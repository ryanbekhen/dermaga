import { openStream } from './ipc';
import { useTaskStore, type TaskKind } from '../store/taskStore';

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
/**
 * How to stop each running task, kept beside the store rather than in it.
 *
 * A closure is not state: it cannot be compared, serialised, or rendered, and
 * putting one in the store would make every task a thing React has to reason
 * about the identity of. The store holds what a task *is*; this holds what to
 * do to it.
 */
const closers = new Map<string, () => void>();

/**
 * Stops a task and takes it off the list.
 *
 * Cancelling kills the command, which is what Ctrl-C in a terminal would do to
 * the same CLI -- a build stops mid-layer, a pull stops mid-blob. The runtime
 * cleans up after itself the same way it would there.
 *
 * The row goes rather than turning red: this did not fail, it was called off,
 * and an error nobody caused is an error nobody should have to dismiss.
 */
export function cancelTask(id: string) {
  closers.get(id)?.();
  closers.delete(id);
  useTaskStore.getState().dismiss(id);
}

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
    const close = await openStream(method, params, {
      onData: (line) => append(id, line),
      onEnd: (error) => {
        closers.delete(id);

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

    closers.set(id, close);
  } catch (err) {
    closers.delete(id);
    fail(id, err instanceof Error ? err.message : 'Could not reach the Dermaga agent');
    onDone?.(true);
  }
}
