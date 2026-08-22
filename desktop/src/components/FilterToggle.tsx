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
  iconOnly = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  icon?: LucideIcon;
  title?: string;
  /**
   * Draw the icon alone, among a header's other icons.
   *
   * The tick cannot be the state here -- there is no room beside a glyph for a
   * second one -- so the icon keeps its own shape and the brand tint says it
   * is on, which is what every other pressed control in this app does.
   */
  iconOnly?: boolean;
}) {
  if (iconOnly) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={title ?? label}
        onClick={() => onChange(!checked)}
        className={`btn-plain ${
          checked
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-400'
            : 'opacity-60'
        }`}
      >
        {Icon && <Icon size={16} aria-hidden />}
      </button>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-7.5 shrink-0 items-center gap-1.5 rounded-lg px-3 text-small transition-colors ${
        checked
          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-600/15 dark:text-brand-400'
          : 'text-ink-600 hover:bg-ink-150 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100'
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
