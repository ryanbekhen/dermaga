package machines

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"sync"

	"github.com/ryanbekhen/dermaga/internal/cli"
	"github.com/ryanbekhen/dermaga/internal/notify"
)

// Machine is a container machine -- the Linux VM that containers actually run
// inside. Apple's CLI manages these separately from containers, so Dermaga
// surfaces them as their own top-level resource.
type Machine struct {
	ID               string `json:"id"`
	Status           string `json:"status"`
	Default          bool   `json:"default"`
	CreatedAt        string `json:"createdAt"`
	CPUs             int    `json:"cpus"`
	MemoryBytes      int64  `json:"memoryBytes"`
	MemoryAllocation string `json:"memoryAllocation"`
	DiskSizeBytes    int64  `json:"diskSizeBytes"`
	StartedAt        string `json:"startedAt,omitempty"`
	IPAddress        string `json:"ipAddress,omitempty"`
	ContainerID      string `json:"containerId,omitempty"`

	// Only populated by inspect.
	Image        string `json:"image,omitempty"`
	HomeMount    string `json:"homeMount,omitempty"`
	Architecture string `json:"architecture,omitempty"`
	OS           string `json:"os,omitempty"`
	Username     string `json:"username,omitempty"`
}

type cliMachine struct {
	ID          string `json:"id"`
	Status      string `json:"status"`
	Default     bool   `json:"default"`
	CreatedDate string `json:"createdDate"`
	StartedDate string `json:"startedDate"`
	IPAddress   string `json:"ipAddress"`
	ContainerID string `json:"containerId"`
	CPUs        int    `json:"cpus"`
	Memory      int64  `json:"memory"`
	DiskSize    int64  `json:"diskSize"`
	HomeMount   string `json:"homeMount"`
	Image       struct {
		Reference string `json:"reference"`
	} `json:"image"`
	Platform struct {
		Architecture string `json:"architecture"`
		OS           string `json:"os"`
	} `json:"platform"`
	UserSetup struct {
		Username string `json:"username"`
	} `json:"userSetup"`
}

type Manager struct {
	runner  *cli.Runner
	logger  *slog.Logger
	changed notify.Notifier
}

func NewManager(runner *cli.Runner, logger *slog.Logger, changed notify.Notifier) *Manager {
	return &Manager{runner: runner, logger: logger, changed: changed}
}

func (mm *Manager) List(ctx context.Context) ([]Machine, error) {
	output, err := mm.runner.Run(ctx, "machine", "list", "--format", "json")
	if err != nil {
		mm.logger.Error("Failed to list machines", "error", err)
		return nil, err
	}

	machines, err := parseMachines(output)
	if err != nil {
		return nil, err
	}

	mm.enrich(ctx, machines)

	return machines, nil
}

// enrich fills in what `machine list` leaves out -- start time, VM id, image,
// home mount, platform -- by inspecting each machine. Hosts have one or two
// machines, and the inspections run in parallel, so this costs one round trip.
func (mm *Manager) enrich(ctx context.Context, machines []Machine) {
	var wg sync.WaitGroup

	for i := range machines {
		wg.Add(1)

		go func(i int) {
			defer wg.Done()

			output, err := mm.runner.Run(ctx, "machine", "inspect", machines[i].ID)
			if err != nil {
				return
			}

			detailed, err := parseMachines(output)
			if err != nil || len(detailed) == 0 {
				return
			}

			d := detailed[0]
			// The list is authoritative for status and the default flag; the
			// inspect output does not carry the latter at all.
			d.Status = machines[i].Status
			d.Default = machines[i].Default
			machines[i] = d
		}(i)
	}

	wg.Wait()
}

// GetMachine returns the inspect view, which carries the image, platform and
// home-mount details the list output leaves out.
func (mm *Manager) Get(ctx context.Context, id string) (*Machine, error) {
	output, err := mm.runner.Run(ctx, "machine", "inspect", id)
	if err != nil {
		return nil, err
	}

	machines, err := parseMachines(output)
	if err != nil {
		return nil, err
	}
	if len(machines) == 0 {
		return nil, fmt.Errorf("machine not found: %s", id)
	}

	// `machine inspect` omits the default flag; recover it from the list.
	if listed, err := mm.List(ctx); err == nil {
		for _, m := range listed {
			if m.ID == machines[0].ID {
				machines[0].Default = m.Default
				break
			}
		}
	}

	return &machines[0], nil
}

func parseMachines(output []byte) ([]Machine, error) {
	var raw []cliMachine
	if err := json.Unmarshal(output, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse machine list: %w", err)
	}

	machines := make([]Machine, 0, len(raw))
	for _, r := range raw {
		status := strings.ToLower(r.Status)
		if status == "" {
			status = "unknown"
		}

		machines = append(machines, Machine{
			ID:               r.ID,
			Status:           status,
			Default:          r.Default,
			CreatedAt:        r.CreatedDate,
			CPUs:             r.CPUs,
			MemoryBytes:      r.Memory,
			MemoryAllocation: cli.FormatMebibytes(r.Memory),
			DiskSizeBytes:    r.DiskSize,
			StartedAt:        r.StartedDate,
			IPAddress:        r.IPAddress,
			ContainerID:      r.ContainerID,
			Image:            r.Image.Reference,
			HomeMount:        r.HomeMount,
			Architecture:     r.Platform.Architecture,
			OS:               r.Platform.OS,
			Username:         r.UserSetup.Username,
		})
	}

	return machines, nil
}

// StartMachine boots a stopped machine. The CLI has no explicit start verb --
// `machine run` boots one if necessary -- so we run the cheapest possible
// command inside it.
func (mm *Manager) Start(ctx context.Context, id string) (*Machine, error) {
	if _, err := mm.runner.Run(ctx, "machine", "run", "--name", id, "--", "true"); err != nil {
		mm.logger.Error("Failed to start machine", "id", id, "error", err)
		return nil, err
	}
	mm.changed.Changed()

	return mm.Get(ctx, id)
}

func (mm *Manager) Stop(ctx context.Context, id string) (*Machine, error) {
	if _, err := mm.runner.Run(ctx, "machine", "stop", id); err != nil {
		mm.logger.Error("Failed to stop machine", "id", id, "error", err)
		return nil, err
	}
	mm.changed.Changed()

	return mm.Get(ctx, id)
}

// StreamLogs follows a machine's log output. boot selects the boot log instead
// of stdio.
func (mm *Manager) LogsCommand(ctx context.Context, id string, tail int, follow, boot bool) *exec.Cmd {
	return mm.runner.Command(ctx, logsCommandArgs(id, tail, follow, boot)...)
}

// MachineSpec is what `container machine create` accepts.
type Spec struct {
	Name           string `json:"name"`
	Image          string `json:"image"`
	CPUs           int    `json:"cpus,omitempty"`
	Memory         string `json:"memory,omitempty"`
	HomeMount      string `json:"homeMount,omitempty"`
	SetDefault     bool   `json:"setDefault,omitempty"`
	NoBoot         bool   `json:"noBoot,omitempty"`
	Virtualization bool   `json:"virtualization,omitempty"`
}

// CreateArgs renders the spec as CLI arguments. Creating pulls an image, so the
// caller streams the command's progress rather than waiting on it.
func (s Spec) CreateArgs() []string {
	args := []string{"machine", "create", "--progress", "plain"}

	if s.Name != "" {
		args = append(args, "--name", s.Name)
	}
	if s.CPUs > 0 {
		args = append(args, "--cpus", fmt.Sprintf("%d", s.CPUs))
	}
	if s.Memory != "" {
		args = append(args, "--memory", s.Memory)
	}
	if s.HomeMount != "" {
		args = append(args, "--home-mount", s.HomeMount)
	}
	if s.SetDefault {
		args = append(args, "--set-default")
	}
	if s.NoBoot {
		args = append(args, "--no-boot")
	}
	if s.Virtualization {
		args = append(args, "--virtualization")
	}

	return append(args, s.Image)
}

func (s Spec) Validate() error {
	if strings.TrimSpace(s.Image) == "" {
		return fmt.Errorf("an image is required, for example ubuntu:26.04")
	}
	if strings.ContainsAny(s.Name, " \t/") {
		return fmt.Errorf("machine name cannot contain spaces or slashes")
	}
	switch s.HomeMount {
	case "", "ro", "rw", "none":
	default:
		return fmt.Errorf("home mount must be ro, rw or none")
	}

	// A machine is a virtual machine, and the runtime will not boot one in less
	// than a gibibyte: `invalid memory value '512mb'. Must be greater than
	// 1gb`. It says so only after fetching and unpacking the image, which is
	// the better part of a minute spent to be told a number was too small.
	if mib := cli.Mebibytes(s.Memory); s.Memory != "" && mib > 0 && mib < 1024 {
		return fmt.Errorf("memory must be at least 1G (got %s)", s.Memory)
	}

	return nil
}

// CreateMachine builds the create command for the caller to stream.
func (mm *Manager) CreateCommand(ctx context.Context, spec Spec) (*exec.Cmd, error) {
	if err := spec.Validate(); err != nil {
		return nil, err
	}

	return mm.runner.Command(ctx, spec.CreateArgs()...), nil
}

func (mm *Manager) Delete(ctx context.Context, id string) error {
	if _, err := mm.runner.Run(ctx, "machine", "delete", id); err != nil {
		mm.logger.Error("Failed to delete machine", "id", id, "error", err)
		return err
	}
	mm.changed.Changed()

	return nil
}

func (mm *Manager) SetDefault(ctx context.Context, id string) error {
	if _, err := mm.runner.Run(ctx, "machine", "set-default", id); err != nil {
		mm.logger.Error("Failed to set default machine", "id", id, "error", err)
		return err
	}
	mm.changed.Changed()

	return nil
}

// MachineSettings are the values `container machine set` accepts. They take
// effect when the machine next restarts, which the UI says out loud.
type Settings struct {
	CPUs           int    `json:"cpus,omitempty"`
	Memory         string `json:"memory,omitempty"`
	HomeMount      string `json:"homeMount,omitempty"`
	Virtualization *bool  `json:"virtualization,omitempty"`
	Kernel         string `json:"kernel,omitempty"`
}

func (mm *Manager) Configure(ctx context.Context, id string, settings Settings) (*Machine, error) {
	args, err := configureArgs(id, settings)
	if err != nil {
		return nil, err
	}
	// Nothing to set means nothing to run.
	if args == nil {
		return mm.Get(ctx, id)
	}

	if _, err := mm.runner.Run(ctx, args...); err != nil {
		mm.logger.Error("Failed to configure machine", "id", id, "error", err)
		return nil, err
	}
	mm.changed.Changed()

	return mm.Get(ctx, id)
}
