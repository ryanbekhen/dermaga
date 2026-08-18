import { useMemo, useState } from 'react';
import { CircleAlert, Loader2, X } from 'lucide-react';
import { Modal } from './form';
import { openStream } from '../services/ipc';
import { useTaskStore, type Task, type TaskKind } from '../store/taskStore';

/**
 * In-flight work shown as rows above the list it will join, rather than as a
 * log in a modal. The output is kept but only surfaces if something fails.
 */
export function TaskRows({ kind }: { kind: TaskKind }) {
  // Select the array itself and narrow it here: a selector that builds a new
  // array on every call gives zustand a fresh snapshot each time, which React
  // treats as an endless update loop.
  const allTasks = useTaskStore((s) => s.tasks);
  const tasks = useMemo(() => allTasks.filter((t) => t.kind === kind), [allTasks, kind]);
  const dismiss = useTaskStore((s) => s.dismiss);
  const [inspecting, setInspecting] = useState<Task | null>(null);

  if (tasks.length === 0) return null;

  return (
    <>
      <ul className="flex flex-col divide-y divide-ink-200 border-b border-ink-200 dark:divide-ink-700 dark:border-ink-700">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3 px-3 py-2">
            {task.status === 'failed' ? (
              <CircleAlert size={14} className="shrink-0 text-brand-600 dark:text-brand-400" />
            ) : (
              <Loader2 size={14} className="shrink-0 animate-spin text-ink-500" />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-semibold">{task.label}</span>
                <span
                  className={`truncate text-tiny ${
                    task.status === 'failed'
                      ? 'text-brand-600 dark:text-brand-400'
                      : 'text-ink-600 dark:text-ink-400'
                  }`}
                >
                  {task.status === 'failed' ? task.error : task.step}
                  {task.status === 'running' && task.total
                    ? ` · ${task.current}/${task.total}`
                    : ''}
                </span>
              </div>

              {task.status === 'running' && (
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

            {task.status === 'failed' && (
              <>
                <button onClick={() => setInspecting(task)} className="btn-ghost">
                  View output
                </button>
                <button
                  onClick={() => dismiss(task.id)}
                  className="btn-icon border-transparent"
                  aria-label="Dismiss"
                >
                  <X size={14} aria-hidden />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {inspecting && (
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
      )}
    </>
  );
}

// Anchored deliberately: "ERROR:" or "Error:" as a word, buildkit's own
// "failed to solve", or a line that begins with either. Anything laxer matches
// ordinary build chatter.
const FAILURE = /(^|\s)(ERROR|Error):\s|(^|\s)failed to solve|^\s*(ERROR|FATAL)\b/;

/**
 * Rewrites the failures whose own wording explains nothing.
 *
 * A registry that speaks plain HTTP answers a TLS handshake with
 * "-9836: bad protocol version", which tells the reader neither what happened
 * nor what to do about it.
 */
function explain(problem: string): string {
  if (/bad protocol version|handshake|SSL|TLS/i.test(problem)) {
    return `${problem} — the registry answered without TLS. Tick "Plain HTTP" if it is running on this machine.`;
  }

  return problem;
}

/**
 * Runs a streaming agent method as a task: progress lands in the list, and the
 * caller never sees a log window unless it fails.
 */
export async function runTask({
  id,
  kind,
  label,
  method,
  params,
  onDone,
}: {
  id: string;
  kind: TaskKind;
  label: string;
  method: string;
  params: unknown;
  onDone?: (failed: boolean) => void;
}) {
  const { start, append, fail, finish } = useTaskStore.getState();
  start({ id, kind, label });

  try {
    await openStream(method, params, {
      onData: (line) => append(id, line),
      onEnd: (error) => {
        const task = useTaskStore.getState().tasks.find((t) => t.id === id);
        // The exit status is the truth. Output is only consulted when the
        // command somehow succeeded while saying it failed -- and then only
        // against anchored markers: a build log is full of the word "error"
        // in package names (liberror-perl) and library paths, and matching
        // those failed builds that had worked perfectly.
        const problem = error ?? task?.lines.find((line) => FAILURE.test(line));

        if (problem) {
          fail(id, explain(problem).trim().slice(0, 160));
          onDone?.(true);
        } else {
          finish(id);
          onDone?.(false);
        }
      },
    });
  } catch (err) {
    fail(id, err instanceof Error ? err.message : 'Could not reach the Dermaga agent');
    onDone?.(true);
  }
}
