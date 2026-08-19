import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { trayLabel, trayMenuTemplate, MAX_CONTAINERS } = createRequire(import.meta.url)(
  './tray-menu.cjs'
);

const labels = (state) => trayMenuTemplate(state).map((item) => item.label ?? '—');

describe('the menu bar item', () => {
  it('answers the question it exists for, in one line', () => {
    expect(trayLabel({ running: true, containers: [{ name: 'a' }, { name: 'b' }] })).toBe(
      'Services running · 2 containers'
    );
    expect(trayLabel({ running: true, containers: [{ name: 'a' }] })).toBe(
      'Services running · 1 container'
    );
    expect(trayLabel({ running: false })).toBe('Services stopped');
    // Before the first answer arrives, it says so rather than claiming zero.
    expect(trayLabel({ running: null })).toBe('Checking the services…');
  });

  it('offers Start services only when they are stopped', () => {
    expect(labels({ running: false })).toContain('Start services');
    expect(labels({ running: true, containers: [] })).not.toContain('Start services');
    // Unknown is not the same as stopped: nothing to recover from yet.
    expect(labels({ running: null })).not.toContain('Start services');
  });

  it('always keeps a way back into the window and a way out of the app', () => {
    for (const state of [{ running: true, containers: [] }, { running: false }, {}]) {
      expect(labels(state)).toContain('Open Dermaga');
      expect(labels(state)).toContain('Quit Dermaga');
    }
  });

  it('lists the running containers, and counts the rest', () => {
    const containers = Array.from({ length: MAX_CONTAINERS + 4 }, (_, i) => ({
      id: `id-${i}`,
      name: `container-${i}`,
    }));

    const shown = labels({ running: true, containers });

    expect(shown).toContain('container-0');
    expect(shown).toContain(`container-${MAX_CONTAINERS - 1}`);
    expect(shown).not.toContain(`container-${MAX_CONTAINERS}`);
    expect(shown).toContain('…and 4 more');
  });

  it('says nothing is running rather than showing an empty gap', () => {
    expect(labels({ running: true, containers: [] })).toContain('No containers running');
  });
});
