import type { LucideIcon } from 'lucide-react';

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/**
 * One control rather than a row of separate buttons: the options are mutually
 * exclusive, so they are drawn as one set.
 *
 * The track they used to sit inside is gone. It was doing the work of saying
 * "these belong together", which the spacing already says, and it made the
 * group read as a switch heavy enough to be the point of the page rather than
 * as one of the several ways a list can be narrowed.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex h-7.5 w-fit shrink-0 items-center gap-1 self-start"
    >
      {segments.map(({ value: segment, label, icon: Icon }) => {
        const active = segment === value;

        return (
          <button
            key={segment}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(segment)}
            className={`inline-flex h-full items-center gap-1.5 rounded-lg px-3 text-small transition-colors ${
              active
                ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-600/15 dark:text-brand-400'
                : 'text-ink-600 hover:bg-ink-150 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100'
            }`}
          >
            {Icon && <Icon size={13} aria-hidden />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
