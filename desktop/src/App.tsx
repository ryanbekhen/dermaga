import { useEffect, useState } from 'react';
import { Hammer } from 'lucide-react';
import { HelpView } from './components/HelpView';
import { LicencesPage } from './pages/LicencesPage';
import { RegistriesPage } from './pages/RegistriesPage';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import {
  onOpenContainer,
  onOpenTask,
  syncSettings,
  takePendingOpen,
  takePendingTask,
} from './services/ipc';
import { useTaskStore } from './store/taskStore';
import { subscribeToScanner } from './store/scannerStore';
import { restoreTasks, watchAnnouncements } from './services/tasks';
import { useSettingsStore } from './store/settingsStore';
import { useEventStream } from './hooks/useEventStream';
import { useFileDrop } from './hooks/useFileDrop';
import { useTheme } from './hooks/useTheme';
import { api } from './services/api';
import { ChangelogPage } from './pages/ChangelogPage';
import { ContainerDetailPage } from './pages/ContainerDetailPage';
import { ContainersPage } from './pages/ContainersPage';
import { ImageDetailPage } from './pages/ImageDetailPage';
import { ImagesPage } from './pages/ImagesPage';
import { MachineDetailPage } from './pages/MachineDetailPage';
import { MachinesPage } from './pages/MachinesPage';
import { NetworkDetailPage } from './pages/NetworkDetailPage';
import { NetworksPage } from './pages/NetworksPage';
import { SearchResultsPage } from './pages/SearchResultsPage';
import { ServicesOffline } from './pages/ServicesOffline';
import { SystemPage } from './pages/SystemPage';
import { VolumeDetailPage } from './pages/VolumeDetailPage';
import { VolumesPage } from './pages/VolumesPage';
import { useResourceStore } from './store/resourceStore';
import { useUIStore } from './store/uiStore';
import type { BuildInfo } from './types';

const APP_VERSION = '1.0.0';

export function App() {
  useTheme();

  const connection = useEventStream();

  // A Dockerfile dragged in from Finder opens the build dialog on it. What the
  // window looks like while one is held over it is the stylesheet's, not this
  // component's: the drag never reaches the page to be put into state.
  useFileDrop();

  // The scanner reports itself; this only opens the ear for it.
  useEffect(() => subscribeToScanner(), []);

  // What earlier runs built, and what those builds printed. Kept by the agent,
  // because the window is the one thing here that does not survive being shut.
  useEffect(() => void restoreTasks(), []);

  // Anything Dermaga has to say while this window is in front says it here, in
  // the corner. Out of focus it goes to macOS instead; the other side chooses,
  // so it is never said twice.
  useEffect(() => watchAnnouncements(), []);

  const route = useUIStore((s) => s.route);
  const globalQuery = useUIStore((s) => s.globalQuery);
  const navigate = useUIStore((s) => s.navigate);
  const openContainer = useUIStore((s) => s.openContainer);
  const notifyOnExit = useSettingsStore((s) => s.notifyOnExit);
  const notifyOnFinish = useSettingsStore((s) => s.notifyOnFinish);

  // Clicking a "container stopped" notification opens that container.
  useEffect(() => onOpenContainer((id) => openContainer(id)), [openContainer]);

  // And clicking one about a finished build opens what it printed -- the same
  // door the toast in the corner opens, from the other side of the app.
  useEffect(() => onOpenTask((id) => useTaskStore.getState().inspect(id)), []);

  useEffect(() => {
    void takePendingTask().then((id) => {
      if (id) useTaskStore.getState().inspect(id);
    });
  }, []);

  // And one asked for before this window existed -- the same notification, or
  // the menu bar, with everything closed -- is waiting to be collected.
  useEffect(() => {
    void takePendingOpen().then((id) => {
      if (id) openContainer(id);
    });
  }, [openContainer]);

  // The main process raises notifications itself, so it needs to know when the
  // user has asked it not to.
  useEffect(() => syncSettings({ notifyOnExit, notifyOnFinish }), [notifyOnExit, notifyOnFinish]);

  const containers = useResourceStore((s) => s.containers);
  const machines = useResourceStore((s) => s.machines);
  const networks = useResourceStore((s) => s.networks);
  const volumes = useResourceStore((s) => s.volumes);
  const error = useResourceStore((s) => s.error);

  // Pushed with everything else rather than asked for on a timer.
  const system = useResourceStore((s) => s.system);
  const cliAvailable = useResourceStore((s) => s.cliAvailable);
  const [build, setBuild] = useState<BuildInfo | null>(null);

  useEffect(() => {
    // The build never changes while the app runs, so it is read once.
    void api
      .getBuild()
      .then(setBuild)
      .catch(() => {
        // The status bar simply omits it.
      });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘K belongs to the title bar, which puts the cursor in its own field.
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        navigate({ name: 'settings' });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  const runtimeMissing = !cliAvailable;
  // Without the services there is nothing to show on any page, so the whole
  // content area becomes the way to start them.
  const blocked = runtimeMissing || (system !== null && !system.running);

  // A detail route survives only as long as its subject does; if the container
  // or machine disappears, fall back to its list.
  const selectedContainer =
    route.name === 'container' ? containers.find((c) => c.id === route.id) : undefined;
  const selectedMachine =
    route.name === 'machine' ? machines.find((m) => m.id === route.id) : undefined;
  const selectedNetwork =
    route.name === 'network' ? networks.find((n) => n.name === route.network) : undefined;
  const selectedVolume =
    route.name === 'volume' ? volumes.find((v) => v.name === route.volume) : undefined;

  useEffect(() => {
    if (route.name === 'container' && containers.length > 0 && !selectedContainer) {
      navigate({ name: 'containers' });
    }
    if (route.name === 'machine' && machines.length > 0 && !selectedMachine) {
      navigate({ name: 'machines' });
    }
    if (route.name === 'network' && networks.length > 0 && !selectedNetwork) {
      navigate({ name: 'networks' });
    }
    if (route.name === 'volume' && volumes.length > 0 && !selectedVolume) {
      navigate({ name: 'volumes' });
    }
  }, [
    route,
    containers.length,
    machines.length,
    networks.length,
    volumes.length,
    selectedContainer,
    selectedMachine,
    selectedNetwork,
    selectedVolume,
    navigate,
  ]);

  // Nothing else is usable without the services, so the window becomes the
  // single screen that fixes it -- no sidebar, no status bar, no navigation to
  // pages that would only be empty.
  if (blocked) {
    return (
      <div className="flex h-screen flex-col overflow-hidden">
        {/* The bar stays: what it reports is exactly what has gone wrong, and a
            window with its chrome cut away reads as a window that has crashed. */}
        <TitleBar build={build} system={system} connection={connection} error={error} />
        {/* Nothing to call back to: starting the services changes the host,
            the watcher notices within a couple of seconds, and the push puts
            this whole screen away. */}
        <ServicesOffline cliMissing={runtimeMissing} />
        <Toasts />
      </div>
    );
  }

  return (
    // Marked as a drop target because Wails only reports a drop that lands on
    // one: a file let go over anything unmarked is swallowed before either side
    // hears about it. The whole window, so a Dockerfile can be dropped wherever
    // it happens to be dragged to -- and the pane that copies into a container
    // carries a mark of its own, which being nearer wins for drops on it.
    <div data-file-drop-target="window" className="flex h-screen flex-col overflow-hidden">
      <TitleBar build={build} system={system} connection={connection} error={error} />

      <div className="flex min-h-0 flex-1">
        <Sidebar version={build?.version} />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* No padding of its own: every page opens with a header that rules
              off against the sidebar and the status bar, and a gutter around
              the whole column would leave that rule floating in the middle of
              nothing. Pages inset their own content instead. */}
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* A search from the title bar asks across every resource, so its
                answer replaces the page rather than filtering it. The route is
                untouched underneath: clearing the box puts you back where you
                were, which is what makes trying a word cheap. */}
            {globalQuery.trim() && <SearchResultsPage />}

            {!globalQuery.trim() && (
              <>
                {route.name === 'containers' && <ContainersPage runtimeMissing={runtimeMissing} />}

                {route.name === 'container' &&
                  (selectedContainer ? (
                    <ContainerDetailPage
                      container={selectedContainer}
                      tab={route.tab}
                      path={route.path}
                    />
                  ) : (
                    <Loading />
                  ))}

                {route.name === 'images' && <ImagesPage />}

                {route.name === 'image' && <ImageDetailPage reference={route.reference} />}

                {route.name === 'volumes' && <VolumesPage />}

                {route.name === 'volume' &&
                  (selectedVolume ? <VolumeDetailPage volume={selectedVolume} /> : <Loading />)}

                {route.name === 'networks' && <NetworksPage />}

                {route.name === 'network' &&
                  (selectedNetwork ? <NetworkDetailPage network={selectedNetwork} /> : <Loading />)}

                {route.name === 'machines' && <MachinesPage runtimeMissing={runtimeMissing} />}

                {route.name === 'machine' &&
                  (selectedMachine ? (
                    <MachineDetailPage machine={selectedMachine} tab={route.tab} />
                  ) : (
                    <Loading />
                  ))}

                {route.name === 'system' && <SystemPage status={system} />}

                {route.name === 'settings' && <SettingsPanel />}

                {route.name === 'help' && <HelpView version={build?.version ?? APP_VERSION} />}

                {route.name === 'changelog' && (
                  <ChangelogPage version={build?.version ?? APP_VERSION} />
                )}

                {route.name === 'registries' && <RegistriesPage />}

                {route.name === 'licences' && <LicencesPage />}
              </>
            )}
          </main>
        </div>
      </div>

      <DropTarget />

      <Toasts />
    </div>
  );
}

/**
 * The window, while a file is held over it.
 *
 * Not a panel floating over the app: the whole of it, opaque, so what is
 * underneath is gone rather than dimmed. A card in the middle of a window that
 * is otherwise still a list of containers reads as a dialog that appeared --
 * something with a decision in it -- when the only thing being said is that
 * this window is, for as long as you hold the file, one thing: somewhere to
 * build an image.
 *
 * The title bar stays. It is where the window's own controls are, and a Mac
 * window that loses them for a second looks like it has crashed rather than
 * like it is waiting.
 *
 * Always rendered, and shown by the stylesheet when the window is the drag's
 * target. React is not told that a drag is happening at all -- on macOS the
 * drag belongs to a native view above the web content, and the page's only
 * word of it is the class Wails puts on whichever drop target the pointer is
 * over. The pane that copies files into a container marks itself too, and
 * being the nearer target it takes the class instead, which is what keeps this
 * from covering a drag meant for it.
 */
function DropTarget() {
  return (
    <div className="drop-surface pointer-events-none fixed inset-0 top-13 z-50 flex flex-col bg-ink-100 p-5 dark:bg-ink-950">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-brand-600/55 bg-brand-600/4">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600/10 text-brand-600 dark:text-brand-400">
          <Hammer size={26} aria-hidden />
        </span>
        <div className="flex max-w-120 flex-col items-center gap-1.5 text-center">
          <p className="text-page font-semibold">Build an image</p>
          <p className="text-body text-ink-600 dark:text-ink-400">
            Drop a Dockerfile, or a folder with one in it — the tag is the only thing left to name.
          </p>
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <p className="flex flex-1 items-center justify-center text-sm text-ink-600 dark:text-ink-400">
      Loading…
    </p>
  );
}

export default App;
