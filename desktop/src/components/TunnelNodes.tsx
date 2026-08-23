import { Boxes, Globe, Laptop, Pencil, Router, Server, Trash2 } from 'lucide-react';
import { CLOUDFLARE_ORANGE, CloudflareGlyph } from './CloudflareMark';
import type { TunnelKind } from '../types';

/**
 * The boxes on the tunnel canvas, drawn as SVG rather than as HTML.
 *
 * They used to be `foreignObject`s with real markup inside, which is how the
 * network page draws its nodes and is far nicer to write. It leaves ghosts:
 * WebKit does not reliably repaint the ground a `foreignObject` has left, so a
 * node that moved or was removed stayed painted where it had been — a faded
 * copy of a route that no longer exists, sitting over the one that does.
 *
 * Removing the DOM does not clear it and neither does replacing the subtree;
 * the paint outlives both. So the nodes are plain SVG, which repaints the way
 * everything else on the canvas already does. The cost is that text has to be
 * cut to fit by hand, since SVG has no ellipsis.
 */

/** SVG text neither wraps nor ellipsizes, so it is cut to fit its box. */
export function clip(text: string, at: number): string {
  return text.length > at ? `${text.slice(0, at - 1)}…` : text;
}

/** Roughly how many characters fit in a box, for the sizes used here. */
export function room(width: number, from: number): number {
  return Math.max(4, Math.floor((width - from - 12) / 6.1));
}

type Tone = 'good' | 'bad' | 'idle';

const DOT: Record<Tone, string> = {
  good: 'fill-emerald-500',
  bad: 'fill-orange-500',
  idle: 'fill-ink-400 dark:fill-ink-600',
};

/** The icon for what a node stands for. Nested SVG, never foreignObject. */
function Glyph({
  kind,
  x,
  y,
  live = false,
}: {
  kind: TunnelKind | 'host-name' | 'gateway';
  x: number;
  y: number;
  /** Takes the pill's own colour, so the glyph is part of it and not a guest. */
  live?: boolean;
}) {
  const Icon =
    kind === 'machine'
      ? Server
      : kind === 'host'
        ? Laptop
        : kind === 'gateway'
          ? Router
          : kind === 'host-name'
            ? Globe
            : Boxes;

  return (
    <Icon
      x={x}
      y={y}
      width={12}
      height={12}
      className={live ? 'stroke-brand-700 dark:stroke-brand-400' : 'stroke-ink-500'}
      aria-hidden
    />
  );
}

/**
 * A card: a title, a status line, and something to say what it is.
 *
 * `onOpen` makes the whole card a target; without one it is only something to
 * hover, which is what the things that have no page of their own get.
 */
export function CardNode({
  x,
  y,
  width,
  height,
  kind,
  title,
  detail,
  tone,
  dim,
  onOpen,
  onHover,
  children,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: TunnelKind | 'host-name';
  title: string;
  detail: string;
  tone: Tone;
  dim: boolean;
  onOpen?: () => void;
  onHover: (on: boolean) => void;
  /** Anything else to draw inside, such as a node's own actions. */
  children?: React.ReactNode;
}) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      opacity={dim ? 0.25 : 1}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      className="transition-opacity"
    >
      <rect
        width={width}
        height={height}
        rx={11}
        className="fill-white stroke-ink-200 dark:fill-ink-900 dark:stroke-ink-800"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />

      <Glyph kind={kind} x={13} y={13} />

      <text
        x={31}
        y={23}
        onClick={onOpen}
        className={`fill-ink-900 text-[11px] font-semibold dark:fill-ink-100 ${
          onOpen ? 'cursor-pointer hover:underline' : ''
        }`}
      >
        {clip(title, room(width, 31))}
      </text>

      <circle cx={18} cy={38} r={3.5} className={DOT[tone]} />

      <text x={31} y={41} className="fill-ink-500 text-[10px]">
        {clip(detail, room(width, 31))}
      </text>

      {children}
    </g>
  );
}

/** The hub: Cloudflare's own, so it wears their mark and their colour. */
export function HubNode({
  width,
  height,
  title,
  detail,
  tone,
  onHover,
}: {
  width: number;
  height: number;
  title: string;
  detail: string;
  tone: Tone;
  onHover: (on: boolean) => void;
}) {
  return (
    <g
      transform={`translate(${-width / 2} ${-height / 2})`}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <rect
        width={width}
        height={height}
        rx={12}
        className="fill-white dark:fill-ink-900"
        stroke={CLOUDFLARE_ORANGE}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />

      <CloudflareGlyph x={14} y={16} size={15} />

      <text x={36} y={28} className="fill-ink-900 text-[12px] font-semibold dark:fill-ink-100">
        {title}
      </text>

      <circle cx={19} cy={50} r={3.5} className={DOT[tone]} />

      <text x={31} y={53} className="fill-ink-500 text-[10px]">
        {clip(detail, room(width, 31))}
      </text>
    </g>
  );
}

/** A pill: a port, or a gateway. Small, and one line of text. */
export function PillNode({
  x,
  y,
  width,
  height,
  label,
  icon,
  live,
  dim,
  title,
  onHover,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  icon?: 'gateway';
  live: boolean;
  dim: boolean;
  title?: string;
  onHover: (on: boolean) => void;
}) {
  const inset = icon ? 20 : 0;

  return (
    <g
      transform={`translate(${x} ${y})`}
      opacity={dim ? 0.25 : 1}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      className="transition-opacity"
    >
      {title && <title>{title}</title>}

      {/* Dermaga's own colour, because these are Dermaga's own facts: a port a
          container listens on, a network this Mac put it on. The hub and the
          edges are Cloudflare's orange because the traffic there is theirs,
          and the picture reads as the handover it is -- their colour on one
          side of the hub, this app's on the other. */}
      <rect
        width={width}
        height={height}
        rx={height / 2}
        className={
          live
            ? 'fill-brand-50 stroke-brand-600/40 dark:fill-brand-600/15 dark:stroke-brand-400/40'
            : 'fill-white stroke-ink-300 dark:fill-ink-900 dark:stroke-ink-700'
        }
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />

      {icon === 'gateway' && <Glyph kind="gateway" x={11} y={height / 2 - 6} live={live} />}

      <text
        x={(width + inset) / 2}
        y={height / 2 + 3.5}
        textAnchor="middle"
        className={
          live
            ? 'fill-brand-700 text-[10px] font-semibold dark:fill-brand-400'
            : 'fill-ink-600 text-[10px] font-semibold dark:fill-ink-400'
        }
      >
        {clip(label, room(width - inset, 4))}
      </text>
    </g>
  );
}

/** One of the actions a node carries, drawn small and inside it. */
export function NodeAction({
  x,
  y,
  kind,
  label,
  onClick,
}: {
  x: number;
  y: number;
  kind: 'move' | 'remove';
  label: string;
  onClick: () => void;
}) {
  const Icon = kind === 'move' ? Pencil : Trash2;

  return (
    <g onClick={onClick} className="cursor-pointer">
      <title>{label}</title>

      {/* An invisible square behind it, so the pointer has something the size
          of a target to find rather than a two-pixel stroke. */}
      <rect x={x - 3} y={y - 3} width={18} height={18} fill="transparent" />

      <Icon
        x={x}
        y={y}
        width={12}
        height={12}
        className={kind === 'remove' ? 'stroke-orange-600' : 'stroke-ink-500'}
        aria-hidden
      />
    </g>
  );
}
