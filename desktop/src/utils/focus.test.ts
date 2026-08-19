import { describe, expect, it } from 'vitest';
import { tabWrap } from './focus';

describe('tabWrap', () => {
  it('leaves the middle of a dialog to the browser', () => {
    expect(tabWrap(4, 1, false)).toBeNull();
    expect(tabWrap(4, 2, true)).toBeNull();
  });

  it('wraps off either end rather than into the page behind', () => {
    expect(tabWrap(4, 3, false)).toBe('first');
    expect(tabWrap(4, 0, true)).toBe('last');
  });

  it('pulls focus back in when it has already escaped', () => {
    expect(tabWrap(4, -1, false)).toBe('first');
    expect(tabWrap(4, -1, true)).toBe('last');
  });

  // A dialog of nothing but text has no stop to wrap to.
  it('does nothing when there is nowhere to go', () => {
    expect(tabWrap(0, -1, false)).toBeNull();
  });

  // One field: Tab in either direction returns to it, not to the page.
  it('holds a single stop', () => {
    expect(tabWrap(1, 0, false)).toBe('first');
    expect(tabWrap(1, 0, true)).toBe('last');
  });
});
