import type { ReactNode } from 'react';
import { PageHeader } from './PageHeader';
import { Tabs, type TabDefinition } from './Tabs';

interface DetailLayoutProps {
  onBack?: () => void;
  title: string;
  /** Badges rendered beside the title: status, default marker, tags. */
  badges?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: TabDefinition[];
  activeTab?: string;
  onSelectTab?: (id: string) => void;
  children: ReactNode;
}

/**
 * The page frame every detail view shares. It deliberately mirrors a list
 * page -- same header weight, same flat background, same edge-to-edge scroll --
 * so moving from a list into a detail does not feel like a different app.
 */
export function DetailLayout({
  onBack,
  title,
  badges,
  subtitle,
  actions,
  tabs,
  activeTab,
  onSelectTab,
  children,
}: DetailLayoutProps) {
  return (
    // flex-1, not just min-h-0: without it the layout is only as tall as its
    // content, so every pane inside it -- logs, terminal, files -- collapses to
    // the height of whatever it happens to contain, and the empty space below
    // belongs to the page rather than to the pane.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        onBack={onBack}
        title={title}
        badges={badges}
        subtitle={subtitle}
        actions={actions}
      />

      {tabs && activeTab && onSelectTab && (
        <Tabs tabs={tabs} active={activeTab} onSelect={onSelectTab} />
      )}

      {children}
    </div>
  );
}

/** Scrolling, unboxed column grid for overview-style tabs. */
export function DetailGrid({ children }: { children: ReactNode }) {
  return (
    <div className="-mr-5 min-h-0 flex-1 overflow-y-auto pr-5">
      <div className="grid grid-cols-1 items-start gap-x-10 gap-y-5 lg:grid-cols-2">{children}</div>
    </div>
  );
}

/** Full-height area for the log and terminal tabs -- unboxed, like everything else. */
export function DetailPane({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>;
}
