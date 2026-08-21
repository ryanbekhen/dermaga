import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { Container, UsagePoint } from '../types';

/**
 * The last couple of minutes of one container, kept live.
 *
 * The agent takes a reading every five seconds and pushes each one, so the
 * container in props is always current -- and it has been keeping those
 * readings since it started, whether or not anybody was looking. So the chart
 * opens with the minutes already watched and carries straight on: closing the
 * tab and coming back a minute later continues the line rather than starting it
 * again.
 */

/**
 * How often the agent takes a reading. Not a choice: `container stats` takes
 * 2.2 seconds to answer on this machine, so asking every five is already most
 * of a core's worth of runtime, and asking faster would spend it for nothing.
 */
export const SAMPLE_EVERY = 5000;
/** How far back the chart reaches. */
export const WINDOW = 2 * 60 * 1000;
/**
 * How often a point is drawn. Faster than the readings arrive, deliberately:
 * the line starts within a second of the tab opening instead of waiting five
 * for a second reading to draw itself against, and it keeps moving while the
 * runtime is being asked. Nothing is invented by it -- between readings the
 * line holds the last measurement, which is exactly what is known.
 */
const DRAW_EVERY = 1000;

function reading(container: Container): Omit<UsagePoint, 'at'> {
  return {
    cpuPercent: container.cpuUsage ?? 0,
    memoryBytes: container.memoryUsageBytes ?? 0,
    networkRxPerSec: container.networkRxPerSec ?? 0,
    networkTxPerSec: container.networkTxPerSec ?? 0,
    blockReadPerSec: container.blockReadPerSec ?? 0,
    blockWritePerSec: container.blockWritePerSec ?? 0,
  };
}

/**
 * Drops what has scrolled off the left edge -- keeping the last point that has,
 * so the line reaches the edge and is clipped there rather than beginning in
 * mid-air a few pixels inside it.
 */
function within(points: UsagePoint[], now: number): UsagePoint[] {
  const edge = now - WINDOW;
  const first = points.findIndex((point) => point.at >= edge);

  if (first <= 0) return points;

  return points.slice(first - 1);
}

/** The reading as one point, taken now. */
function taken(container: Container): UsagePoint {
  return { ...reading(container), at: Date.now() };
}

/**
 * The recorded window joined to what has been watched since.
 *
 * Where they meet, what was seen here wins: the recorded points may be up to a
 * reading old by the time they arrive, and the ones taken here are the newer
 * account of the same seconds.
 */
function joined(recorded: UsagePoint[], watched: UsagePoint[]): UsagePoint[] {
  const from = watched[0]?.at ?? Infinity;

  return [...recorded.filter((point) => point.at < from), ...watched];
}

export function useLiveUsage(container: Container, enabled: boolean): UsagePoint[] {
  // Opened with the reading already in hand: waiting for a timer to fire before
  // drawing anything visible made a tab that had the answer look like a tab
  // that was still looking for it. Keyed by container, so a chart never carries
  // readings taken from the one that was open a moment ago.
  const [state, setState] = useState<{ id: string; points: UsagePoint[] }>(() => ({
    id: container.id,
    points: enabled ? [taken(container)] : [],
  }));

  const latest = useRef(container);
  useEffect(() => {
    latest.current = container;
  }, [container]);

  // Asked for once, on the way in. Everything after this arrives on its own,
  // and the answer is folded in behind whatever has been watched meanwhile --
  // so nothing waits for the round trip and nothing is drawn twice.
  useEffect(() => {
    if (!enabled) return;

    const id = container.id;
    let live = true;

    void api
      .getContainerHistory(id)
      .then((recorded) => {
        if (!live || recorded.length === 0) return;

        setState((previous) =>
          previous.id === id
            ? { id, points: within(joined(recorded, previous.points), Date.now()) }
            : previous
        );
      })
      .catch(() => {
        // A container that went away mid-request draws from the pushes alone.
      });

    return () => {
      live = false;
    };
  }, [container.id, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const id = container.id;
    const timer = setInterval(() => {
      setState((previous) => {
        if (previous.id !== id) return { id, points: [taken(latest.current)] };

        return {
          id,
          points: within([...previous.points, taken(latest.current)], Date.now()),
        };
      });
    }, DRAW_EVERY);

    return () => clearInterval(timer);
  }, [container.id, enabled]);

  return enabled && state.id === container.id ? state.points : [];
}
