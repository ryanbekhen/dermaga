import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { CLOUDFLARE_ORANGE } from './CloudflareMark';
import { CardNode, HubNode, NodeAction, PillNode } from './TunnelNodes';
import type { Tunnel, TunnelKind, TunnelRoute, TunnelStatus } from '../types';

/**
 * Everything published from this Mac, drawn as one picture: a hub with what
 * plugs into it, the way a network is drawn on its own page — but deeper, and
 * in the order traffic meets it.
 *
 *   hostname  →  Cloudflare  →  the network's gateway  →  a port  →  what listens
 *
 * One picture rather than one per Cloudflare account. The accounts are real —
 * a tunnel belongs to exactly one, so Dermaga keeps one per account — but that
 * is bookkeeping, not something anybody is asking about. Every route leaves
 * this Mac the same way, so they all meet at one hub.
 *
 * The port comes before the container because that is what it is: the door in.
 * Traffic arrives at a port and the port opens onto whatever is listening
 * behind it, so a container with two ports has two doors and the two lines meet
 * at the container rather than fanning out of it.
 *
 * Which gateway a route takes is the agent's answer, not this file's. A machine
 * sits on one of the same networks the containers do; only this Mac is reached
 * without a hop, because the connector is already on it.
 *
 * Hovering anything lights the whole path it belongs to, which is the question
 * somebody actually has: this name is not answering — where does it go?
 */

const HUB = { width: 196, height: 74 };
const NODE = { width: 176, height: 58 };
const PILL = { width: 84, height: 34 };
/** A gateway pill says a network name and carries an icon, so it is wider. */
const GATE = { width: 112, height: 34 };

/** How far each column sits from the hub at the origin. */
const HOST_RADIUS = 296;
const GATEWAY_RADIUS = 262;
const PORT_RADIUS = 456;
const CONTAINER_RADIUS = 642;

/** Minimum vertical room between two neighbours in the same column. */
const HOST_STEP = 78;
const CONTAINER_STEP = 96;
const PORT_STEP = 46;

/** How far a line stops short of the box it points at. */
const DOCK = 9;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;

interface Point {
  x: number;
  y: number;
}

interface View extends Point {
  k: number;
}

interface Placed extends Point {
  id: string;
  size: { width: number; height: number };
}

interface HostNode extends Placed {
  route: TunnelRoute;
}

interface GatewayNode extends Placed {
  address: string;
  network: string;
}

/** Whatever is behind a port: a container, a machine, or this Mac. */
interface TargetNode extends Placed {
  kind: TunnelKind;
  /** The key a port uses to find it, kind and name together. */
  ref: string;
  label: string;
  reachable: boolean;
  ports: number;
}

interface PortNode extends Placed {
  /** Which target it opens onto, by the same key. */
  ref: string;
  kind: TunnelKind;
  port: string;
  reachable: boolean;
  /** The gateway it is reached through, empty when it is not reached through one. */
  gateway: string;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Pushes nodes apart until none is closer to its neighbour than `gap`, keeping
 * the group where it was.
 *
 * A node sits at the average of whatever feeds it, and two averages can land on
 * the same line -- two gateways did, and the one drawn first vanished under the
 * other, so half the routes appeared to go through a network they are not on.
 * A hidden node is worse than a node an inch from where the arithmetic put it.
 */
function declutter<T extends { y: number }>(nodes: T[], gap: number): T[] {
  if (nodes.length < 2) return nodes;

  const middle = nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
  const sorted = [...nodes].sort((a, b) => a.y - b.y);

  for (let i = 1; i < sorted.length; i += 1) {
    const above = sorted[i - 1]!;
    const here = sorted[i]!;

    if (here.y - above.y < gap) here.y = above.y + gap;
  }

  const moved = sorted.reduce((sum, node) => sum + node.y, 0) / sorted.length;
  for (const node of sorted) node.y += middle - moved;

  return nodes;
}

/** Spreads n items evenly around a centre line, at least `step` apart. */
function spread(n: number, step: number): number[] {
  return Array.from({ length: n }, (_, index) => (index - (n - 1) / 2) * step);
}

/**
 * Places every node.
 *
 * Not rings: the two sides of a tunnel are not alike. What arrives is a list of
 * hostnames and what answers is a tree, so the hostnames stack to the left of
 * the hub and the tree grows to the right, each parent centred on its own
 * children.
 */
function layout(routes: TunnelRoute[]) {
  const hosts: HostNode[] = spread(routes.length, HOST_STEP).map((y, index) => ({
    id: `host:${routes[index]!.hostname}`,
    route: routes[index]!,
    x: -HOST_RADIUS,
    y,
    size: NODE,
  }));

  // The distinct ports, and the containers behind them, in the order their
  // hostnames appear so the lines cross as little as possible.
  const portKeys: string[] = [];
  const portOf = new Map<
    string,
    { ref: string; port: string; reachable: boolean; gateway: string; network: string }
  >();
  const targetOrder: string[] = [];
  const named = new Map<string, { kind: TunnelKind; label: string }>();

  for (const route of routes) {
    const ref = `${route.kind}/${route.target}`;
    const key = `${ref} ${route.port}`;

    if (!portOf.has(key)) {
      portKeys.push(key);
      portOf.set(key, {
        ref,
        port: route.port,
        reachable: route.reachable,
        // Whatever the route says, whatever its kind. A machine sits on one of
        // the same networks the containers do and is reached through the same
        // gateway; only this Mac, where the connector already is, has none.
        // Deciding that here by kind was deciding it twice, and getting it
        // wrong the second time.
        gateway: route.gateway ?? '',
        network: route.network ?? '',
      });
    }

    if (!targetOrder.includes(ref)) {
      targetOrder.push(ref);
      named.set(ref, {
        kind: route.kind,
        label: route.kind === 'host' ? 'This Mac' : route.target,
      });
    }
  }

  const portsByTarget = new Map<string, string[]>();
  for (const key of portKeys) {
    const { ref } = portOf.get(key)!;
    portsByTarget.set(ref, [...(portsByTarget.get(ref) ?? []), key]);
  }

  // Every port of one target shares its gateway, because they share the thing
  // they are on.
  const gatewayOfTarget = new Map<string, string>();
  for (const key of portKeys) {
    const detail = portOf.get(key)!;
    if (!gatewayOfTarget.has(detail.ref)) gatewayOfTarget.set(detail.ref, detail.gateway);
  }

  // Ordered by gateway, not by hostname.
  //
  // The left column is in hostname order and the right used to follow it, which
  // scattered one network's targets among another's: this Mac, which is reached
  // through no gateway at all, sat between two that are -- and its line had to
  // cross theirs to get out. Grouping puts each gateway's targets together, so
  // a gateway sits in the middle of its own block and nothing crosses.
  const groupOrder: string[] = [];
  for (const ref of targetOrder) {
    const gateway = gatewayOfTarget.get(ref) ?? '';
    if (!groupOrder.includes(gateway)) groupOrder.push(gateway);
  }

  // Whatever takes no gateway goes first: this Mac, and anything too stopped to
  // say where it sits. Their line leaves the hub and arrives with nothing in
  // between, so they sit above the gateways -- clear of the block their line
  // would otherwise have to get past.
  const grouped = [...targetOrder].sort((a, b) => {
    const left = gatewayOfTarget.get(a) ?? '';
    const right = gatewayOfTarget.get(b) ?? '';

    if (left !== right) {
      if (!left) return -1;
      if (!right) return 1;

      return groupOrder.indexOf(left) - groupOrder.indexOf(right);
    }

    return targetOrder.indexOf(a) - targetOrder.indexOf(b);
  });

  // Each container needs as much vertical room as its own ports take up.
  const heights = grouped.map((ref) =>
    Math.max(CONTAINER_STEP, (portsByTarget.get(ref)?.length ?? 1) * PORT_STEP)
  );

  const total = heights.reduce((sum, height) => sum + height, 0);
  let cursor = -total / 2;

  const containers: TargetNode[] = [];
  const ports: PortNode[] = [];

  grouped.forEach((ref, index) => {
    const room = heights[index]!;
    const centre = cursor + room / 2;
    cursor += room;

    const keys = portsByTarget.get(ref) ?? [];
    const offsets = spread(keys.length, PORT_STEP);
    const about = named.get(ref)!;

    keys.forEach((key, position) => {
      const detail = portOf.get(key)!;
      ports.push({
        id: `port:${key}`,
        ref,
        kind: about.kind,
        port: detail.port,
        reachable: detail.reachable,
        gateway: detail.gateway,
        x: PORT_RADIUS,
        y: centre + offsets[position]!,
        size: PILL,
      });
    });

    containers.push({
      id: `target:${ref}`,
      kind: about.kind,
      ref,
      label: about.label,
      reachable: keys.some((key) => portOf.get(key)!.reachable),
      ports: keys.length,
      x: CONTAINER_RADIUS,
      y: centre,
      size: NODE,
    });
  });

  // One gateway per network, not one for the picture.
  //
  // Things on different networks are reached through different gateways, and
  // drawing them all through the first is drawing a hop that does not happen.
  // What has no gateway hangs straight off the hub: this Mac, which is where
  // the connector already runs, and a stopped machine, which reports nothing
  // about where it sits.
  const byGateway = new Map<string, PortNode[]>();
  for (const port of ports) {
    if (!port.gateway) continue;
    byGateway.set(port.gateway, [...(byGateway.get(port.gateway) ?? []), port]);
  }

  const networkOf = new Map<string, string>();
  for (const key of portKeys) {
    const detail = portOf.get(key)!;
    if (detail.gateway && !networkOf.has(detail.gateway)) {
      networkOf.set(detail.gateway, detail.network);
    }
  }

  const gateways: GatewayNode[] = declutter(
    [...byGateway.entries()].map(([address, behind]) => ({
      id: `gateway:${address}`,
      address,
      network: networkOf.get(address) ?? '',
      x: GATEWAY_RADIUS,
      y: behind.reduce((sum, port) => sum + port.y, 0) / behind.length,
      size: GATE,
    })),
    GATE.height + 14
  );

  return { hosts, gateways, containers, ports };
}

/**
 * Where an edge leaves a node, and where it arrives at the next one.
 *
 * Fixed to the middle of the right and left sides rather than worked out from
 * the angle between the two boxes. Everything here flows left to right in
 * columns, so those are the sides an edge always uses -- and an angled dock
 * puts the end of a line on the bottom of a box whenever the vertical distance
 * beats the horizontal one, which reads as a line that missed.
 */
function leaves(node: Placed): Point {
  return { x: node.x + node.size.width / 2 + DOCK, y: node.y };
}

function arrives(node: Placed): Point {
  return { x: node.x - node.size.width / 2 - DOCK, y: node.y };
}

/**
 * Turns an edge's look into the attributes that draw it.
 *
 * `vectorEffect` is what keeps a line the same weight, and a dash the same
 * length, at every zoom. Without it both are scaled by the canvas transform:
 * zoomed in, a 5-and-5 dash becomes a row of long strokes with long gaps, and
 * a path reads as broken rather than dashed.
 */
function stroke(style: {
  className?: string;
  colour?: string;
  opacity?: number;
  width: number;
  dash?: string;
}) {
  return {
    className: style.className,
    // Cloudflare's orange is not a colour in the palette, and it should not
    // become one: it belongs to them and is used only where their traffic is.
    // So a live edge names it directly rather than through a class.
    stroke: style.colour,
    strokeOpacity: style.opacity,
    strokeWidth: style.width,
    strokeDasharray: style.dash,
    vectorEffect: 'non-scaling-stroke' as const,
  };
}

/** A curved edge from one node to the next. */
function edge(from: Placed, to: Placed): string {
  const start = leaves(from);
  const end = arrives(to);
  const mid = (start.x + end.x) / 2;

  return `M ${start.x} ${start.y} C ${mid} ${start.y}, ${mid} ${end.y}, ${end.x} ${end.y}`;
}

export function TunnelTopology({
  tunnels,
  onOpenContainer,
  onOpenRoute,
  onMoveRoute,
  onRemoveRoute,
}: {
  tunnels: Tunnel[];
  onOpenContainer: (container: string) => void;
  onOpenRoute: (route: TunnelRoute) => void;
  onMoveRoute: (route: TunnelRoute) => void;
  onRemoveRoute: (route: TunnelRoute) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const surface = useRef<SVGRectElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [active, setActive] = useState<string | null>(null);

  // Every route from every tunnel, in one list. Sorted by hostname so the
  // picture does not reshuffle when a connector's status arrives.
  const routes = useMemo(
    () =>
      tunnels
        .flatMap((tunnel) => tunnel.routes)
        .sort((a, b) => a.hostname.localeCompare(b.hostname)),
    [tunnels]
  );

  const plan = useMemo(() => layout(routes), [routes]);
  const { hosts, gateways, containers, ports } = plan;

  // Whether anything is being served at all, which is what decides the colour
  // of an edge. Which connector is up is the hub's business, not an edge's.
  const live = tunnels.some((tunnel) => tunnel.status === 'running');

  /**
   * Everything on the path a hovered node belongs to.
   *
   * Hovering a hostname lights its whole route; hovering a container or a port
   * lights every hostname that ends there. Either way the same question is
   * answered: what is joined to this?
   */
  const lit = useMemo(() => {
    if (!active) return null;

    const on = new Set<string>();

    for (const route of routes) {
      const ref = `${route.kind}/${route.target}`;

      const belongs =
        active === `host:${route.hostname}` ||
        active === `port:${ref} ${route.port}` ||
        active === `target:${ref}` ||
        // Every route through this gateway, whatever kind it points at. This
        // read `active === 'gateway'` while there was only ever one; once each
        // network got its own, hovering one matched no route at all.
        (route.gateway !== undefined &&
          route.gateway !== '' &&
          active === `gateway:${route.gateway}`) ||
        active === 'hub';

      if (!belongs) continue;

      on.add(`host:${route.hostname}`);
      on.add('hub');

      if (route.gateway) on.add(`gateway:${route.gateway}`);

      on.add(`port:${ref} ${route.port}`);
      on.add(`target:${ref}`);
    }

    // Nothing matched, so nothing is lit -- and dimming the whole picture to
    // say so is worse than saying nothing. It also broke the picture: with
    // every node faded, the one under the pointer faded too, WebKit stopped
    // sending it pointer events for a frame, the hover dropped, and the two
    // states chased each other into a flicker.
    return on.size > 0 ? on : null;
  }, [active, routes]);

  const shows = (id: string) => !lit || lit.has(id);

  const bounds = useMemo(() => {
    let minX = -HUB.width / 2;
    let maxX = HUB.width / 2;
    let minY = -HUB.height / 2;
    let maxY = HUB.height / 2;

    const all: Placed[] = [...hosts, ...containers, ...ports, ...gateways];

    for (const node of all) {
      minX = Math.min(minX, node.x - node.size.width / 2);
      maxX = Math.max(maxX, node.x + node.size.width / 2);
      minY = Math.min(minY, node.y - node.size.height / 2);
      maxY = Math.max(maxY, node.y + node.size.height / 2);
    }

    return { minX, maxX, minY, maxY };
  }, [hosts, containers, ports, gateways]);

  const { minX, maxX, minY, maxY } = bounds;

  const fit = useCallback(() => {
    if (size.width === 0 || size.height === 0) return;

    // A small graph is allowed to grow past 1:1 -- three boxes marooned in the
    // middle of a wide canvas look like a mistake rather than a diagram.
    const k = clamp(
      Math.min(1.3, (size.width - 56) / (maxX - minX), (size.height - 56) / (maxY - minY)),
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
  const hub: Placed = { id: 'hub', x: 0, y: 0, size: HUB };

  /**
   * How one edge is drawn: its colour, its weight, and whether it is dashed.
   *
   * A dash means the leg is not carrying anything — a connector down, or a
   * container that is not running. It is the right thing to say at rest, and
   * the wrong thing to say while a path is lit: the point of lighting a path is
   * "these are joined", and a dashed highlight reads as a path with a hole in
   * it. So a lit edge is always solid. What is down is still said, by the
   * status dot on every node it touches.
   */
  const edgeStyle = (on: boolean, healthy: boolean) => {
    if (lit && !on) {
      // Faint enough to be a memory of the shape rather than something to
      // read. At 20% these were still legible over the grid, which put a
      // thicket of grey curves behind the one path somebody asked to see.
      return {
        className: 'stroke-ink-300 opacity-[0.08] dark:stroke-ink-700',
        width: 1.5,
        dash: undefined,
      };
    }

    // A lit path is the same colour, at full strength and heavier. One hue for
    // the traffic and a second for the highlight would be two things to learn;
    // this is the same thing, said louder -- and everything else drops to
    // eight per cent, so there is no mistaking which path is which.
    if (lit && on) {
      return { colour: CLOUDFLARE_ORANGE, opacity: 1, width: 2.5, dash: undefined };
    }

    if (healthy) {
      return { colour: CLOUDFLARE_ORANGE, opacity: 0.75, width: 1.5, dash: undefined };
    }

    return {
      className: 'stroke-ink-300 dark:stroke-ink-700',
      width: 1.5,
      dash: '5 5',
    };
  };

  return (
    <div
      ref={frame}
      className="relative h-full min-h-0 flex-1 overflow-hidden rounded-xl border border-ink-200 bg-ink-50/60 dark:border-ink-700 dark:bg-ink-900/40"
    >
      <svg
        ref={svg}
        width="100%"
        height="100%"
        className="block h-full w-full touch-none"
        role="img"
        aria-label="What this Mac publishes, and where each hostname goes"
      >
        <defs>
          {/* The grid moves with the canvas, so panning reads as movement
              rather than as the nodes sliding over a static backdrop. */}
          <pattern
            id="tunnel-grid"
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
          fill="url(#tunnel-grid)"
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
          <g fill="none">
            {/* The internet side: every hostname into the hub. A route's health
                is its own connector's, not the whole picture's. */}
            {hosts.map((host) => {
              const running = host.route.status === 'running';

              return (
                <path
                  key={`edge:${host.id}`}
                  d={edge(host, hub)}
                  {...stroke(edgeStyle(shows(host.id), running))}
                />
              );
            })}

            {gateways.map((gateway) => (
              <path
                key={`edge:${gateway.id}`}
                d={edge(hub, gateway)}
                {...stroke(edgeStyle(shows(gateway.id), live))}
              />
            ))}

            {/* Each gateway opens onto the ports on its own network. This Mac
                has no gateway and needs none: the connector is already on it,
                so its line comes straight off the hub.

                A stopped machine has no gateway either, but for the opposite
                reason -- it is not saying where it sits, and nothing can reach
                it. So it gets no line at all. A dashed one from the hub drew a
                path straight from Cloudflare to a machine, which is not a route
                that exists even when the machine is up. Nothing joined is what
                nothing joined looks like. */}
            {ports.map((port) => {
              const gateway = gateways.find((node) => node.address === port.gateway);

              if (!gateway && !port.reachable) return null;

              return (
                <path
                  key={`edge:${port.id}`}
                  d={edge(gateway ?? hub, port)}
                  {...stroke(edgeStyle(shows(port.id), live && port.reachable))}
                />
              );
            })}

            {/* And each port onto what is listening behind it. Two ports on one
                container means two lines meeting there, which is the shape of a
                container with two doors. */}
            {ports.map((port) => {
              const behind = containers.find((node) => node.ref === port.ref)!;

              return (
                <path
                  key={`edge:behind:${port.id}`}
                  d={edge(port, behind)}
                  {...stroke(edgeStyle(shows(behind.id), live && port.reachable))}
                />
              );
            })}
          </g>

          {/* A hostname carries its own actions. There is no list of routes
              anywhere else, so opening, moving and removing one has to be
              reachable from the thing itself. They appear on hover, which is
              also when the path is lit, so the node you are acting on is the
              node whose route is showing. */}
          {hosts.map((host) => (
            <CardNode
              key={host.id}
              x={host.x - NODE.width / 2}
              y={host.y - NODE.height / 2}
              width={NODE.width}
              height={NODE.height}
              kind="host-name"
              title={host.route.hostname}
              detail={host.route.zoneName}
              tone={host.route.status === 'running' ? 'good' : 'idle'}
              dim={!shows(host.id)}
              onOpen={() => onOpenRoute(host.route)}
              onHover={(on) => setActive(on ? host.id : null)}
            >
              {active === host.id && (
                <>
                  <NodeAction
                    x={NODE.width - 40}
                    y={NODE.height / 2 + 3}
                    kind="move"
                    label={`Move ${host.route.hostname}`}
                    onClick={() => onMoveRoute(host.route)}
                  />
                  <NodeAction
                    x={NODE.width - 21}
                    y={NODE.height / 2 + 3}
                    kind="remove"
                    label={`Remove ${host.route.hostname}`}
                    onClick={() => onRemoveRoute(host.route)}
                  />
                </>
              )}
            </CardNode>
          ))}

          <HubNode
            width={HUB.width}
            height={HUB.height}
            title="Cloudflare"
            detail={connectorLabel(tunnels)}
            tone={connectorTone(tunnels)}
            onHover={(on) => setActive(on ? 'hub' : null)}
          />

          {/* A gateway is named by its network rather than its address. With
              more than one on screen, "testing" and "default" tell them apart
              at a glance where two similar dotted quads do not. */}
          {gateways.map((gateway) => (
            <PillNode
              key={gateway.id}
              x={gateway.x - GATE.width / 2}
              y={gateway.y - GATE.height / 2}
              width={GATE.width}
              height={GATE.height}
              label={gateway.network || gateway.address}
              icon="gateway"
              live={live}
              dim={!shows(gateway.id)}
              title={`${gateway.network || 'Network'} gateway · ${gateway.address}`}
              onHover={(on) => setActive(on ? gateway.id : null)}
            />
          ))}

          {ports.map((port) => (
            <PillNode
              key={port.id}
              x={port.x - PILL.width / 2}
              y={port.y - PILL.height / 2}
              width={PILL.width}
              height={PILL.height}
              label={`:${port.port}`}
              live={port.reachable}
              dim={!shows(port.id)}
              onHover={(on) => setActive(on ? port.id : null)}
            />
          ))}

          {/* Only a container has a page to open. A machine has one too, but it
              is reached by its own id rather than by name, and this Mac has
              none at all -- so a click goes somewhere only when there is
              somewhere for it to go. */}
          {containers.map((node) => (
            <CardNode
              key={node.id}
              x={node.x - NODE.width / 2}
              y={node.y - NODE.height / 2}
              width={NODE.width}
              height={NODE.height}
              kind={node.kind}
              title={node.label}
              detail={
                node.reachable
                  ? `${node.ports} port${node.ports === 1 ? '' : 's'}`
                  : node.kind === 'container'
                    ? 'not running'
                    : 'not reachable'
              }
              tone={node.reachable ? 'good' : 'bad'}
              dim={!shows(node.id)}
              onOpen={node.kind === 'container' ? () => onOpenContainer(node.label) : undefined}
              onHover={(on) => setActive(on ? node.id : null)}
            />
          ))}
        </g>
      </svg>

      <div className="absolute right-2 bottom-2 flex gap-1">
        <ViewButton label="Zoom in" onClick={() => zoomBy(1.25)} icon={ZoomIn} />
        <ViewButton label="Zoom out" onClick={() => zoomBy(0.8)} icon={ZoomOut} />
        <ViewButton label="Fit" onClick={fit} icon={Maximize2} />
      </div>
    </div>
  );
}

/**
 * What the hub says underneath its name.
 *
 * The connectors are named rather than the accounts. There is one per account,
 * which is why the count can be more than one, but which account a route sits
 * in is bookkeeping and not what somebody looking at this wants to know.
 */
function connectorLabel(tunnels: Tunnel[]): string {
  if (tunnels.length === 0) return 'nothing published';

  const count = (status: TunnelStatus) =>
    tunnels.filter((tunnel) => tunnel.status === status).length;

  const failed = count('error');
  const starting = count('starting');
  const up = count('running');

  if (tunnels.length === 1) {
    if (failed) return 'connector failed';
    if (starting) return 'connector starting';

    return up ? 'connector up' : 'connector stopped';
  }

  const said = `${up} of ${tunnels.length} connectors up`;

  if (failed) return `${said} · ${failed} failed`;
  if (starting) return `${said} · ${starting} starting`;

  return said;
}

/** The dot beside it: green while everything runs, orange when one failed. */
function connectorTone(tunnels: Tunnel[]): 'good' | 'bad' | 'idle' {
  if (tunnels.some((tunnel) => tunnel.status === 'error')) return 'bad';
  if (tunnels.length > 0 && tunnels.every((tunnel) => tunnel.status === 'running')) return 'good';

  return 'idle';
}

function ViewButton({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  icon: typeof ZoomIn;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-md border border-ink-200 bg-white/90 p-1.5 text-ink-600 backdrop-blur transition-colors hover:text-ink-900 dark:border-ink-700 dark:bg-ink-900/90 dark:text-ink-400 dark:hover:text-ink-100"
    >
      <Icon size={13} aria-hidden />
    </button>
  );
}
