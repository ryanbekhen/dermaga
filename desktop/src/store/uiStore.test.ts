import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from './uiStore';

/**
 * An intent that outlives the navigation that carried it would reopen a dialog
 * the user has already dismissed, on a page they only passed through.
 */
describe('intents', () => {
  beforeEach(() => {
    useUIStore.setState({ route: { name: 'containers' }, intent: null, intentTarget: null });
  });

  it('travels with the route it was given', () => {
    useUIStore.getState().navigateWith({ name: 'images' }, 'image.pull');

    expect(useUIStore.getState().route).toEqual({ name: 'images' });
    expect(useUIStore.getState().intent).toBe('image.pull');
  });

  it('is dropped by every other way of moving', () => {
    const moves: [string, () => void][] = [
      ['navigate', () => useUIStore.getState().navigate({ name: 'volumes' })],
      ['openContainer', () => useUIStore.getState().openContainer('web')],
      ['openImage', () => useUIStore.getState().openImage('alpine:latest')],
      ['openMachine', () => useUIStore.getState().openMachine('default')],
      ['openNetwork', () => useUIStore.getState().openNetwork('backend')],
    ];

    for (const [name, move] of moves) {
      useUIStore.getState().navigateWith({ name: 'images' }, 'image.build');
      move();
      expect(useUIStore.getState().intent, `${name} left an intent behind`).toBeNull();
    }
  });

  it('carries what it is about, and lets go of it together', () => {
    // "Detach web from backend" is one intent about one container; the target
    // must not outlive it, or the next detach would name the wrong one.
    useUIStore
      .getState()
      .navigateWith({ name: 'network', network: 'backend' }, 'network.detach', 'web');

    expect(useUIStore.getState().intentTarget).toBe('web');

    useUIStore.getState().clearIntent();
    expect(useUIStore.getState().intentTarget).toBeNull();
  });

  it('is dropped when the page it was meant for hands it back', () => {
    useUIStore.getState().navigateWith({ name: 'networks' }, 'network.create');
    useUIStore.getState().clearIntent();

    expect(useUIStore.getState().intent).toBeNull();
    // Clearing an intent is not a navigation: the user stays where they are.
    expect(useUIStore.getState().route).toEqual({ name: 'networks' });
  });

  it('does not survive going back from a detail page', () => {
    useUIStore.getState().navigateWith({ name: 'images' }, 'image.pull');
    useUIStore.setState({ route: { name: 'image', reference: 'alpine:latest' } });
    useUIStore.getState().back();

    expect(useUIStore.getState().intent).toBeNull();
  });
});
