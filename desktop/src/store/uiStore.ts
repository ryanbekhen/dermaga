import { create } from 'zustand';
import type { BuildDrop, ContainerTab, MachineTab, Route } from '../types';

/**
 * Something to do on arrival, set by whoever navigated. The command palette can
 * then mean "pull an image" rather than "go to Images and find the button",
 * without reaching into another page's state.
 */
export type Intent =
  | 'container.create'
  | 'container.template'
  | 'image.pull'
  | 'image.build'
  | 'volume.create'
  | 'network.create'
  | 'network.attach'
  | 'network.detach'
  | 'machine.create'
  | 'registry.add';

/**
 * What an intent is about.
 *
 * A string for the ones that name a single thing -- the container to detach,
 * the image to run. A value for the one that cannot: a Dockerfile dropped on
 * the window is a folder, a filename within it and a tag worth suggesting, and
 * squeezing three things into one string only means parsing them back out.
 */
export type IntentTarget = string | BuildDrop;

interface UIState {
  route: Route;
  /**
   * What is typed into the title bar. There is one search in this app and this
   * is it: every page used to carry a box of its own as well, so a name typed
   * in one of them found nothing while the other had the answer.
   */
  globalQuery: string;
  intent: Intent | null;
  /** What the intent is about, when it needs one -- the container to detach. */
  intentTarget: IntentTarget | null;
  navigate: (route: Route) => void;
  /** Navigates and asks the page it lands on to open something. */
  navigateWith: (route: Route, intent: Intent, target?: IntentTarget) => void;
  /** Called by the page once it has acted on the intent, or dismissed it. */
  clearIntent: () => void;
  /** `path` opens the files tab at a directory, e.g. a volume's mount point. */
  openContainer: (id: string, tab?: ContainerTab, path?: string) => void;
  openMachine: (id: string, tab?: MachineTab) => void;
  openImage: (reference: string) => void;
  openNetwork: (name: string) => void;
  openVolume: (name: string) => void;
  /** Switches tabs within the current detail route; ignored elsewhere. */
  setTab: (tab: string) => void;
  back: () => void;
  setGlobalQuery: (query: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  route: { name: 'containers' },
  globalQuery: '',
  intent: null,
  intentTarget: null,
  // Moving clears the search: the page you asked for is the page you land on.
  // Every other way of moving drops a pending intent too -- arriving somewhere
  // by another route means the user changed their mind.
  navigate: (route) => set({ route, intent: null, intentTarget: null, globalQuery: '' }),
  // Navigates and asks the page it lands on to open something, which is how a
  // search result can be "Pull an image" rather than "go to Images and find
  // the button".
  navigateWith: (route, intent, target) =>
    set({ route, intent, intentTarget: target ?? null, globalQuery: '' }),
  clearIntent: () => set({ intent: null, intentTarget: null }),
  // Logs, not Inspect. A container is opened to see what it is saying far more
  // often than to read back the flags it was started with, and the flags are
  // one tab away either way.
  openContainer: (id, tab = 'logs', path) =>
    set({
      route: { name: 'container', id, tab, path },
      globalQuery: '',
    }),
  openMachine: (id, tab = 'overview') =>
    set({ route: { name: 'machine', id, tab }, intent: null, intentTarget: null, globalQuery: '' }),
  openImage: (reference) =>
    set({ route: { name: 'image', reference }, intent: null, intentTarget: null, globalQuery: '' }),
  openNetwork: (name) =>
    set({
      route: { name: 'network', network: name },
      globalQuery: '',
    }),
  openVolume: (name) =>
    set({
      route: { name: 'volume', volume: name },
      globalQuery: '',
    }),
  setTab: (tab) =>
    set((state) => {
      if (state.route.name === 'container') {
        return { route: { ...state.route, tab: tab as ContainerTab } };
      }
      if (state.route.name === 'machine') {
        return { route: { ...state.route, tab: tab as MachineTab } };
      }
      return state;
    }),
  back: () =>
    set((state) => {
      const cleared = { intent: null, intentTarget: null, globalQuery: '' };
      if (state.route.name === 'container') return { route: { name: 'containers' }, ...cleared };
      if (state.route.name === 'machine') return { route: { name: 'machines' }, ...cleared };
      if (state.route.name === 'image') return { route: { name: 'images' }, ...cleared };
      if (state.route.name === 'network') return { route: { name: 'networks' }, ...cleared };
      if (state.route.name === 'volume') return { route: { name: 'volumes' }, ...cleared };
      return state;
    }),
  setGlobalQuery: (globalQuery) => set({ globalQuery }),
}));
