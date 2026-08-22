import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

interface PageHeaderProps {
  onBack?: () => void;
  /** Where back goes, named — "Containers", "Images". Shown beside the arrow. */
  backTo?: string;
  title: string;
  /** Badges rendered beside the title: status, default marker, tags. */
  badges?: ReactNode;
  subtitle?: ReactNode;
  /**
   * What the list is narrowed by, beside the box that searches it. Kept apart
   * from actions because these stay put: a filter that disappears the moment
   * rows are selected is a filter somebody has to undo a selection to reach.
   */
  filters?: ReactNode;
  actions?: ReactNode;
}

/**
 * Every page — list or detail — is topped by this.
 *
 * Two rows, not one. The top row is what the page is and the one or two things
 * it is opened to do; the strip beneath it is how the list below is narrowed.
 * They used to share a line, which meant a page's verbs and its filters queued
 * up against the same right edge and swapped places as either side grew — so
 * the button you were reaching for moved because a filter appeared.
 *
 * No search box. Every page used to carry one, which meant two places to type
 * a name — this one and the field in the title bar, which searches everything
 * — and the two never agreed about what they had found.
 *
 * The rules under each row run the full width of the column, against the
 * sidebar on one side and the window on the other. That is why the header owns
 * its own padding rather than sitting inside a gutter: a rule that stops short
 * of the edge reads as the top of a card, not as the base of a heading.
 */
export function PageHeader({
  onBack,
  backTo,
  title,
  badges,
  subtitle,
  filters,
  actions,
}: PageHeaderProps) {
  const hasStrip = Boolean(filters);

  return (
    <header className="shrink-0">
      <div
        className={`flex flex-wrap items-end justify-between gap-x-5 gap-y-3 border-b border-ink-200 px-7 pb-4 dark:border-ink-800 ${
          onBack ? 'pt-4' : 'pt-6'
        }`}
      >
        <div className="min-w-0">
          {/* Named, and above the title rather than beside it. A bare arrow in
              a box asks the reader to remember what they came from; the word
              says it, and putting it on its own line keeps the title starting
              at the same left edge as every other page's. */}
          {onBack && (
            <button
              onClick={onBack}
              className="mb-2.5 flex items-center gap-2 text-small text-ink-600 transition-colors hover:text-brand-600 dark:text-ink-400 dark:hover:text-brand-400"
            >
              <ArrowLeft size={13} aria-hidden />
              {backTo ?? 'Back'}
            </button>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-page font-semibold">{title}</h1>
            {badges}
          </div>
          {subtitle && (
            <p className="truncate pt-1 text-body text-ink-600 dark:text-ink-400">{subtitle}</p>
          )}
        </div>

        {actions && (
          <div className="header-actions flex shrink-0 flex-wrap items-center justify-end gap-2.5">
            {actions}
          </div>
        )}
      </div>

      {hasStrip && (
        // A shade off the ground it sits on, so the strip reads as part of the
        // heading rather than as the first row of the list.
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-ink-50 px-7 py-2.5 dark:border-ink-800 dark:bg-ink-900/50">
          {filters}
        </div>
      )}
    </header>
  );
}
