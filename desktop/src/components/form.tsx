import { Plus, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { tabWrap } from '../utils/focus';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement) {
  // offsetParent is null for anything display:none, which must not be a stop.
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null
  );
}

/** A centred modal with an escape hatch and a scrolling body. */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    // A form opened from the command palette should be ready to type in. If no
    // field claimed focus with autoFocus, the first one takes it -- the close
    // button is first in the DOM, and landing there means a wasted Tab.
    if (!panel.contains(document.activeElement)) {
      const stops = focusableIn(panel);
      const firstField = stops.find((element) => element.tagName !== 'BUTTON');
      (firstField ?? stops[0])?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const stops = focusableIn(panel);
      const active = document.activeElement;
      const wrap = tabWrap(
        stops.length,
        active instanceof HTMLElement ? stops.indexOf(active) : -1,
        event.shiftKey
      );
      if (!wrap) return;

      event.preventDefault();
      // focusVisible keeps the ring on. The wrap is a Tab like any other, but
      // moving focus in code loses the "arrived by keyboard" the indicator
      // depends on -- in WebKit it does, at least -- and a Tab that lands
      // somewhere invisible is worse than one that does not move at all.
      (wrap === 'first' ? stops[0] : stops[stops.length - 1]).focus({ focusVisible: true });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/40 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-panel dark:border-ink-700 dark:bg-ink-900 ${
          wide ? 'max-w-3xl' : 'max-w-md'
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-200 p-5 dark:border-ink-700">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-icon" aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">{children}</div>

        <div className="flex justify-end gap-2 border-t border-ink-200 p-4 dark:border-ink-700">
          {footer}
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold">{label}</span>
      {children}
      {hint && <span className="text-tiny text-ink-600 dark:text-ink-400">{hint}</span>}
    </label>
  );
}

export function Fieldset({
  legend,
  hint,
  onAdd,
  addLabel,
  children,
}: {
  legend: string;
  hint?: string;
  // Omitted by groups that are not a list of rows, such as the .env editor.
  onAdd?: () => void;
  addLabel?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-xs font-semibold">{legend}</legend>
        {onAdd && (
          <button type="button" onClick={onAdd} className="btn-ghost px-2 py-1 text-xs">
            <Plus size={13} aria-hidden />
            {addLabel}
          </button>
        )}
      </div>
      {hint && <p className="text-tiny text-ink-600 dark:text-ink-400">{hint}</p>}
      <div className="flex flex-col gap-2">{children}</div>
    </fieldset>
  );
}

/** One removable row inside a Fieldset. */
export function Row({ onRemove, children }: { onRemove: () => void; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="btn-icon h-8 w-8 shrink-0"
        aria-label="Remove row"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex h-7 items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-brand-600"
      />
      {label}
    </label>
  );
}
