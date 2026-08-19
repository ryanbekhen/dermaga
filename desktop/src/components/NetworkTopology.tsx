import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Globe, Maximize2, Network as NetworkIcon, ZoomIn, ZoomOut } from 'lucide-react';
import { StatusDot } from './StatusBadge';
import type { Container, Network } from '../types';
import { shortImage } from '../utils/format';

/**
 * A network drawn as what it is: one hub with everything that plugs into it
 * hanging off it. A list of names in a table column says "these seven exist";
 * this says which of them are up, what address each one holds, and that they
 * can all reach each other -- which is the only reason a network is interesting.
 */

const HUB = { width: 224, height: 82 };
const NODE = { width: 180, height: 62 };

/** Ring geometry. Rings grow outwards; each holds as many nodes as it can fit. */
const FIRST_RING = 226;
const RING_GAP = 134;
/** Minimum arc between two neighbours, so their boxes never touch. */
const MIN_ARC = 208;

/** How far a line stops short of the box it points at. */
const DOCK = 9;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;

interface Satellite {
  id: string;
  kind: 'container' | 'gateway' | 'ghost';
  label: string;
  detail: string;
  status?: string;
  containerId?: string;
}

interface Placed extends Satellite {
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

interface View extends Point {
  k: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Lays the satellites out on concentric rings around the hub at the origin. */
function place(satellites: Satellite[]): Placed[] {
  const placed: Placed[] = [];
  let rest = satellites;
  let index = 0;

  while (rest.length > 0) {
    const radius = FIRST_RING + index * RING_GAP;
    const capacity = Math.max(1, Math.floor((2 * Math.PI * radius) / MIN_ARC));
    const here = rest.slice(0, capacity);
    rest = rest.slice(capacity);

    const step = (2 * Math.PI) / here.length;
    // From the top, and every other ring turned half a step so nodes do not
    // line up radially and hide each other's lines.
    const start = -Math.PI / 2 + (index % 2 === 1 ? step / 2 : 0);

    here.forEach((satellite, position) => {
      const angle = start + position * step;
      placed.push({
        ...satellite,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    });

    index += 1;
  }

  return placed;
}

/** The point on the border of the box at `to`, facing `from`. */
function dock(from: Point, to: Point, size: { width: number; height: number }): Point {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const scale = Math.min(
    (size.width / 2 + DOCK) / Math.max(Math.abs(dx), 1e-6),
    (size.height / 2 + DOCK) / Math.max(Math.abs(dy), 1e-6)
  );

  return { x: to.x + dx * scale, y: to.y + dy * scale };
}

interface NetworkTopologyProps {
  network: Network;
  /** Every container the app knows about; the attached ones are picked out. */
  containers: Container[];
  onOpenContainer: (id: string) => void;
}

export function NetworkTopology({ network, containers, onOpenContainer }: NetworkTopologyProps) {
  const frame = useRef<HTMLDivElement>(null);
  const surface = useRef<SVGRectElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [active, setActive] = useState<string | null>(null);

  const satellites = useMemo(() => {
    const attached = containers
      .filter((container) => container.networks?.includes(network.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    const nodes: Satellite[] = attached.map((container) => {
      const address = container.interfaces?.find(
        (iface) => iface.network === network.name
      )?.ipv4Address;

      return {
        id: `container:${container.id}`,
        kind: 'container',
        label: container.name,
        detail: address ?? shortImage(container.image),
        status: container.status,
        containerId: container.id,
      };
    });

    // The daemon reports users by name; anything it names that the container
    // list has not caught up with still belongs on the picture.
    const known = new Set(attached.map((container) => container.name));
    for (const name of network.usedBy) {
      if (!known.has(name)) {
        nodes.push({ id: `ghost:${name}`, kind: 'ghost', label: name, detail: 'not reported' });
      }
    }

    // Outbound is a real hop off this network, so it gets a node rather than a
    // line in a table. A host-only network has no gateway and shows none.
    if (network.ipv4Gateway) {
      nodes.unshift({
        id: 'gateway',
        kind: 'gateway',
        label: 'Gateway',
        detail: network.ipv4Gateway,
      });
    }

    return nodes;
  }, [containers, network]);

  const nodes = useMemo(() => place(satellites), [satellites]);

  // Only the shape of the graph should re-fit the view; a container changing
  // state must not throw away the zoom the user has chosen.
  const bounds = useMemo(() => {
    let minX = -HUB.width / 2;
    let maxX = HUB.width / 2;
    let minY = -HUB.height / 2;
    let maxY = HUB.height / 2;

    for (const node of nodes) {
      minX = Math.min(minX, node.x - NODE.width / 2);
      maxX = Math.max(maxX, node.x + NODE.width / 2);
      minY = Math.min(minY, node.y - NODE.height / 2);
      maxY = Math.max(maxY, node.y + NODE.height / 2);
    }

    return { minX, maxX, minY, maxY };
  }, [nodes]);

  const { minX, maxX, minY, maxY } = bounds;

  const fit = useCallback(() => {
    if (size.width === 0 || size.height === 0) return;

    // A small graph is allowed to grow past 1:1 -- three boxes marooned in the
    // middle of a wide canvas look like a mistake rather than a diagram.
    const k = clamp(
      Math.min(1.4, (size.width - 56) / (maxX - minX), (size.height - 56) / (maxY - minY)),
      MIN_ZOOM,
      MAX_ZOOM
    );

    setView({ k, x: (-(minX + maxX) / 2) * k, y: (-(minY + maxY) / 2) * k });
  }, [minX, maxX, minY, maxY, size.width, size.height]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Frame the whole graph on arrival, and again whenever it grows or shrinks.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useLayoutEffect(() => fit(), [fit]);

  // Wheel has to be bound by hand: React's listener is passive, and a passive
  // handler cannot stop the page from scrolling under a zoom.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const px = event.clientX - box.left - box.width / 2;
      const py = event.clientY - box.top - box.height / 2;

      setView((current) => {
        // Pinch on a trackpad arrives as ctrl+wheel; a plain two-finger scroll
        // pans, the way every other canvas behaves.
        if (!event.ctrlKey && !event.metaKey) {
          return { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY };
        }

        const k = clamp(current.k * Math.exp(-event.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM);
        return {
          k,
          x: px - ((px - current.x) / current.k) * k,
          y: py - ((py - current.y) / current.k) * k,
        };
      });
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<{ x: number; y: number; from: Point } | null>(null);
  const [panning, setPanning] = useState(false);

  const zoomBy = (factor: number) =>
    setView((current) => ({ ...current, k: clamp(current.k * factor, MIN_ZOOM, MAX_ZOOM) }));

  const origin = { x: size.width / 2 + view.x, y: size.height / 2 + view.y };
  const attachedCount = satellites.filter((node) => node.kind !== 'gateway').length;

  return (
    <div
      ref={frame}
      className="relative min-h-64 flex-1 overflow-hidden rounded-lg border border-ink-200 bg-ink-50/60 dark:border-ink-700 dark:bg-ink-900/40"
    >
      <svg
        ref={svg}
        width="100%"
        height="100%"
        className="block h-full w-full touch-none"
        role="img"
        aria-label={`Topology of ${network.name}`}
      >
        <defs>
          {/* The grid moves with the canvas, so panning reads as movement
              rather than as the nodes sliding over a static backdrop. */}
          <pattern
            id="topology-grid"
            width="26"
            height="26"
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${origin.x} ${origin.y}) scale(${view.k})`}
          >
            <circle cx="1" cy="1" r="1" className="fill-ink-300 dark:fill-ink-800" />
          </pattern>
        </defs>

        <rect
          ref={surface}
          width="100%"
          height="100%"
          fill="url(#topology-grid)"
          className={panning ? 'cursor-grabbing' : 'cursor-grab'}
          onPointerDown={(event) => {
            if (event.target !== surface.current) return;
            drag.current = { x: event.clientX, y: event.clientY, from: { x: view.x, y: view.y } };
            setPanning(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            setView((current) => ({
              ...current,
              x: start.from.x + (event.clientX - start.x),
              y: start.from.y + (event.clientY - start.y),
            }));
          }}
          onPointerUp={(event) => {
            drag.current = null;
            setPanning(false);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        />

        <g transform={`translate(${origin.x} ${origin.y}) scale(${view.k})`}>
          {nodes.map((node) => {
            const from = dock(node, { x: 0, y: 0 }, HUB);
            const to = dock({ x: 0, y: 0 }, node, NODE);
            const lit = active === node.id;

            return (
              <line
                key={`edge:${node.id}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                strokeWidth={lit ? 2 : 1.25}
                strokeDasharray={node.kind === 'container' ? undefined : '5 5'}
                className={
                  lit
                    ? 'stroke-brand-600'
                    : active
                      ? 'stroke-ink-300 opacity-30 dark:stroke-ink-700'
                      : 'stroke-ink-300 dark:stroke-ink-700'
                }
              />
            );
          })}

          <foreignObject
            x={-HUB.width / 2}
            y={-HUB.height / 2}
            width={HUB.width}
            height={HUB.height}
          >
            <div className="flex h-full w-full flex-col justify-center gap-1 rounded-xl border-2 border-brand-600 bg-white px-3 py-2 shadow-md dark:bg-ink-900">
              <div className="flex items-center gap-2">
                <NetworkIcon size={15} className="shrink-0 text-brand-600" aria-hidden />
                <span className="truncate text-sm font-semibold">{network.name}</span>
              </div>
              <p className="truncate font-mono text-tiny text-ink-600 dark:text-ink-400">
                {network.ipv4Subnet || network.mode || 'no subnet'}
              </p>
              <p className="truncate text-tiny text-ink-500">
                {attachedCount} container{attachedCount === 1 ? '' : 's'} attached
              </p>
            </div>
          </foreignObject>

          {nodes.map((node) => (
            <foreignObject
              key={node.id}
              x={node.x - NODE.width / 2}
              y={node.y - NODE.height / 2}
              width={NODE.width}
              height={NODE.height}
              className={active && active !== node.id ? 'opacity-40 transition-opacity' : undefined}
            >
              <NodeBox
                node={node}
                onEnter={() => setActive(node.id)}
                onLeave={() => setActive(null)}
                onOpen={node.containerId ? () => onOpenContainer(node.containerId!) : undefined}
              />
            </foreignObject>
          ))}
        </g>
      </svg>

      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button
          className="btn-icon bg-white dark:bg-ink-900"
          onClick={() => zoomBy(1.2)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn size={14} aria-hidden />
        </button>
        <button
          className="btn-icon bg-white dark:bg-ink-900"
          onClick={() => zoomBy(1 / 1.2)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut size={14} aria-hidden />
        </button>
        <button
          className="btn-icon bg-white dark:bg-ink-900"
          onClick={fit}
          title="Fit to view"
          aria-label="Fit to view"
        >
          <Maximize2 size={14} aria-hidden />
        </button>
      </div>

      <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/80 px-1.5 py-0.5 text-tiny text-ink-500 dark:bg-ink-900/80">
        Drag to move · pinch or ⌘-scroll to zoom · click a container to open it
      </p>
    </div>
  );
}

function NodeBox({
  node,
  onEnter,
  onLeave,
  onOpen,
}: {
  node: Placed;
  onEnter: () => void;
  onLeave: () => void;
  onOpen?: () => void;
}) {
  const shell =
    'flex h-full w-full flex-col justify-center gap-1 rounded-lg border px-2.5 py-1.5 text-left shadow-md transition-colors bg-white dark:bg-ink-900';

  const border =
    node.kind === 'container'
      ? 'border-ink-200 dark:border-ink-700'
      : 'border-dashed border-ink-300 dark:border-ink-700';

  const body = (
    <>
      <div className="flex items-center gap-1.5">
        {node.kind === 'gateway' ? (
          <Globe size={13} className="shrink-0 text-ink-500" aria-hidden />
        ) : node.status ? (
          <StatusDot status={node.status} />
        ) : (
          <Boxes size={13} className="shrink-0 text-ink-500" aria-hidden />
        )}
        <span className="truncate text-xs font-semibold">{node.label}</span>
      </div>
      <p className="truncate font-mono text-tiny text-ink-500">{node.detail}</p>
    </>
  );

  if (!onOpen) {
    return (
      <div className={`${shell} ${border}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${shell} ${border} cursor-pointer hover:border-brand-600`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={onOpen}
      title={`Open ${node.label}`}
    >
      {body}
    </button>
  );
}
