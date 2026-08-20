package volumes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Keeping the helper image within reach.
//
// A volume no container has mounted is read through a helper, and a helper
// needs an image. `container run` fetches one when it is missing, which
// quietly makes "look inside this volume" depend on a registry being
// reachable -- and a Mac on a train, or a registry having a bad day, is
// exactly when a volume still has to open.
//
// So a copy is kept where the runtime cannot lose it: an OCI archive in
// ~/.dermaga, written by `container image save`. When the image is gone --
// pruned, or never pulled on this machine at all -- it is loaded back from
// there and nothing touches the network. The copy is refreshed weekly, so
// what gets restored is never far behind what the registry has.

// helperArchive is what the copy is called in ~/.dermaga. One image, one file:
// there is nothing here that needs an index.
const helperArchive = "helper-image.tar"

// The only architecture these Macs are. The local store holds just what was
// pulled, so asking to save the whole multi-arch index fails on the blobs it
// does not have.
const helperPlatform = "linux/arm64"

// How old the copy is allowed to get before it is fetched again. A week is
// plenty: a base image's latest tag moves a handful of times a year, and the
// point of a copy is to exist at all, not to be current to the hour.
const helperMaxAge = 7 * 24 * time.Hour

// How often that age is looked at. One stat, so it can be often enough that a
// Mac left running for a fortnight does not drift.
const helperCheckEvery = 6 * time.Hour

// How long to wait after a pass that got nowhere. A first launch has the
// runtime still starting up, and six hours is a long time to go without a copy
// for a reason that stopped applying two minutes later.
const helperRetryAfter = 30 * time.Minute

// How long the first pass holds off, so it does not run while the splash is
// still installing the CLI and starting the services.
const helperSettle = time.Minute

// Nothing here should take five minutes -- the image is four megabytes. The
// bound is there so a stalled pull cannot wedge the loop that owns it, or the
// volume page that is waiting on it.
const helperTimeout = 5 * time.Minute

// helperStore owns the copy of the helper image, and the schedule that keeps it
// worth having.
type helperStore struct {
	manager *Manager
	// Empty when there is nowhere to keep a copy, which turns every method here
	// into a no-op and leaves things as they were before any of this existed.
	path string
	// One restore or refresh at a time: two `container image load` runs reading
	// the same archive is not a race worth learning the outcome of.
	mu sync.Mutex
}

func newHelperStore(m *Manager) *helperStore {
	store := &helperStore{manager: m}

	home, err := os.UserHomeDir()
	if err != nil {
		m.logger.Warn("Could not resolve home directory; no copy of the helper image will be kept", "error", err)
		return store
	}

	store.path = filepath.Join(home, ".dermaga", helperArchive)

	return store
}

// ensure makes sure the helper image is on the machine before a helper
// container is started from it.
//
// The order is the whole point: what is already here, then the copy on disk,
// and only then the registry -- the one source that can fail for a reason the
// user can do nothing about.
func (h *helperStore) ensure(ctx context.Context) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	present, err := h.present(ctx)
	if err != nil {
		// The image list did not answer, which is a larger problem than a
		// missing helper. Let the command that follows report it: it fails for
		// the same reason, in words about what was actually asked for.
		h.manager.logger.Warn("Could not check whether the helper image is here", "error", err)
		return nil
	}
	if present {
		return nil
	}

	ctx, cancel := context.WithTimeout(ctx, helperTimeout)
	defer cancel()

	err = h.restore(ctx)
	switch {
	case err == nil:
		h.manager.logger.Info("Restored the helper image from the copy on disk", "image", helperImage, "path", h.path)
		return nil
	case errors.Is(err, os.ErrNotExist):
		// Nothing kept yet, which is the ordinary state of a machine that has
		// never needed one.
	default:
		// A copy that will not load is worse than none, because it fails the
		// same way every time. Say so out loud, then go to the registry.
		h.manager.logger.Warn("The copy of the helper image could not be loaded", "path", h.path, "error", err)
	}

	if err := h.fetch(ctx); err != nil {
		return fmt.Errorf("the helper image %s is not on this machine and no copy could be restored: %w", helperImage, err)
	}

	// Fetched once, kept from now on.
	h.store(ctx)

	return nil
}

// keep runs the upkeep for as long as the agent does.
func (h *helperStore) keep(ctx context.Context) {
	if h.path == "" {
		return
	}

	wait := helperSettle

	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}

		if err := h.upkeep(ctx); err != nil {
			h.manager.logger.Warn("Could not keep a copy of the helper image", "error", err)
			wait = helperRetryAfter

			continue
		}

		wait = helperCheckEvery
	}
}

// upkeep fetches what the registry has now and keeps a copy of it, if the copy
// on disk has got old enough to be worth the trouble.
//
// When the pull fails -- offline, nearly always -- an existing copy is left
// exactly as it is, timestamp included, so the next pass tries again instead of
// recording a refresh that never happened. The one exception is a machine that
// has the image but no copy at all: an old copy beats none.
func (h *helperStore) upkeep(ctx context.Context) error {
	if h.path == "" || !h.stale() {
		return nil
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, helperTimeout)
	defer cancel()

	if err := h.fetch(ctx); err != nil {
		if _, statErr := os.Stat(h.path); statErr == nil {
			h.manager.logger.Info("Could not refresh the copy of the helper image; keeping the one on disk", "error", err)
			return nil
		}

		if present, _ := h.present(ctx); !present {
			return err
		}

		h.manager.logger.Warn("Could not reach the registry; copying the helper image already on this machine", "error", err)
	}

	h.store(ctx)

	return nil
}

// stale reports whether the copy is old enough to fetch again. No copy at all
// is stale by definition -- there is nothing older than absent.
func (h *helperStore) stale() bool {
	if h.path == "" {
		return false
	}

	info, err := os.Stat(h.path)
	if err != nil {
		return true
	}

	return time.Since(info.ModTime()) >= helperMaxAge
}

// present reports whether the runtime already holds the helper image.
//
// It reads the image list itself rather than going through the images package,
// which would be a dependency for one field. The name the CLI reports is fully
// qualified -- docker.io/library/alpine:latest, whatever was typed to pull it
// -- which is why the constant it is compared against is too.
func (h *helperStore) present(ctx context.Context) (bool, error) {
	out, err := h.manager.runner.Run(ctx, "image", "list", "--format", "json")
	if err != nil {
		return false, err
	}

	return holdsHelper(out)
}

func holdsHelper(out []byte) (bool, error) {
	var listed []struct {
		Configuration struct {
			Name string `json:"name"`
		} `json:"configuration"`
	}

	if err := json.Unmarshal(out, &listed); err != nil {
		return false, fmt.Errorf("could not read the image list: %w", err)
	}

	for _, image := range listed {
		if image.Configuration.Name == helperImage {
			return true, nil
		}
	}

	return false, nil
}

// restore loads the copy back into the runtime, and reports os.ErrNotExist when
// there is none to load.
func (h *helperStore) restore(ctx context.Context) error {
	if h.path == "" {
		return os.ErrNotExist
	}

	if _, err := os.Stat(h.path); err != nil {
		return err
	}

	_, err := h.manager.runner.Run(ctx, "image", "load", "--input", h.path)

	return err
}

// fetch is the only step that needs a network.
func (h *helperStore) fetch(ctx context.Context) error {
	_, err := h.manager.runner.Run(ctx, "image", "pull", helperImage)

	return err
}

// store writes the copy out, over any older one.
//
// It never fails anything: not being able to keep a copy is a worse tomorrow,
// not a broken today, and the caller is usually in the middle of doing what the
// user actually asked for.
//
// Written beside the real file and renamed over it, so a save that is cut short
// cannot leave a truncated archive where a good one used to be -- which would
// break the one thing here that is supposed to work when nothing else does.
func (h *helperStore) store(ctx context.Context) {
	if h.path == "" {
		return
	}

	if err := os.MkdirAll(filepath.Dir(h.path), 0o755); err != nil {
		h.manager.logger.Warn("Could not create the directory for the helper image copy",
			"path", filepath.Dir(h.path), "error", err)

		return
	}

	temp := h.path + ".tmp"
	defer os.Remove(temp)

	if _, err := h.manager.runner.Run(ctx,
		"image", "save", helperImage, "--platform", helperPlatform, "--output", temp,
	); err != nil {
		h.manager.logger.Warn("Could not copy the helper image out", "image", helperImage, "error", err)

		return
	}

	if err := os.Rename(temp, h.path); err != nil {
		h.manager.logger.Warn("Could not save the copy of the helper image", "path", h.path, "error", err)

		return
	}

	h.manager.logger.Info("Kept a copy of the helper image", "image", helperImage, "path", h.path)
}
