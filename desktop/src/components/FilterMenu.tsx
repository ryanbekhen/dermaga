import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';

/**
 * The switches that narrow a list, behind one button.
 *
 * They were two controls in the header, and as words they crowded the row that
 * also holds what the page is opened to *do*. Folded in here they take one
 * button's worth of room and can say what they actually mean -- "Show
 * containers that are not running" rather than "Stopped", which is the whole
 * difference between a label somebody reads and one they interpret.
 *
 * Folding them away is safe because the list itself says when they have
 * emptied it. A filter nobody can see is a filter nobody remembers, and the
 * failure that causes is an empty list reading as lost work -- which is exactly
 * what happened once: the services restarted, every container came back
 * stopped, and the page looked as though the containers were gone. The answer
 * to that is where the emptiness is, in words, rather than a mark up here that
 * says something is wrong without saying what. The count is in the tooltip for
 * the quieter case, where some rows are held back and the list is not empty.
 */
export function FilterMenu({ hidden, children }: { hidden: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          hidden > 0
            ? `Filters — ${hidden} ${hidden === 1 ? 'container is' : 'containers are'} hidden`
            : 'Filters'
        }
        title={
          hidden > 0
            ? `${hidden} ${hidden === 1 ? 'container is' : 'containers are'} hidden by a filter`
            : 'Filters'
        }
        onClick={() => setOpen((was) => !was)}
        className={`btn-plain ${open ? 'bg-ink-200 text-ink-900 dark:bg-ink-800 dark:text-ink-100' : ''}`}
      >
        <SlidersHorizontal size={16} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-30 w-72 rounded-xl border border-ink-200 bg-white p-1.5 shadow-panel dark:border-ink-800 dark:bg-ink-900"
        >
          {children}
        </div>
      )}
    </div>
  );
}
