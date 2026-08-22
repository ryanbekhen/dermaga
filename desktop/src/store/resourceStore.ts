import { create } from 'zustand';
import type { Container, DiskUsage, Image, Machine, Network, SystemStatus, Volume } from '../types';

interface ResourceState {
  containers: Container[];
  machines: Machine[];
  images: Image[];
  volumes: Volume[];
  networks: Network[];
  /** False only until the first snapshot lands. */
  hasLoaded: boolean;
  /**
   * The host, as of the last snapshot. It arrives with everything else rather
   * than on a timer of its own: the window used to ask for it every fifteen
   * seconds, which is both slower than a change and busier than nothing
   * happening.
   */
  system: SystemStatus | null;
  cliAvailable: boolean;
  /** What the runtime occupies, recomputed by the agent when anything moved. */
  disk: DiskUsage | null;
  error: string | null;
  setContainers: (containers: Container[]) => void;
  setMachines: (machines: Machine[]) => void;
  setImages: (images: Image[]) => void;
  setVolumes: (volumes: Volume[]) => void;
  setNetworks: (networks: Network[]) => void;
  setHost: (host: {
    system: SystemStatus | null;
    cliAvailable: boolean;
    disk: DiskUsage | null;
  }) => void;
  setError: (error: string | null) => void;
}

export const useResourceStore = create<ResourceState>((set) => ({
  containers: [],
  machines: [],
  images: [],
  volumes: [],
  networks: [],
  hasLoaded: false,
  system: null,
  cliAvailable: true,
  disk: null,
  error: null,
  setContainers: (containers) => set({ containers, hasLoaded: true }),
  setMachines: (machines) => set({ machines }),
  setImages: (images) => set({ images }),
  setVolumes: (volumes) => set({ volumes }),
  setNetworks: (networks) => set({ networks }),
  // Disk is only recomputed by the agent when something changed, so a snapshot
  // that carries none is saying "unchanged", not "gone".
  setHost: ({ system, cliAvailable, disk }) =>
    set((state) => ({ system, cliAvailable, disk: disk ?? state.disk })),
  setError: (error) => set({ error }),
}));
