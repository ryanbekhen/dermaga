import { Check, type LucideIcon } from 'lucide-react';

/**
 * A filter that belongs to the list it filters.
 *
 * These used to live in Settings, which put them a page away from the thing
 * they change and made them read as preferences: something to decide once and
 * forget. They are not. Whether stopped containers are in the list is a
 * question somebody answers while looking at the list, several times a day --
 * so it is answered here, beside it.
 *
 * The answer is still remembered between launches. Reaching for the same switch
 * every morning is its own kind of tax.
 */
export function FilterToggle({
  checked,
  onChange,
  label,
  icon: Icon,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  icon?: LucideIcon;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className={`btn h-7 gap-1.5 border ${
        checked
          ? 'border-brand-600 bg-brand-600/10 text-brand-700 dark:text-brand-400'
          : 'border-ink-300 text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800'
      }`}
    >
      {/* The tick is the state, not the colour: colour alone is a poor way to
          say on or off, and this pair has to be readable at a glance. */}
      {checked ? (
        <Check size={12} aria-hidden />
      ) : (
        Icon && <Icon size={12} aria-hidden className="opacity-60" />
      )}
      {label}
    </button>
  );
}
