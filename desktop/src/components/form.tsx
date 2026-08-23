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
  onSubmit,
  children,
  footer,
  hint,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /**
   * What the dialog's primary button does, so Cmd+Return can do it too.
   *
   * A dialog is not a form element here -- the fields are laid out in panels
   * rather than submitted -- so there was no key that finished one. Escape
   * has always cancelled; this is the other half of that pair, and it is the
   * modifier version deliberately: plain Return in a field adds a row to the
   * list it is in, and creating a container by accident is not a small
   * mistake.
   */
  onSubmit?: () => void;
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

      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onSubmit) {
        event.preventDefault();
        onSubmit();
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
  }, [onClose, onSubmit]);

  return (
    // no-drag for the same reason the panel sets its own text colour below: a
    // dialog opened from the title bar is rendered inside it, and
    // `--wails-draggable` inherits like any other property. Without this,
    // dragging across the text of a failed build's output moved the window
    // instead of selecting the line somebody was trying to copy.
    <div
      className="no-drag fixed inset-0 z-40 flex items-center justify-center bg-ink-950/55 p-6"
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
        // Its own text colour, not the caller's. A dialog opened from the
        // title bar was inheriting the chrome's near-white type onto a light
        // panel, which left the whole thing washed out and barely readable --
        // and a panel that changes colour depending on which button opened it
        // is not a panel, it is an accident waiting for the next call site.
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-2xl bg-ink-100 text-ink-900 shadow-panel dark:bg-ink-950 dark:text-ink-100 ${
          wide ? 'max-w-3xl' : 'max-w-xl'
        }`}
      >
        {/* No close box in the corner. Every dialog here already carries a
            Cancel or a Close in its foot, and closes on Escape and on a click
            outside -- so a cross would be the fourth way out of the same room,
            sitting where a Mac sheet has never had one. It also read as the
            opposite of the button beside it: two controls a hand's width
            apart, one of which discards and one of which does not, and only
            one of them says which. */}
        <div className="flex shrink-0 flex-col gap-1 border-b border-ink-200 bg-white px-6 pb-4 pt-5 dark:border-ink-800 dark:bg-ink-900">
          <h2 className="text-title font-semibold">{title}</h2>
          {subtitle && <p className="text-body text-ink-600 dark:text-ink-400">{subtitle}</p>}
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
  const body = useRef<HTMLDivElement>(null);

  /**
   * Add a row, and put the caret in it.
   *
   * The button that adds a row sits after the rows -- it has to, or it would
   * be above the thing it appends to -- so pressing it left focus *past* the
   * row it had just created. Reaching the new fields meant shift-Tabbing
   * backwards over the button you had only just pressed, every single time.
   *
   * The row does not exist yet when this runs, so the caret is placed on the
   * next frame, once React has committed it.
   */
  const add = () => {
    onAdd?.();

    requestAnimationFrame(() => {
      const rows = body.current?.querySelectorAll<HTMLElement>('[data-row]');
      const last = rows?.[rows.length - 1];

      last?.querySelector<HTMLInputElement>('input, select, textarea')?.focus();
    });
  };

  /**
   * Return, in a row, means another row.
   *
   * It is what the key means everywhere else a list is typed into, and there
   * is nothing else for it to do here: the dialog is not a form element, so
   * Return in a field did nothing at all.
   *
   * A select is left alone -- Return there commits the open menu -- and so is
   * anything held with a modifier, which is how the dialog is submitted.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!onAdd || event.key !== 'Enter') return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = event.target as HTMLElement;
    if (target.tagName !== 'INPUT') return;

    event.preventDefault();
    add();
  };

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

      <div
        ref={body}
        onKeyDown={onKeyDown}
        className="flex flex-col gap-2.5 rounded-xl border border-ink-200 bg-white p-3.5 dark:border-ink-800 dark:bg-ink-900"
      >
        {children}
        {onAdd && (
          <button
            type="button"
            onClick={add}
            title={`${addLabel} — or press Return in any field here`}
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
    // Marked so the fieldset above can find the row it has just added and put
    // the caret in it.
    <div data-row className="flex items-center gap-2">
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
