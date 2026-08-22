import { useMemo, useState } from 'react';
import {
  ChevronRight,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldHalf,
  ShieldQuestionMark,
  ShieldX,
  type LucideIcon,
} from 'lucide-react';
import { DataTable, Muted, type Column } from './DataTable';
import { DetailPane, PaneBar } from './DetailLayout';
import { useImageScan } from '../hooks/useImageScan';
import { useScannerStore } from '../store/scannerStore';
import { openFindingWindow } from '../services/ipc';
import { formatBytes, formatDuration } from '../utils/format';
import type { Finding, ImagePackage } from '../types';

// Worst first everywhere: a list sorted any other way buries the line that
// decides whether this image ships.
/** Worst first. Exported because the packages list ranks by the same order. */
export const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
const ORDER = SEVERITY_ORDER;

export type Severity = (typeof ORDER)[number];

// Red is the brand colour, so it is spent only on the severities that warrant
// it; the rest step down through amber to plain text.
//
// Each severity is a shield, and what is on the shield says how much of one is
// left: broken through, warning, half covering, whole. That is not decoration.
// A column told apart by colour alone is a column a colour-blind reader cannot
// sort, and "worst first" is the one thing this list is for -- so the glyph
// carries the order too. The word is still in the tooltip and for a screen
// reader.
// Each severity carries three paints: the text colour it is named in, the
// solid segment it fills when it has something in it, and the wash that
// segment wears when it has nothing.
//
// The wash is the same hue, not white. White was a hole: on a list where every
// row sits on a tint, an empty segment disappeared into the row and the bar
// read as a coloured fragment with its ends torn off. Kept in its own colour,
// five segments are always five segments -- which is the only reason a bar
// beats a row of numbers, since it is the shape of one row against the next
// that is being read.
const TONE: Record<Severity, { text: string; strip: string; faint: string; icon: LucideIcon }> = {
  CRITICAL: {
    text: 'text-brand-700 dark:text-brand-400',
    strip: 'bg-brand-800 text-white',
    faint: 'bg-brand-800/15 text-brand-800/60 dark:bg-brand-400/20 dark:text-brand-200/60',
    icon: ShieldX,
  },
  HIGH: {
    text: 'text-brand-600 dark:text-brand-400',
    strip: 'bg-brand-600 text-white',
    faint: 'bg-brand-600/12 text-brand-700/55 dark:bg-brand-400/15 dark:text-brand-200/55',
    icon: ShieldAlert,
  },
  MEDIUM: {
    text: 'text-amber-700 dark:text-amber-500',
    strip: 'bg-amber-500 text-ink-900',
    faint: 'bg-amber-500/15 text-amber-700/60 dark:bg-amber-500/20 dark:text-amber-500/70',
    icon: ShieldHalf,
  },
  LOW: {
    text: 'text-ink-600 dark:text-ink-400',
    strip: 'bg-ink-300 text-ink-800 dark:bg-ink-600 dark:text-ink-100',
    faint: 'bg-ink-300/40 text-ink-500 dark:bg-ink-600/30 dark:text-ink-400',
    icon: Shield,
  },
  UNKNOWN: {
    text: 'text-ink-500',
    strip: 'bg-ink-200 text-ink-700 dark:bg-ink-700 dark:text-ink-200',
    faint: 'bg-ink-200/60 text-ink-400 dark:bg-ink-700/40 dark:text-ink-500',
    icon: ShieldQuestionMark,
  },
};

// One row per package, because a package is what an image is made of. The
// findings hang off the row that owns them rather than forming a list of
// their own: 177 findings across 43 packages is one list read two ways, and
// splitting it into two tabs made the reader join them back up by hand.
const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', width: 'minmax(160px,2.4fr)' },
  { key: 'vulns', label: 'Vulnerabilities', width: '148px' },
  { key: 'version', label: 'Version', width: '116px' },
  { key: 'size', label: 'Size', width: '84px', align: 'right' },
  { key: 'type', label: 'Type', width: '96px' },
  { key: 'licences', label: 'Licence', width: 'minmax(100px,1fr)' },
];

/** A package, with whatever is known against it. */
interface Row {
  pkg: ImagePackage;
  findings: Finding[];
  counts: Record<string, number>;
  /** Rank of its worst finding; ORDER.length for a package with none. */
  worst: number;
}

/**
 * What is inside one image, and what is known against it.
 *
 * The agent scans in the background and remembers the result, so this is
 * usually already filled in by the time it is opened.
 *
 * Packages and findings were two tabs, and they are not two things: every
 * finding is a fact about a package that is already listed here. Kept apart,
 * the two lists could not be read against each other -- "is this the openssl
 * the critical is in" meant switching tabs and matching a name by eye. Joined,
 * the severities sort the inventory and the inventory explains the severities.
 *
 * They are still not the same shape, which is why this is one list of packages
 * and not one list of both: a package with eight findings is one row that
 * opens, not eight rows that repeat its version, size and licence.
 */
export function PackagesPane({
  reference,
  filter,
  onFilter: setFilter,
  only,
  onOnly: setOnly,
}: {
  reference: string;
  /**
   * What the list is narrowed to, held by the page rather than by this pane.
   *
   * Somewhere else can send a reader here already looking for one package --
   * and a pane that owned its own filter would have to be told about that
   * after the fact, either through an effect that writes state during a render
   * or by being thrown away and rebuilt.
   */
  filter: string;
  onFilter: (value: string) => void;
  only: Severity | null;
  onOnly: (value: Severity | null) => void;
}) {
  const status = useScannerStore((s) => s.status);
  const { report, scanning, preparing } = useImageScan(reference);

  // Whether the list is down to the packages something is known against.
  const [risky, setRisky] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  // Opening a finding opens a window for it. What is known about one of these
  // is a paragraph, eight metrics, a dozen scores and up to seventy links --
  // too much for a row, and over the top of the list it is a choice between
  // reading and looking. A window can sit beside the list, or on another
  // screen, and two of them can be compared.
  const openFinding = (finding: Finding) => {
    void openFindingWindow(reference, finding.id);
  };

  const rows = useMemo<Row[]>(() => {
    const findings = report?.findings ?? [];

    const held = new Map<string, Finding[]>();
    for (const finding of findings) {
      const at = held.get(finding.package);
      if (at) at.push(finding);
      else held.set(finding.package, [finding]);
    }

    // Reports written before Dermaga asked Trivy for the whole inventory have
    // findings and no package list. Rather than an empty tab, the packages
    // those findings name are the inventory -- thinner, but the rows the
    // reader came for are all there.
    const packages: ImagePackage[] = report?.packages?.length
      ? report.packages
      : [...held.keys()].sort().map((name) => ({
          name,
          version: held.get(name)?.[0]?.installed,
        }));

    return packages.map((pkg) => {
      const mine = (held.get(pkg.name) ?? [])
        .slice()
        .sort(
          (a, b) => ORDER.indexOf(a.severity as Severity) - ORDER.indexOf(b.severity as Severity)
        );

      const counts: Record<string, number> = {};
      for (const finding of mine) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;

      const worst = mine.length ? Math.min(...mine.map((f) => rank(f.severity))) : ORDER.length;

      return { pkg, findings: mine, counts, worst };
    });
  }, [report]);

  const needle = filter.trim().toLowerCase();

  // Which rows a search matched on a finding rather than on the package
  // itself. Typing a CVE id should land on the package it is in, and land on
  // it already open -- otherwise the answer is a row that does not say the
  // thing that was searched for.
  const matchedByFinding = useMemo(() => {
    if (!needle) return new Set<string>();

    const hit = new Set<string>();
    for (const row of rows) {
      if (row.findings.some((f) => f.id.toLowerCase().includes(needle))) hit.add(row.pkg.name);
    }

    return hit;
  }, [rows, needle]);

  const visible = useMemo(() => {
    return rows
      .filter((row) => !risky || row.findings.length > 0)
      .filter((row) => !only || (row.counts[only] ?? 0) > 0)
      .filter(
        (row) =>
          !needle ||
          matchedByFinding.has(row.pkg.name) ||
          row.pkg.name.toLowerCase().includes(needle) ||
          (row.pkg.version ?? '').toLowerCase().includes(needle) ||
          (row.pkg.type ?? '').toLowerCase().includes(needle)
      )
      .sort(
        // Worst first, then the most of it, then by name. A package with a
        // critical in it is the reason somebody opened this tab; the rest of
        // the inventory follows underneath in the order you would look
        // something up in.
        (a, b) =>
          a.worst - b.worst ||
          b.findings.length - a.findings.length ||
          a.pkg.name.localeCompare(b.pkg.name)
      );
  }, [rows, risky, only, needle, matchedByFinding]);

  const total = report?.findings.length ?? 0;
  const affected = rows.filter((row) => row.findings.length > 0).length;
  const installed = rows.reduce((sum, row) => sum + (row.pkg.size ?? 0), 0);

  // Nothing to list and nothing to filter, so a header and its rule would be
  // furniture around an empty room: one centred statement instead.
  if (preparing || !report || rows.length === 0) {
    return (
      <DetailPane>
        {preparing ? (
          <Empty
            icon={RefreshCw}
            title={status?.detail ?? 'Preparing the scanner…'}
            body="The scanner and its vulnerability database are being fetched. This happens once, in the background."
          />
        ) : (
          <Empty
            icon={ShieldAlert}
            title={scanning ? 'Scanning…' : 'Not scanned yet'}
            body={
              scanning
                ? 'The result will appear here on its own.'
                : 'Dermaga scans images in the background as it finds them. This one has not had its turn yet.'
            }
          />
        )}
      </DetailPane>
    );
  }

  return (
    <DetailPane>
      <PaneBar>
        {/* The sentence caps the bar rather than sharing its line: beside the
            controls it pushed them off the end, where they wrapped underneath
            and read as more things to press rather than as the ways into this
            list. */}
        <span className="label-mono w-full normal-case">
          {/* How much of the image is in front of you, not just how much of it
              there is: a list showing forty-three rows under a line reading
              "89 packages" leaves the reader counting. */}
          {visible.length !== rows.length && `${visible.length} of `}
          {rows.length} package{rows.length === 1 ? '' : 's'}
          {report.os && ` · ${report.os}`}
          {installed > 0 && ` · ${formatBytes(installed)} installed`}
          {total > 0
            ? ` · ${total} finding${total === 1 ? '' : 's'} in ${affected} of them`
            : ' · no known vulnerabilities'}
          {' · scanned '}
          {formatDuration(report.scannedAt)} ago
        </span>

        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter packages and CVEs…"
          aria-label="Filter packages and vulnerabilities"
          className="input h-7.5 w-64 rounded-lg"
        />

        {/* Down to what is actually a problem. Hidden when nothing is: a
            control that can only ever empty the list has nothing to do. */}
        {affected > 0 && (
          <button
            onClick={() => setRisky(!risky)}
            aria-pressed={risky}
            title={
              risky
                ? 'Show every package again'
                : `Show only the ${affected} package${affected === 1 ? '' : 's'} with findings`
            }
            className={`inline-flex h-7.5 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-small transition-colors ${
              risky
                ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-600/15 dark:text-brand-400'
                : 'text-ink-600 hover:bg-ink-150 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100'
            }`}
          >
            <ShieldAlert size={13} aria-hidden />
            <span className="tabular-nums">{affected}</span>
            vulnerable
          </button>
        )}

        <div className="flex-1" />

        <SeverityStrip
          counts={report.summary ?? {}}
          active={only}
          onPick={(severity) => setOnly(only === severity ? null : severity)}
        />
      </PaneBar>

      <DataTable
        columns={COLUMNS}
        rows={visible}
        rowKey={(row) => row.pkg.name}
        empty="No package matches that."
        onOpen={(row) => {
          // A row held open by the search stays open: closing it would hide
          // the thing that was searched for and leave the row as the only
          // answer, which is not one.
          if (row.findings.length === 0 || matchedByFinding.has(row.pkg.name)) return;
          toggle(row.pkg.name, opened, setOpened);
        }}
        below={(row) => {
          if (row.findings.length === 0) return null;

          // Searching a CVE id opens the package it is in, showing that
          // finding rather than the other eleven it happens to sit beside.
          if (matchedByFinding.has(row.pkg.name)) {
            return (
              <FindingList
                findings={row.findings.filter((f) => f.id.toLowerCase().includes(needle))}
                onOpen={openFinding}
              />
            );
          }

          return opened.has(row.pkg.name) ? (
            <FindingList findings={row.findings} onOpen={openFinding} />
          ) : null;
        }}
        cells={(row) => [
          <span key="name" className="flex min-w-0 items-center gap-1">
            {/* Only where there is something to open. A chevron on every row
                promises four hundred packages have more to say, and then
                three hundred and fifty of them do not. */}
            {row.findings.length > 0 ? (
              <ChevronRight
                size={13}
                aria-hidden
                className={`shrink-0 text-ink-400 transition-transform ${
                  opened.has(row.pkg.name) || matchedByFinding.has(row.pkg.name) ? 'rotate-90' : ''
                }`}
              />
            ) : (
              <span className="w-[13px] shrink-0" />
            )}
            <span
              className="selectable block truncate text-body font-medium"
              title={`${row.pkg.name}${row.pkg.source ? ` · ${row.pkg.source}` : ''}`}
            >
              {row.pkg.name}
            </span>
          </span>,
          // Blank where there is nothing against the package: five empty
          // segments repeated down four hundred rows would be a bar chart of
          // nothing, and the few packages that do carry findings have to be
          // findable by running an eye down the column.
          row.findings.length > 0 ? (
            <SeverityStrip key="vulns" counts={row.counts} />
          ) : (
            <span key="vulns" />
          ),
          <Muted key="version" mono>
            {row.pkg.version || '—'}
          </Muted>,
          // Blank, not a dash, where the idea does not apply: a Go module has
          // no size of its own and a column of dashes down every row of a Go
          // image reads as data that failed to arrive.
          <Muted key="size" mono>
            {row.pkg.size ? formatBytes(row.pkg.size) : ''}
          </Muted>,
          <Muted key="type" mono>
            {row.pkg.type || '—'}
          </Muted>,
          <Muted key="licences">{row.pkg.licenses?.join(', ') || '—'}</Muted>,
        ]}
      />
    </DetailPane>
  );
}

function toggle(
  name: string,
  opened: ReadonlySet<string>,
  setOpened: (next: ReadonlySet<string>) => void
) {
  const next = new Set(opened);
  if (!next.delete(name)) next.add(name);
  setOpened(next);
}

/** Where a severity sits in the order; past the end when it is not one we know. */
function rank(severity: string): number {
  const at = ORDER.indexOf(severity as Severity);
  return at === -1 ? ORDER.length : at;
}

/**
 * One package's findings, opened out under it.
 *
 * Indented and ruled down the left rather than boxed: these belong to the row
 * above, and a panel would make them a second list that happens to be nearby.
 */
function FindingList({
  findings,
  onOpen,
}: {
  findings: Finding[];
  onOpen: (finding: Finding) => void;
}) {
  return (
    // No ground of its own. A panel here would be a second surface laid over
    // the list, and what is under a row is part of the row, not a thing
    // resting on top of the table.
    <div className="mb-2 ml-11 mr-7 border-l-2 border-ink-200 py-1 pl-4 dark:border-ink-700">
      <ul className="flex flex-col">
        {findings.map((finding) => (
          <li key={finding.id}>
            <button
              onClick={() => onOpen(finding)}
              // ink-200, not ink-100: the page's own ground is ink-100, so a
              // hover painted in it was the colour that was already there.
              // Dark mode looked right only because ink-800 happens to differ
              // from ink-950 -- the same class was broken in both, and only
              // one half of it showed.
              className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ink-200 dark:hover:bg-ink-800"
              title={finding.title || finding.id}
            >
              <SeverityMark severity={finding.severity} />
              <span className="w-36 shrink-0 truncate font-mono text-code font-medium">
                {finding.id}
              </span>
              <span className="min-w-0 flex-1 truncate text-small text-ink-600 dark:text-ink-400">
                {finding.title || '—'}
              </span>
              {/* What to do about it, which is the only reason to read a row
                  of these rather than open one. */}
              {finding.fixed ? (
                <span className="shrink-0 font-mono text-tiny text-emerald-700 dark:text-emerald-500">
                  → {finding.fixed}
                </span>
              ) : (
                <span className="shrink-0 text-tiny text-ink-500">no fix yet</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The colours and glyph for a severity, shared with the finding's own window. */
/**
 * Findings by severity, as one bar.
 *
 * Every severity is a segment, including the ones at zero, and the zeros are
 * the point: "no criticals" is an answer, and a bar that lists only what was
 * found cannot give it. Five segments in a fixed order can be read at a
 * glance and compared between two rows, where a row of however many chips
 * happened to match cannot -- which is what makes this worth repeating down a
 * column of packages rather than only once above a list.
 */
export function SeverityStrip({
  counts,
  active,
  onPick,
}: {
  counts: Record<string, number>;
  /** The segment currently filtered to, drawn pressed. */
  active?: Severity | null;
  /**
   * What pressing a segment narrows to. Left out, the bar is a reading and
   * not a control: inside a row it is the row that is pressed, and a segment
   * that lit up under the pointer promised something of its own to do.
   */
  onPick?: (severity: Severity) => void;
}) {
  return (
    <div className="flex shrink-0" role="group" aria-label="Findings by severity">
      {ORDER.map((severity) => {
        const count = counts[severity] ?? 0;
        const on = active === severity;
        const tone = TONE[severity];
        const named = severity.toLowerCase();
        // The corners are on the end segments themselves, not on a rounded
        // box clipping them. WebKit does not reliably clip a child's own
        // background to a rounded parent inside a subgrid, so the right end
        // came out square while the left looked fine.
        //
        // 28x20: wide enough that a three-digit count -- which a single
        // severity does reach on a large image -- is not cut off, and no
        // taller than the line of text beside it.
        const paint = `flex h-5 w-7 shrink-0 items-center justify-center border-r border-white/25 text-tiny font-semibold tabular-nums first:rounded-l-md last:rounded-r-md last:border-r-0 dark:border-black/25 ${
          count === 0 ? tone.faint : tone.strip
        }`;

        if (!onPick) {
          return (
            <span
              key={severity}
              aria-label={`${count} ${named}`}
              title={`${count} ${named}`}
              className={paint}
            >
              {count}
            </span>
          );
        }

        return (
          <button
            key={severity}
            // Nothing to narrow to, so nothing to press: a segment at zero
            // would empty the list and leave the reader undoing it.
            disabled={count === 0}
            onClick={() => onPick(severity)}
            aria-pressed={on}
            aria-label={`${count} ${named}`}
            title={count === 0 ? `no ${named} findings` : `${count} ${named} — show them`}
            className={`${paint} transition ${
              on ? 'ring-2 ring-inset ring-ink-900/30 dark:ring-white/40' : ''
            } ${count > 0 ? 'hover:opacity-85' : 'cursor-default'}`}
          >
            {count}
          </button>
        );
      })}
    </div>
  );
}

export function severityTone(severity: string) {
  return TONE[severity as Severity] ?? TONE.UNKNOWN;
}

/**
 * A severity, as a mark rather than a word.
 *
 * The words were five different lengths in a narrow column, so the eye read
 * their outlines instead of their meaning -- and "CRITICAL" beside "LOW" is a
 * lot of type for a fact with five possible values. A shape and a colour say
 * it at a glance, and the word is on the tooltip and in the accessible name
 * for anyone who needs it spelled out.
 */
export function SeverityMark({ severity }: { severity: string }) {
  const tone = TONE[severity as Severity] ?? TONE.UNKNOWN;
  const label = severity.toLowerCase();

  return (
    <span className={`flex items-center ${tone.text}`} title={label}>
      <tone.icon size={15} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Empty({
  icon: Icon,
  title,
  body,
  action,
  tone = 'neutral',
}: {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
  action?: React.ReactNode;
  tone?: 'neutral' | 'good';
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full ${
          tone === 'good'
            ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-500'
            : 'bg-ink-500/10 text-ink-500'
        }`}
      >
        <Icon size={20} aria-hidden />
      </span>

      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mx-auto mt-1 max-w-sm wrap-break-word text-xs leading-relaxed text-ink-600 dark:text-ink-400">
          {body}
        </p>
      </div>

      {action}
    </div>
  );
}
