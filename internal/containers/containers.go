package containers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/ryanbekhen/dermaga/internal/cli"
	"github.com/ryanbekhen/dermaga/internal/notify"
	"github.com/ryanbekhen/dermaga/internal/store"
)

// Container is the flat, API-facing representation of a container. The Apple
// `container` CLI reports a deeply nested structure; everything in this file
// exists to flatten it into this shape.
type Container struct {
	ID               string             `json:"id"`
	Name             string             `json:"name"`
	Image            string             `json:"image"`
	Status           string             `json:"status"`
	State            string             `json:"state"`
	CreatedAt        string             `json:"createdAt"`
	StartedAt        string             `json:"startedAt,omitempty"`
	Ports            []Port             `json:"ports"`
	Mounts           []Mount            `json:"mounts"`
	Labels           map[string]string  `json:"labels"`
	CPUAllocation    int                `json:"cpuAllocation,omitempty"`
	MemoryAllocation string             `json:"memoryAllocation,omitempty"`
	EnvironmentVars  []string           `json:"environmentVariables,omitempty"`
	Networks         []string           `json:"networks"`
	Interfaces       []NetworkInterface `json:"interfaces"`
	Hostname         string             `json:"hostname,omitempty"`
	Platform         string             `json:"platform,omitempty"`
	RuntimeHandler   string             `json:"runtimeHandler,omitempty"`
	StopSignal       string             `json:"stopSignal,omitempty"`
	DNS              DNSConfig          `json:"dns"`
	CapAdd           []string           `json:"capAdd"`
	CapDrop          []string           `json:"capDrop"`
	Sysctls          map[string]string  `json:"sysctls"`
	Rosetta          bool               `json:"rosetta"`
	Virtualization   bool               `json:"virtualization"`
	SSH              bool               `json:"ssh"`
	ReadOnlyRoot     bool               `json:"readOnlyRoot"`
	UseInit          bool               `json:"useInit"`
	Terminal         bool               `json:"terminal"`
	Entrypoint       string             `json:"entrypoint,omitempty"`
	Command          []string           `json:"command,omitempty"`
	WorkingDir       string             `json:"workingDir,omitempty"`
	User             string             `json:"user,omitempty"`

	// Live usage, merged in from the stats sampler. The percentages are always
	// present (0 is a meaningful reading); MemoryUsage is empty until the
	// first sample lands for a running container.
	CPUUsage           float64 `json:"cpuUsage"`
	MemoryUsage        string  `json:"memoryUsage,omitempty"`
	MemoryUsageBytes   int64   `json:"memoryUsageBytes"`
	MemoryUsagePercent float64 `json:"memoryUsagePercent"`

	// Network and disk, each as a rate and as a total since the container
	// started, plus the number of processes inside it.
	NetworkRxBytes   int64   `json:"networkRxBytes"`
	NetworkTxBytes   int64   `json:"networkTxBytes"`
	NetworkRxPerSec  float64 `json:"networkRxPerSec"`
	NetworkTxPerSec  float64 `json:"networkTxPerSec"`
	BlockReadBytes   int64   `json:"blockReadBytes"`
	BlockWriteBytes  int64   `json:"blockWriteBytes"`
	BlockReadPerSec  float64 `json:"blockReadPerSec"`
	BlockWritePerSec float64 `json:"blockWritePerSec"`
	Processes        int     `json:"processes"`
}

// NetworkInterface is one attachment of a container to a network, as reported
// once it is running. A stopped container has none.
type NetworkInterface struct {
	Network     string `json:"network"`
	Hostname    string `json:"hostname,omitempty"`
	IPv4Address string `json:"ipv4Address,omitempty"`
	IPv4Gateway string `json:"ipv4Gateway,omitempty"`
	IPv6Address string `json:"ipv6Address,omitempty"`
	MACAddress  string `json:"macAddress,omitempty"`
	MTU         int    `json:"mtu,omitempty"`
}

type DNSConfig struct {
	Nameservers   []string `json:"nameservers"`
	SearchDomains []string `json:"searchDomains"`
	Options       []string `json:"options"`
	Domain        string   `json:"domain,omitempty"`
}

type Port struct {
	Host      string `json:"host"`
	Container string `json:"container"`
	Protocol  string `json:"protocol"`
}

type Mount struct {
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Type        string `json:"type"`
	ReadOnly    bool   `json:"readOnly,omitempty"`
}

// cliContainer mirrors the subset of `container list --format json` that we
// care about. Fields we do not surface are deliberately omitted.
type cliContainer struct {
	ID     string `json:"id"`
	Status struct {
		State       string `json:"state"`
		StartedDate string `json:"startedDate"`
		Networks    []struct {
			Network     string `json:"network"`
			Hostname    string `json:"hostname"`
			IPv4Address string `json:"ipv4Address"`
			IPv4Gateway string `json:"ipv4Gateway"`
			IPv6Address string `json:"ipv6Address"`
			MACAddress  string `json:"macAddress"`
			MTU         int    `json:"mtu"`
		} `json:"networks"`
	} `json:"status"`
	Configuration struct {
		ID           string            `json:"id"`
		CreationDate string            `json:"creationDate"`
		Labels       map[string]string `json:"labels"`
		Image        struct {
			Reference string `json:"reference"`
		} `json:"image"`
		InitProcess struct {
			Environment      []string `json:"environment"`
			Executable       string   `json:"executable"`
			Arguments        []string `json:"arguments"`
			WorkingDirectory string   `json:"workingDirectory"`
			Terminal         bool     `json:"terminal"`
			User             struct {
				ID struct {
					UID int `json:"uid"`
					GID int `json:"gid"`
				} `json:"id"`
			} `json:"user"`
		} `json:"initProcess"`
		Mounts []struct {
			Source      string   `json:"source"`
			Destination string   `json:"destination"`
			Options     []string `json:"options"`
			// Type is a tagged union: {"volume":{"name":...}}, {"virtiofs":{}}, ...
			Type map[string]struct {
				Name string `json:"name"`
			} `json:"type"`
		} `json:"mounts"`
		Networks []struct {
			Network string `json:"network"`
			Options struct {
				Hostname string `json:"hostname"`
			} `json:"options"`
		} `json:"networks"`
		PublishedPorts []struct {
			ContainerPort int    `json:"containerPort"`
			HostPort      int    `json:"hostPort"`
			HostAddress   string `json:"hostAddress"`
			Proto         string `json:"proto"`
		} `json:"publishedPorts"`
		Resources struct {
			CPUs          int   `json:"cpus"`
			MemoryInBytes int64 `json:"memoryInBytes"`
		} `json:"resources"`
		Platform struct {
			Architecture string `json:"architecture"`
			OS           string `json:"os"`
		} `json:"platform"`
		DNS struct {
			Nameservers   []string `json:"nameservers"`
			SearchDomains []string `json:"searchDomains"`
			Options       []string `json:"options"`
			Domain        string   `json:"domain"`
		} `json:"dns"`
		CapAdd         []string          `json:"capAdd"`
		CapDrop        []string          `json:"capDrop"`
		Sysctls        map[string]string `json:"sysctls"`
		RuntimeHandler string            `json:"runtimeHandler"`
		StopSignal     string            `json:"stopSignal"`
		Rosetta        bool              `json:"rosetta"`
		Virtualization bool              `json:"virtualization"`
		SSH            bool              `json:"ssh"`
		ReadOnly       bool              `json:"readOnly"`
		UseInit        bool              `json:"useInit"`
	} `json:"configuration"`
}

// ContainerManager wraps the `container` CLI. It holds no container state of
// its own -- every request shells out -- except for the stats sampler, which
// needs two samples to compute a CPU percentage.
type Manager struct {
	runner  *cli.Runner
	logger  *slog.Logger
	stats   *StatsSampler
	changed notify.Notifier
	// Edits that were begun and not finished, so a failed recreate does not
	// take the user's changes with it.
	pending *PendingStore
}

func NewManager(runner *cli.Runner, logger *slog.Logger, changed notify.Notifier) *Manager {
	return &Manager{
		runner:  runner,
		logger:  logger,
		stats:   NewStatsSampler(runner, logger),
		changed: changed,
		pending: NewPendingStore(logger),
	}
}

// Pending exposes the unfinished edits, so the window can offer them back.
func (cm *Manager) Pending() *PendingStore {
	return cm.pending
}

// Stats exposes the sampler so the agent can run it in the background.
func (cm *Manager) Stats() *StatsSampler {
	return cm.stats
}

// UsePendingStore hands the unfinished-edit store somewhere to keep them.
func (cm *Manager) UsePendingStore(db *store.Store) {
	cm.pending.UseStore(db)
}

func (cm *Manager) List(ctx context.Context, all bool) ([]Container, error) {
	args := []string{"list", "--format", "json"}
	if all {
		args = append(args, "--all")
	}

	output, err := cm.runner.Run(ctx, args...)
	if err != nil {
		cm.logger.Error("Failed to list containers", "error", err)
		return nil, err
	}

	containers, err := parseContainerList(output)
	if err != nil {
		cm.logger.Error("Failed to parse container list", "error", err)
		return nil, err
	}

	cm.stats.Apply(containers)

	return containers, nil
}

func parseContainerList(output []byte) ([]Container, error) {
	var raw []cliContainer
	if err := json.Unmarshal(output, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse container list: %w", err)
	}

	containers := make([]Container, 0, len(raw))
	for _, r := range raw {
		containers = append(containers, toContainer(r))
	}

	return containers, nil
}

// toContainer flattens one CLI record into the API shape.
func toContainer(r cliContainer) Container {
	cfg := r.Configuration

	state := strings.ToLower(r.Status.State)
	if state == "" {
		state = "unknown"
	}

	name := cfg.ID
	if name == "" {
		name = r.ID
	}
	// The CLI uses the container ID as its name; the network hostname is the
	// closest thing to a user-facing label when they diverge.
	//
	// Only the first label of it. Once a DNS domain is configured the runtime
	// fills this in fully qualified -- "whoami.internal.", root dot and all --
	// and a list of containers called that is a list nobody asked for. The
	// domain is the same for every one of them, so it says nothing here that
	// repeating it forty times does not take away.
	for _, n := range cfg.Networks {
		if label := firstLabel(n.Options.Hostname); label != "" {
			name = label
			break
		}
	}

	networks := make([]string, 0, len(cfg.Networks))
	for _, n := range cfg.Networks {
		if n.Network != "" {
			networks = append(networks, n.Network)
		}
	}

	// A non-root user is worth round-tripping into the edit form; uid 0 is the
	// default and would only add noise.
	user := ""
	if uid := cfg.InitProcess.User.ID.UID; uid != 0 {
		user = fmt.Sprintf("%d", uid)
		if gid := cfg.InitProcess.User.ID.GID; gid != 0 {
			user = fmt.Sprintf("%d:%d", uid, gid)
		}
	}

	// Addresses only exist while the container is running.
	interfaces := make([]NetworkInterface, 0, len(r.Status.Networks))
	hostname := ""
	for _, n := range r.Status.Networks {
		if hostname == "" {
			hostname = n.Hostname
		}
		interfaces = append(interfaces, NetworkInterface{
			Network:     n.Network,
			Hostname:    n.Hostname,
			IPv4Address: n.IPv4Address,
			IPv4Gateway: n.IPv4Gateway,
			IPv6Address: n.IPv6Address,
			MACAddress:  n.MACAddress,
			MTU:         n.MTU,
		})
	}
	if hostname == "" {
		for _, n := range cfg.Networks {
			if n.Options.Hostname != "" {
				hostname = n.Options.Hostname
				break
			}
		}
	}

	platform := ""
	if cfg.Platform.OS != "" || cfg.Platform.Architecture != "" {
		platform = fmt.Sprintf("%s/%s", cfg.Platform.OS, cfg.Platform.Architecture)
	}

	ports := make([]Port, 0, len(cfg.PublishedPorts))
	for _, p := range cfg.PublishedPorts {
		proto := p.Proto
		if proto == "" {
			proto = "tcp"
		}
		ports = append(ports, Port{
			Host:      fmt.Sprintf("%d", p.HostPort),
			Container: fmt.Sprintf("%d", p.ContainerPort),
			Protocol:  proto,
		})
	}

	mounts := make([]Mount, 0, len(cfg.Mounts))
	for _, m := range cfg.Mounts {
		mount := Mount{
			Source:      m.Source,
			Destination: m.Destination,
			Type:        "bind",
			ReadOnly:    hasReadOnlyOption(m.Options),
		}
		// A volume mount reports its human-readable volume name inside the
		// union; prefer that over the on-disk image path.
		for kind, detail := range m.Type {
			mount.Type = kind
			if detail.Name != "" {
				mount.Source = detail.Name
			}
			break
		}
		mounts = append(mounts, mount)
	}

	labels := cfg.Labels
	if labels == nil {
		labels = map[string]string{}
	}

	sysctls := cfg.Sysctls
	if sysctls == nil {
		sysctls = map[string]string{}
	}
	cfg.Sysctls = sysctls

	return Container{
		ID:               r.ID,
		Name:             name,
		Image:            cfg.Image.Reference,
		Status:           state,
		State:            state,
		CreatedAt:        cfg.CreationDate,
		StartedAt:        r.Status.StartedDate,
		Ports:            ports,
		Mounts:           mounts,
		Labels:           labels,
		CPUAllocation:    cfg.Resources.CPUs,
		MemoryAllocation: formatMebibytes(cfg.Resources.MemoryInBytes),
		EnvironmentVars:  cfg.InitProcess.Environment,
		Networks:         networks,
		Entrypoint:       cfg.InitProcess.Executable,
		Command:          cfg.InitProcess.Arguments,
		WorkingDir:       cfg.InitProcess.WorkingDirectory,
		User:             user,
		Interfaces:       interfaces,
		Hostname:         hostname,
		Platform:         platform,
		RuntimeHandler:   cfg.RuntimeHandler,
		StopSignal:       cfg.StopSignal,
		DNS: DNSConfig{
			Nameservers:   orEmpty(cfg.DNS.Nameservers),
			SearchDomains: orEmpty(cfg.DNS.SearchDomains),
			Options:       orEmpty(cfg.DNS.Options),
			Domain:        cfg.DNS.Domain,
		},
		CapAdd:         orEmpty(cfg.CapAdd),
		CapDrop:        orEmpty(cfg.CapDrop),
		Sysctls:        cfg.Sysctls,
		Rosetta:        cfg.Rosetta,
		Virtualization: cfg.Virtualization,
		SSH:            cfg.SSH,
		ReadOnlyRoot:   cfg.ReadOnly,
		UseInit:        cfg.UseInit,
		Terminal:       cfg.InitProcess.Terminal,
	}
}

// orEmpty keeps JSON arrays as [] rather than null, so the UI never has to
// guard against a missing list.
func orEmpty(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func hasReadOnlyOption(options []string) bool {
	for _, o := range options {
		switch strings.ToLower(strings.TrimSpace(o)) {
		case "ro", "readonly", "read-only":
			return true
		}
	}
	return false
}

// formatMebibytes renders a byte count the way the CLI accepts it back, e.g.
// 2147483648 -> "2048m".
func formatMebibytes(bytes int64) string {
	if bytes <= 0 {
		return ""
	}
	return fmt.Sprintf("%dm", bytes/(1024*1024))
}

func (cm *Manager) Get(ctx context.Context, id string) (*Container, error) {
	containers, err := cm.List(ctx, true)
	if err != nil {
		return nil, err
	}

	for i := range containers {
		if containers[i].ID == id || containers[i].Name == id {
			return &containers[i], nil
		}
	}

	return nil, fmt.Errorf("container not found: %s", id)
}

// Long enough for a container that is merely slow, short enough that a wedged
// one is reported rather than waited on.
const killTimeout = 15 * time.Second

// killRuntime stops the host process that runs one container.
//
// Only that container goes: each has a runtime process of its own, and the
// others carry on -- which is what makes this usable as a last resort rather
// than a reset of everything.
func (cm *Manager) killRuntime(id string) error {
	out, err := exec.Command("ps", "-axo", "pid=,args=").Output()
	if err != nil {
		return err
	}

	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, "container-runtime-linux") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		// Matched on the argument pair rather than on the text, so a container
		// whose name is a prefix of another is not taken down by mistake.
		var uuid string
		for i, field := range fields {
			if field == "--uuid" && i+1 < len(fields) {
				uuid = fields[i+1]
				break
			}
		}

		if uuid != id {
			continue
		}

		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}

		cm.logger.Warn("Stopping the container's runtime", "id", id, "pid", pid)

		return syscall.Kill(pid, syscall.SIGKILL)
	}

	return fmt.Errorf("no runtime process found for %s", id)
}

func (cm *Manager) Start(ctx context.Context, id string) (*Container, error) {
	if _, err := cm.runner.Run(ctx, "start", id); err != nil {
		cm.logger.Error("Failed to start container", "id", id, "error", err)
		return nil, err
	}
	cm.changed.Changed()

	return cm.Get(ctx, id)
}

func (cm *Manager) Stop(ctx context.Context, id string, timeout int) (*Container, error) {
	args := []string{"stop"}
	if timeout > 0 {
		args = append(args, "--time", fmt.Sprintf("%d", timeout))
	}
	args = append(args, id)

	if _, err := cm.runner.Run(ctx, args...); err != nil {
		cm.logger.Error("Failed to stop container", "id", id, "error", err)
		return nil, err
	}
	cm.changed.Changed()

	return cm.Get(ctx, id)
}

// Kill stops a container the abrupt way, for one that will not stop politely.
//
// It is bounded, because the reason for reaching for this is usually that the
// container has stopped answering -- and `container kill` goes through the same
// channel as everything else, so on a truly wedged container it hangs too.
// Waiting forever would trade one stuck thing for another; saying so lets the
// user act.
func (cm *Manager) Kill(ctx context.Context, id string) (*Container, error) {
	bounded, cancel := context.WithTimeout(ctx, killTimeout)
	defer cancel()

	_, err := cm.runner.Run(bounded, "kill", id)

	if errors.Is(bounded.Err(), context.DeadlineExceeded) {
		// The polite way goes through the same channel as everything else, so
		// on a container that has stopped answering it hangs like the rest.
		// What is left is the process running the container on this side of the
		// wall, which answers to a signal because it is only a process.
		cm.logger.Warn("Kill did not answer; stopping the container's runtime", "id", id)

		if err := cm.killRuntime(id); err != nil {
			return nil, fmt.Errorf(
				"%s did not answer being killed within %s, and its runtime could not be stopped either: %w",
				id, killTimeout, err,
			)
		}

		cm.changed.Changed()

		return cm.Get(ctx, id)
	}

	cm.changed.Changed()

	if err != nil {
		cm.logger.Error("Failed to kill container", "id", id, "error", err)
		return nil, err
	}

	return cm.Get(ctx, id)
}

func (cm *Manager) Remove(ctx context.Context, id string, force bool) error {
	args := []string{"delete"}
	if force {
		args = append(args, "--force")
	}
	args = append(args, id)

	if _, err := cm.runner.Run(ctx, args...); err != nil {
		cm.logger.Error("Failed to remove container", "id", id, "error", err)
		return err
	}
	cm.changed.Changed()

	return nil
}

// StreamLogs builds the log-following command. The caller owns starting and
// waiting on it; the context cancels the child when the client disconnects.
func (cm *Manager) LogsCommand(ctx context.Context, id string, tail int, follow bool) *exec.Cmd {
	args := []string{"logs"}
	if follow {
		args = append(args, "--follow")
	}
	if tail > 0 {
		args = append(args, "-n", fmt.Sprintf("%d", tail))
	}
	args = append(args, id)

	return cm.runner.Command(ctx, args...)
}

// ParseLogsLine splits a leading RFC3339-ish timestamp off a log line. Lines
// that do not carry one are passed through whole.
func ParseLogsLine(line string) map[string]any {
	parts := strings.SplitN(strings.TrimSpace(line), " ", 2)
	if len(parts) == 2 && looksLikeTimestamp(parts[0]) {
		return map[string]any{
			"timestamp": parts[0],
			"message":   parts[1],
		}
	}

	return map[string]any{
		"timestamp": "",
		"message":   line,
	}
}

func looksLikeTimestamp(s string) bool {
	// 2026-08-17T14:22:15Z and friends: digits, dashes and a T in the right spot.
	if len(s) < 10 || len(s) > 35 {
		return false
	}
	for i := 0; i < 4; i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return s[4] == '-' && s[7] == '-'
}

// firstLabel is the part of a hostname before its domain.
//
// "whoami.internal." and "whoami" both give "whoami"; a name that is nothing
// but dots gives nothing, and the caller keeps what it had.
func firstLabel(hostname string) string {
	if dot := strings.Index(hostname, "."); dot >= 0 {
		return hostname[:dot]
	}

	return hostname
}

// BuilderImage is the image Apple's own build container runs.
//
// It is not somebody's container even though it appears in the list beside
// theirs: `container build` starts it, `container builder` manages it, and
// deleting it only means the next build makes another one.
const BuilderImage = "ghcr.io/apple/container-builder-shim/"

// IsBuilder reports whether a container is Apple's builder rather than one
// somebody made.
//
// Matched on the image and not the name, which is only "buildkit" by
// convention and is not Dermaga's to rely on.
func IsBuilder(c Container) bool {
	return strings.HasPrefix(c.Image, BuilderImage)
}
