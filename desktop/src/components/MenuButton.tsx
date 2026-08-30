import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { IconButton } from './Button';

/**
 * An icon in a header that opens a small panel of switches beneath it.
 *
 * Why the switches are behind a button rather than in the row: a header of bare
 * glyphs reads as a row of verbs, and whatever sits in it gets pressed as one.
 * The stopped filter wore a square -- the same square that means *stop this
 * container* -- and was pressed as Stop. The autoboot mark wore a power symbol
 * next to Start and Restart, and read as *turn this container off*. Neither was
 * a badly chosen glyph. A setting cannot be told from an action when both are
 * icons side by side, so the settings come in here where there is room to say
 * what they do in a sentence.
 *
 * The parts every one of these menus needs and would otherwise get right
 * separately: Escape and a click outside close it, and the button keeps a
 * pressed look while it is open.
 */
export function MenuButton({
  icon,
  label,
  title,
  children,
}: {
  icon: LucideIcon;
  /** The accessible name of the button. */
  label: string;
  /** Its tooltip, when there is more to say than the name. */
  title?: string;
  children: ReactNode;
}) {
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
      <IconButton
        icon={icon}
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={open ? 'bg-ink-200 text-ink-900 dark:bg-ink-800 dark:text-ink-100' : ''}
      />

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
