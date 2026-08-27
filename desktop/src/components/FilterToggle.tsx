import { Check } from 'lucide-react';

/**
 * One switch inside the filter menu.
 *
 * These used to live in Settings, which put them a page away from the thing
 * they change and made them read as preferences: something to decide once and
 * forget. They are not. Whether stopped containers are in the list is a
 * question somebody answers while looking at the list, several times a day --
 * so it is answered beside it. The answer is still remembered between
 * launches; reaching for the same switch every morning is its own kind of tax.
 *
 * It says what it does, in a sentence. There was a shape with no words at all
 * for a while, on the grounds that the header had no room for them, and it cost
 * a user their afternoon: collapsed to a glyph the stopped filter wore a square
 * -- the same square this window uses to mean *stop this container*, one of
 * them a button in the very same row -- and it was pressed as one. A control
 * some readers cannot tell from the button beside it is not smaller, it is
 * wrong. Room came from folding them into a menu instead, which cost nothing
 * that had to be read.
 */
export function FilterToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What the switch does, said as a sentence rather than named as a noun. */
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-item transition-colors ${
        checked
          ? 'font-medium text-brand-700 dark:text-brand-400'
          : 'text-ink-700 hover:bg-ink-150 dark:text-ink-300 dark:hover:bg-ink-800'
      }`}
    >
      {/* The tick is the state, not the colour: colour alone is a poor way to
          say on or off, and a menu of switches has to read at a glance. Its
          space is held when it is absent so the labels do not shift as the
          switches are thrown. */}
      <span className="flex w-3.5 shrink-0 justify-center">
        {checked && <Check size={13} aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
    </button>
  );
}
