import { X } from 'lucide-react';
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
  hint,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  /**
   * A line along the bottom left, opposite the buttons — what the dialog is
   * waiting for, or what pressing the button will do. It reads as part of the
   * decision rather than as another paragraph in the form.
   */
  hint?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Claim focus once, when the dialog opens.
   *
   * A form should be ready to type in: if no field claimed focus with
   * autoFocus, the first one takes it -- the close button is first in the DOM,
   * and landing there means a wasted Tab.
   *
   * Once, though, and the empty dependency list is the whole fix. This used to
   * share an effect with the key handling below, which depends on `onClose` --
   * and every caller passes an inline arrow, so `onClose` was a new function on
   * every render and the effect ran on every render with it. That was harmless
   * only while focus stayed inside the panel. The moment a keystroke caused
   * React to replace the focused input's DOM node, focus fell to the body, the
   * next render found it outside the panel and handed it to the first field --
   * the container's name. Typing an image jumped to the name field mid-word.
   */
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;

    const stops = focusableIn(panel);
    const firstField = stops.find((element) => element.tagName !== 'BUTTON');
    (firstField ?? stops[0])?.focus();
  }, []);

  // Escape closes, and Tab is kept inside the panel. Separate from the focus
  // above precisely so that re-subscribing when `onClose` changes -- which is
  // every render -- costs nothing more than swapping a listener.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

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
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/55 p-6"
      onClick={onClose}
    >
      {/* The panel is the page's own paper, and its head and foot are white:
          the form is laid on it in the same panels a page uses, so the two
          fixed edges have to be the thing they are laid against. A dialog that
          was white throughout gave a card inside it nothing to sit on. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-2xl bg-ink-100 shadow-panel dark:bg-ink-950 ${
          wide ? 'max-w-3xl' : 'max-w-xl'
        }`}
      >
        <div className="flex shrink-0 items-start justify-between gap-5 border-b border-ink-200 bg-white px-6 pb-4 pt-5 dark:border-ink-800 dark:bg-ink-900">
          <div className="min-w-0">
            <h2 className="text-title font-semibold">{title}</h2>
            {subtitle && (
              <p className="pt-1 text-body text-ink-600 dark:text-ink-400">{subtitle}</p>
            )}
          </div>
          <button onClick={onClose} className="btn-icon h-7.5 w-7.5 shrink-0" aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4.5 overflow-y-auto px-6 py-5">
          {children}
        </div>

        <div className="header-actions flex shrink-0 items-center gap-2.5 border-t border-ink-200 bg-white px-6 py-3.5 dark:border-ink-800 dark:bg-ink-900">
          <p className="min-w-0 flex-1 truncate text-xs text-ink-500">{hint}</p>
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
      <span className="label-mono">{label}</span>
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
      {/* The rule runs from the label to the right edge, which is what makes a
          group of fields read as a group without drawing a box around it --
          the box is the panel underneath, and two edges around one thing is
          one edge too many. */}
      <div className="flex items-center gap-3">
        <legend className="label-mono">{legend}</legend>
        <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" aria-hidden />
      </div>
      {hint && <p className="text-tiny text-ink-600 dark:text-ink-400">{hint}</p>}

      <div className="flex flex-col gap-2.5 rounded-xl border border-ink-200 bg-white p-3.5 dark:border-ink-800 dark:bg-ink-900">
        {children}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="self-start text-small text-brand-700 hover:underline dark:text-brand-400"
          >
            + {addLabel}
          </button>
        )}
      </div>
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
