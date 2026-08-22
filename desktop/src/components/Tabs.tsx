import type { LucideIcon } from 'lucide-react';

export interface TabDefinition {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface TabsProps {
  tabs: TabDefinition[];
  active: string;
  onSelect: (id: string) => void;
}

/**
 * The panes of one thing, picked between.
 *
 * Underlined rather than the pills the filter strip uses, and the difference is
 * the question each answers. A filter narrows what is in front of you and can
 * be combined with the next one along; a tab replaces the whole pane. The rule
 * under the strip is what a tab is attached to, so the selected one reads as
 * the front of a stack rather than as one of several things switched on.
 */
export function Tabs({ tabs, active, onSelect }: TabsProps) {
  return (
    <div role="tablist" className="flex flex-wrap gap-6 px-7">
      {tabs.map(({ id, label, icon: Icon }) => {
        const selected = id === active;

        return (
          <button
            key={id}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(id)}
            // The strip sits on the rule that closes the header, so the
            // underline is pulled down a pixel to cover it rather than to
            // stack a second line just above it.
            className={`-mb-px flex items-center gap-2 border-b-2 py-2.5 text-body transition-colors ${
              selected
                ? 'border-brand-600 font-medium text-brand-700 dark:text-brand-400'
                : 'border-transparent text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100'
            }`}
          >
            <Icon size={14} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
