import { useEffect, useState } from 'react';
import { invoke, onNotify } from '../services/ipc';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import type { Container, Image, Machine, Network, Volume } from '../types';

export type ConnectionState = 'connecting' | 'live' | 'disconnected';

interface Snapshot {
  containers: Container[];
  machines: Machine[];
  images: Image[];
  volumes: Volume[];
  networks: Network[];
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
  const setError = useResourceStore((s) => s.setError);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const unsubscribe = onNotify((message) => {
      // A container that stopped on its own is also announced by macOS, but
      // that needs permission the app may not have been granted -- and in
      // development it never is. The toast is the part that always arrives.
      if (message.method === 'containers.exited') {
        const exit = message.params as { name?: string };
        if (exit?.name) {
          useToastStore.getState().push(`${exit.name} stopped on its own`, 'error');
        }
        return;
      }

      if (message.method !== 'events.snapshot') return;

      const snapshot = message.params as Snapshot;
      setContainers(snapshot.containers ?? []);
      setMachines(snapshot.machines ?? []);
      setImages(snapshot.images ?? []);
      setVolumes(snapshot.volumes ?? []);
      setNetworks(snapshot.networks ?? []);
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
  }, [setContainers, setMachines, setImages, setVolumes, setNetworks, setError]);

  return connection;
}
