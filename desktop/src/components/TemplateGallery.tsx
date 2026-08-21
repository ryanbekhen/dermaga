import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, WifiOff } from 'lucide-react';
import { Modal } from './form';
import { PLACEHOLDER_WIDTHS, SkeletonBar } from './Skeleton';
import { Button } from './Button';
import { api } from '../services/api';
import { useToastStore } from '../store/toastStore';
import type { ContainerSpec, Template } from '../types';

/**
 * Somewhere to start, rather than an empty form.
 *
 * A template fills the create form in and gets out of the way -- every field
 * stays editable and nothing is created until the person presses the button
 * themselves. That is what makes taking them from a public catalogue reasonable,
 * and it is why this shows the whole specification rather than just a name: the
 * image, the port, the volume it will keep its data on.
 *
 * The catalogue lives online and the agent keeps a copy, so this works offline
 * once it has been reached once -- and says so plainly when it has not.
 *
 * It is reachable without the mouse, the same way the command palette is: type
 * to narrow, arrows to move, Enter to take one. Anybody who opened this from the
 * palette got here by keyboard and should not have to leave it now.
 */

/** A tinted tile with an initial, for a template whose project has no icon. */
function Monogram({ name }: { name: string }) {
  // A hue from the name, so the same template is the same colour every time and
  // two templates side by side are rarely the same. Not decoration: it is what
  // makes a missing logo read as a designed thing rather than a broken image.
  const hue = [...name].reduce((total, character) => total + character.charCodeAt(0), 0) % 360;

  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold"
      style={{
        backgroundColor: `hsl(${hue} 55% 92%)`,
        color: `hsl(${hue} 55% 32%)`,
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function TemplateGallery({
  onPick,
  onClose,
}: {
  onPick: (spec: Partial<ContainerSpec>) => void;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [needle, setNeedle] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;

    void api
      .listTemplates()
      .then((found) => !cancelled && setTemplates(found ?? []))
      .catch(() => !cancelled && setTemplates([]));

    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    const term = needle.trim().toLowerCase();
    if (!term) return templates ?? [];

    return (templates ?? []).filter((template) =>
      `${template.name} ${template.summary} ${template.spec.image}`.toLowerCase().includes(term)
    );
  }, [templates, needle]);

  // A stale index would fill the form in from whatever happens to sit there now.
  const index = Math.min(active, Math.max(shown.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, shown.length]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setTemplates(await api.refreshTemplates());
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not reach the catalogue', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  // Handled where the caret is. Typing narrows the list and the arrows move
  // through what is left, so neither ever asks for the mouse. Escape belongs to
  // the modal itself and is left alone here.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (shown.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(index + 1 >= shown.length ? 0 : index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(index - 1 < 0 ? shown.length - 1 : index - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onPick(shown[index].spec);
    }
  };

  return (
    <Modal
      title="Start from a template"
      subtitle="Everything stays editable before anything is created."
      onClose={onClose}
      footer={
        <>
          {shown.length > 0 && (
            <span className="mr-auto flex items-center gap-3 text-tiny text-ink-500">
              <span>
                <span className="font-mono">↑↓</span> to move
              </span>
              <span>
                <span className="font-mono">↵</span> to use
              </span>
            </span>
          )}
          <Button icon={RefreshCw} busy={refreshing} busyLabel="Fetching…" onClick={refresh}>
            Refresh
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <label className="relative block">
        <Search
          size={14}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
        />
        <input
          autoFocus
          value={needle}
          onChange={(event) => {
            setNeedle(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search templates…"
          aria-label="Search templates"
          className="input w-full pl-9"
        />
      </label>

      {templates === null ? (
        // The shape of the list, not a word about waiting: the rows land where
        // the bars are and nothing moves.
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 4 }, (_, at) => (
            <div
              key={at}
              aria-hidden
              className="flex items-start gap-2.5 rounded-lg border border-ink-200 p-2.5 dark:border-ink-700"
            >
              <SkeletonBar width="28px" height="h-7" at={at} className="shrink-0 rounded-md" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
                <SkeletonBar width="38%" at={at} />
                <SkeletonBar width={PLACEHOLDER_WIDTHS[at % PLACEHOLDER_WIDTHS.length]} at={at} />
              </div>
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        // Not an error, and worth saying exactly: the catalogue is online, and
        // this machine has not reached it yet. Everything else about creating a
        // container works meanwhile.
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <WifiOff size={20} className="text-ink-500" aria-hidden />
          <div>
            <p className="text-sm font-semibold">No templates yet</p>
            <p className="mx-auto mt-1 max-w-sm break-words text-xs leading-relaxed text-ink-600 dark:text-ink-400">
              They are fetched from a catalogue and kept for when you are offline. This Mac has not
              reached it yet — everything else about creating a container works meanwhile.
            </p>
          </div>
          <Button icon={RefreshCw} busy={refreshing} busyLabel="Fetching…" onClick={refresh}>
            Try now
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-600 dark:text-ink-400">
          Nothing matches “{needle}”.
        </p>
      ) : (
        <div ref={listRef} className="flex flex-col gap-1.5">
          {shown.map((template, position) => (
            <button
              key={template.id}
              data-active={position === index}
              onClick={() => onPick(template.spec)}
              // The mouse moves the same selection the arrows do, rather than
              // lighting up a second one: two highlights at once and Enter
              // becomes a guess.
              onMouseMove={() => setActive(position)}
              className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition ${
                position === index
                  ? 'border-brand-600 bg-brand-600/5'
                  : 'border-ink-200 dark:border-ink-700'
              }`}
            >
              {template.logo ? (
                <img src={template.logo} alt="" aria-hidden className="h-7 w-7 shrink-0" />
              ) : (
                <Monogram name={template.name} />
              )}

              <div className="min-w-0">
                <p className="text-sm font-semibold">{template.name}</p>
                <p className="break-words text-xs leading-relaxed text-ink-600 dark:text-ink-400">
                  {template.summary}
                </p>
                {/* Only what is still theirs to deal with, and only when there
                    is any: a port two templates both want, an image far larger
                    than its neighbours. Most have none. */}
                {template.caveat && (
                  <p className="mt-1 break-words text-tiny leading-relaxed text-amber-700 dark:text-amber-500">
                    {template.caveat}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
