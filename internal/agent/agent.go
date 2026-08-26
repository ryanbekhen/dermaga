// Package agent wires the domain packages to the RPC surface. It is the only
// place that knows both what the app can do and how the UI asks for it.
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/ryanbekhen/dermaga/internal/cli"
	"github.com/ryanbekhen/dermaga/internal/containers"
	"github.com/ryanbekhen/dermaga/internal/files"
	"github.com/ryanbekhen/dermaga/internal/images"
	"github.com/ryanbekhen/dermaga/internal/machines"
	"github.com/ryanbekhen/dermaga/internal/networks"
	"github.com/ryanbekhen/dermaga/internal/registry"
	"github.com/ryanbekhen/dermaga/internal/rpc"
	"github.com/ryanbekhen/dermaga/internal/scanner"
	"github.com/ryanbekhen/dermaga/internal/settings"
	"github.com/ryanbekhen/dermaga/internal/store"
	"github.com/ryanbekhen/dermaga/internal/system"
	"github.com/ryanbekhen/dermaga/internal/tasks"
	"github.com/ryanbekhen/dermaga/internal/templates"
	"github.com/ryanbekhen/dermaga/internal/terminal"
	"github.com/ryanbekhen/dermaga/internal/toolchain"
	"github.com/ryanbekhen/dermaga/internal/tunnels"
	"github.com/ryanbekhen/dermaga/internal/volumes"
	"github.com/ryanbekhen/dermaga/internal/watcher"
)

// Build is what this binary was cut from, reported to the UI.
type Build struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
	Date    string `json:"date,omitempty"`
}

type Agent struct {
	build   Build
	logger  *slog.Logger
	runner  *cli.Runner
	server  *rpc.Server
	streams *streams
	// Set when serving a socket: how to let go of it, so another agent -- the
	// background service -- can take over without anyone guessing at pids.
	standDown context.CancelFunc

	// Everything Dermaga has worked out for itself, in one file. Nil if it
	// could not be opened -- another copy of Dermaga holding the lock, a
	// read-only home directory -- and the managers all work without it, just
	// without remembering anything between launches.
	store *store.Store

	containers *containers.Manager
	files      *files.Manager
	images     *images.Manager
	volumes    *volumes.Manager
	networks   *networks.Manager
	machines   *machines.Manager
	system     *system.Manager
	registry   *registry.Manager
	scanner    *scanner.Manager
	templates  *templates.Manager
	toolchain  *toolchain.Manager
	tunnels    *tunnels.Manager
	settings   *settings.Store
	watcher    *watcher.Watcher
	exits      *exitWatch
	// What finished commands printed, kept so a build's log outlives the
	// window that watched it arrive.
	tasks *tasks.Store
}

func New(server *rpc.Server, logger *slog.Logger) *Agent {
	runner := cli.New()

	agent := &Agent{
		logger:   logger,
		runner:   runner,
		server:   server,
		streams:  newStreams(server),
		settings: settings.NewStore(logger),
		exits:    newExitWatch(),
	}

	// The watcher is what "something changed" means, but the managers only see
	// the notify.Notifier side of it, so no domain package imports the watcher.
	var pending *watcher.Watcher
	changed := notifierFunc(func() {
		if pending != nil {
			pending.Changed()
		}
		// A new image should have an answer waiting by the time anyone opens
		// it; the sweep collapses a burst of changes into one pass.
		if agent.scanner != nil {
			agent.scanner.Sweep()
		}
	})

	agent.containers = containers.NewManager(runner, logger, changed)
	agent.images = images.NewManager(runner, logger, changed)
	agent.files = files.NewManager(runner, logger)
	agent.volumes = volumes.NewManager(runner, logger, changed)
	agent.networks = networks.NewManager(runner, logger, changed)
	agent.machines = machines.NewManager(runner, logger, changed)
	agent.system = system.NewManager(runner, logger, changed)
	agent.toolchain = toolchain.NewManager(runner, logger, changed)
	agent.registry = registry.NewManager(runner, logger)
	agent.tunnels = tunnels.NewManager(runner, logger, changed)
	agent.scanner = scanner.NewManager(runner, logger)
	agent.templates = templates.NewManager(logger)
	agent.tasks = tasks.New(logger)

	// Opened before anything reads from it, and forgiving if it cannot be:
	// none of what it holds is authored by anybody, so the fallback is doing
	// the work again rather than losing something.
	if opened, err := store.Open(); err != nil {
		logger.Warn("Running without a store; nothing will be remembered", "error", err)
	} else {
		agent.store = opened

		// NOTE: TEMPORARY — remove this call with internal/store/migrate.go in
		// 1.15.0. See the note at the top of that file.
		store.Migrate(opened, logger)

		agent.scanner.UseStore(opened)
		agent.templates.UseStore(opened)
		agent.containers.UseStore(opened)
		agent.tasks.UseStore(opened)
		agent.tunnels.UseStore(opened)

		// A build from a pasted Dockerfile writes it to a directory of its own
		// and removes it when the build ends. A build that never ended -- the
		// app was quit, the machine went down, the removal itself failed --
		// leaves one behind, and nothing else is ever going to notice.
		//
		// Inside this branch on purpose. The store opened, which means this
		// process holds its exclusive lock, which means no second agent is
		// running with a build in flight whose context this would delete.
		// Nothing has been served yet either, so everything here is litter.
		images.SweepStagedBuilds()
	}

	// The scanner works on its own goroutine and reports where it has got to;
	// the window shows that in the status bar without ever having asked.
	agent.scanner.OnChange(func(status scanner.Status) {
		server.Notify("scanner.status", status)
	})

	// Results land in the list the moment they exist, rather than when the
	// window next thinks to ask.
	agent.scanner.OnReport(func(report scanner.Report) {
		server.Notify("scanner.result", report)
	})

	// Where the sweep finds its work. Kept as a callback so the scanner never
	// imports the image package.
	agent.scanner.SetSource(func(ctx context.Context) ([]scanner.ImageRef, error) {
		found, err := agent.images.List(ctx)
		if err != nil {
			return nil, err
		}

		refs := make([]scanner.ImageRef, 0, len(found))
		for _, image := range found {
			refs = append(refs, scanner.ImageRef{
				Reference: image.Reference,
				Digest:    image.Digest,
				Platforms: image.Platforms,
			})
		}

		return refs, nil
	})

	pending = watcher.New(watcher.Sources{
		Containers: func(ctx context.Context) ([]containers.Container, error) {
			return agent.containers.List(ctx, true)
		},
		Machines: agent.machines.List,
		Images:   agent.images.List,
		Volumes:  agent.volumes.List,
		Networks: agent.networks.List,
		System:   agent.system.Status,
		// Read from Dermaga's own records and its running connectors, so it
		// costs a map lookup rather than a call to the CLI -- and a route going
		// dark reaches the window the same way every other change does.
		Tunnels:      agent.tunnels.Tunnels,
		CLIAvailable: agent.runner.Available,
		// Checked on its own schedule rather than in a pass: asking Homebrew
		// costs seconds, and the answer changes about as often as Apple cuts a
		// release.
		Toolchain: agent.toolchain.Latest,
		Disk:      agent.system.DiskUsage,
	}, logger)
	agent.watcher = pending

	// Images pulled in a terminal never touch a Dermaga manager, so the only
	// place they show up is the watcher. Scanning follows what is actually
	// there, not only what this app did.
	pending.OnChange(func(snapshot watcher.Snapshot) {
		agent.scanner.Sweep()

		// A container recreated on a new address would otherwise keep a
		// hostname that resolves and answers nothing. This is the same
		// snapshot the window is about to be shown, so the route is corrected
		// before anybody notices it was wrong.
		go agent.tunnels.Reconcile(
			context.Background(),
			targetsOf(snapshot.Containers, snapshot.Machines, snapshot.Networks))

		// A container that stopped without being asked to is worth saying out
		// loud: the window is often not the thing the user is looking at.
		for _, exit := range agent.exits.Check(snapshot.Containers) {
			logger.Info("Container exited on its own", "container", exit.Name)
			server.Notify("containers.exited", exit)
		}

		agent.announceToolchain(snapshot.Toolchain)
	})

	return agent
}

type notifierFunc func()

func (f notifierFunc) Changed() { f() }

// setUpContainerNames makes containers findable by name, once and without
// asking.
//
// Apple's runtime registers every container under a local domain when one is
// configured, and does nothing when none is. A machine where containers cannot
// find each other by name is not somebody's preference, it is a machine nobody
// has set up -- so this sets it up, and leaves any domain already chosen
// exactly where it is.
//
// The services read that setting only as they start. Dermaga starts them itself
// when they are down, so the ordinary case costs nothing; when they are already
// up they have to be told again, and the containers running at that moment stop
// and come back with them. That is the price of the setting meaning anything
// today rather than after the next reboot, and it is paid once.
func (a *Agent) setUpContainerNames(ctx context.Context) {
	written, err := system.EnsureDomain(a.logger)
	if err != nil {
		a.logger.Warn("Could not set up container names", "error", err)
		return
	}
	if !written {
		return
	}

	status, err := a.system.Status(ctx)
	if err != nil || status == nil || !status.Running {
		// Down, and about to be started with the setting already in place.
		return
	}

	a.logger.Info("Restarting the container services so container names take effect")

	if err := a.system.Stop(ctx); err != nil {
		a.logger.Warn("Could not stop the container services", "error", err)
		return
	}
	if err := a.system.Start(ctx, false); err != nil {
		a.logger.Warn("Could not start the container services again", "error", err)
	}
}

// Run starts the background work and serves requests until the client goes
// away, then tears down anything still streaming.
func (a *Agent) Run(ctx context.Context, in io.Reader, out io.Writer) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	go a.containers.Stats().Run(ctx)
	go a.watcher.Run(ctx)
	go a.toolchain.Watch(ctx)
	go a.volumes.KeepHelper(ctx)
	go a.templates.Run(ctx, func() string { return a.settings.Load().TemplatesURL })

	// Not in the goroutine above it, and not before serving either. Setting the
	// names up can restart the container services, which would take down the
	// very containers autoBoot is bringing up -- and doing it before the socket
	// exists would leave the window waiting on an agent that looks dead.
	named := make(chan struct{})
	go func() {
		defer close(named)
		a.setUpContainerNames(ctx)
	}()
	go func() {
		<-named
		a.autoBoot(ctx)
	}()
	a.scanner.Start(ctx)

	a.register()

	// Tunnels that were up when Dermaga last stopped come back up, in the
	// background: each one fetches a token and starts a connector, and none of
	// that is worth making the window wait for.
	go a.restoreTunnels(ctx)

	err := a.server.Serve(ctx, in, out)
	a.streams.closeAll()
	a.tunnels.Close()

	return err
}

// Listen does the same for an agent that outlives any one client: it serves a
// Unix socket, so the desktop app can come and go while the watching, the
// scanning and the supervising carry on.
func (a *Agent) Listen(ctx context.Context, socket string) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	a.standDown = cancel

	go a.containers.Stats().Run(ctx)
	go a.watcher.Run(ctx)
	go a.toolchain.Watch(ctx)
	go a.volumes.KeepHelper(ctx)
	go a.templates.Run(ctx, func() string { return a.settings.Load().TemplatesURL })

	// Not in the goroutine above it, and not before serving either. Setting the
	// names up can restart the container services, which would take down the
	// very containers autoBoot is bringing up -- and doing it before the socket
	// exists would leave the window waiting on an agent that looks dead.
	named := make(chan struct{})
	go func() {
		defer close(named)
		a.setUpContainerNames(ctx)
	}()
	go func() {
		<-named
		a.autoBoot(ctx)
	}()
	a.scanner.Start(ctx)

	a.register()

	go a.restoreTunnels(ctx)

	err := a.server.Listen(ctx, socket)
	a.streams.closeAll()
	a.tunnels.Close()

	return err
}

// SetBuild records the version stamped into the binary at link time.
func (a *Agent) SetBuild(build Build) {
	a.build = build
}

func (a *Agent) register() {
	a.registerSystem()
	a.server.Register("app.info", func(_ context.Context, _ json.RawMessage) (any, error) {
		return a.build, nil
	})

	// Asks this agent to let go, so another can take the socket -- installing
	// the background service means handing over to a process launchd owns, and
	// guessing which process holds the socket from outside is worse than
	// asking it politely over the socket itself.
	a.server.Register("agent.stand-down", func(_ context.Context, _ json.RawMessage) (any, error) {
		if a.standDown == nil {
			return nil, rpc.Fail("this agent cannot stand down")
		}

		// After the reply, so the caller hears the answer before the socket
		// goes.
		go func() {
			time.Sleep(200 * time.Millisecond)
			a.standDown()
		}()

		return map[string]any{"standingDown": true}, nil
	})

	a.registerSettings()
	a.registerToolchain()
	a.registerScanner()
	a.registerFiles()
	a.registerRegistry()
	a.registerTunnels()
	a.registerContainers()
	a.registerImages()
	a.registerVolumes()
	a.registerNetworks()
	a.registerMachines()
	a.registerStreams()
	a.registerTasks()
}

// named picks what to call a piece of work: what the user asked it to be
// called, or failing that what it was made from. Empty when neither is known,
// which is how a stream stays quiet.
func named(name, fallback string) string {
	if strings.TrimSpace(name) != "" {
		return name
	}

	return fallback
}

// --- finished work ---------------------------------------------------------

// The shelf a command's output is put on once it has finished.
//
// The window owns the work while it is running -- the lines are arriving there,
// and it is the thing drawing them -- and hands the whole of it over at the end.
// One message rather than a running copy: it is a megabyte at the very worst,
// once, over a socket on this machine, and it keeps one idea of what a task is
// instead of two halves that have to be kept in step.
func (a *Agent) registerTasks() {
	// The shelf is the agent's, so writing to it is too. A stream the window
	// filed is written down when it ends, by whatever is running at the time --
	// which on a long build is often nothing but this process.
	a.streams.shelve = func(streamID string, f *filing, err error) {
		record := tasks.Record{
			ID:       f.taskID,
			StreamID: streamID,
			Kind:     f.kind,
			Label:    f.label,
			Status:   "done",
			Lines:    f.output(),
			At:       time.Now().UTC().Format(time.RFC3339),
		}

		if err != nil {
			record.Status = "failed"
			record.Error = err.Error()
		}

		if putErr := a.tasks.Put(record); putErr != nil {
			a.logger.Error("Could not keep what a command printed", "task", f.taskID, "error", putErr)
		}
	}

	a.server.Register("tasks.list", func(_ context.Context, _ json.RawMessage) (any, error) {
		return a.tasks.List(), nil
	})

	// The window's name for a run it has just started, said as soon as it knows
	// the agent's.
	//
	// Two names for one thing, and both are needed: the window files a run
	// under something a person would recognise, so building the same tag twice
	// replaces the row rather than stacking it; the agent knows only its own
	// `build-7`, which is the name a notification comes back with. Told them
	// here, the agent can keep the output under both -- and keep it whether or
	// not there is still a window to keep it for.
	a.server.Register("tasks.name", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			StreamID string `json:"streamId"`
			ID       string `json:"id"`
			Kind     string `json:"kind"`
			Label    string `json:"label"`
		}](params)
		if err != nil {
			return nil, err
		}

		if args.StreamID == "" || args.ID == "" {
			return nil, rpc.Fail("a run needs both names to be filed under")
		}

		a.streams.file(args.StreamID, args.ID, args.Kind, args.Label)

		return map[string]any{"id": args.ID}, nil
	})

	a.server.Register("tasks.forget", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.tasks.Forget(args.ID); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"id": args.ID}, nil
	})
}

// --- system ---------------------------------------------------------------

func (a *Agent) registerSystem() {
	a.server.Register("system.status", func(ctx context.Context, _ json.RawMessage) (any, error) {
		status, err := a.system.Status(ctx)
		if err != nil {
			return nil, err
		}

		// The renderer shows this alongside the service state.
		return map[string]any{"status": status, "cliAvailable": a.runner.Available()}, nil
	})

	a.server.Register("system.start", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			InstallKernel bool `json:"installKernel"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.system.Start(ctx, args.InstallKernel); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return a.system.Status(ctx)
	})

	// Container names: what the runtime believes, and whether macOS has been
	// told. Two halves, and only the first one is Dermaga's to write.
	a.server.Register("system.dns", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return map[string]any{
			"domain":     system.Domain,
			"registered": a.system.Registered(ctx),
		}, nil
	})

	a.server.Register("system.stop", func(ctx context.Context, _ json.RawMessage) (any, error) {
		if err := a.system.Stop(ctx); err != nil {
			return nil, rpc.Fail(err.Error())
		}
		return map[string]any{}, nil
	})

	// Asked during startup: the services start perfectly well without a kernel,
	// and the failure only appears later when something tries to run.
	a.server.Register("system.kernelConfigured", func(_ context.Context, _ json.RawMessage) (any, error) {
		return map[string]any{"configured": a.system.KernelConfigured()}, nil
	})

	a.server.Register("system.diskUsage", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return a.system.DiskUsage(ctx)
	})

	a.server.Register("system.prune", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Kind string `json:"kind"`
		}](params)
		if err != nil {
			return nil, err
		}

		result, err := a.system.Prune(ctx, system.Kind(args.Kind))
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return result, nil
	})
}

// --- toolchain ------------------------------------------------------------

// announceToolchain says out loud, once, that the CLI wants attention.
//
// Two kinds of news, and they are not the same size. A newer release is worth
// mentioning; a CLI older than Dermaga is written for is worth saying plainly,
// because it is the reason something in the app is about to behave oddly.
//
// Once is the whole difficulty. The check runs at startup, and somebody who
// leaves an update for later opens Dermaga a dozen times before they get round
// to it -- so what has already been said is written down, keyed by the version
// it was said about. A different version is different news; the same version
// is the same sentence again.
func (a *Agent) announceToolchain(status *toolchain.Status) {
	if status == nil {
		return
	}

	subject := ""
	switch {
	case status.BelowMinimum:
		subject = "below-" + status.Version
	case status.UpdateAvailable && status.LatestVersion != "":
		subject = "update-" + status.LatestVersion
	default:
		return
	}

	// No store means no memory of what was said, and the choice is between
	// saying it every launch or never. Never is the quieter mistake: the
	// sidebar and the System page still carry it, and neither of them forgets.
	if a.store == nil {
		return
	}

	var told string
	if found, err := a.store.Get(store.BucketNotices, "toolchain", &told); err != nil {
		a.logger.Debug("Could not read what has been said about the CLI", "error", err)
		return
	} else if found && told == subject {
		return
	}

	if err := a.store.Put(store.BucketNotices, "toolchain", subject); err != nil {
		// Not fatal, but it does mean this is about to be said again, so it is
		// worth a line rather than a silent repeat.
		a.logger.Warn("Could not record that the CLI notice was raised", "error", err)
	}

	a.logger.Info("The container CLI wants attention", "subject", subject)
	a.server.Notify("toolchain.news", status)
}

func (a *Agent) registerToolchain() {
	// Checked afresh rather than read from the cache: this is asked when the
	// System page opens and again when an upgrade on it finishes, and both are
	// exactly when the cached answer is the wrong one. It updates the cache on
	// its way through, so the sidebar's dot goes at the same moment the page's
	// own line does.
	a.server.Register("toolchain.status", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return a.toolchain.Refresh(ctx), nil
	})

	// A Mac that has never run a container has no Linux kernel, and the runtime
	// refuses to start until one is set. This is that fix, as one call.
	a.server.Register("system.installKernel", func(ctx context.Context, _ json.RawMessage) (any, error) {
		// Through a pty: without a terminal this command prints one line and
		// then hangs for ever instead of downloading anything.
		id, err := a.streams.runCommandTTY(ctx, "kernel", func(ctx context.Context) (*exec.Cmd, error) {
			return a.system.InstallKernelCommand(ctx), nil
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})

	a.server.Register("toolchain.install", func(ctx context.Context, _ json.RawMessage) (any, error) {
		if !a.runner.Has("brew") {
			return nil, rpc.Fail("Homebrew is not installed, so Dermaga cannot install the CLI for you")
		}

		id, err := a.streams.runCommand(ctx, "install", func(ctx context.Context) (*exec.Cmd, error) {
			return a.toolchain.InstallCommand(ctx), nil
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})

	a.server.Register("toolchain.update", func(ctx context.Context, _ json.RawMessage) (any, error) {
		if !a.runner.Has("brew") {
			return nil, rpc.Fail("Homebrew is not installed, so Dermaga cannot update the CLI for you")
		}

		id, err := a.streams.runCommand(ctx, "update", func(ctx context.Context) (*exec.Cmd, error) {
			return a.toolchain.UpgradeCommand(ctx), nil
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})
}

// --- files inside a container ----------------------------------------------

func (a *Agent) registerFiles() {
	// Asked once when a container is opened: without a shell there is nothing
	// for the Files or Terminal tabs to do, and they are hidden rather than
	// left to fail.
	a.server.Register("containers.hasShell", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Container string `json:"container"`
		}](params)
		if err != nil {
			return nil, err
		}

		return map[string]any{"hasShell": a.files.HasShell(ctx, args.Container)}, nil
	})

	a.server.Register("files.list", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Container string `json:"container"`
			Path      string `json:"path"`
		}](params)
		if err != nil {
			return nil, err
		}

		entries, err := a.files.List(ctx, args.Container, args.Path)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return entries, nil
	})

	a.server.Register("files.copyIn", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Container string   `json:"container"`
			Sources   []string `json:"sources"`
			Path      string   `json:"path"`
		}](params)
		if err != nil {
			return nil, err
		}

		// One failure should not hide the ones that worked: a drop of ten
		// files where one is unreadable still moved nine.
		var failed []string
		var reason string

		for _, source := range args.Sources {
			if err := a.files.CopyIn(ctx, args.Container, source, args.Path); err != nil {
				failed = append(failed, filepath.Base(source))

				// Why it failed is the useful half, and a drop that fails
				// usually fails the same way for every file in it. Naming the
				// files without saying what went wrong -- which is what this
				// did -- leaves the user with nothing to act on.
				if reason == "" {
					reason = err.Error()
				}
			}
		}

		if len(failed) > 0 {
			return nil, rpc.Fail(fmt.Sprintf("could not copy %s: %s", strings.Join(failed, ", "), reason))
		}

		return map[string]any{"copied": len(args.Sources)}, nil
	})

	a.server.Register("files.copyOut", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Container string `json:"container"`
			Path      string `json:"path"`
			Target    string `json:"target"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.files.CopyOut(ctx, args.Container, args.Path, args.Target); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"path": args.Target}, nil
	})
}

// --- registries -----------------------------------------------------------

func (a *Agent) registerRegistry() {
	a.server.Register("registry.list", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return a.registry.List(ctx)
	})

	a.server.Register("registry.login", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Server   string `json:"server"`
			Username string `json:"username"`
			Password string `json:"password"`
			Scheme   string `json:"scheme"`
		}](params)
		if err != nil {
			return nil, err
		}

		if strings.TrimSpace(args.Server) == "" {
			return nil, rpc.Fail("a login needs a registry address")
		}

		if err := a.registry.Login(ctx, args.Server, args.Username, args.Password, args.Scheme); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{}, nil
	})

	a.server.Register("registry.logout", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Server string `json:"server"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.registry.Logout(ctx, args.Server); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{}, nil
	})

	a.server.Register("images.tag", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Source string `json:"source"`
			Target string `json:"target"`
		}](params)
		if err != nil {
			return nil, err
		}

		if strings.TrimSpace(args.Target) == "" {
			return nil, rpc.Fail("a tag needs a new reference")
		}

		if err := a.registry.Tag(ctx, args.Source, args.Target); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		a.watcher.Changed()

		return map[string]any{}, nil
	})

	a.server.Register("images.push", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Reference string `json:"reference"`
			Scheme    string `json:"scheme"`
		}](params)
		if err != nil {
			return nil, err
		}

		id, err := a.streams.runCommand(ctx, "push", func(ctx context.Context) (*exec.Cmd, error) {
			return a.registry.PushCommand(ctx, args.Reference, args.Scheme), nil
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})
}

// --- scanner --------------------------------------------------------------

func (a *Agent) registerScanner() {
	a.server.Register("scanner.status", func(_ context.Context, _ json.RawMessage) (any, error) {
		return a.scanner.Status(), nil
	})

	// Queues the scan and returns at once: the result arrives as a pushed
	// status followed by a report, so the window never waits on Trivy.
	a.server.Register("scanner.scan", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Reference string `json:"reference"`
		}](params)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(args.Reference) == "" {
			return nil, rpc.Fail("a scan needs an image reference")
		}

		if err := a.scanner.Scan(args.Reference); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"queued": true}, nil
	})

	// --- templates ----------------------------------------------------------
	//
	// Starting points for the create form. The window cannot fetch them itself
	// -- it is served under `connect-src 'self'` and has no network of its own
	// -- so they come through here like everything else.
	a.server.Register("templates.list", func(_ context.Context, _ json.RawMessage) (any, error) {
		return a.templates.List(), nil
	})

	// Asked for when somebody changes where the catalogue comes from. The
	// answer to "did that work?" should not be "wait a week".
	a.server.Register("templates.refresh", func(ctx context.Context, _ json.RawMessage) (any, error) {
		if err := a.templates.FetchNow(ctx, a.settings.Load().TemplatesURL); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return a.templates.List(), nil
	})

	a.server.Register("scanner.reports", func(_ context.Context, _ json.RawMessage) (any, error) {
		return a.scanner.Briefs(), nil
	})

	a.server.Register("scanner.dismiss", func(_ context.Context, _ json.RawMessage) (any, error) {
		a.scanner.Dismiss()

		return a.scanner.Status(), nil
	})

	a.server.Register("scanner.report", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Reference string `json:"reference"`
		}](params)
		if err != nil {
			return nil, err
		}

		report, ok := a.scanner.Report(args.Reference)
		if !ok {
			return nil, nil
		}

		return report, nil
	})
}

// --- settings -------------------------------------------------------------

func (a *Agent) registerSettings() {
	a.server.Register("settings.get", func(_ context.Context, _ json.RawMessage) (any, error) {
		return map[string]any{"settings": a.settings.Load(), "path": a.settings.Path()}, nil
	})

	a.server.Register("settings.save", func(_ context.Context, params json.RawMessage) (any, error) {
		// Merge onto what is stored so a partial update leaves the rest alone.
		current := a.settings.Load()
		if len(params) > 0 {
			if err := json.Unmarshal(params, &current); err != nil {
				return nil, &rpc.Error{Code: rpc.CodeInvalidParams, Message: err.Error()}
			}
		}

		saved, err := a.settings.Save(current)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"settings": saved, "path": a.settings.Path()}, nil
	})
}

// --- containers -----------------------------------------------------------

func (a *Agent) registerContainers() {
	a.server.Register("containers.list", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			All *bool `json:"all"`
		}](params)
		if err != nil {
			return nil, err
		}

		all := args.All == nil || *args.All

		return a.containers.List(ctx, all)
	})

	a.server.Register("containers.get", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		return a.containers.Get(ctx, args.ID)
	})

	// The minutes already watched, so a chart opens full rather than empty. The
	// window keeps itself from the moment the agent starts; this only hands over
	// what is there.
	a.server.Register("containers.history", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		return a.containers.Stats().History(args.ID), nil
	})

	a.server.Register("containers.spec", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		container, err := a.containers.Get(ctx, args.ID)
		if err != nil {
			return nil, err
		}

		return containers.SpecOf(container), nil
	})

	a.server.Register("containers.start", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		return a.containers.Start(ctx, args.ID)
	})

	a.server.Register("containers.stop", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID      string `json:"id"`
			Timeout int    `json:"timeout"`
		}](params)
		if err != nil {
			return nil, err
		}

		if args.Timeout <= 0 {
			args.Timeout = 10
		}

		// Asked for, so it stops quietly.
		a.exits.Expect(args.ID)

		return a.containers.Stop(ctx, args.ID, args.Timeout)
	})

	a.server.Register("containers.kill", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		// Asked for, so it stops quietly -- a kill is still a deliberate stop.
		a.exits.Expect(args.ID)

		return a.containers.Kill(ctx, args.ID)
	})

	// Marking a container to start with Dermaga, which used to mean recreating
	// it: the mark was a label, and a label can only be written by
	// `container run`. It is a record of Dermaga's own now, so it is a write.
	a.server.Register("containers.setAutoBoot", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID       string `json:"id"`
			AutoBoot bool   `json:"autoBoot"`
		}](params)
		if err != nil {
			return nil, err
		}

		settings := a.containers.Settings(args.ID)
		settings.AutoBoot = args.AutoBoot

		if err := a.containers.SetSettings(args.ID, settings); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"id": args.ID, "autoBoot": args.AutoBoot}, nil
	})

	a.server.Register("containers.remove", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID    string `json:"id"`
			Force bool   `json:"force"`
		}](params)
		if err != nil {
			return nil, err
		}

		a.exits.Expect(args.ID)

		// Read before the removal, while there is still something to read. A
		// tunnel is keyed by the container's name, and this call carries
		// whichever of its name and ID the window was holding.
		var name string
		if found, err := a.containers.Get(ctx, args.ID); err == nil && found != nil {
			name = found.Name
		}

		if err := a.containers.Remove(ctx, args.ID, args.Force); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		// The container is gone, so any route to it answers nothing. The
		// hostname and its DNS record go with it, and the tunnel too if that
		// was the last route on it.
		a.tunnels.Forget(ctx, args.ID, name)

		return map[string]any{"id": args.ID}, nil
	})

	// An edit that was begun and never finished. The window asks before it
	// opens the form, so someone coming back after a failure is offered what
	// they had typed rather than an empty one.
	a.server.Register("containers.pendingEdit", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		edit, ok := a.containers.Pending().All()[args.ID]
		if !ok {
			return nil, nil
		}

		return edit, nil
	})

	// Dropping it is the other answer to being offered it back.
	a.server.Register("containers.discardEdit", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		a.containers.Pending().Done(args.ID)

		return map[string]any{"id": args.ID}, nil
	})

	a.server.Register("containers.update", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID   string                   `json:"id"`
			Spec containers.ContainerSpec `json:"spec"`
		}](params)
		if err != nil {
			return nil, err
		}

		// Editing recreates: the container stops as part of the job, which is
		// not something to be told about.
		a.exits.Expect(args.ID)

		container, err := a.containers.Update(ctx, args.ID, args.Spec)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return container, nil
	})

	// The same container, made again from what its tag means now. Offered when
	// a build has moved that tag on: the alternative is remembering the spec,
	// deleting by hand and typing it back in, every time.
	a.server.Register("containers.recreate", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		// It stops as part of the job, which is not something to be told about.
		a.exits.Expect(args.ID)

		container, err := a.containers.Recreate(ctx, args.ID)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return container, nil
	})

	// Creating streams: `container run` reports fetching, unpacking and
	// starting as it goes, and the UI shows those steps.
	a.server.Register("containers.create", func(ctx context.Context, params json.RawMessage) (any, error) {
		spec, err := decodeParams[containers.ContainerSpec](params)
		if err != nil {
			return nil, err
		}

		// Naming a volume in the form is how most volumes come into being --
		// the CLI creates whatever is not there yet -- so this is where a
		// volume has to be made fit to write to, not the New volume dialog.
		a.prepareVolumes(ctx, spec)

		id, err := a.streams.runNamed(ctx, "create", named(spec.Name, spec.Image),
			func(ctx context.Context) (*exec.Cmd, error) {
				return a.containers.CreateCommand(ctx, spec)
			})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})

	// containers.create streams its progress because a pull can take minutes and
	// the user is watching. This one is for containers Dermaga starts on its own
	// account -- a helper to read a volume with -- where the caller wants the
	// container to exist by the time the call returns and there is no progress
	// worth showing.
	a.server.Register("containers.run", func(ctx context.Context, params json.RawMessage) (any, error) {
		spec, err := decodeParams[containers.ContainerSpec](params)
		if err != nil {
			return nil, err
		}

		container, err := a.containers.Create(ctx, spec)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return container, nil
	})

	a.server.Register("containers.logs", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID     string `json:"id"`
			Tail   int    `json:"tail"`
			Follow *bool  `json:"follow"`
		}](params)
		if err != nil {
			return nil, err
		}

		follow := args.Follow == nil || *args.Follow

		id, err := a.streams.runCommand(ctx, "logs", func(ctx context.Context) (*exec.Cmd, error) {
			return a.containers.LogsCommand(ctx, args.ID, args.Tail, follow), nil
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})
}

// --- images ---------------------------------------------------------------

func (a *Agent) registerImages() {
	a.server.Register("images.list", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return a.images.List(ctx)
	})

	a.server.Register("images.inspect", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Reference string `json:"reference"`
		}](params)
		if err != nil {
			return nil, err
		}

		return a.images.Inspect(ctx, args.Reference)
	})

	a.server.Register("images.pull", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Reference string `json:"reference"`
			Platform  string `json:"platform"`
			Scheme    string `json:"scheme"`
		}](params)
		if err != nil {
			return nil, err
		}

		id, err := a.streams.runNamed(ctx, "pull", args.Reference,
			func(ctx context.Context) (*exec.Cmd, error) {
				return a.images.PullCommand(ctx, args.Reference, args.Platform, args.Scheme), nil
			})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})

	a.server.Register("images.save", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Reference string `json:"reference"`
			Platform  string `json:"platform"`
			Output    string `json:"output"`
		}](params)
		if err != nil {
			return nil, err
		}

		id, err := a.streams.runCommand(ctx, "save", func(ctx context.Context) (*exec.Cmd, error) {
			return a.images.SaveCommand(ctx, args.Reference, args.Platform, args.Output), nil
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})

	a.server.Register("images.load", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Input string `json:"input"`
		}](params)
		if err != nil {
			return nil, err
		}

		id, err := a.streams.runCommand(ctx, "load", func(ctx context.Context) (*exec.Cmd, error) {
			return a.images.LoadCommand(ctx, args.Input), nil
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})

	a.server.Register("images.build", func(ctx context.Context, params json.RawMessage) (any, error) {
		opts, err := decodeParams[images.BuildOptions](params)
		if err != nil {
			return nil, err
		}
		// A Dockerfile typed into the app is written out first, and the
		// directory holding it becomes the context -- unless a real one was
		// named, which is what a paste with COPY in it needs.
		var staged string
		if text := strings.TrimSpace(opts.DockerfileText); text != "" {
			dir, file, err := images.StageDockerfile(opts.DockerfileText)
			if err != nil {
				return nil, rpc.Fail(err.Error())
			}

			staged = dir
			opts.Dockerfile = file
			if strings.TrimSpace(opts.Context) == "" {
				opts.Context = dir
			}
		}

		if strings.TrimSpace(opts.Context) == "" {
			return nil, rpc.Fail("a build needs a context directory")
		}

		// The directory dies with the build, not with this request: the
		// request returns the moment the build starts, and the build reads
		// that directory for as long as it runs.
		id, err := a.streams.runNamedThen(ctx, "build", named(opts.Tag, opts.Context),
			func(ctx context.Context) (*exec.Cmd, error) {
				return a.images.BuildCommand(ctx, opts), nil
			}, func() {
				if staged != "" {
					_ = os.RemoveAll(staged)
				}
			})
		if err != nil {
			// Nothing was started, so nothing else will clear this up.
			if staged != "" {
				_ = os.RemoveAll(staged)
			}

			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})

	// Every build runs through a buildkit container, which does not exist until
	// something starts it. Asked before a build, this turns a confusing failure
	// into a step the UI can offer.
	a.server.Register("images.builderStatus", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return a.images.BuilderStatus(ctx), nil
	})

	a.server.Register("images.startBuilder", func(ctx context.Context, _ json.RawMessage) (any, error) {
		id, err := a.streams.runCommand(ctx, "builder", func(ctx context.Context) (*exec.Cmd, error) {
			return a.images.StartBuilderCommand(ctx), nil
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})

	a.server.Register("images.delete", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Reference string `json:"reference"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.images.Delete(ctx, args.Reference); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"reference": args.Reference}, nil
	})

	a.server.Register("images.prune", func(ctx context.Context, _ json.RawMessage) (any, error) {
		if err := a.images.Prune(ctx); err != nil {
			return nil, rpc.Fail(err.Error())
		}
		return map[string]any{}, nil
	})
}

// prepareVolumes makes every named volume a container is about to mount fit for
// an image to write to, creating the ones that do not exist yet.
//
// A volume is an ext4 filesystem and so is born with a lost+found in it, which
// images that inspect their data directory read as "not empty": redis then
// declines to fix permissions and cannot write, Postgres refuses to initialise.
// Removing it is idempotent, so this asks no questions first -- and it is best
// effort, because a container that starts with a rough volume is better than a
// container that did not start at all.
//
// Only the create path calls this. The helper containers Dermaga runs on its
// own account already know what they are mounting.
func (a *Agent) prepareVolumes(ctx context.Context, spec containers.ContainerSpec) {
	known := map[string]bool{}
	if list, err := a.volumes.List(ctx); err == nil {
		for _, volume := range list {
			known[volume.Name] = true
		}
	}

	for _, mount := range spec.Mounts {
		if mount.Type != "volume" || mount.Source == "" {
			continue
		}

		// Creating it here rather than leaving it to `container run` means it
		// arrives tidied, and one fewer thing to reason about afterwards.
		if !known[mount.Source] {
			if err := a.volumes.Create(ctx, volumes.Spec{Name: mount.Source}); err != nil {
				a.logger.Warn("Could not create the volume for a new container",
					"volume", mount.Source, "error", err)
			}
			continue
		}

		if err := a.volumes.Tidy(ctx, mount.Source, a.volumeMount(ctx, mount.Source)); err != nil {
			a.logger.Warn("Could not prepare the volume for a new container",
				"volume", mount.Source, "error", err)
		}
	}
}

// volumeMount finds a running container holding the volume, so the work can go
// through it rather than through a helper that would be refused the disk.
func (a *Agent) volumeMount(ctx context.Context, name string) *volumes.Mount {
	list, err := a.containers.List(ctx, true)
	if err != nil {
		return nil
	}

	for _, container := range list {
		if container.Status != "running" {
			continue
		}

		for _, mount := range container.Mounts {
			if mount.Type == "volume" && mount.Source == name {
				return &volumes.Mount{Container: container.ID, Path: mount.Destination}
			}
		}
	}

	return nil
}

// --- volumes and networks -------------------------------------------------

func (a *Agent) registerVolumes() {
	// Who owns the volume's root directory, and how to change it.
	//
	// Most "permission denied" inside a container comes down to this: the image
	// runs as somebody other than root -- redis as 999, postgres as 999 -- and
	// a volume is born owned by root. Neither call reaches for a helper
	// container when some running container already has the volume, because a
	// disk image can only be attached to one running VM at a time.
	a.server.Register("volumes.owner", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Name string `json:"name"`
		}](params)
		if err != nil {
			return nil, err
		}

		state, err := a.volumes.Inspect(ctx, args.Name, a.volumeMount(ctx, args.Name))
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return state, nil
	})

	// Removes the filesystem's own lost+found, which is what makes a fresh
	// volume look occupied to an image that checks before it writes.
	a.server.Register("volumes.tidy", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Name string `json:"name"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.volumes.Tidy(ctx, args.Name, a.volumeMount(ctx, args.Name)); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		state, err := a.volumes.Inspect(ctx, args.Name, a.volumeMount(ctx, args.Name))
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return state, nil
	})

	a.server.Register("volumes.setOwner", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Name  string `json:"name"`
			Owner string `json:"owner"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.volumes.SetOwner(ctx, args.Name, args.Owner, a.volumeMount(ctx, args.Name)); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		state, err := a.volumes.Inspect(ctx, args.Name, a.volumeMount(ctx, args.Name))
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return state, nil
	})

	a.server.Register("volumes.list", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return a.volumes.List(ctx)
	})

	a.server.Register("volumes.create", func(ctx context.Context, params json.RawMessage) (any, error) {
		spec, err := decodeParams[volumes.Spec](params)
		if err != nil {
			return nil, err
		}

		if err := a.volumes.Create(ctx, spec); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"name": spec.Name}, nil
	})

	a.server.Register("volumes.delete", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Name string `json:"name"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.volumes.Delete(ctx, args.Name); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"name": args.Name}, nil
	})
}

func (a *Agent) registerNetworks() {
	a.server.Register("networks.list", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return a.networks.List(ctx)
	})

	a.server.Register("networks.create", func(ctx context.Context, params json.RawMessage) (any, error) {
		spec, err := decodeParams[networks.Spec](params)
		if err != nil {
			return nil, err
		}

		if err := a.networks.Create(ctx, spec); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"name": spec.Name}, nil
	})

	a.server.Register("networks.delete", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Name string `json:"name"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.networks.Delete(ctx, args.Name); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"name": args.Name}, nil
	})
}

// --- machines -------------------------------------------------------------

func (a *Agent) registerMachines() {
	a.server.Register("machines.list", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return a.machines.List(ctx)
	})

	a.server.Register("machines.get", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		return a.machines.Get(ctx, args.ID)
	})

	a.server.Register("machines.start", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		machine, err := a.machines.Start(ctx, args.ID)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return machine, nil
	})

	a.server.Register("machines.stop", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		machine, err := a.machines.Stop(ctx, args.ID)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return machine, nil
	})

	a.server.Register("machines.delete", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.machines.Delete(ctx, args.ID); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"id": args.ID}, nil
	})

	a.server.Register("machines.setDefault", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.machines.SetDefault(ctx, args.ID); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"id": args.ID}, nil
	})

	a.server.Register("machines.configure", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID       string            `json:"id"`
			Settings machines.Settings `json:"settings"`
		}](params)
		if err != nil {
			return nil, err
		}

		machine, err := a.machines.Configure(ctx, args.ID, args.Settings)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return machine, nil
	})

	a.server.Register("machines.create", func(ctx context.Context, params json.RawMessage) (any, error) {
		spec, err := decodeParams[machines.Spec](params)
		if err != nil {
			return nil, err
		}

		id, err := a.streams.runNamed(ctx, "machine", named(spec.Name, spec.Image),
			func(ctx context.Context) (*exec.Cmd, error) {
				return a.machines.CreateCommand(ctx, spec)
			})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})

	a.server.Register("machines.logs", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID     string `json:"id"`
			Tail   int    `json:"tail"`
			Follow *bool  `json:"follow"`
			Boot   bool   `json:"boot"`
		}](params)
		if err != nil {
			return nil, err
		}

		follow := args.Follow == nil || *args.Follow

		id, err := a.streams.runCommand(ctx, "logs", func(ctx context.Context) (*exec.Cmd, error) {
			return a.machines.LogsCommand(ctx, args.ID, args.Tail, follow, args.Boot), nil
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})
}

// --- streams, events and terminals ----------------------------------------

func (a *Agent) registerStreams() {
	a.server.Register("system.logs", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Last   string `json:"last"`
			Follow *bool  `json:"follow"`
		}](params)
		if err != nil {
			return nil, err
		}

		if args.Last == "" {
			args.Last = "30m"
		}
		follow := args.Follow == nil || *args.Follow

		id, err := a.streams.runCommand(ctx, "syslog", func(ctx context.Context) (*exec.Cmd, error) {
			return a.system.LogsCommand(ctx, args.Last, follow), nil
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})

	a.server.Register("stream.cancel", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID string `json:"id"`
		}](params)
		if err != nil {
			return nil, err
		}

		a.streams.cancel(args.ID)

		return map[string]any{}, nil
	})

	// One subscription per client; snapshots arrive as events.snapshot.
	a.server.Register("events.subscribe", func(ctx context.Context, _ json.RawMessage) (any, error) {
		id, updates, snapshot, ready := a.watcher.Subscribe()

		if ready {
			a.server.Notify("events.snapshot", snapshot)
		}

		go func() {
			defer a.watcher.Unsubscribe(id)

			for {
				select {
				case <-ctx.Done():
					return
				case next := <-updates:
					a.server.Notify("events.snapshot", next)
				}
			}
		}()

		return map[string]any{"subscribed": true}, nil
	})

	a.server.Register("terminal.open", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Kind    string `json:"kind"`
			ID      string `json:"id"`
			Command string `json:"command"`
			User    string `json:"user"`
		}](params)
		if err != nil {
			return nil, err
		}

		kind := terminal.Container
		if args.Kind == string(terminal.Machine) {
			kind = terminal.Machine
		}

		streamID, err := a.streams.openTerminal(ctx, func(
			ctx context.Context,
			onData func([]byte),
			onClose func(error),
		) (*terminal.Session, error) {
			return terminal.Open(
				ctx, a.runner, a.logger, kind, args.ID, args.Command, args.User, onData, onClose,
			)
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": streamID}, nil
	})

	a.server.Register("terminal.input", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID   string `json:"id"`
			Data string `json:"data"`
		}](params)
		if err != nil {
			return nil, err
		}

		session := a.streams.session(args.ID)
		if session == nil {
			return nil, rpc.Fail("terminal is closed")
		}

		decoded, err := decodeBase64(args.Data)
		if err != nil {
			return nil, err
		}

		if err := session.Write(decoded); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{}, nil
	})

	a.server.Register("terminal.resize", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			ID   string `json:"id"`
			Cols uint16 `json:"cols"`
			Rows uint16 `json:"rows"`
		}](params)
		if err != nil {
			return nil, err
		}

		session := a.streams.session(args.ID)
		if session == nil {
			return map[string]any{}, nil
		}

		if err := session.Resize(args.Cols, args.Rows); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{}, nil
	})
}

// SocketPath is where an agent serving a socket puts it: beside the settings
// and the scan results, in a directory only this user can read.
//
// DERMAGA_SOCKET overrides it, which is how a development build keeps to
// itself. Sharing one path would mean the app you are working on driving the
// agent of the one you have installed -- different code, same containers, and
// no sign on screen that it is happening.
func SocketPath() (string, error) {
	if custom := strings.TrimSpace(os.Getenv("DERMAGA_SOCKET")); custom != "" {
		return custom, nil
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(home, ".dermaga", "agent.sock"), nil
}
