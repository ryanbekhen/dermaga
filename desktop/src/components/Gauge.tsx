interface GaugeProps {
  /** 0-100. Anything outside is clamped rather than drawn off the dial. */
  value: number;
  label: string;
  /** The big reading in the middle, e.g. "42%" or "1.2 GB". */
  reading: string;
  /** What the reading is measured against, e.g. "of 2 GB". */
  caption?: string;
  /** Nothing is being measured -- the needle rests and the dial greys out. */
  idle?: boolean;
}

const CENTRE = { x: 80, y: 78 };
const RADIUS = 58;
/** A 240° sweep, the way a dial on a dashboard reads: empty low-left, full low-right. */
const START = 210;
const SWEEP = 240;
const LENGTH = (Math.PI * RADIUS * SWEEP) / 180;

function pointAt(fraction: number, radius: number) {
  const angle = ((START - fraction * SWEEP) * Math.PI) / 180;
  return { x: CENTRE.x + radius * Math.cos(angle), y: CENTRE.y - radius * Math.sin(angle) };
}

/**
 * A dial, for the numbers that only mean anything against a limit.
 *
 * A bar says "0.4% of what?"; a dial says it at a glance, because the eye reads
 * the needle's position on the sweep before it reads any number. The same face
 * serves CPU and memory -- one dashboard, two instruments -- with the reading
 * in the middle carrying the units a percentage cannot.
 */
export function Gauge({ value, label, reading, caption, idle = false }: GaugeProps) {
  const pct = Math.min(100, Math.max(0, value));
  const fraction = pct / 100;

  const from = pointAt(0, RADIUS);
  const to = pointAt(1, RADIUS);
  const track = `M ${from.x} ${from.y} A ${RADIUS} ${RADIUS} 0 1 1 ${to.x} ${to.y}`;

  // The same thresholds the allocation bars use, so a full dial and a full bar
  // mean the same thing.
  const fill = idle
    ? 'stroke-ink-300 dark:stroke-ink-700'
    : pct >= 90
      ? 'stroke-brand-600'
      : pct >= 70
        ? 'stroke-amber-500'
        : 'stroke-emerald-600';

  const needle = pointAt(fraction, RADIUS - 15);

  return (
    <figure
      className="flex flex-col items-center gap-1"
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${label}: ${reading}${caption ? ` ${caption}` : ''}`}
    >
      <svg viewBox="0 0 160 104" className="w-full max-w-40" aria-hidden>
        <path
          d={track}
          fill="none"
          strokeWidth={9}
          strokeLinecap="round"
          className="stroke-ink-200 dark:stroke-ink-800"
        />

        <path
          d={track}
          fill="none"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${LENGTH * fraction} ${LENGTH}`}
          className={`transition-[stroke-dasharray] duration-500 ${fill}`}
        />

        {/* Quarter marks: enough to read the sweep, few enough to stay quiet. */}
        {[0, 0.25, 0.5, 0.75, 1].map((mark) => {
          const outer = pointAt(mark, RADIUS - 15);
          const inner = pointAt(mark, RADIUS - 21);

          return (
            <line
              key={mark}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              strokeWidth={1.5}
              strokeLinecap="round"
              className="stroke-ink-300 dark:stroke-ink-700"
            />
          );
        })}

        <line
          x1={CENTRE.x}
          y1={CENTRE.y}
          x2={needle.x}
          y2={needle.y}
          strokeWidth={2.5}
          strokeLinecap="round"
          className={`transition-all duration-500 ${
            idle ? 'stroke-ink-400 dark:stroke-ink-600' : 'stroke-ink-700 dark:stroke-ink-200'
          }`}
        />
        <circle
          cx={CENTRE.x}
          cy={CENTRE.y}
          r={4}
          className="fill-white stroke-ink-400 dark:fill-ink-900 dark:stroke-ink-600"
          strokeWidth={1.5}
        />

        <text
          x={CENTRE.x}
          y={CENTRE.y + 26}
          textAnchor="middle"
          className="fill-ink-800 text-[15px] font-semibold dark:fill-ink-100"
        >
          {reading}
        </text>
      </svg>

      <figcaption className="flex flex-col items-center -mt-1">
        <span className="text-xs font-semibold">{label}</span>
        {caption && <span className="text-tiny text-ink-500">{caption}</span>}
      </figcaption>
    </figure>
  );
}
