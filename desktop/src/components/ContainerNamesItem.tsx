import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, TriangleAlert } from 'lucide-react';
import { Button } from './Button';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { registerContainerNames } from '../services/ipc';
import { useToastStore } from '../store/toastStore';
import { isBuilder } from '../utils/builder';

/**
 * A warning in the status bar while containers cannot find each other by name.
 *
 * Two halves make it work. Dermaga writes the first itself, into the runtime's
 * own configuration, without asking anybody: a machine where containers cannot
 * reach each other by name is not somebody's preference. The second is a
 * resolver file under /etc/resolver, which belongs to root — so it waits here
 * until somebody says yes.
 *
 * It is checked rather than remembered. The entry can go away without Dermaga
 * doing anything, and a setup that is assumed done is one nobody notices has
 * come undone.
 */
export function ContainerNamesItem() {
  const [state, setState] = useState<{ domain: string; registered: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const pushToast = useToastStore((s) => s.push);
  // A container's DNS is fixed when it is created. Restarting one does not
  // change it and only recreating does, so these are the ones that will not
  // answer to a name however long they run.
  const containers = useResourceStore((s) => s.containers);

  const check = useCallback(() => {
    void api
      .getContainerNames()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  useEffect(check, [check]);

  useEffect(() => {
    if (!open) return;

    const dismiss = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);

    window.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const behind = state
    ? containers.filter(
        (container) =>
          (container.dns?.domain ?? '') !== state.domain &&
          // Apple's builder is not somebody's container. `container build`
          // makes it, and recreating it only produces another one exactly like
          // it -- so naming it here would be asking for work with no result.
          !isBuilder(container)
      )
    : [];

  // Nothing to say while it works and everything answers to a name, or while
  // the question cannot be answered at all.
  if (!state) return null;
  if (state.registered && behind.length === 0) return null;

  const setUp = async () => {
    setBusy(true);
    try {
      await registerContainerNames();
      check();
      setOpen(false);
      pushToast(`New containers can now reach each other as <name>.${state.domain}`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Saying no is an answer, not a failure worth a red toast.
      if (!message.includes('cancelled')) pushToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapper} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-amber-700 hover:underline dark:text-amber-500"
      >
        <TriangleAlert size={12} aria-hidden />
        {state.registered ? `${behind.length} without a name` : 'Container names are off'}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-80 rounded-lg border border-ink-200 bg-white p-3 shadow-panel dark:border-ink-700 dark:bg-ink-900">
          <p className="flex items-center gap-1.5 break-words text-xs font-semibold">
            <Globe size={13} aria-hidden />
            {state.registered ? 'Container names are on' : 'Let containers find each other by name'}
          </p>

          <p className="mt-1.5 break-words text-tiny leading-relaxed text-ink-600 dark:text-ink-400">
            One container can reach another as{' '}
            <span className="font-mono">&lt;name&gt;.{state.domain}</span> instead of by an address
            that changes every time it is recreated.
          </p>

          {!state.registered && (
            <>
              <p className="mt-1.5 break-words text-tiny leading-relaxed text-ink-600 dark:text-ink-400">
                macOS has to be told to send those names to the container runtime, and only an
                administrator can tell it. Your Mac will ask — the password goes to macOS, never to
                Dermaga.
              </p>

              <div className="mt-2.5">
                <Button
                  icon={Globe}
                  busy={busy}
                  busyLabel="Waiting for macOS…"
                  onClick={() => void setUp()}
                >
                  Set it up
                </Button>
              </div>
            </>
          )}

          {behind.length > 0 && (
            // Not offered as a button on purpose. Recreating a container keeps
            // its volumes and loses its filesystem, which is a decision to put
            // in front of somebody rather than take for them.
            <div className="mt-2.5 rounded-md border border-amber-600/40 bg-amber-600/5 p-2">
              <p className="break-words text-tiny leading-relaxed text-ink-700 dark:text-ink-300">
                {behind.length === 1
                  ? 'One container was created before this and will not answer to a name:'
                  : `${behind.length} containers were created before this and will not answer to a name:`}
              </p>
              <p className="mt-1 break-words font-mono text-tiny text-ink-600 dark:text-ink-400">
                {behind.map((container) => container.name).join(', ')}
              </p>
              <p className="mt-1.5 break-words text-tiny leading-relaxed text-ink-600 dark:text-ink-400">
                A container's DNS is set when it is created, so restarting one does not help.
                Recreate it — editing and saving does — and it keeps its volumes.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
