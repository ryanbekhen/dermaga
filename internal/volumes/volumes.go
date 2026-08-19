// Package volumes wraps `container volume`.
package volumes

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
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
