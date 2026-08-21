/**
 * The numbers up the side of a chart.
 *
 * A line drawn without them says "something happened", and nothing about how
 * much: a spike to the top of the box is either a busy container or a container
 * that moved four kilobytes, and there is no way to tell. The scale is what
 * turns a shape into a reading.
 *
 * The top is rounded up to something a person would have chosen -- 5, 20, 500,
 * never 4.7 -- because the label is read more often than the line is measured
 * against it.
 */

/** The steps worth landing on, within each power of ten. */
const STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

export interface Scale {
  /** The value at the top of the box. */
  top: number;
  /** Every gridline, from the top down -- which is the order they are drawn. */
  ticks: number[];
}

/**
 * A scale that covers `highest` with `divisions` gridlines.
 *
 * `floor` keeps a quiet chart from being drawn against a scale so small that
 * the noise in it looks like activity -- a container using 0.02% of a core
 * should read as idle, not as a mountain range.
 */
export function niceScale(highest: number, divisions = 4, floor = 0): Scale {
  // Nothing to cover at all -- a chart of zeroes still needs a box and a
  // number at the top of it.
  const wanted = Math.max(highest, floor, 0) || 1;

  // The step is what gets rounded, not the top: gridlines at 0, 2.5, 5 are
  // read at a glance, and a top of 9.4 divided four ways is not.
  const rough = wanted / divisions;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = (STEPS.find((candidate) => rough <= candidate * power) ?? 10) * power;

  const top = step * divisions;
  // Trimmed of the noise floating point leaves behind: a gridline at
  // 0.30000000000000004 is the same line, with a worse label.
  const ticks = Array.from({ length: divisions + 1 }, (_, at) =>
    Number((top - at * step).toPrecision(12))
  );

  return { top, ticks };
}
