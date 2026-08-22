import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, ExternalLink } from 'lucide-react';
import { severityTone } from '../components/PackagesPane';
import { api } from '../services/api';
import { openExternal } from '../services/ipc';
import { readVector } from '../utils/cvss';
import { formatDuration, shortDigest } from '../utils/format';
import type { Finding } from '../types';

/**
 * What a window opened for one vulnerability is showing.
 *
 * The address carries only the two names needed to find it again. A URL is a
 * poor place for a paragraph, and the report can be rescanned while this
 * window is open — so the window fetches, and gets whatever is current rather
 * than whatever was true when it was opened.
 */
export interface FindingRoute {
  reference: string;
  id: string;
}

/**
 * Reads the window's own address.
 *
 * Returns nothing for the main window, which is how index.tsx tells the two
 * apart: same bundle, same bridge, different hash.
 */
export function findingRoute(): FindingRoute | null {
  const match = /^#finding\/([^/]+)\/(.+)$/.exec(window.location.hash);
  if (!match) return null;

  try {
    return { reference: decodeURIComponent(match[1]), id: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

/**
 * One vulnerability, given a window.
 *
 * An advisory rather than a panel: the severity is the masthead, the fix is
 * stated before anything has to be read, and everything under that is the
 * evidence for both. No sidebar and no navigation — this window is about one
 * thing and closes when you are done with it.
 */
export function FindingWindow({ route }: { route: FindingRoute }) {
  const [finding, setFinding] = useState<Finding | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void api
      .getScanReport(route.reference)
      .then((report) => {
        const found = report?.findings.find((entry) => entry.id === route.id);
        if (found) setFinding(found);
        else setMissing(true);
      })
      .catch(() => setMissing(true));
  }, [route.reference, route.id]);

  if (missing) {
    return (
      <Centred>
        This finding is no longer in the scan for {route.reference}. It may have been rescanned
        since this window was opened.
      </Centred>
    );
  }

  if (!finding) return <Centred>Reading the scan…</Centred>;

  return <FindingBody finding={finding} reference={route.reference} />;
}

function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div className="drag flex h-full items-center justify-center px-8 text-center">
      <p className="max-w-sm text-body leading-relaxed text-ink-600 dark:text-ink-400">
        {children}
      </p>
    </div>
  );
}

function FindingBody({ finding, reference }: { finding: Finding; reference: string }) {
  const metrics = readVector(finding.vector);
  const tone = severityTone(finding.severity);

  return (
    <div className="flex h-full flex-col bg-white dark:bg-ink-950">
      {/* The masthead, in the severity's own colour. Every vulnerability
          report opens this way for the same reason: severity is not one field
          among twenty, it is the thing that decides whether the other twenty
          get read at all. It is also what makes this window recognisable from
          across a desk with three of them open.

          It holds the strip macOS puts the close button on, so the frame is
          part of the header rather than a white gap above it, and it does not
          scroll — scrolled away, there would be nothing left to drag the
          window by. */}
      <header className={`shrink-0 ${tone.strip}`}>
        <div className="drag h-11" />
        <div className="flex items-start justify-between gap-6 px-9 pb-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <tone.icon size={14} aria-hidden />
              <span className="text-micro font-semibold uppercase">{finding.severity}</span>
            </div>
            <h1 className="selectable truncate font-mono text-page font-semibold">{finding.id}</h1>
            {/* Which image this is a finding in. The window has no sidebar to
                say where it came from, and one of these open beside another is
                only readable if each says what it is about. */}
            <p className="selectable truncate font-mono text-tiny opacity-70">{reference}</p>
          </div>

          {/* The number, given the size its weight in the decision deserves.
              Opacity rather than a colour: the band is a different shade for
              every severity, and only the text it already carries is legible
              on all of them. */}
          {finding.score !== undefined && (
            <div className="flex shrink-0 flex-col items-end">
              <span className="font-mono text-figure font-semibold tabular-nums">
                {finding.score.toFixed(1)}
              </span>
              <span className="text-micro uppercase opacity-70">CVSS</span>
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-9 py-6">
        <div className="flex flex-col gap-6">
          {finding.title && (
            <p className="selectable text-item font-medium leading-relaxed">{finding.title}</p>
          )}

          <Remedy finding={finding} />

          {finding.description && (
            <p className="selectable whitespace-pre-line text-body leading-[1.7] text-ink-700 dark:text-ink-300">
              {finding.description.trim()}
            </p>
          )}

          <Section title="Affected package">
            <Facts
              rows={[
                { label: 'Package', value: finding.package },
                { label: 'Installed', value: finding.installed || '—' },
                {
                  label: 'Fixed in',
                  value: finding.fixed || <span className="text-ink-500">no fix yet</span>,
                },
                ...(finding.layer
                  ? [{ label: 'From layer', value: shortDigest(finding.layer) }]
                  : []),
              ]}
            />
          </Section>

          <Section title="Advisory">
            <Facts
              rows={[
                ...(finding.status ? [{ label: 'Upstream', value: said(finding.status) }] : []),
                ...(finding.published
                  ? [{ label: 'Published', value: `${formatDuration(finding.published)} ago` }]
                  : []),
                ...(finding.lastModified
                  ? [{ label: 'Revised', value: `${formatDuration(finding.lastModified)} ago` }]
                  : []),
              ]}
            />
            {/* The classes of mistake this is an instance of. Chips rather
                than a comma-separated cell: each is its own identifier, and
                two of them run together read as one long code. */}
            {finding.weaknesses?.length ? (
              <div className="flex flex-wrap gap-1.5 pt-2.5">
                {finding.weaknesses.map((cwe) => (
                  <span
                    key={cwe}
                    className="selectable rounded border border-ink-200 px-1.5 py-0.5 font-mono text-tiny text-ink-600 dark:border-ink-700 dark:text-ink-400"
                  >
                    {cwe}
                  </span>
                ))}
              </div>
            ) : null}
          </Section>

          {/* The vector, read out: whether the score applies to how the package
              is actually used here. A 9.8 reachable only by somebody already
              logged in is a different morning's work from one reachable from
              the network. */}
          {metrics.length > 0 && (
            <Section title="How it is reached">
              <Facts rows={metrics.map((m) => ({ label: m.label, value: m.value }))} />
              {finding.vector && (
                <p className="selectable pt-2.5 font-mono text-tiny text-ink-500">
                  {finding.vector}
                </p>
              )}
            </Section>
          )}

          {/* Vendors disagree, sometimes by two points, and which of them
              applies depends on the distribution in the image — so the
              disagreement is shown rather than resolved here. */}
          {(finding.ratings?.length ?? 0) > 1 && (
            <Section title="Scores by source">
              <Facts
                rows={
                  finding.ratings?.map((rating) => ({
                    label: rating.source,
                    value: (
                      <span className="font-mono tabular-nums" title={rating.vector}>
                        {rating.score ? rating.score.toFixed(1) : '—'}
                      </span>
                    ),
                  })) ?? []
                }
              />
            </Section>
          )}

          {(finding.references?.length ?? 0) > 0 && (
            <Section title={`References (${finding.references?.length})`}>
              {/* Numbered and given whole. An address is the one thing here
                  that must not be shortened: half a URL says neither where it
                  goes nor whether you have read it already, so these wrap onto
                  a second line rather than end in an ellipsis. */}
              <ol className="flex flex-col gap-1.5">
                {finding.references?.map((href, at) => (
                  <li key={href} className="flex gap-2.5">
                    <span
                      aria-hidden
                      className="w-5 shrink-0 text-right font-mono text-tiny tabular-nums text-ink-400"
                    >
                      {at + 1}
                    </span>
                    <a
                      href={href}
                      onClick={(event) => {
                        event.preventDefault();
                        void openExternal(href);
                      }}
                      className="min-w-0 break-all font-mono text-tiny leading-[1.5] text-brand-700 hover:underline dark:text-brand-400"
                    >
                      {href}
                    </a>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {finding.url && (
            <a
              href={finding.url}
              onClick={(event) => {
                event.preventDefault();
                void openExternal(finding.url!);
              }}
              className="flex w-fit items-center gap-1.5 text-body font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              Read the full advisory
              <ExternalLink size={13} aria-hidden />
            </a>
          )}

          {/* Who found this and who reported it are two different parties, and
              the difference matters when a finding is argued about: Trivy
              matched a package against a database somebody else wrote. No
              version — which Trivy read the image is a fact about this
              machine, not about the flaw, and it dates the page for no gain. */}
          <p className="border-t border-ink-150 pt-4 text-tiny text-ink-500 dark:border-ink-800">
            Found by Trivy
            {finding.sourceName && (
              <>
                {', reported by '}
                {finding.sourceUrl ? (
                  <a
                    href={finding.sourceUrl}
                    onClick={(event) => {
                      event.preventDefault();
                      void openExternal(finding.sourceUrl!);
                    }}
                    className="text-brand-700 hover:underline dark:text-brand-400"
                  >
                    {finding.sourceName}
                  </a>
                ) : (
                  finding.sourceName
                )}
              </>
            )}
            .
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * What to do about it, said before any of the evidence for it.
 *
 * This is the only line on the page that answers the question the window was
 * opened to ask. Buried as one row of a table -- which is where it was -- it
 * reads as another field; stated here it reads as the finding's disposition,
 * which is what it is.
 */
function Remedy({ finding }: { finding: Finding }) {
  const fixed = Boolean(finding.fixed);
  const Icon = fixed ? CircleCheck : CircleAlert;

  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border p-3 ${
        fixed
          ? 'border-emerald-600/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-500'
          : 'border-amber-600/30 bg-amber-500/5 text-amber-700 dark:text-amber-500'
      }`}
    >
      <Icon size={15} className="mt-px shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-body font-semibold">
          {fixed ? `Fixed in ${finding.fixed}` : 'No fix available'}
        </p>
        <p className="text-small text-ink-600 dark:text-ink-400">
          {fixed
            ? `${finding.package} is at ${finding.installed || 'an affected version'}. Rebuild the image once the base has the newer package.`
            : `${finding.package} is affected and upstream has not published a fix. Ask whether the image needs this package at all.`}
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className="label-mono border-b border-ink-200 pb-1.5 dark:border-ink-800">{title}</h2>
      <div className="pt-2">{children}</div>
    </section>
  );
}

/**
 * Label and value, ruled rather than boxed.
 *
 * One column, not two: at this width two columns give each value about a
 * hundred pixels, which is where a version string starts being cut in half.
 */
function Facts({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="flex flex-col">
      {rows.map(({ label, value }) => (
        <div
          key={label}
          className="flex items-baseline justify-between gap-4 border-b border-ink-150 py-1.5 last:border-0 dark:border-ink-800"
        >
          <dt className="shrink-0 text-small text-ink-600 dark:text-ink-400">{label}</dt>
          <dd className="selectable wrap-break-word text-right text-small font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What upstream intends to do about it, in words rather than an enum. */
function said(status: string): string {
  const words: Record<string, string> = {
    fixed: 'a fix is available',
    affected: 'no fix yet',
    will_not_fix: 'will not be fixed',
    fix_deferred: 'a fix is deferred',
    end_of_life: 'package is end of life',
  };

  return words[status] ?? status.replace(/_/g, ' ');
}
