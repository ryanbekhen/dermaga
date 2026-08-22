import type { ReactNode } from 'react';
import { PageHeader } from './PageHeader';
import { Tabs, type TabDefinition } from './Tabs';

interface DetailLayoutProps {
  onBack?: () => void;
  /** Where back goes, named — "Containers", "Images". */
  backTo?: string;
  title: string;
  /** Badges rendered beside the title: status, default marker, tags. */
  badges?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: TabDefinition[];
  activeTab?: string;
  onSelectTab?: (id: string) => void;
  children: ReactNode;
}

/**
 * The page frame every detail view shares. It deliberately mirrors a list
 * page -- same header weight, same flat background, same edge-to-edge scroll --
 * so moving from a list into a detail does not feel like a different app.
 */
export function DetailLayout({
  onBack,
  backTo,
  title,
  badges,
  subtitle,
  actions,
  tabs,
  activeTab,
  onSelectTab,
  children,
}: DetailLayoutProps) {
  return (
    // flex-1, not just min-h-0: without it the layout is only as tall as its
    // content, so every pane inside it -- logs, terminal, files -- collapses to
    // the height of whatever it happens to contain, and the empty space below
    // belongs to the page rather than to the pane.
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        onBack={onBack}
        backTo={backTo}
        title={title}
        badges={badges}
        subtitle={subtitle}
        actions={actions}
      />

      {tabs && activeTab && onSelectTab && (
        <div className="shrink-0 border-b border-ink-200 bg-ink-50 dark:border-ink-800 dark:bg-ink-900/50">
          <Tabs tabs={tabs} active={activeTab} onSelect={onSelectTab} />
        </div>
      )}

      {children}
    </div>
  );
}

/** Scrolling column grid for overview-style tabs. */
export function DetailGrid({ children }: { children: ReactNode }) {
  return (
    <DetailScroll>
      <DetailSections>{children}</DetailSections>
    </DetailScroll>
  );
}

/**
 * The scrolling area a tab's content sits in, without assuming that content is
 * a grid of fact panels. Used where a tab opens with something wider than a
 * panel -- a row of figures, a bar across the page -- and puts the panels below.
 *
 * It draws no ground of its own. A detail pane on white next to a rail on the
 * page's own paper reads as two documents laid side by side; on the same paper
 * as everything else, the rule under each heading is the only line on the page,
 * which is what makes an unboxed group read as a group.
 */
export function DetailScroll({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}

/** The two columns the fact groups line up in. */
export function DetailSections({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-x-10 gap-y-6 lg:grid-cols-2">{children}</div>
  );
}

/**
 * The strip a pane opens with: what is below it in a few words on the left,
 * and whatever narrows it on the right.
 *
 * One shape for all of them. The tabs of a detail page grew their own openings
 * separately -- one a tinted bar, one a bare toolbar, two a loose line of
 * prose -- and switching between them shifted the content up and down by a
 * few pixels each time, which reads as the page settling rather than as the
 * same page showing something else. It is the strip the resource lists are
 * filtered with, so a pane and a page open the same way too.
 */
export function PaneBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-200 bg-ink-50 px-7 py-2.5 dark:border-ink-800 dark:bg-ink-900/50">
      {children}
    </div>
  );
}

/** Full-height area for the log and terminal tabs -- unboxed, like everything else. */
export function DetailPane({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>;
}

/**
 * A detail page split into the pane you came for and a rail that never leaves.
 *
 * The rail is the answer to "wait, which one is this?" -- the readings and the
 * dozen facts that identify the thing, kept on screen whichever tab is open.
 * Without it those facts lived on one tab among five, so checking the port a
 * container publishes meant leaving the logs you were reading and coming back.
 */
export function DetailBody({ rail, children }: { rail?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>

      {rail && (
        <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-ink-200 bg-ink-50 px-6 py-5 dark:border-ink-800 dark:bg-ink-900/50">
          {rail}
        </aside>
      )}
    </div>
  );
}

/** A titled group inside the rail. Unboxed: the rail is already a panel. */
export function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="label-mono">{title}</h2>
      {children}
    </section>
  );
}

/**
 * How long a label may be before its row stops being two columns.
 *
 * The rail is 320px wide and the label never wraps, so a long one takes the
 * value's room rather than its own: "org.opencontainers.image.description"
 * left about four characters for the description, which then came down the
 * rail as a ribbon forty lines tall. Past this many characters the pair reads
 * better stacked; under it the two-column form is tighter and scans better.
 *
 * A count of characters rather than a measurement. Measuring would mean laying
 * the row out, reading it back and laying it out again, for a decision that is
 * the same every time for the same label.
 */
const LABEL_FITS = 18;

/**
 * One fact in the rail: label and value, hairline under.
 *
 * Side by side while the label is short enough to leave the value room, and
 * stacked when it is not -- an OCI annotation key is longer than the rail is
 * wide, and there is no arrangement in which it and its value both fit on one
 * line.
 *
 * The value wraps rather than truncates either way. These are image
 * references, addresses and descriptions -- the things somebody opened the
 * rail to read in full -- and a digest cut off at the rail's edge is worse
 * than one that takes two lines.
 */
export function RailRow({ label, value }: { label: string; value?: string | number | null }) {
  const text = value === undefined || value === null || value === '' ? '—' : String(value);

  if (label.length > LABEL_FITS) {
    return (
      <div className="flex flex-col gap-1 border-b border-ink-150 py-2 last:border-b-0 dark:border-ink-800">
        {/* Broken anywhere, because a dotted annotation key has no spaces in it
            to break at and would otherwise run off the edge. */}
        <span className="break-all text-xs text-ink-600 dark:text-ink-400">{label}</span>
        <span className="selectable break-all font-mono text-code">{text}</span>
      </div>
    );
  }

  return (
    <div className="flex justify-between gap-3.5 border-b border-ink-150 py-2 last:border-b-0 dark:border-ink-800">
      <span className="shrink-0 text-xs text-ink-600 dark:text-ink-400">{label}</span>
      <span className="selectable break-all text-right font-mono text-code">{text}</span>
    </div>
  );
}

/** One live reading in the rail, with a meter when there is a ceiling for it. */
export function RailMeter({
  label,
  value,
  percent,
  tone = 'brand',
}: {
  label: string;
  value: string;
  /** Left out where nothing bounds the figure — network throughput has no cap. */
  percent?: number;
  tone?: 'brand' | 'rose' | 'ink';
}) {
  const fill = {
    brand: 'bg-brand-600',
    rose: 'bg-brand-400',
    ink: 'bg-ink-800 dark:bg-ink-300',
  }[tone];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-600 dark:text-ink-400">{label}</span>
        <span className="truncate font-mono text-ink-900 dark:text-ink-100">{value}</span>
      </div>
      {percent !== undefined && (
        <span className="block h-1.25 overflow-hidden rounded-full bg-ink-150 dark:bg-ink-800">
          <span
            className={`block h-full rounded-full transition-[width] duration-500 ${fill}`}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </span>
      )}
    </div>
  );
}
