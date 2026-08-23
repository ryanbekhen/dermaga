import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';
import { Modal } from './form';
import { cancelTask } from '../services/tasks';
import { useTaskStore, type Task } from '../store/taskStore';

/**
 * What Dermaga is doing, along the title bar.
 *
 * The rows above each list stay: a build's row becomes the image it built, in
 * the same list, which is a continuity no panel can give. But they are only
 * visible from the page they belong to, and a build takes minutes -- long
 * enough to have gone somewhere else. Worse for a failure, which sits on its
 * page waiting to be dismissed by somebody who may not go back that way today.
 *
 * So this is the same information at the other range: not what a task is
 * doing, but that there is one. An icon and nothing else -- it appears while
 * there is work and goes when there is none, which is the whole of what it has
 * to say from across the window.
 *
 * A count would be a number to read; the colour is not. Anything failed turns
 * it red, because that is the state nobody should have to open a panel to
 * discover.
 */
export function TaskStatusItem() {
  const tasks = useTaskStore((s) => s.tasks);
  const dismiss = useTaskStore((s) => s.dismiss);
  const [open, setOpen] = useState(false);
  const [inspecting, setInspecting] = useState<Task | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const away = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);

    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Nothing to say, so nothing there. A control that is permanently present
  // and permanently idle is furniture.
  // The output of a failure outlives the popover: dismissing the list should
  // not take the reason with it.
  if (tasks.length === 0 && !inspecting) return null;

  const failed = tasks.filter((task) => task.status === 'failed');
  const running = tasks.length - failed.length;

  const details = inspecting && (
    <Modal
      wide
      title={`${inspecting.label} failed`}
      subtitle={inspecting.error}
      onClose={() => setInspecting(null)}
      footer={
        <button onClick={() => setInspecting(null)} className="btn-ghost">
          Close
        </button>
      }
    >
      <div className="selectable max-h-96 overflow-auto rounded-md border border-ink-200 bg-ink-50 p-3 font-mono text-tiny leading-relaxed dark:border-ink-700 dark:bg-ink-950">
        {inspecting.lines.length === 0 ? (
          <p className="text-ink-500">The command produced no output.</p>
        ) : (
          inspecting.lines.map((line, index) => (
            <p key={index} className="whitespace-pre-wrap break-all">
              {line}
            </p>
          ))
        )}
      </div>
    </Modal>
  );

  if (tasks.length === 0) return details;

  return (
    <div ref={wrapper} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={
          failed.length > 0 ? `${failed.length} failed, ${running} running` : `${running} running`
        }
        title={failed.length > 0 ? `${failed.length} failed` : `${running} running`}
        className={`no-drag flex items-center rounded-md px-1.5 py-1 transition-colors hover:bg-chrome-raised ${
          failed.length > 0 ? 'text-brand-400' : 'text-chrome-muted'
        }`}
      >
        {/* Turning is what the icon says while anything is turning, even with
            a failure sitting unread beside it. A failure that has already
            happened is not going to change; the thing somebody needs to know
            from across the window is that work is under way -- and a still
            icon there says the opposite.

            Neither fact is lost: the spinner wears the failure's colour, so
            "something is running, and something went wrong" is one glance. */}
        {running > 0 ? (
          <Loader2 size={13} className="animate-spin" aria-hidden />
        ) : (
          <CircleAlert size={13} aria-hidden />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Work in progress"
          className="no-drag absolute right-0 top-full z-40 mt-2 w-[26rem] rounded-xl border border-ink-200 bg-white p-2 text-left text-ink-900 shadow-panel dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
        >
          <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
                {task.status === 'failed' ? (
                  <CircleAlert
                    size={13}
                    className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400"
                    aria-hidden
                  />
                ) : (
                  <Loader2
                    size={13}
                    className="mt-0.5 shrink-0 animate-spin text-ink-500"
                    aria-hidden
                  />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-small font-medium">{task.label}</p>

                  <p
                    className={`truncate text-tiny ${
                      task.status === 'failed'
                        ? 'text-brand-600 dark:text-brand-400'
                        : 'text-ink-600 dark:text-ink-400'
                    }`}
                  >
                    {task.status === 'failed' ? (task.error ?? 'Failed') : task.step || 'Working…'}
                    {/* The counted part, where the CLI gives one: a build says
                        which step of how many, a pull how many layers are
                        down. "Fetching image" alone answers what it is doing
                        and not how much of it is left. */}
                    {task.status === 'running' && task.total
                      ? ` · ${task.current ?? 0}/${task.total}`
                      : ''}
                  </p>

                  {task.status === 'running' && (
                    // Determinate when the numbers are known, and a pulse when
                    // they are not -- rather than a bar sitting at zero, which
                    // reads as stuck.
                    <div className="mt-1 h-0.75 w-full overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
                      <div
                        className={`h-full rounded-full bg-brand-600 transition-[width] duration-300 ${
                          task.total ? '' : 'w-1/3 animate-pulse'
                        }`}
                        style={
                          task.total
                            ? { width: `${Math.round(((task.current ?? 0) / task.total) * 100)}%` }
                            : undefined
                        }
                      />
                    </div>
                  )}
                </div>

                {/* Only a failure can be put away. Something still running
                    goes when it is done, and a button that pretended to stop
                    it here would be lying about what it did. */}
                {/* Called off, not failed. Whatever it was doing stops the
                    way Ctrl-C would stop the same command in a terminal. */}
                {task.status === 'running' && (
                  <button
                    onClick={() => cancelTask(task.id)}
                    className="shrink-0 text-tiny text-ink-500 hover:text-brand-700 hover:underline dark:hover:text-brand-400"
                  >
                    Cancel
                  </button>
                )}

                {task.status === 'failed' && (
                  <div className="flex shrink-0 items-center gap-2">
                    {/* The output is kept for exactly this: a failure whose
                        one-line summary does not explain itself. */}
                    <button
                      onClick={() => {
                        setInspecting(task);
                        setOpen(false);
                      }}
                      className="text-tiny text-brand-700 hover:underline dark:text-brand-400"
                    >
                      Output
                    </button>
                    <button
                      onClick={() => dismiss(task.id)}
                      className="text-tiny text-ink-500 hover:underline"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {details}
    </div>
  );
}
