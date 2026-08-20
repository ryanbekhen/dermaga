import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wails runs the script that carries its flags once the window has finished
 * navigating, which is not necessarily before the modules on the page have
 * run. This file is about what happens when that order comes out wrong: the
 * window used to stay white for good, because the module threw on its way to
 * setting `window.dermaga` and nothing ever tried again.
 */

let flags: Record<string, unknown> | null = null;
const byName = vi.fn(async () => 'answered');

vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: (...args: unknown[]) => byName(...(args as [])) },
  Events: { On: () => () => {}, Emit: () => {} },
  Flags: {
    GetFlag: (key: string) => {
      // The real one throws while the flags are absent, rather than answering
      // undefined. Anything gentler here would not be testing the same thing.
      if (flags === null) {
        throw new TypeError("undefined is not an object (evaluating 'window._wails.flags[key]')");
      }

      return flags[key];
    },
  },
}));

// These tests run without a DOM, and the module wants somewhere to hang
// itself. A bare object is the whole of what it touches.
function loadBridge() {
  (globalThis as { window?: unknown }).window = {};
  vi.resetModules();

  return import('./bridge.wails');
}

function dermaga() {
  const api = (globalThis as unknown as { window: Window }).window.dermaga;
  if (!api) {
    throw new Error('the bridge never installed itself, which the first test is about');
  }

  return api;
}

describe('the bridge when the flags have not arrived yet', () => {
  beforeEach(() => {
    flags = null;
    byName.mockClear();
  });

  it('still installs itself on the window', async () => {
    await loadBridge();

    expect(dermaga()).toBeDefined();
    expect(typeof dermaga().invoke).toBe('function');
  });

  it('waits for the name rather than failing the call', async () => {
    await loadBridge();

    const answer = dermaga().invoke('containers.list', null);

    // The flags land a moment after the page has already asked for something.
    flags = { bridge: 'github.com/ryanbekhen/dermaga/internal/window.Bridge' };

    await expect(answer).resolves.toBe('answered');
    expect(byName).toHaveBeenCalledWith(
      'github.com/ryanbekhen/dermaga/internal/window.Bridge.Invoke',
      'containers.list',
      null
    );
  });

  it('names the right service once the flags are there from the start', async () => {
    flags = { bridge: 'github.com/ryanbekhen/dermaga/internal/window.Bridge' };
    await loadBridge();

    await expect(dermaga().invoke('app.info', null)).resolves.toBe('answered');
    expect(byName).toHaveBeenCalledWith(
      'github.com/ryanbekhen/dermaga/internal/window.Bridge.Invoke',
      'app.info',
      null
    );
  });
});
