/**
 * A line through a handful of samples that reads as a curve.
 *
 * Straight segments between five-second samples make a sawtooth: every reading
 * becomes a corner, and the eye reads corners as events. A curve says what the
 * data says -- something rose and fell -- without inventing a spike at each
 * point where a measurement happened to land.
 *
 * Monotone cubic (Fritsch-Carlson), not the usual smoothing. An ordinary spline
 * overshoots: two low readings either side of a high one bow the curve below
 * zero, and a chart that draws negative bytes per second is lying about the one
 * thing it exists to show. This one cannot leave the range its points sit in.
 */

/** The slope to leave each point on, in value per unit of x. */
function tangents(values: number[], xs: number[]): number[] {
  const count = values.length;
  // Real gaps, not positions: live samples do not arrive on a metronome, and a
  // slope that assumes they did bends the curve wherever one was late.
  const secants = values
    .slice(0, -1)
    .map((value, at) => (values[at + 1] - value) / (xs[at + 1] - xs[at]));

  const slopes = values.map((_, at) => {
    if (at === 0) return secants[0];
    if (at === count - 1) return secants[count - 2];
    return (secants[at - 1] + secants[at]) / 2;
  });

  for (let at = 0; at < count - 1; at++) {
    // A flat run stays flat. Without this the curve wanders between two equal
    // readings, which reads as movement that never happened.
    if (secants[at] === 0) {
      slopes[at] = 0;
      slopes[at + 1] = 0;
      continue;
    }

    const before = slopes[at] / secants[at];
    const after = slopes[at + 1] / secants[at];
    const distance = before * before + after * after;

    // Outside the circle of radius 3 the segment would overshoot its own end
    // points; pulling both tangents back onto it is what keeps the curve inside
    // the data.
    if (distance > 9) {
      const scale = 3 / Math.sqrt(distance);
      slopes[at] = scale * before * secants[at];
      slopes[at + 1] = scale * after * secants[at];
    }
  }

  return slopes;
}

/**
 * An SVG path through the values, sampled at even intervals.
 *
 * `x` and `y` map an index and a value onto the drawing, so the caller keeps
 * every decision about scale and this keeps only the shape.
 */
export function smoothPath(
  values: number[],
  x: (index: number) => number,
  y: (value: number) => number
): string {
  if (values.length === 0) return '';
  if (values.length === 1) return `M${x(0)},${y(values[0])}`;

  // Two points have one straight answer, and no curve to fit.
  if (values.length === 2) {
    return `M${x(0)},${y(values[0])} L${x(1)},${y(values[1])}`;
  }

  const xs = values.map((_, at) => x(at));
  const slopes = tangents(values, xs);
  let path = `M${xs[0]},${y(values[0])}`;

  for (let at = 0; at < values.length - 1; at++) {
    // The control points are placed a third of a step in from each end, along
    // that end's tangent -- which is the cubic whose slope at both points is
    // exactly the tangent chosen above. y() is applied last, so the arithmetic
    // stays in the units the values arrived in.
    const step = (xs[at + 1] - xs[at]) / 3;

    const firstX = xs[at] + step;
    const firstY = y(values[at] + slopes[at] * step);
    const secondX = xs[at + 1] - step;
    const secondY = y(values[at + 1] - slopes[at + 1] * step);

    path += ` C${firstX},${firstY} ${secondX},${secondY} ${xs[at + 1]},${y(values[at + 1])}`;
  }

  return path;
}
