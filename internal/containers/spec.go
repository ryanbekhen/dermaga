package containers

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// ContainerSpec is everything Dermaga can set when creating a container. It
// maps one-to-one onto `container run` flags.
type ContainerSpec struct {
	Name       string            `json:"name"`
	Image      string            `json:"image"`
	Entrypoint string            `json:"entrypoint,omitempty"`
	Command    []string          `json:"command,omitempty"`
	Env        []string          `json:"env,omitempty"`
	Ports      []Port            `json:"ports,omitempty"`
	Mounts     []SpecMount       `json:"mounts,omitempty"`
	Labels     map[string]string `json:"labels,omitempty"`
	CPUs       int               `json:"cpus,omitempty"`
	Memory     string            `json:"memory,omitempty"`
	// Every network the container is attached to. `container run` takes one
	// --network per attachment, and a container with none lands on the
	// built-in default network.
	Networks  []string `json:"networks,omitempty"`
	WorkDir   string   `json:"workdir,omitempty"`
	User      string   `json:"user,omitempty"`
	ReadOnly  bool     `json:"readOnly,omitempty"`
	Init      bool     `json:"init,omitempty"`
	RemoveOnE bool     `json:"removeOnExit,omitempty"`

	// Carried through a recreate rather than edited anywhere. The CLI reports
	// these on inspect and accepts them as flags, so leaving them out of the
	// spec would quietly reconfigure a container that was only meant to change
	// one thing -- a read-only root that comes back writable, a dropped
	// capability that comes back granted.
	//
	// Three settings cannot be carried, because the CLI never reports them:
	// --rm, --sysctl and the stop signal. Those are lost on every recreate.
	Platform       string     `json:"platform,omitempty"`
	RuntimeHandler string     `json:"runtimeHandler,omitempty"`
	CapAdd         []string   `json:"capAdd,omitempty"`
	CapDrop        []string   `json:"capDrop,omitempty"`
	DNS            *DNSConfig `json:"dns,omitempty"`
	Rosetta        bool       `json:"rosetta,omitempty"`
	Virtualization bool       `json:"virtualization,omitempty"`
	SSH            bool       `json:"ssh,omitempty"`
	Terminal       bool       `json:"terminal,omitempty"`
}

type SpecMount struct {
	// "volume" mounts a named volume; "bind" mounts a host path.
	Type     string `json:"type"`
	Source   string `json:"source"`
	Target   string `json:"target"`
	ReadOnly bool   `json:"readOnly,omitempty"`
}

// Validate reports the problems a user can actually fix, before anything is
// destroyed on their behalf.
func (s ContainerSpec) Validate() error {
	if strings.TrimSpace(s.Image) == "" {
		return fmt.Errorf("an image is required")
	}
	if strings.ContainsAny(s.Name, " \t/") {
		return fmt.Errorf("container name cannot contain spaces or slashes")
	}

	for _, p := range s.Ports {
		if _, err := strconv.Atoi(p.Container); err != nil {
			return fmt.Errorf("container port %q is not a number", p.Container)
		}
		if _, err := strconv.Atoi(p.Host); err != nil {
			return fmt.Errorf("host port %q is not a number", p.Host)
		}
	}

	for _, m := range s.Mounts {
		if m.Source == "" || m.Target == "" {
			return fmt.Errorf("every mount needs a source and a target")
		}
		if !strings.HasPrefix(m.Target, "/") {
			return fmt.Errorf("mount target %q must be an absolute path", m.Target)
		}
	}

	for _, e := range s.Env {
		if !strings.Contains(e, "=") {
			return fmt.Errorf("environment entry %q must be KEY=value", e)
		}
	}

	// The runtime rejects anything under 200 MiB, but only after pulling the
	// image -- catching it here saves the wait.
	if mib := parseMemoryMiB(s.Memory); s.Memory != "" && mib > 0 && mib < 200 {
		return fmt.Errorf("memory must be at least 200m (got %s)", s.Memory)
	}

	return nil
}

// parseMemoryMiB reads the CLI's size syntax: a number with an optional
// K/M/G/T suffix. Returns 0 when it cannot tell.
func parseMemoryMiB(value string) int64 {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if trimmed == "" {
		return 0
	}

	unit := trimmed[len(trimmed)-1]
	digits := trimmed
	multiplier := int64(1)

	switch unit {
	case 'k':
		digits, multiplier = trimmed[:len(trimmed)-1], 0
	case 'm':
		digits = trimmed[:len(trimmed)-1]
	case 'g':
		digits, multiplier = trimmed[:len(trimmed)-1], 1024
	case 't':
		digits, multiplier = trimmed[:len(trimmed)-1], 1024*1024
	}

	amount, err := strconv.ParseInt(strings.TrimSpace(digits), 10, 64)
	if err != nil {
		return 0
	}

	// Kilobytes round down to zero MiB unless there are a lot of them.
	if multiplier == 0 {
		return amount / 1024
	}

	return amount * multiplier
}

// Args renders the spec as `container run` arguments.
func (s ContainerSpec) Args() []string {
	args := []string{"run", "--detach"}

	if s.Name != "" {
		args = append(args, "--name", s.Name)
	}
	if s.CPUs > 0 {
		args = append(args, "--cpus", strconv.Itoa(s.CPUs))
	}
	if s.Memory != "" {
		args = append(args, "--memory", s.Memory)
	}
	for _, n := range s.Networks {
		if n != "" {
			args = append(args, "--network", n)
		}
	}
	if s.WorkDir != "" {
		args = append(args, "--workdir", s.WorkDir)
	}
	if s.User != "" {
		args = append(args, "--user", s.User)
	}
	if s.Entrypoint != "" {
		args = append(args, "--entrypoint", s.Entrypoint)
	}
	if s.ReadOnly {
		args = append(args, "--read-only")
	}
	if s.Init {
		args = append(args, "--init")
	}
	if s.RemoveOnE {
		args = append(args, "--rm")
	}
	if s.Terminal {
		args = append(args, "--tty")
	}
	if s.Rosetta {
		args = append(args, "--rosetta")
	}
	if s.Virtualization {
		args = append(args, "--virtualization")
	}
	if s.SSH {
		args = append(args, "--ssh")
	}
	if s.Platform != "" {
		args = append(args, "--platform", s.Platform)
	}
	if s.RuntimeHandler != "" {
		args = append(args, "--runtime", s.RuntimeHandler)
	}

	for _, c := range s.CapAdd {
		args = append(args, "--cap-add", c)
	}
	for _, c := range s.CapDrop {
		args = append(args, "--cap-drop", c)
	}

	if s.DNS != nil {
		for _, server := range s.DNS.Nameservers {
			args = append(args, "--dns", server)
		}
		for _, domain := range s.DNS.SearchDomains {
			args = append(args, "--dns-search", domain)
		}
		for _, option := range s.DNS.Options {
			args = append(args, "--dns-option", option)
		}
		if s.DNS.Domain != "" {
			args = append(args, "--dns-domain", s.DNS.Domain)
		}
	}

	for _, e := range s.Env {
		args = append(args, "--env", e)
	}
	for _, p := range s.Ports {
		spec := fmt.Sprintf("%s:%s", p.Host, p.Container)
		if proto := strings.ToLower(p.Protocol); proto != "" && proto != "tcp" {
			spec += "/" + proto
		}
		args = append(args, "--publish", spec)
	}
	for _, m := range s.Mounts {
		// The explicit --mount form is unambiguous about volume vs bind, which
		// the shorthand -v is not.
		kind := m.Type
		if kind == "" {
			kind = "volume"
		}
		mount := fmt.Sprintf("type=%s,source=%s,target=%s", kind, m.Source, m.Target)
		if m.ReadOnly {
			mount += ",readonly"
		}
		args = append(args, "--mount", mount)
	}
	for key, value := range s.Labels {
		args = append(args, "--label", fmt.Sprintf("%s=%s", key, value))
	}

	args = append(args, s.Image)
	args = append(args, s.Command...)

	return args
}

// SpecOf reconstructs an editable spec from a running container's reported
// configuration, so the edit form opens pre-filled.
func SpecOf(c *Container) ContainerSpec {
	mounts := make([]SpecMount, 0, len(c.Mounts))
	for _, m := range c.Mounts {
		mounts = append(mounts, SpecMount{
			Type:     m.Type,
			Source:   m.Source,
			Target:   m.Destination,
			ReadOnly: m.ReadOnly,
		})
	}

	spec := ContainerSpec{
		Name:           c.Name,
		Image:          c.Image,
		Entrypoint:     c.Entrypoint,
		Command:        c.Command,
		Env:            c.EnvironmentVars,
		Ports:          c.Ports,
		Mounts:         mounts,
		Labels:         c.Labels,
		CPUs:           c.CPUAllocation,
		Memory:         c.MemoryAllocation,
		Networks:       append([]string(nil), c.Networks...),
		WorkDir:        c.WorkingDir,
		User:           c.User,
		ReadOnly:       c.ReadOnlyRoot,
		Init:           c.UseInit,
		Terminal:       c.Terminal,
		Platform:       c.Platform,
		RuntimeHandler: c.RuntimeHandler,
		CapAdd:         append([]string(nil), c.CapAdd...),
		CapDrop:        append([]string(nil), c.CapDrop...),
		Rosetta:        c.Rosetta,
		Virtualization: c.Virtualization,
		SSH:            c.SSH,
	}

	// An empty DNS block means "whatever the CLI configures by default", which
	// is not the same as asking for no nameservers at all.
	if len(c.DNS.Nameservers)+len(c.DNS.SearchDomains)+len(c.DNS.Options) > 0 || c.DNS.Domain != "" {
		dns := c.DNS
		spec.DNS = &dns
	}

	return spec
}

// CreateCommand validates the spec and returns the `container run` command
// without starting it, so a caller can stream its progress.
func (cm *Manager) CreateCommand(ctx context.Context, spec ContainerSpec) (*exec.Cmd, error) {
	if err := spec.Validate(); err != nil {
		return nil, err
	}

	return cm.runner.Command(ctx, spec.Args()...), nil
}

// CreateContainer runs a new container from the spec and returns it.
func (cm *Manager) Create(ctx context.Context, spec ContainerSpec) (*Container, error) {
	if err := spec.Validate(); err != nil {
		return nil, err
	}

	if _, err := cm.runner.Run(ctx, spec.Args()...); err != nil {
		cm.logger.Error("Failed to create container", "name", spec.Name, "error", err)
		return nil, err
	}
	cm.changed.Changed()

	id := spec.Name
	if id == "" {
		// Without --name the CLI generates one; the newest container is ours.
		containers, err := cm.List(ctx, true)
		if err != nil || len(containers) == 0 {
			return nil, err
		}
		newest := containers[0]
		for _, c := range containers[1:] {
			if c.CreatedAt > newest.CreatedAt {
				newest = c
			}
		}
		return &newest, nil
	}

	return cm.Get(ctx, id)
}

// UpdateContainer applies a new spec to an existing container.
//
// The CLI has no update verb, so this recreates: stop, delete, run. Named
// volumes survive that, but the container's writable layer does not, so the
// caller is expected to have warned the user. If the new spec fails to start,
// the previous one is restored rather than leaving the user with nothing.
func (cm *Manager) Update(ctx context.Context, id string, spec ContainerSpec) (*Container, error) {
	if err := spec.Validate(); err != nil {
		return nil, err
	}

	existing, err := cm.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	wasRunning := existing.Status == "running"
	previous := SpecOf(existing)

	// Written down before anything is taken apart. Everything below this line
	// can fail, and when it does the changes are still on disk to come back to.
	cm.pending.Begin(id, spec, previous)

	if wasRunning {
		if _, err := cm.runner.Run(ctx, "stop", id); err != nil {
			failure := fmt.Errorf("could not stop %s: %w", id, err)
			cm.pending.Failed(id, failure)

			return nil, failure
		}
	}

	if _, err := cm.runner.Run(ctx, "delete", "--force", id); err != nil {
		failure := fmt.Errorf("could not remove %s: %w", id, err)
		cm.pending.Failed(id, failure)

		return nil, failure
	}

	if _, err := cm.runner.Run(ctx, spec.Args()...); err != nil {
		cm.logger.Error("Recreate failed; restoring previous configuration", "id", id, "error", err)

		if _, restoreErr := cm.runner.Run(ctx, previous.Args()...); restoreErr != nil {
			failure := fmt.Errorf(
				"could not apply changes (%w) and could not restore the previous container (%v); your changes were kept and can be picked up again",
				err, restoreErr,
			)
			cm.pending.Failed(id, failure)

			return nil, failure
		}

		failure := fmt.Errorf(
			"could not apply changes, previous container restored: %w; your changes were kept and can be picked up again",
			err,
		)
		cm.pending.Failed(id, failure)

		return nil, failure
	}

	// It landed: there is nothing left unfinished.
	cm.pending.Done(id)
	cm.changed.Changed()

	return cm.Get(ctx, spec.Name)
}
