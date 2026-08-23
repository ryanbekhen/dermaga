import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { invoke, onNotify } from '../services/ipc';
import { useResourceStore } from '../store/resourceStore';
import type { Container, DiskUsage, Image, Machine, Network, SystemStatus, Volume } from '../types';

export type ConnectionState = 'connecting' | 'live' | 'disconnected';

interface Snapshot {
  containers: Container[];
  machines: Machine[];
  images: Image[];
  volumes: Volume[];
  networks: Network[];
  system?: SystemStatus;
  cliAvailable?: boolean;
  disk?: DiskUsage;
}

/**
 * Subscribes to the agent's snapshots. It pushes a new one whenever anything
 * changes -- including immediately after an action taken here -- so nothing in
 * the UI polls or refreshes on a timer.
 */
export function useEventStream() {
  const setContainers = useResourceStore((s) => s.setContainers);
  const setMachines = useResourceStore((s) => s.setMachines);
  const setImages = useResourceStore((s) => s.setImages);
  const setVolumes = useResourceStore((s) => s.setVolumes);
  const setNetworks = useResourceStore((s) => s.setNetworks);
  const setHost = useResourceStore((s) => s.setHost);
  const setError = useResourceStore((s) => s.setError);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const unsubscribe = onNotify((message) => {
      // A container stopping is announced once, by the side that knows whether
      // this window is in front of the reader: a toast if it is, a macOS
      // notification if it is not. It used to be said here as well, which meant
      // both at once -- a banner with a sound, over a window already showing
      // the same sentence.
      if (message.method === 'containers.exited') return;

      if (message.method !== 'events.snapshot') return;

      const snapshot = message.params as Snapshot;
      setContainers(snapshot.containers ?? []);
      setMachines(snapshot.machines ?? []);
      setImages(snapshot.images ?? []);
      setVolumes(snapshot.volumes ?? []);
      setNetworks(snapshot.networks ?? []);
      // An agent old enough not to carry the host in its snapshot is still a
      // working agent -- someone with the background service installed can be
      // running a copy of Dermaga from before this field existed. Left to the
      // snapshot alone the window would report "Engine stopped" over a
      // perfectly healthy machine, which is the worst kind of wrong: confident
      // and false. Asked for the old way instead, once, and only then.
      if (snapshot.system === undefined) {
        void api
          .getSystem()
          .then((report) =>
            setHost({ system: report.status, cliAvailable: report.cliAvailable, disk: null })
          )
          .catch(() => {});
      } else {
        setHost({
          system: snapshot.system,
          cliAvailable: snapshot.cliAvailable ?? true,
          disk: snapshot.disk ?? null,
        });
      }
      setConnection('live');
      setError(null);
    });

    void invoke('events.subscribe')
      .then(() => setConnection((prev) => (prev === 'connecting' ? 'connecting' : prev)))
      .catch((err: unknown) => {
        setConnection('disconnected');
        setError(err instanceof Error ? err.message : 'Could not reach the Dermaga agent');
      });

    return unsubscribe;
  }, [setContainers, setMachines, setImages, setVolumes, setNetworks, setHost, setError]);

  return connection;
}
