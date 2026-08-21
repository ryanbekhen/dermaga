import { describe, expect, it } from 'vitest';
import { niceScale } from './scale';

describe('niceScale', () => {
  it('covers the highest reading', () => {
    for (const highest of [0.4, 7, 23, 61, 4096, 123456]) {
      expect(niceScale(highest).top).toBeGreaterThanOrEqual(highest);
    }
  });

  it('lands on numbers somebody would have chosen', () => {
    expect(niceScale(7).ticks).toEqual([8, 6, 4, 2, 0]);
    expect(niceScale(23).ticks).toEqual([24, 18, 12, 6, 0]);
    expect(niceScale(41).ticks).toEqual([50, 37.5, 25, 12.5, 0]);
  });

  // Floating point leaves 0.30000000000000004 behind, which is the same
  // gridline with a worse label.
  it('leaves no floating-point dust in the labels', () => {
    expect(niceScale(0.4).ticks).toEqual([0.4, 0.3, 0.2, 0.1, 0]);
  });

  it('reads from the top down, ending at nothing', () => {
    const { ticks } = niceScale(100);

    expect(ticks[0]).toBe(niceScale(100).top);
    expect(ticks[ticks.length - 1]).toBe(0);
    expect(ticks).toEqual([...ticks].sort((a, b) => b - a));
  });

  // A container using a hundredth of a percent should read as idle. Without a
  // floor the scale shrinks to fit the noise, and the noise becomes a mountain.
  it('will not shrink below the floor it is given', () => {
    expect(niceScale(0.02, 4, 10).top).toBe(10);
    expect(niceScale(40, 4, 10).top).toBe(40);
  });

  it('has something to draw even with nothing to show', () => {
    const { top, ticks } = niceScale(0);

    expect(top).toBeGreaterThan(0);
    expect(ticks).toHaveLength(5);
  });

  it('gives as many gridlines as asked for', () => {
    expect(niceScale(100, 6).ticks).toHaveLength(7);
  });
});
