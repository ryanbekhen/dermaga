import { useId, useMemo, useState } from 'react';
import type { UsagePoint } from '../types';
import { WINDOW } from '../hooks/useLiveUsage';
import { smoothPath } from '../utils/curve';

/**
 * One measurement as it happens.
 *
 * A number on its own cannot show a shape, and the shape is the diagnosis:
 * memory that climbs and never falls is a leak; a burst of traffic every thirty
 * seconds is a health check, not a user. Drawn as inline SVG rather than with a
 * charting library, because a few sparklines do not justify a dependency.
 *
 * Some measurements come in pairs -- in and out, read and written -- and those
 * are drawn together on one scale. Apart, in separate boxes, they cannot be
 * compared, which is the only thing anybody wants to do with them.
 *
 * Time runs along the bottom whether or not there are readings to fill it, so a
 * chart that has been watching for twenty seconds shows twenty seconds of line
 * at the right rather than stretching them across the width. The alternative
 * rescales the whole picture on every reading: nothing stays where it was, and
 * two points a second apart look exactly like two points a minute apart.
 */

/** One line. A chart is given one or two, never more: three is a knot. */
export interface Trace {
  /** Named only when there is another line to tell it apart from. */
  name?: string;
  value: (point: UsagePoint) => number;
}

/**
 * The two line colours, chosen to be far apart.
 *
 * Blue against orange sits almost opposite on the wheel, so the pair reads at a
 * glance and survives the common colour blindnesses -- where red against orange
 * does not, and red against green is worse. Neither is the brand red either,
 * which in this app means "at its limit": a line that happened to be busy
 * should not borrow the colour of a line that is in trouble.
 */
const TONES = [
  { text: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-600 dark:bg-blue-400' },
  { text: 'text-orange-600 dark:text-orange-500', dot: 'bg-orange-600 dark:bg-orange-500' },
];

const WIDTH = 320;
const HEIGHT = 64;
/** Room above the highest point, so a peak is never drawn against the ceiling. */
const HEADROOM = 1.15;

export function LiveChart({
  points,
  traces,
  format,
  ceiling,
  footnote,
}: {
  points: UsagePoint[];
  traces: Trace[];
  format: (value: number) => string;
  /** Fixes the top of the scale, for a measurement that has a known limit. */
  ceiling?: number;
  /** A line under the chart for what the shape cannot say -- a total, a count. */
  footnote?: string;
}) {
  const gradient = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  const { lines, peak, latest, place } = useMemo(() => {
    const readings = traces.map((trace) => points.map(trace.value));

    // One scale for every line in the chart. Given each its own, a trickle
    // drawn beside a flood looks exactly like the flood.
    const highest = ceiling ?? Math.max(...readings.flat(), 0) * HEADROOM;
    const top = highest > 0 ? highest : 1;

    // Anchored to the newest reading rather than to the clock, so the live end
    // of the line always touches the right edge instead of drifting away from
    // it between readings.
    const end = points[points.length - 1]?.at ?? 0;
    const at = (index: number) => ((points[index].at - (end - WINDOW)) / WINDOW) * WIDTH;
    const y = (value: number) => HEIGHT - (value / top) * (HEIGHT - 3) - 1.5;

    return {
      peak: Math.max(...readings.flat(), 0),
      latest: readings.map((values) => values[values.length - 1] ?? 0),
      place: at,
      lines: readings.map((values) => {
        const line = points.length > 1 ? smoothPath(values, at, y) : '';

        return {
          line,
          // Only under a single line: two translucent fills over one another
          // make a third colour that means nothing.
          area:
            line && traces.length === 1
              ? `${line} L${at(points.length - 1)},${HEIGHT} L${at(0)},${HEIGHT} Z`
              : '',
          tip: { x: at(points.length - 1), y: y(values[values.length - 1] ?? 0) },
          at: (index: number) => ({ x: at(index), y: y(values[index] ?? 0) }),
          values,
        };
      }),
    };
  }, [points, traces, ceiling]);

  const drawn = points.length > 0;
  const reading = hovered ?? points.length - 1;
  const held = hovered !== null && points[hovered] !== undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-end gap-3">
        {traces.map((trace, at) => (
          <span key={trace.name ?? at} className="flex items-baseline gap-1.5">
            {trace.name && (
              <>
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONES[at].dot}`}
                  aria-hidden
                />
                <span className="text-tiny text-ink-600 dark:text-ink-400">{trace.name}</span>
              </>
            )}
            <span className="font-mono text-sm font-semibold tabular-nums">
              {format(held ? lines[at].values[reading] : latest[at])}
            </span>
          </span>
        ))}
      </div>

      <div
        className="relative"
        onPointerMove={(event) => {
          if (points.length === 0) return;

          const box = event.currentTarget.getBoundingClientRect();
          const wanted = ((event.clientX - box.left) / box.width) * WIDTH;

          // The nearest reading in time, not the nearest in the list: with the
          // window only part full, most of the width has no readings under it
          // at all.
          let nearest = 0;
          for (let index = 1; index < points.length; index++) {
            if (Math.abs(place(index) - wanted) < Math.abs(place(nearest) - wanted)) {
              nearest = index;
            }
          }
          setHovered(nearest);
        }}
        onPointerLeave={() => setHovered(null)}
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-16 w-full"
          role="img"
          aria-label={traces
            .map((trace, at) => `${trace.name ? `${trace.name} ` : ''}${format(latest[at])}`)
            .join(', ')}
        >
          {/* A floor to read the line against. Without it a flat line at zero
              and a chart with no data look identical. */}
          <line
            x1={0}
            y1={HEIGHT - 1.5}
            x2={WIDTH}
            y2={HEIGHT - 1.5}
            className="stroke-ink-200 dark:stroke-ink-800"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />

          {lines.map((drawing, at) => (
            <g key={traces[at].name ?? at} className={TONES[at].text}>
              {drawing.area && (
                <>
                  <defs>
                    <linearGradient id={`${gradient}-${at}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <path d={drawing.area} fill={`url(#${gradient}-${at})`} />
                </>
              )}

              <path
                d={drawing.line}
                stroke="currentColor"
                fill="none"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />

              {drawn && !held && (
                // The live end of the line, breathing. It is the one thing that
                // says this is happening now rather than a picture of earlier.
                <circle
                  cx={drawing.tip.x}
                  cy={drawing.tip.y}
                  r={2.5}
                  fill="currentColor"
                  className="animate-pulse motion-reduce:animate-none"
                  style={{ transformBox: 'fill-box' }}
                />
              )}

              {held && (
                <circle
                  cx={drawing.at(reading).x}
                  cy={drawing.at(reading).y}
                  r={2.5}
                  fill="currentColor"
                />
              )}
            </g>
          ))}

          {held && (
            <line
              x1={lines[0].at(reading).x}
              y1={0}
              x2={lines[0].at(reading).x}
              y2={HEIGHT}
              className="stroke-ink-400 dark:stroke-ink-600"
              strokeWidth={1}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {!drawn && (
          <p className="absolute inset-0 flex items-center justify-center text-tiny text-ink-500">
            Watching…
          </p>
        )}
      </div>

      <p className="flex items-baseline justify-between gap-3 text-tiny text-ink-500">
        <span>{footnote}</span>
        <span>
          {held
            ? whenAgo(points[points.length - 1].at - points[reading].at)
            : `peak ${format(peak)}`}
        </span>
      </p>
    </div>
  );
}

/** How long ago a hovered reading was taken, in the words somebody would use. */
function whenAgo(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds <= 1) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  return `${Math.round(seconds / 60)} min ago`;
}
