import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, Search } from 'lucide-react';

interface PageHeaderProps {
  onBack?: () => void;
  title: string;
  /** Badges rendered beside the title: status, default marker, tags. */
  badges?: ReactNode;
  subtitle?: ReactNode;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  };
  actions?: ReactNode;
}

/** Shared so ⌘K can reach whichever page's search is currently mounted. */
export const PAGE_SEARCH_ID = 'dermaga-page-search';

/**
 * Every page — list or detail — is topped by this. There is no separate app
 * toolbar: a bar spanning only the content column read as an extension of the
 * sidebar, and search belongs to the list it filters anyway.
 */
export function PageHeader({ onBack, title, badges, subtitle, search, actions }: PageHeaderProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!search) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Only ⌘F: ⌘K opens the command palette, which searches everything
      // rather than only the list on this page.
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        search.onChange('');
        searchRef.current?.blur();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [search]);

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="btn-icon shrink-0" title="Back" aria-label="Back">
            <ArrowLeft size={14} aria-hidden />
          </button>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            {badges}
          </div>
          {subtitle && (
            <p className="truncate text-tiny text-ink-600 dark:text-ink-400">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {search && (
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
              aria-hidden
            />
            <input
              id={PAGE_SEARCH_ID}
              ref={searchRef}
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              className="input w-52 pl-7"
            />
          </div>
        )}
        {actions}
      </div>
    </header>
  );
}
