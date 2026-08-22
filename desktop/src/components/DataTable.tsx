import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Boxes } from 'lucide-react';
import { PLACEHOLDER_ROWS, PLACEHOLDER_WIDTHS, SkeletonBar } from './Skeleton';

export interface Column {
  key: string;
  label: string;
  /** CSS grid track for this column, e.g. "120px" or "minmax(0,1.5fr)". */
  width: string;
  /**
   * Where the heading and its values sit in the track.
   *
   * The two are set from one place on purpose: a status stacked over its
   * uptime was centred in the cell while its heading stayed at the left edge,
   * and a column whose title does not stand over its contents reads as two
   * columns that happen to be next to each other.
   */
  align?: 'right' | 'center';
}

export interface Selection {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

interface DataTableProps<T> {
  columns: Column[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Cells for one row, in column order. */
  cells: (row: T) => ReactNode[];
  onOpen?: (row: T) => void;
  /** Rendered at the end of each row, outside the click target. */
  actions?: (row: T) => ReactNode;
  /**
   * A row's own contents, opened out underneath it.
   *
   * Full width rather than in the columns: what hangs off a row is rarely the
   * same shape as the row -- a package's findings are not packages -- and
   * squeezed into the parent's tracks it would read as more of the same list
   * rather than as part of the row above it. Returning nothing leaves the row
   * as it was.
   */
  below?: (row: T) => ReactNode;
  /** Enables the leading checkbox column and select-all. */
  selection?: Selection;
  empty: string;
  /**
   * True while the first answer is still on its way. Without it a page that has
   * not been told anything yet is indistinguishable from a page that has been
   * told there is nothing -- so every list opened by announcing it was empty,
   * then replaced itself a moment later with the rows that were there all
   * along. Nothing about that reads as live.
   */
  loading?: boolean;
}

/**
 * One list shape for every resource: a header strip and hairline-divided rows,
 * dense enough to scan and identical across pages.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  cells,
  onOpen,
  actions,
  below,
  selection,
  empty,
  loading = false,
}: DataTableProps<T>) {
  const keys = rows.map(rowKey);

  /**
   * The row the keys are on.
   *
   * Held as the row's own key rather than as its position, so filtering the
   * list does not silently move the cursor onto whatever slid into that slot.
   * A row that filters away simply stops being the one -- indexOf returns -1
   * and nothing is marked, which is the truth.
   */
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeRow = useRef<HTMLLIElement>(null);

  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: 'nearest' });
  }, [activeKey]);

  /**
   * Arrows walk the list, Return opens, Space picks.
   *
   * Bound to the window and deliberately alive while the caret is in a filter
   * field: type a few letters, arrow down, press Return is the whole point,
   * and a single-line field has nowhere for an up-arrow to go anyway. A
   * textarea does, and the terminal is one, so those are left alone -- as is
   * anything behind an open dialog, which owns the keyboard while it is up.
   */
  useEffect(() => {
    if (rows.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;

      const focused = document.activeElement as HTMLElement | null;
      if (focused?.tagName === 'TEXTAREA' || focused?.isContentEditable) return;

      const current = activeKey ? keys.indexOf(activeKey) : -1;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        // From nothing, down lands on the first row and up on the last, so
        // either arrow is a way in rather than only a way along.
        const next =
          current === -1
            ? step === 1
              ? 0
              : keys.length - 1
            : Math.min(keys.length - 1, Math.max(0, current + step));

        setActiveKey(keys[next]);
        return;
      }

      if (current === -1) return;

      if (event.key === 'Enter' && onOpen) {
        event.preventDefault();
        onOpen(rows[current]);
        return;
      }

      // Space, where there are checkboxes to fill: picking a row without
      // reaching for the mouse is most of what bulk actions are for. Not
      // while typing, though -- a space in a filter is a space.
      if (event.key === ' ' && selection && focused?.tagName !== 'INPUT') {
        event.preventDefault();
        // Written out here rather than calling the toggle below it: that one
        // is declared further down the component, and reaching backwards for
        // it from an effect is what the compiler's immutability rule is
        // there to stop.
        const next = new Set(selection.selected);
        if (!next.delete(keys[current])) next.add(keys[current]);
        selection.onChange(next);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // keys and rows are rebuilt every render; the values that decide what the
    // handler does are the ones listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, rows, onOpen, selection]);

  const selectedHere = keys.filter((key) => selection?.selected.has(key));
  const allSelected = keys.length > 0 && selectedHere.length === keys.length;

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allSelected) keys.forEach((key) => next.delete(key));
    else keys.forEach((key) => next.add(key));
    selection.onChange(next);
  };

  const toggle = (key: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  };

  if (rows.length === 0 && !loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-7">
        <div className="flex w-full max-w-md items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white/60 px-6 py-10 text-center text-sm text-ink-600 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-400">
          {empty}
        </div>
      </div>
    );
  }

  // One grid owns the columns; the header and every row are subgrids of it.
  // Sizing them separately let the trailing actions track resolve to nothing
  // in the header and a button's width in the rows, and the difference came
  // out of the flexible column -- so every heading sat a few pixels left of
  // the values underneath it.
  //
  // The margins either side are tracks rather than padding. A subgrid's tracks
  // are placed on its parent's grid lines, so padding on one has nowhere to go
  // but into the first and last column: a 22px checkbox track behind 28px of
  // padding is no track at all, and the box was drawn straight over the name
  // beside it. As tracks, the margins are part of the same grid as everything
  // else, and a row's hover still runs the full width because the row spans it.
  const GUTTER = '28px';
  const template = {
    gridTemplateColumns: [
      GUTTER,
      ...(selection ? ['22px'] : []),
      ...columns.map((c) => c.width),
      actions ? 'auto' : '16px',
      GUTTER,
    ].join(' '),
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div style={template} className="grid gap-x-3">
        <div className="label-mono sticky top-0 z-10 col-span-full grid grid-cols-subgrid items-center border-b border-ink-200 bg-ink-100 py-2.5 dark:border-ink-800 dark:bg-ink-950">
          <span />
          {selection && (
            <RowCheckbox
              checked={allSelected}
              indeterminate={selectedHere.length > 0 && !allSelected}
              onChange={toggleAll}
              label="Select all"
            />
          )}
          {columns.map((column) => (
            <span
              key={column.key}
              className={
                column.align === 'right'
                  ? 'text-right'
                  : column.align === 'center'
                    ? 'text-center'
                    : undefined
              }
            >
              {column.label}
            </span>
          ))}
          <span />
          <span />
        </div>

        <ul
          aria-busy={loading || undefined}
          className="col-span-full grid grid-cols-subgrid divide-y divide-ink-150 dark:divide-ink-800/70"
        >
          {rows.length === 0 &&
            // The shape of the answer while it is still coming: the columns it
            // will arrive in, at the height it will occupy, so the page does not
            // jump when it does.
            Array.from({ length: PLACEHOLDER_ROWS }, (_, at) => (
              <li
                key={`waiting-${at}`}
                aria-hidden
                className="col-span-full grid grid-cols-subgrid items-center"
              >
                <span />
                {selection && <span className="h-3.5 w-3.5 rounded bg-ink-200 dark:bg-ink-800" />}
                {columns.map((column, index) => (
                  <div
                    key={column.key}
                    className={`min-w-0 py-3.5 ${
                      column.align === 'right'
                        ? 'flex justify-end'
                        : column.align === 'center'
                          ? 'flex justify-center'
                          : ''
                    }`}
                  >
                    <SkeletonBar
                      width={PLACEHOLDER_WIDTHS[index % PLACEHOLDER_WIDTHS.length]}
                      at={at}
                    />
                  </div>
                ))}
                <span />
                <span />
              </li>
            ))}

          {rows.map((row) => {
            const key = rowKey(row);
            const isSelected = selection?.selected.has(key) ?? false;
            const opened = below?.(row);

            // The click belongs to the row, not to each cell: hung on the
            // cells, the gutters between columns belonged to nothing, so they
            // neither opened the row nor matched it -- and the pointer
            // flickered between a hand and an arrow at every column edge.
            //
            // The hand is on the whole row for the same reason. A row is not
            // shaped like a control, so hover alone left the reader to
            // discover by trying that it opens.
            const isActive = key === activeKey;

            const main = (
              <li
                key={key}
                ref={isActive ? activeRow : undefined}
                onClick={onOpen ? () => onOpen(row) : undefined}
                aria-current={isActive ? 'true' : undefined}
                className={`group col-span-full grid grid-cols-subgrid items-center text-body transition-colors ${
                  onOpen ? 'cursor-pointer' : ''
                } ${
                  isSelected
                    ? 'bg-brand-50 dark:bg-brand-600/10'
                    : isActive
                      ? 'bg-ink-150 dark:bg-ink-800/70'
                      : 'hover:bg-ink-50 dark:hover:bg-ink-900/60'
                }`}
              >
                <span />
                {selection && (
                  // Picking a row is not opening it.
                  <span onClick={(event) => event.stopPropagation()} className="contents">
                    <RowCheckbox
                      checked={isSelected}
                      onChange={() => toggle(key)}
                      label={`Select ${key}`}
                    />
                  </span>
                )}

                {cells(row).map((cell, index) => (
                  <div
                    key={columns[index]?.key ?? index}
                    className={`min-w-0 py-3.5 ${
                      columns[index]?.align === 'right'
                        ? 'text-right'
                        : columns[index]?.align === 'center'
                          ? 'text-center'
                          : ''
                    }`}
                  >
                    {cell}
                  </div>
                ))}

                <div
                  onClick={(event) => event.stopPropagation()}
                  className="flex items-center justify-end gap-1.5 py-1.5"
                >
                  {actions?.(row)}
                </div>

                <span />
              </li>
            );

            if (!opened) return main;

            // Both halves are siblings in the same grid, so the open part is
            // its own row rather than something inside the row above it --
            // which keeps the columns of every other row where they were.
            return (
              <Fragment key={key}>
                {main}
                <li className="col-span-full">{opened}</li>
              </Fragment>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function RowCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  // "Some selected" has no HTML attribute; it must be set on the element.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="h-3.5 w-3.5 accent-brand-600"
    />
  );
}

/** Primary cell: a bold name with optional badges beside it. */
export function NameCell({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 items-center gap-2">{children}</div>;
}

export function Muted({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return (
    <span
      className={`block truncate text-ink-600 dark:text-ink-400 ${
        mono ? 'font-mono text-code' : 'text-small'
      }`}
    >
      {children}
    </span>
  );
}

/**
 * That something is holding this row's thing, and what.
 *
 * The containers glyph, because "in use" here only ever means "a container is
 * using it" -- borrowing the icon the sidebar names containers with says that
 * without a word. The words are not lost: the badge could only say *that* it
 * was in use, while the tooltip says by what, which is the question anybody
 * reading the badge was about to ask next.
 */
export function InUse({ by }: { by: string[] }) {
  if (by.length === 0) return null;

  return (
    <span
      title={`In use by ${by.join(', ')}`}
      aria-label={`In use by ${by.join(', ')}`}
      className="shrink-0 text-brand-600 dark:text-brand-400"
    >
      <Boxes size={13} aria-hidden />
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  fit = false,
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand';
  // Badges hold short words and do not shrink, which is what keeps one beside
  // a truncating name instead of being squeezed by it. A badge holding
  // something arbitrary -- an image tag, which is as long as whoever built the
  // image decided -- has to give way instead, or it is drawn straight over the
  // column beside it.
  fit?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`rounded-md px-1.5 py-0.5 font-mono text-tiny ${
        fit ? 'min-w-0 truncate' : 'shrink-0'
      } ${
        tone === 'brand'
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-400'
          : 'bg-ink-150 text-ink-600 dark:bg-ink-800 dark:text-ink-400'
      }`}
    >
      {children}
    </span>
  );
}

/** Shown in the page header while rows are selected. */
export function SelectionActions({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="label-mono whitespace-nowrap">{count} selected</span>
      {children}
      <button onClick={onClear} className="btn-ghost">
        Clear
      </button>
    </div>
  );
}
