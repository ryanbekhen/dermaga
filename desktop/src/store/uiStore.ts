import { create } from 'zustand';
import type { ContainerTab, MachineTab, Route } from '../types';

/**
 * Something to do on arrival, set by whoever navigated. The command palette can
 * then mean "pull an image" rather than "go to Images and find the button",
 * without reaching into another page's state.
 */
export type Intent =
  | 'container.create'
  | 'image.pull'
  | 'image.build'
  | 'volume.create'
  | 'network.create'
  | 'machine.create'
  | 'registry.add';

interface UIState {
  route: Route;
  searchQuery: string;
  intent: Intent | null;
  navigate: (route: Route) => void;
  /** Navigates and asks the page it lands on to open something. */
  navigateWith: (route: Route, intent: Intent) => void;
  /** Called by the page once it has acted on the intent, or dismissed it. */
  clearIntent: () => void;
  openContainer: (id: string, tab?: ContainerTab) => void;
  openMachine: (id: string, tab?: MachineTab) => void;
  openImage: (reference: string) => void;
  /** Switches tabs within the current detail route; ignored elsewhere. */
  setTab: (tab: string) => void;
  back: () => void;
  setSearchQuery: (query: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  route: { name: 'containers' },
  searchQuery: '',
  intent: null,
  // Every other way of moving drops a pending intent: arriving somewhere by
  // another route means the user changed their mind.
  navigate: (route) => set({ route, intent: null }),
  navigateWith: (route, intent) => set({ route, intent }),
  clearIntent: () => set({ intent: null }),
  openContainer: (id, tab = 'overview') =>
    set({ route: { name: 'container', id, tab }, intent: null }),
  openMachine: (id, tab = 'overview') => set({ route: { name: 'machine', id, tab }, intent: null }),
  openImage: (reference) => set({ route: { name: 'image', reference }, intent: null }),
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
      if (state.route.name === 'container') return { route: { name: 'containers' }, intent: null };
      if (state.route.name === 'machine') return { route: { name: 'machines' }, intent: null };
      if (state.route.name === 'image') return { route: { name: 'images' }, intent: null };
      return state;
    }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
