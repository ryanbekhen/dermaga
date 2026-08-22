import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { Button } from './Button';
import { CommandProgress, useCommandProgress } from './CommandProgress';
import { api } from '../services/api';
import { useToastStore } from '../store/toastStore';

// What the runtime tells the user to run, and what Dermaga runs on their
// behalf. Shown verbatim so it can be pasted into a terminal and trusted.
const COMMAND = 'container system kernel set --recommended';

/**
 * A warning along the title bar while no Linux kernel is configured.
 *
 * Containers run on a kernel; without one every run fails with an error naming
 * a CLI command. Apple's installer can also hang, in which case Dermaga stops
 * waiting and opens anyway -- so the reminder has to live somewhere permanent,
 * with the command to hand for anyone who would rather do it themselves.
 */
export function KernelStatusItem() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const install = useCommandProgress('system.installKernel');
  const pushToast = useToastStore((s) => s.push);

  const check = useCallback(() => {
    void api
      .getKernel()
      .then(({ configured: value }) => setConfigured(value))
      .catch(() => setConfigured(null));
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

  if (configured !== false) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      pushToast('Could not copy the command', 'error');
    }
  };

  return (
    <div ref={wrapper} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="No Linux kernel is configured"
        className="no-drag flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-amber-500 transition-colors hover:bg-chrome-raised"
      >
        <TriangleAlert size={12} aria-hidden />
        No Linux kernel
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Linux kernel"
          className="absolute right-0 top-full z-40 mt-2 w-96 rounded-xl border border-ink-200 bg-white p-3 text-left text-ink-900 shadow-panel dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
        >
          <p className="text-xs font-semibold">No Linux kernel is configured</p>
          <p className="mt-1 text-tiny leading-relaxed text-ink-600 dark:text-ink-400">
            Containers cannot run until one is installed. Dermaga can do it, or run this yourself —
            Apple&rsquo;s installer downloads it from GitHub and is sometimes slow.
          </p>

          <div className="mt-2 flex items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-2 py-1.5 dark:border-ink-700 dark:bg-ink-950">
            <code className="min-w-0 flex-1 truncate font-mono text-tiny">{COMMAND}</code>
            <button
              onClick={() => void copy()}
              className="btn-icon border-transparent"
              aria-label="Copy command"
            >
              {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
            </button>
          </div>

          <div className="mt-2.5 flex flex-col items-start gap-2">
            <Button
              variant="primary"
              busy={install.state === 'running'}
              busyLabel="Installing…"
              onClick={() =>
                void install.run((failed) => {
                  if (failed) return;
                  pushToast('Linux kernel installed');
                  check();
                })
              }
            >
              Install kernel
            </Button>

            <CommandProgress {...install} />
          </div>
        </div>
      )}
    </div>
  );
}
