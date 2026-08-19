// Package volumes wraps `container volume`.
package volumes

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"syscall"

	"github.com/ryanbekhen/dermaga/internal/cli"
	"github.com/ryanbekhen/dermaga/internal/notify"
)

// Manager owns every volume operation.
type Manager struct {
	runner  *cli.Runner
	logger  *slog.Logger
	changed notify.Notifier
}

func NewManager(runner *cli.Runner, logger *slog.Logger, changed notify.Notifier) *Manager {
	return &Manager{runner: runner, logger: logger, changed: changed}
}

type Volume struct {
	Name        string `json:"name"`
	Driver      string `json:"driver"`
	Format      string `json:"format"`
	Source      string `json:"source"`
	SizeInBytes int64  `json:"sizeInBytes"`
	// What the volume is actually costing on disk. The size above is the cap
	// the image was created with -- half a terabyte by default -- which says
	// nothing at all about how full it is.
	UsedBytes int64             `json:"usedBytes"`
	CreatedAt string            `json:"createdAt"`
	Labels    map[string]string `json:"labels"`
	/** Containers currently mounting this volume, filled in by the watcher. */
	UsedBy []string `json:"usedBy"`
}

type cliVolume struct {
	ID            string `json:"id"`
	Configuration struct {
		Name         string            `json:"name"`
		Driver       string            `json:"driver"`
		Format       string            `json:"format"`
		Source       string            `json:"source"`
		SizeInBytes  int64             `json:"sizeInBytes"`
		CreationDate string            `json:"creationDate"`
		Labels       map[string]string `json:"labels"`
	} `json:"configuration"`
}

func (m *Manager) List(ctx context.Context) ([]Volume, error) {
	output, err := m.runner.Run(ctx, "volume", "list", "--format", "json")
	if err != nil {
		return nil, err
	}

	return parse(output)
}

func parse(output []byte) ([]Volume, error) {
	var raw []cliVolume
	if err := json.Unmarshal(output, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse volume list: %w", err)
	}

	volumes := make([]Volume, 0, len(raw))
	for _, r := range raw {
		name := r.Configuration.Name
		if name == "" {
			name = r.ID
		}

		labels := r.Configuration.Labels
		if labels == nil {
			labels = map[string]string{}
		}

		volumes = append(volumes, Volume{
			Name:        name,
			Driver:      r.Configuration.Driver,
			Format:      r.Configuration.Format,
			Source:      r.Configuration.Source,
			SizeInBytes: r.Configuration.SizeInBytes,
			UsedBytes:   onDisk(r.Configuration.Source),
			CreatedAt:   r.Configuration.CreationDate,
			Labels:      labels,
			UsedBy:      []string{},
		})
	}

	return volumes, nil
}

// onDisk measures the volume image the way the finder does: by the blocks it
// actually occupies. The file is sparse, so its apparent length is the cap and
// not the answer to "what is this costing me?".
func onDisk(source string) int64 {
	if source == "" {
		return 0
	}

	info, err := os.Stat(source)
	if err != nil {
		return 0
	}

	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return info.Size()
	}

	return stat.Blocks * 512
}

type Spec struct {
	Name   string            `json:"name"`
	Size   string            `json:"size,omitempty"`
	Labels map[string]string `json:"labels,omitempty"`
	Opts   map[string]string `json:"options,omitempty"`
}

func (m *Manager) Create(ctx context.Context, spec Spec) error {
	if strings.TrimSpace(spec.Name) == "" {
		return fmt.Errorf("volume name is required")
	}

	args := []string{"volume", "create"}
	if spec.Size != "" {
		args = append(args, "-s", spec.Size)
	}
	for key, value := range spec.Labels {
		args = append(args, "--label", fmt.Sprintf("%s=%s", key, value))
	}
	for key, value := range spec.Opts {
		args = append(args, "--opt", fmt.Sprintf("%s=%s", key, value))
	}
	args = append(args, spec.Name)

	if _, err := m.runner.Run(ctx, args...); err != nil {
		m.logger.Error("Failed to create volume", "name", spec.Name, "error", err)
		return err
	}
	m.changed.Changed()

	// A volume made here comes out looking empty, so that images which inspect
	// their data directory before touching it -- redis, Postgres -- behave the
	// way their authors intended. Best effort: a volume that exists is worth
	// more than one that failed to be tidied, and the volume page can finish
	// the job later.
	if err := m.Tidy(ctx, spec.Name, nil); err != nil {
		m.logger.Warn("Created the volume but could not tidy it", "name", spec.Name, "error", err)
	}

	return nil
}

func (m *Manager) Delete(ctx context.Context, name string) error {
	if _, err := m.runner.Run(ctx, "volume", "delete", name); err != nil {
		m.logger.Error("Failed to delete volume", "name", name, "error", err)
		return err
	}
	m.changed.Changed()

	return nil
}

// Where a volume is already mounted, when some running container has it.
//
// A disk image can only be attached to one running VM at a time, so a volume
// in use cannot be mounted again to look at it -- but the container that holds
// it can be asked instead, which is both allowed and instant.
type Mount struct {
	// Empty when nothing holds the volume; a helper is used then.
	Container string
	Path      string
	// The volume itself, so a helper knows what to mount.
	Volume string
}

// The image a helper container is built from when nothing else has the volume.
// Small, and almost certainly already on the machine.
const helperImage = "alpine:latest"

// Where the helper mounts the volume it was started for.
const helperPath = "/volume"

// ownerPattern is what a POSIX owner looks like: uid, or uid:gid. Anything else
// is refused rather than passed to chown, where a stray "--reference=/etc" or a
// user name that does not exist inside the helper would mean something else
// entirely.
var ownerPattern = regexp.MustCompile(`^\d+(:\d+)?$`)

// ValidOwner reports whether an owner is one this package will act on.
func ValidOwner(owner string) bool {
	return ownerPattern.MatchString(owner)
}

// State is what a container will find when it mounts the volume: who owns the
// root directory, and whether the filesystem's own lost+found is still sitting
// in it.
type State struct {
	Owner string `json:"owner"`
	// Every ext4 filesystem has one, and a volume here is an ext4 filesystem.
	// Images disagree with that: the redis entrypoint refuses to fix ownership
	// when it finds anything unexpected in the data directory ("Notice: Unknown
	// file './lost+found' found in data dir"), and Postgres refuses to
	// initialise a data directory that is not empty. Both then fail with an
	// error that never mentions a volume.
	LostFound bool `json:"lostFound"`
}

// Inspect reads both in one visit, since either answer costs the same trip.
func (m *Manager) Inspect(ctx context.Context, name string, in *Mount) (State, error) {
	path := pathOf(in)
	script := fmt.Sprintf(
		`stat -c %%u:%%g %s; [ -d %s/lost+found ] && echo yes || echo no`, path, path,
	)

	out, err := m.runner.Run(ctx, commandIn(withVolume(in, name), []string{"sh", "-c", script})...)
	if err != nil {
		return State{}, fmt.Errorf("could not read %s: %w", name, err)
	}

	lines := strings.Fields(string(out))
	if len(lines) < 2 {
		return State{}, fmt.Errorf("could not read %s: unexpected output %q", name, string(out))
	}

	return State{Owner: lines[0], LostFound: lines[1] == "yes"}, nil
}

// Tidy removes the filesystem's lost+found, which is what makes a fresh volume
// look occupied to an image that checks.
//
// Nothing is lost with it: it is created empty by mkfs and only ever filled by
// a filesystem check recovering orphaned inodes, which would recreate it.
func (m *Manager) Tidy(ctx context.Context, name string, in *Mount) error {
	target := pathOf(in) + "/lost+found"

	if _, err := m.runner.Run(ctx, commandIn(withVolume(in, name), []string{"rm", "-rf", target})...); err != nil {
		return fmt.Errorf("could not tidy %s: %w", name, err)
	}

	return nil
}

// Owner reports who owns the volume's root directory, as "uid:gid".
//
// It is the answer to the question behind most "permission denied" in a
// container: the image runs as somebody other than root, and a volume is born
// owned by root.
func (m *Manager) Owner(ctx context.Context, name string, in *Mount) (string, error) {
	args := commandIn(withVolume(in, name), []string{"stat", "-c", "%u:%g", pathOf(in)})

	out, err := m.runner.Run(ctx, args...)
	if err != nil {
		return "", fmt.Errorf("could not read the owner of %s: %w", name, err)
	}

	return strings.TrimSpace(string(out)), nil
}

// SetOwner hands the whole volume to a user, which is what makes a Postgres or
// a Redis image able to write to it.
func (m *Manager) SetOwner(ctx context.Context, name, owner string, in *Mount) error {
	if !ValidOwner(owner) {
		return fmt.Errorf("owner must be a uid or uid:gid, not %q", owner)
	}

	args := commandIn(withVolume(in, name), []string{"chown", "-R", owner, pathOf(in)})

	if _, err := m.runner.Run(ctx, args...); err != nil {
		return fmt.Errorf("could not set the owner of %s: %w", name, err)
	}

	return nil
}

// withVolume fills in the volume a helper would have to mount.
func withVolume(in *Mount, name string) *Mount {
	if in == nil {
		return &Mount{Volume: name}
	}

	copied := *in
	copied.Volume = name

	return &copied
}

// pathOf is where the volume can be reached: inside the container already
// holding it, or at the helper's own mount point.
func pathOf(in *Mount) string {
	if in != nil && in.Container != "" {
		return in.Path
	}

	return helperPath
}

// commandIn runs the command wherever the volume is reachable: through the
// container that has it, or through a helper started for the purpose.
func commandIn(in *Mount, command []string) []string {
	if in != nil && in.Container != "" {
		return append([]string{"exec", in.Container}, command...)
	}

	return append([]string{"run", "--rm", "--mount", mountSpec(in), helperImage}, command...)
}

func mountSpec(in *Mount) string {
	name := ""
	if in != nil {
		name = in.Volume
	}

	return fmt.Sprintf("type=volume,source=%s,target=%s", name, helperPath)
}
