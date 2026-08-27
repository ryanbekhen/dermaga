package containers

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/ryanbekhen/dermaga/internal/cli"
)

// ContainerSpec is everything Dermaga can set when creating a container.
//
// Nearly all of it maps one-to-one onto `container run` flags. Project is the
// exception, and is marked as one where it is declared.
type ContainerSpec struct {
	Name  string `json:"name"`
	Image string `json:"image"`
	// The project to file it under. Not an argument to `container run` and
	// never will be -- the runtime has no idea projects exist. It rides on the
	// spec because the form that fills the spec is where the answer is known,
	// and the agent writes it to Dermaga's own record instead.
	Project    string            `json:"project,omitempty"`
	Entrypoint string            `json:"entrypoint,omitempty"`
	Command    []string          `json:"command,omitempty"`
	Env        []string          `json:"env,omitempty"`
	Ports      []Port            `json:"ports,omitempty"`
	Mounts     []SpecMount       `json:"mounts,omitempty"`
	Labels     map[string]string `json:"labels,omitempty"`
	CPUs       int               `json:"cpus,omitempty"`
	Memory     string            `json:"memory,omitempty"`
	// The size of /dev/shm, in the size syntax the CLI takes -- 64m, 1g. The
	// default is small enough that Postgres and headless Chrome both fall over
	// on it, and the way they fall over says nothing about shared memory.
	ShmSize string `json:"shmSize,omitempty"`
	// Resource limits, one per entry, as `<type>=<soft>[:<hard>]`.
	Ulimits []string `json:"ulimits,omitempty"`
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

	// Caught here rather than by the runtime, which reports a malformed limit
	// after the image has been pulled -- and reports it in its own words, about
	// a flag the person never typed.
	for _, limit := range s.Ulimits {
		if strings.TrimSpace(limit) == "" {
			continue
		}
		if err := validUlimit(limit); err != nil {
			return err
		}
	}

	// The runtime rejects anything under 200 MiB, but only after pulling the
	// image -- catching it here saves the wait.
	if mib := cli.Mebibytes(s.Memory); s.Memory != "" && mib > 0 && mib < 200 {
		return fmt.Errorf("memory must be at least 200m (got %s)", s.Memory)
	}

	return nil
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
	if s.ShmSize != "" {
		args = append(args, "--shm-size", s.ShmSize)
	}
	for _, limit := range s.Ulimits {
		if strings.TrimSpace(limit) != "" {
			args = append(args, "--ulimit", limit)
		}
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
		// A tmpfs has a flag of its own and takes only the path it appears at:
		// there is nothing on the host to name, which is the whole point of one.
		if m.Type == "tmpfs" {
			if m.Target != "" {
				args = append(args, "--tmpfs", m.Target)
			}
			continue
		}

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
		ShmSize:        c.ShmSize,
		Ulimits:        append([]string(nil), c.Ulimits...),
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

	// Tried before anything is taken apart.
	//
	// A recreate has to delete before it can run: a container's name is its id
	// here, and this runtime has no rename to move the old one aside with. So
	// there is a moment with nothing in it, and anything the new spec gets
	// wrong used to be discovered inside that moment, with the container
	// already gone.
	//
	// `container create` answers the cheap half of "will this work" without
	// starting anything: it resolves the image -- reaching the registry if it
	// has to, which is where a reference that only ever existed on this Mac is
	// refused -- and it checks every bind mount source. On an image that is
	// already here it costs about seventy milliseconds.
	//
	// What it does not do is unpack. The fetching and unpacking a container
	// does on its way up all happen at start, so an image whose content is
	// incomplete still passes this and still fails afterwards -- with the old
	// container gone, exactly as before. This narrows the window; it does not
	// close it, and nothing available on this runtime does.
	if err := cm.rehearse(ctx, spec); err != nil {
		failure := fmt.Errorf("%w; %s was left as it was", err, id)
		cm.pending.Failed(id, failure)

		return nil, failure
	}

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

// Recreate makes a container again from the configuration it already has.
//
// One thing changes, and it is the one thing nobody can change by hand: the
// image. `container run api:dev` resolves the tag at the moment it runs, so a
// container whose tag has been built again comes back on what that tag means
// now -- with the same name, ports, volumes and environment it had a moment
// ago, which is the part people were reconstructing from memory.
//
// Everything else here is Update's, including the parts that matter when it
// goes wrong: the configuration is written down before anything is destroyed,
// and a new container that will not start puts the previous one back.
func (cm *Manager) Recreate(ctx context.Context, id string) (*Container, error) {
	existing, err := cm.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	return cm.Update(ctx, id, SpecOf(existing))
}

// rehearse makes the container the spec describes, under a name of its own,
// and throws it away.
//
// It proves what `container create` proves and no more: the image reference
// resolves to something this Mac can get, and every bind mount source is
// really there. Both of those are ordinary ways an edit goes wrong -- an image
// deleted since, a project folder moved -- and both used to be found only after
// the old container had been destroyed.
//
// It proves nothing about starting. Layers are unpacked at start, so an image
// missing content passes here; so does a bad entrypoint. Start is deliberately
// not taken: the container being replaced is still running, and two of them
// racing over the same data is a worse failure than the one this prevents.
func (cm *Manager) rehearse(ctx context.Context, spec ContainerSpec) error {
	if _, err := cm.runner.Run(ctx, rehearsalArgs(spec)...); err != nil {
		return fmt.Errorf("could not build %s from %s: %w", spec.Name, spec.Image, err)
	}

	if _, err := cm.runner.Run(ctx, "delete", "--force", rehearsalName(spec.Name)); err != nil {
		// It exists and is not running. Left behind it is untidy rather than
		// harmful, and refusing the edit over it would be refusing to do the
		// thing that has just been proved safe.
		cm.logger.Warn("Could not remove the rehearsal container",
			"name", rehearsalName(spec.Name), "error", err)
	}

	return nil
}

// rehearsalName is what the throwaway is called. Suffixed rather than
// prefixed, so it sorts beside the container it is standing in for anywhere one
// is ever seen.
func rehearsalName(name string) string {
	return name + "-dermaga-rehearsal"
}

// rehearsalArgs is the rehearsal's command, built apart from the call that runs
// it so what reaches the CLI can be checked without the CLI being installed.
//
// `create` rather than `run`, a name of its own, and no published ports: the
// host cannot hand out the same port twice, and the container this is standing
// in for is about to want its own back.
func rehearsalArgs(spec ContainerSpec) []string {
	probe := spec
	probe.Name = rehearsalName(spec.Name)
	probe.Ports = nil

	args := probe.Args()
	args[0] = "create"

	return args
}

// validUlimit checks the shape `<type>=<soft>[:<hard>]`.
//
// The type is not checked against a list. The runtime knows which limits it
// supports and that list is its to change; refusing `nofile` here because this
// file had not heard of it would be the app getting in the way of the runtime
// growing.
func validUlimit(limit string) error {
	name, values, found := strings.Cut(limit, "=")
	if !found || strings.TrimSpace(name) == "" || strings.TrimSpace(values) == "" {
		return fmt.Errorf("limit %q must be <type>=<soft>[:<hard>]", limit)
	}

	soft, hard, split := strings.Cut(values, ":")

	softN, err := strconv.Atoi(strings.TrimSpace(soft))
	if err != nil || softN < 0 {
		return fmt.Errorf("limit %q: %q is not a number", limit, soft)
	}

	if !split {
		return nil
	}

	hardN, err := strconv.Atoi(strings.TrimSpace(hard))
	if err != nil || hardN < 0 {
		return fmt.Errorf("limit %q: %q is not a number", limit, hard)
	}

	// The runtime refuses this too, but only once the image is down.
	if hardN < softN {
		return fmt.Errorf("limit %q: the hard limit is below the soft one", limit)
	}

	return nil
}
