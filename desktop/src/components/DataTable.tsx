import { useEffect, useRef, type ReactNode } from 'react';

export interface Column {
  key: string;
  label: string;
  /** CSS grid track for this column, e.g. "120px" or "minmax(0,1.5fr)". */
  width: string;
  align?: 'right';
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
  /** Enables the leading checkbox column and select-all. */
  selection?: Selection;
  empty: string;
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
  selection,
  empty,
}: DataTableProps<T>) {
  const keys = rows.map(rowKey);
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

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-ink-300 text-sm text-ink-600 dark:border-ink-700 dark:text-ink-400">
        {empty}
      </div>
    );
  }

  // One grid owns the columns; the header and every row are subgrids of it.
  // Sizing them separately let the trailing actions track resolve to nothing
  // in the header and a button's width in the rows, and the difference came
  // out of the flexible column -- so every heading sat a few pixels left of
  // the values underneath it.
  const template = {
    gridTemplateColumns: [
      ...(selection ? ['22px'] : []),
      ...columns.map((c) => c.width),
      actions ? 'auto' : '16px',
    ].join(' '),
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div style={template} className="grid gap-x-3">
        <div className="sticky top-0 z-10 col-span-full grid grid-cols-subgrid items-center border-b border-ink-200 bg-white px-3 pb-2.5 pt-1 text-tiny font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-700 dark:bg-ink-950">
          {selection && (
            <RowCheckbox
              checked={allSelected}
              indeterminate={selectedHere.length > 0 && !allSelected}
              onChange={toggleAll}
              label="Select all"
            />
          )}
          {columns.map((column) => (
            <span key={column.key} className={column.align === 'right' ? 'text-right' : undefined}>
              {column.label}
            </span>
          ))}
          <span />
        </div>

        <ul className="col-span-full grid grid-cols-subgrid divide-y divide-ink-200 dark:divide-ink-700">
          {rows.map((row) => {
            const key = rowKey(row);
            const isSelected = selection?.selected.has(key) ?? false;

            return (
              // The click belongs to the row, not to each cell: hung on the
              // cells, the gutters between columns belonged to nothing, so
              // they neither opened the row nor matched it -- and the pointer
              // flickered between a hand and an arrow at every column edge.
              //
              // No hand, either. This app draws the arrow everywhere, as a Mac
              // does; the row lights up on hover to say it can be opened.
              <li
                key={key}
                onClick={onOpen ? () => onOpen(row) : undefined}
                className={`group col-span-full grid grid-cols-subgrid items-center px-3 transition-colors ${
                  isSelected
                    ? 'bg-brand-600/5 dark:bg-brand-600/10'
                    : 'hover:bg-ink-50 dark:hover:bg-ink-800/50'
                }`}
              >
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
                    className={`min-w-0 py-2 ${
                      columns[index]?.align === 'right' ? 'text-right' : ''
                    }`}
                  >
                    {cell}
                  </div>
                ))}

                <div
                  onClick={(event) => event.stopPropagation()}
                  className="flex items-center justify-end gap-1 py-1"
                >
                  {actions?.(row)}
                </div>
              </li>
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
      className={`block truncate text-xs text-ink-600 dark:text-ink-400 ${mono ? 'font-mono' : ''}`}
    >
      {children}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand';
}) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-tiny font-semibold ${
        tone === 'brand'
          ? 'bg-brand-600/10 text-brand-700 dark:text-brand-400'
          : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-400'
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
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-tiny font-semibold text-ink-600 dark:text-ink-400">
        {count} selected
      </span>
      {children}
      <button onClick={onClear} className="btn-ghost">
        Clear
      </button>
    </div>
  );
}
