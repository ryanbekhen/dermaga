import { useId, useMemo, useState } from 'react';
import type { UsagePoint } from '../types';
import { WINDOW } from '../hooks/useLiveUsage';
import { smoothPath } from '../utils/curve';
import { niceScale } from '../utils/scale';

/**
 * One measurement as it happens, drawn against a scale.
 *
 * A line on its own says "something happened" and nothing about how much: a
 * spike to the top of the box is either a busy container or one that moved four
 * kilobytes, and nothing on screen tells them apart. So the box is a box --
 * numbers up the side, gridlines across it, time along the bottom, and the
 * reading spelled out above it.
 *
 * Some measurements come in pairs -- in and out, read and written -- and those
 * share one scale. Apart, they cannot be compared, which is the only thing
 * anybody wants to do with them.
 */

/** One line. A chart is given one or two, never more: three is a knot. */
export interface Trace {
  /** Named in the legend; a single line still gets one. */
  name: string;
  value: (point: UsagePoint) => number;
}

const TONES = [
  { text: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-600 dark:bg-blue-400' },
  { text: 'text-orange-600 dark:text-orange-500', dot: 'bg-orange-600 dark:bg-orange-500' },
];

const WIDTH = 320;
const HEIGHT = 120;
/** Gridlines below the top one. Five reads without becoming a ledger. */
const DIVISIONS = 4;

export function LiveChart({
  points,
  traces,
  format,
  heading,
  reading,
  floor = 0,
}: {
  points: UsagePoint[];
  traces: Trace[];
  format: (value: number) => string;
  /** What this measures, e.g. "Memory usage". */
  heading: string;
  /** The figure beside it, already in the words it should read in. */
  reading: string;
  /**
   * The smallest top the scale may shrink to. Without one, a container using a
   * hundredth of a percent is drawn as a mountain range of its own noise.
   */
  floor?: number;
}) {
  const gradient = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  const { lines, scale, place, span } = useMemo(() => {
    const readings = traces.map((trace) => points.map(trace.value));

    // One scale for every line in the chart. Given each its own, a trickle
    // drawn beside a flood looks exactly like the flood.
    const scale = niceScale(Math.max(...readings.flat(), 0), DIVISIONS, floor);

    // Anchored to the newest reading rather than to the clock, so the live end
    // of the line always touches the right edge instead of drifting away from
    // it between readings.
    const end = points[points.length - 1]?.at ?? 0;
    const at = (index: number) => ((points[index].at - (end - WINDOW)) / WINDOW) * WIDTH;
    const y = (value: number) => HEIGHT - (value / scale.top) * HEIGHT;

    return {
      scale,
      place: at,
      span: { start: end - WINDOW, end },
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
  }, [points, traces, floor]);

  const drawn = points.length > 0;
  const held = hovered !== null && points[hovered] !== undefined;
  const shown = hovered ?? points.length - 1;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold">
        {heading}: <span className="font-mono tabular-nums">{held ? '' : reading}</span>
        {held && (
          <span className="font-mono tabular-nums">
            {lines.map((line) => format(line.values[shown])).join(' / ')}
            <span className="ml-2 font-sans font-normal text-ink-500">
              {whenAgo(points[points.length - 1].at - points[shown].at)}
            </span>
          </span>
        )}
      </p>

      <div className="flex gap-1.5">
        {/* The numbers up the side, each sitting on its own gridline. */}
        <div className="relative w-14 shrink-0" style={{ height: HEIGHT }} aria-hidden>
          {scale.ticks.map((tick, at) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-tiny leading-none text-ink-500"
              style={{ top: `${(at / DIVISIONS) * 100}%` }}
            >
              {format(tick)}
            </span>
          ))}
        </div>

        <div
          className="relative flex-1"
          onPointerMove={(event) => {
            if (points.length === 0) return;

            const box = event.currentTarget.getBoundingClientRect();
            const wanted = ((event.clientX - box.left) / box.width) * WIDTH;

            // The nearest reading in time, not in the list: with the window
            // only part full, most of the width has no readings under it.
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
            className="w-full rounded-sm border border-ink-200 dark:border-ink-800"
            style={{ height: HEIGHT }}
            role="img"
            aria-label={`${heading}: ${reading}`}
          >
            {scale.ticks.map((tick, at) => (
              <line
                key={tick}
                x1={0}
                y1={(at / DIVISIONS) * HEIGHT}
                x2={WIDTH}
                y2={(at / DIVISIONS) * HEIGHT}
                className="stroke-ink-200 dark:stroke-ink-800"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {lines.map((drawing, at) => (
              <g key={traces[at].name} className={TONES[at].text}>
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

                {drawn && (
                  <circle
                    cx={held ? drawing.at(shown).x : drawing.tip.x}
                    cy={held ? drawing.at(shown).y : drawing.tip.y}
                    r={2.5}
                    fill="currentColor"
                    // Breathing at the live end: the one thing that says this is
                    // happening now rather than a picture of earlier.
                    className={held ? '' : 'animate-pulse motion-reduce:animate-none'}
                  />
                )}
              </g>
            ))}

            {held && (
              <line
                x1={lines[0].at(shown).x}
                y1={0}
                x2={lines[0].at(shown).x}
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

          {/* Time along the bottom: the window is fixed, so the ends are known
              whether or not there are readings under them yet. */}
          <div className="mt-1 flex justify-between text-tiny text-ink-500" aria-hidden>
            <span>{clock(span.start)}</span>
            <span>{clock(span.start + WINDOW / 2)}</span>
            <span>{clock(span.end)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {traces.map((trace, at) => (
          <span key={trace.name} className="flex items-center gap-1.5 text-tiny text-ink-500">
            <span className={`h-1.5 w-4 shrink-0 rounded-full ${TONES[at].dot}`} aria-hidden />
            {trace.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A tick on the time axis, as a clock reads. */
function clock(at: number): string {
  if (!at) return '';

  return new Date(at).toLocaleTimeString(undefined, { minute: '2-digit', second: '2-digit' });
}

/** How long ago a hovered reading was taken, in the words somebody would use. */
function whenAgo(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds <= 1) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  return `${Math.round(seconds / 60)} min ago`;
}
