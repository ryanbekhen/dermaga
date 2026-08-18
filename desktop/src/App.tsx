import { useCallback, useEffect, useState } from 'react';
import { HelpView } from './components/HelpView';
import { LicencesPage } from './pages/LicencesPage';
import { RegistriesPage } from './pages/RegistriesPage';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Toasts } from './components/Toasts';
import { subscribeToScanner } from './store/scannerStore';
import { useEventStream } from './hooks/useEventStream';
import { useFullScreen } from './hooks/useFullScreen';
import { useTheme } from './hooks/useTheme';
import { api } from './services/api';
import { ContainerDetailPage } from './pages/ContainerDetailPage';
import { ContainersPage } from './pages/ContainersPage';
import { ImageDetailPage } from './pages/ImageDetailPage';
import { ImagesPage } from './pages/ImagesPage';
import { MachineDetailPage } from './pages/MachineDetailPage';
import { MachinesPage } from './pages/MachinesPage';
import { NetworksPage } from './pages/NetworksPage';
import { ServicesOffline } from './pages/ServicesOffline';
import { SystemPage } from './pages/SystemPage';
import { VolumesPage } from './pages/VolumesPage';
import { useResourceStore } from './store/resourceStore';
import { useUIStore } from './store/uiStore';
import type { BuildInfo, SystemStatus } from './types';

const APP_VERSION = '1.0.0';

export function App() {
  useTheme();

  const connection = useEventStream();

  // The scanner reports itself; this only opens the ear for it.
  useEffect(() => subscribeToScanner(), []);

  const route = useUIStore((s) => s.route);
  const navigate = useUIStore((s) => s.navigate);
  const containers = useResourceStore((s) => s.containers);
  const machines = useResourceStore((s) => s.machines);
  const error = useResourceStore((s) => s.error);

  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [cliAvailable, setCliAvailable] = useState(true);
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const fullScreen = useFullScreen();

  // The services are what everything else depends on, so their state is
  // checked on its own schedule rather than riding the resource stream.
  const refreshSystem = useCallback(async () => {
    try {
      const report = await api.getSystem();
      setSystem(report.status);
      setCliAvailable(report.cliAvailable);
    } catch {
      setSystem(null);
    }
  }, []);

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
    // Fetch on mount: the rule guards against render loops, and this resolves
    // asynchronously exactly once before the interval takes over.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSystem();
    const interval = setInterval(() => void refreshSystem(), 15000);
    return () => clearInterval(interval);
  }, [refreshSystem]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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

  useEffect(() => {
    if (route.name === 'container' && containers.length > 0 && !selectedContainer) {
      navigate({ name: 'containers' });
    }
    if (route.name === 'machine' && machines.length > 0 && !selectedMachine) {
      navigate({ name: 'machines' });
    }
  }, [route, containers.length, machines.length, selectedContainer, selectedMachine, navigate]);

  // Nothing else is usable without the services, so the window becomes the
  // single screen that fixes it -- no sidebar, no status bar, no navigation to
  // pages that would only be empty.
  if (blocked) {
    return (
      <div className="flex h-screen flex-col overflow-hidden">
        {/* Room for the traffic lights, and a handle to move the window. */}
        <div className="drag h-10 shrink-0" />
        <ServicesOffline cliMissing={runtimeMissing} onStarted={() => void refreshSystem()} />
        <Toasts />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Nothing sits above the page here, so give the window a drag strip.
              Fullscreen has no title bar to clear, so it shrinks. */}
          <div className={`drag shrink-0 ${fullScreen ? 'h-2' : 'h-6'}`} />

          <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-4">
            {route.name === 'containers' && <ContainersPage runtimeMissing={runtimeMissing} />}

            {route.name === 'container' &&
              (selectedContainer ? (
                <ContainerDetailPage container={selectedContainer} tab={route.tab} />
              ) : (
                <Loading />
              ))}

            {route.name === 'images' && <ImagesPage />}

            {route.name === 'image' && <ImageDetailPage reference={route.reference} />}

            {route.name === 'volumes' && <VolumesPage />}

            {route.name === 'networks' && <NetworksPage />}

            {route.name === 'machines' && <MachinesPage runtimeMissing={runtimeMissing} />}

            {route.name === 'machine' &&
              (selectedMachine ? (
                <MachineDetailPage machine={selectedMachine} tab={route.tab} />
              ) : (
                <Loading />
              ))}

            {route.name === 'system' && (
              <SystemPage status={system} onRefresh={() => void refreshSystem()} />
            )}

            {route.name === 'settings' && <SettingsPanel />}

            {route.name === 'help' && <HelpView version={build?.version ?? APP_VERSION} />}

            {route.name === 'registries' && <RegistriesPage />}

            {route.name === 'licences' && <LicencesPage />}
          </main>
        </div>
      </div>

      <StatusBar build={build} system={system} connection={connection} error={error} />

      <Toasts />
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
