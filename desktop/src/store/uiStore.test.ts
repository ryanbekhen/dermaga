import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from './uiStore';

/**
 * A search that outlived the navigation it started would leave the results
 * page drawn over whatever the user had just asked to see — they press a
 * result, and land back on the list of results.
 *
 * This replaces a suite about intents, which the command palette set and
 * nothing else did. The palette is gone and the search that used to live in it
 * is in the title bar, so what has to be let go of on the way somewhere is the
 * query rather than an intent — the same invariant about the same act.
 */
describe('the title bar search', () => {
  beforeEach(() => {
    useUIStore.setState({ route: { name: 'containers' }, globalQuery: '' });
  });

  it('is cleared by every way of moving', () => {
    const moves: [string, () => void][] = [
      ['navigate', () => useUIStore.getState().navigate({ name: 'volumes' })],
      ['openContainer', () => useUIStore.getState().openContainer('web')],
      ['openImage', () => useUIStore.getState().openImage('alpine:latest')],
      ['openMachine', () => useUIStore.getState().openMachine('default')],
      ['openNetwork', () => useUIStore.getState().openNetwork('backend')],
      ['openVolume', () => useUIStore.getState().openVolume('pgdata')],
    ];

    for (const [name, move] of moves) {
      useUIStore.getState().setGlobalQuery('alpine');
      move();

      expect(useUIStore.getState().globalQuery, `${name} left the search standing`).toBe('');
    }
  });

  it('is cleared by going back from a detail page', () => {
    useUIStore.setState({ route: { name: 'image', reference: 'alpine:latest' } });
    useUIStore.getState().setGlobalQuery('alpine');

    useUIStore.getState().back();

    expect(useUIStore.getState().globalQuery).toBe('');
    expect(useUIStore.getState().route).toEqual({ name: 'images' });
  });

  it('survives being typed into, which is the whole point', () => {
    useUIStore.getState().setGlobalQuery('redis');

    expect(useUIStore.getState().globalQuery).toBe('redis');
    // Typing is not navigating: the route underneath is untouched, so clearing
    // the box puts the user back where they were.
    expect(useUIStore.getState().route).toEqual({ name: 'containers' });
  });
});
