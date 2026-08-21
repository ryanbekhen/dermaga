import { describe, expect, it } from 'vitest';
import { smoothPath } from './curve';

// The chart draws with x = index * step and y = height - value, which is what
// these use: keeping the mapping trivial makes the numbers in the expectations
// the values themselves.
const x = (index: number) => index * 10;
const y = (value: number) => value;

/** Every coordinate the path names, as numbers. */
function coordinates(path: string): number[] {
  return (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

/** Every y coordinate: the second of each pair. */
function heights(path: string): number[] {
  return coordinates(path).filter((_, at) => at % 2 === 1);
}

describe('smoothPath', () => {
  it('has nothing to draw for nothing, and no curve for one point', () => {
    expect(smoothPath([], x, y)).toBe('');
    expect(smoothPath([5], x, y)).toBe('M0,5');
  });

  // Two readings have one honest answer between them.
  it('draws two points as the straight line they are', () => {
    expect(smoothPath([2, 8], x, y)).toBe('M0,2 L10,8');
  });

  it('starts at the first point and ends at the last', () => {
    const path = smoothPath([1, 9, 3, 7], x, y);

    expect(path.startsWith('M0,1')).toBe(true);
    expect(path.endsWith('30,7')).toBe(true);
  });

  // The whole reason for choosing this curve over an ordinary spline: a spike
  // between two low readings pulls a smoothed line below both of them, and a
  // chart of bytes per second would draw a negative rate that never happened.
  it('never leaves the range of its own points', () => {
    const values = [0, 0, 60000, 0, 0];
    const path = smoothPath(values, x, y);

    expect(Math.min(...heights(path))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...heights(path))).toBeLessThanOrEqual(60000);
  });

  // A container sitting idle draws a flat line, not a gentle wander.
  it('keeps a run of equal readings flat', () => {
    const path = smoothPath([4, 4, 4, 4], x, y);

    expect(heights(path).every((height) => height === 4)).toBe(true);
  });

  it('draws one curve per gap between points', () => {
    expect((smoothPath([1, 2, 3, 4, 5], x, y).match(/C/g) ?? []).length).toBe(4);
  });

  // Live samples do not arrive on a metronome: one late reading must bend the
  // line where it actually landed, not where a fixed step would have put it.
  it('places a late sample where it happened', () => {
    const uneven = [0, 10, 30, 35];
    const path = smoothPath([1, 2, 3, 4], (index) => uneven[index], y);

    expect(path.startsWith('M0,1')).toBe(true);
    expect(path.endsWith('35,4')).toBe(true);
    // The curve still cannot leave the range of its points.
    expect(Math.min(...heights(path))).toBeGreaterThanOrEqual(1);
    expect(Math.max(...heights(path))).toBeLessThanOrEqual(4);
  });
});
