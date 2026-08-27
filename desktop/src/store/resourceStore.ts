import { create } from 'zustand';
import type {
  Container,
  DiskUsage,
  Image,
  Machine,
  Network,
  Project,
  SystemStatus,
  ToolchainStatus,
  Tunnel,
  Volume,
} from '../types';

interface ResourceState {
  containers: Container[];
  machines: Machine[];
  images: Image[];
  volumes: Volume[];
  networks: Network[];
  /** Every tunnel and the routes on it, pushed with everything else. */
  tunnels: Tunnel[];
  /**
   * The projects somebody has made, pushed with everything else so the
   * switcher and the list it filters can never disagree about what exists.
   */
  projects: Project[];
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
  /**
   * Apple's CLI: its version, whether a newer one is waiting, and whether it
   * is older than Dermaga is written for. Pushed like everything else, so the
   * sidebar can say so without the System page ever being opened.
   */
  toolchain: ToolchainStatus | null;
  /** What the runtime occupies, recomputed by the agent when anything moved. */
  disk: DiskUsage | null;
  error: string | null;
  setContainers: (containers: Container[]) => void;
  setMachines: (machines: Machine[]) => void;
  setImages: (images: Image[]) => void;
  setVolumes: (volumes: Volume[]) => void;
  setNetworks: (networks: Network[]) => void;
  setTunnels: (tunnels: Tunnel[]) => void;
  setProjects: (projects: Project[]) => void;
  setHost: (host: {
    system: SystemStatus | null;
    cliAvailable: boolean;
    disk: DiskUsage | null;
    toolchain: ToolchainStatus | null;
  }) => void;
  setError: (error: string | null) => void;
}

export const useResourceStore = create<ResourceState>((set) => ({
  containers: [],
  machines: [],
  images: [],
  volumes: [],
  networks: [],
  tunnels: [],
  projects: [],
  hasLoaded: false,
  system: null,
  cliAvailable: true,
  toolchain: null,
  disk: null,
  error: null,
  setContainers: (containers) => set({ containers, hasLoaded: true }),
  setMachines: (machines) => set({ machines }),
  setImages: (images) => set({ images }),
  setVolumes: (volumes) => set({ volumes }),
  setNetworks: (networks) => set({ networks }),
  setTunnels: (tunnels) => set({ tunnels }),
  setProjects: (projects) => set({ projects }),
  // Disk is only recomputed by the agent when something changed, so a snapshot
  // that carries none is saying "unchanged", not "gone". The CLI's status is
  // the same shape of thing: checked on its own schedule, and absent until the
  // first check has run.
  setHost: ({ system, cliAvailable, disk, toolchain }) =>
    set((state) => ({
      system,
      cliAvailable,
      disk: disk ?? state.disk,
      toolchain: toolchain ?? state.toolchain,
    })),
  setError: (error) => set({ error }),
}));
