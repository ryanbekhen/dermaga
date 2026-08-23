import { useEffect, useRef, useState } from 'react';
import { Ban, CircleAlert, CircleCheck, ListChecks, Loader2, ScrollText, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Modal } from './form';
import { cancelTask, dismissTask } from '../services/tasks';
import { useTaskStore } from '../store/taskStore';

/** One verb in a row, drawn as its icon and named in its tooltip. */
function RowAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-md p-1 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 dark:hover:bg-ink-800 dark:hover:text-ink-100"
    >
      <Icon size={13} aria-hidden />
    </button>
  );
}

/** What the icon is about, in words, for the tooltip and for a screen reader. */
function summarise(running: number, failed: number, total: number): string {
  const parts = [];

  if (running > 0) parts.push(`${running} running`);
  if (failed > 0) parts.push(`${failed} failed`);

  const done = total - running - failed;
  if (done > 0) parts.push(`${done} finished`);

  return parts.join(', ') || 'Nothing running';
}

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
 * doing, but that there is one. An icon and nothing else, which is the whole of
 * what it has to say from across the window.
 *
 * What has finished stays until it is put away. A build's output is the only
 * record of how an image was made, and it used to be thrown away at the moment
 * the build succeeded -- so the one log worth keeping was the one that never
 * survived.
 *
 * A count would be a number to read; the colour is not. Anything failed turns
 * it red, because that is the state nobody should have to open a panel to
 * discover.
 */
export function TaskStatusItem() {
  const tasks = useTaskStore((s) => s.tasks);
  const [open, setOpen] = useState(false);
  const inspectingId = useTaskStore((s) => s.inspecting);
  const inspect = useTaskStore((s) => s.inspect);
  const inspecting = tasks.find((task) => task.id === inspectingId) ?? null;
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

  // Always here, even with nothing to report. It used to appear the moment a
  // build started and vanish when the last one was dismissed -- and a control
  // that comes and goes moves everything beside it, including the search field
  // in the middle of the bar. Somewhere to look is worth more than the pixels
  // saved by not being there; opened with nothing on it, it says so.
  const failed = tasks.filter((task) => task.status === 'failed');
  const running = tasks.filter((task) => task.status === 'running').length;
  // Anything that has stopped, either way. Running work is not something to
  // put away -- it is still arriving.
  const finished = tasks.filter((task) => task.status !== 'running');

  const details = inspecting && (
    <Modal
      wide
      title={inspecting.status === 'failed' ? `${inspecting.label} failed` : inspecting.label}
      subtitle={
        inspecting.status === 'failed'
          ? inspecting.error
          : 'Everything the command printed, from the top.'
      }
      onClose={() => inspect(null)}
      footer={
        <button onClick={() => inspect(null)} className="btn-ghost">
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

  return (
    <div ref={wrapper} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={summarise(running, failed.length, tasks.length)}
        title={summarise(running, failed.length, tasks.length)}
        className={`no-drag flex items-center rounded-md px-1.5 py-1 transition-colors hover:bg-chrome-raised ${
          failed.length > 0 ? 'text-brand-400' : 'text-chrome-muted'
        } ${tasks.length === 0 ? 'text-chrome-faint' : ''}`}
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
        ) : failed.length > 0 ? (
          <CircleAlert size={13} aria-hidden />
        ) : tasks.length > 0 ? (
          // Nothing running and nothing wrong: what is left is finished work
          // waiting to be read or put away.
          <CircleCheck size={13} aria-hidden />
        ) : (
          // Nothing at all. The same glyph the list uses for work, dimmed --
          // this is where work appears, and it should look like the same place
          // whether or not there is any.
          <ListChecks size={13} aria-hidden />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Work in progress"
          className="no-drag absolute right-0 top-full z-40 mt-2 w-[26rem] rounded-xl border border-ink-200 bg-white p-2 text-left text-ink-900 shadow-panel dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
        >
          {tasks.length === 0 && (
            <p className="px-2 py-3 text-center text-small text-ink-600 dark:text-ink-400">
              Nothing running, and nothing left to read.
            </p>
          )}

          <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto overscroll-contain">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
                {task.status === 'failed' ? (
                  <CircleAlert
                    size={13}
                    className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400"
                    aria-hidden
                  />
                ) : task.status === 'done' ? (
                  <CircleCheck
                    size={13}
                    className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-500"
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

                {/* Icons, with their words as the tooltip, like every other
                    row of actions in this window. Three verbs written out beside
                    a name made the name the smallest thing in its own row. */}
                <div className="flex shrink-0 items-center gap-0.5">
                  {task.status === 'running' ? (
                    // Called off, not failed. Whatever it was doing stops the
                    // way Ctrl-C would stop the same command in a terminal.
                    <RowAction
                      icon={Ban}
                      label={`Cancel ${task.label}`}
                      onClick={() => cancelTask(task.id)}
                    />
                  ) : (
                    <>
                      {/* Kept for a failure whose one-line summary does not
                          explain itself -- and for a build that worked, where
                          the output is the only record of how it was made. */}
                      <RowAction
                        icon={ScrollText}
                        label={`Output of ${task.label}`}
                        onClick={() => {
                          inspect(task.id);
                          setOpen(false);
                        }}
                      />
                      <RowAction
                        icon={X}
                        label={`Dismiss ${task.label}`}
                        onClick={() => dismissTask(task.id)}
                      />
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* Under the list rather than in the row of icons above it: it is
              about all of them, and a button that clears everything should not
              sit a few pixels from one that clears a single line. Only when
              there is more than one thing to clear -- for one, the row's own
              icon is nearer and says which. */}
          {finished.length > 1 && (
            <div className="mt-1 border-t border-ink-150 pt-1 dark:border-ink-800">
              <button
                onClick={() => finished.forEach((task) => dismissTask(task.id))}
                className="w-full rounded-lg px-2 py-1.5 text-small text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100"
              >
                Dismiss all {finished.length}
              </button>
            </div>
          )}
        </div>
      )}

      {details}
    </div>
  );
}
