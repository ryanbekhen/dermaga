import { api } from './api';
import { onAnnouncement, openStream } from './ipc';
import { useTaskStore, type TaskKind } from '../store/taskStore';
import { useToastStore } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';
import type { Container } from '../types';
import { shortImage } from '../utils/format';

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
 * Hands a finished command's output to the agent to keep.
 *
 * At the end rather than as it arrives: it is a megabyte at the very worst,
 * once, over a socket on this machine -- and it leaves one idea of what a task
 * is instead of two halves to keep in step while lines are still coming.
 *
 * Failing to keep it is not worth telling anybody about. The output is still on
 * screen, which is what somebody is looking at; all that is lost is reading it
 * back tomorrow.
 */
function shelve(id: string) {
  const task = useTaskStore.getState().tasks.find((t) => t.id === id);
  if (!task || task.status === 'running') return;

  void api
    .recordTask({
      id: task.id,
      streamId: task.streamId,
      kind: task.kind,
      label: task.label,
      status: task.status,
      error: task.error,
      lines: task.lines,
      at: new Date().toISOString(),
    })
    .catch(() => {});
}

/**
 * Puts what Dermaga has to say into the corner, when the reader is here to see
 * it.
 *
 * Which channel a piece of news goes down -- a toast here, or a notification
 * from macOS -- is decided on the other side, by whether this window has the
 * focus. So this never has to ask, and the two can never both fire.
 *
 * Pressing it opens whatever the news was about: the container that stopped, or
 * what the finished command printed. The same door its notification opens.
 */
export function watchAnnouncements(): () => void {
  return onAnnouncement(({ title, body, failed, container, task }) => {
    const open = container
      ? () => useUIStore.getState().openContainer(container)
      : task
        ? () => useTaskStore.getState().inspect(task)
        : undefined;

    useToastStore
      .getState()
      .push(failed && body ? `${title} — ${body}` : title, failed ? 'error' : 'success', open);
  });
}

/**
 * Reads back what earlier runs left, so a build's log survives the window.
 */
export async function restoreTasks() {
  try {
    const kept = await api.recentTasks();

    useTaskStore.getState().restore(
      kept.map((record) => ({
        id: record.id,
        streamId: record.streamId,
        kind: record.kind,
        label: record.label,
        step: record.status === 'failed' ? 'Failed' : 'Done',
        lines: record.lines,
        status: record.status,
        error: record.error,
      }))
    );
  } catch {
    // Nothing kept, or nothing answering. The list is simply what this run has
    // done, which is what it was before any of this.
  }
}

/**
 * Puts a finished task away, here and on the shelf.
 *
 * Both, or dismissing it would only hide it until the next launch brought it
 * back.
 */
export function dismissTask(id: string) {
  useTaskStore.getState().dismiss(id);
  void api.forgetTask(id).catch(() => {});
}

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
  const { start, append, fail, finish, name } = useTaskStore.getState();
  start({ id, kind, label });

  try {
    const close = await openStream(method, params, {
      onStart: (streamId) => name(id, streamId),
      onData: (line) => append(id, line),
      onEnd: (error) => {
        closers.delete(id);

        // The exit status, and nothing else.
        //
        // The output used to be searched as well, for "ERROR:" and buildkit's
        // "failed to solve", on the theory that a command might fail while
        // exiting zero. It does not: `container build` answers 1 when a step
        // fails. What the search did instead was invent failures -- a build
        // that succeeds while apt or npm prints the word ERROR was reported as
        // broken next to the image it had just produced.
        if (error) {
          fail(id, explain(error).trim().slice(0, 160));
        } else {
          finish(id);
        }

        shelve(id);
        onDone?.(Boolean(error));
      },
    });

    closers.set(id, close);
  } catch (err) {
    closers.delete(id);
    fail(id, err instanceof Error ? err.message : 'Could not reach the Dermaga agent');
    shelve(id);
    onDone?.(true);
  }
}

/**
 * The container again, on the image its tag means now.
 *
 * A task rather than a spinner on whatever was clicked: recreating deletes the
 * container and makes another, so for a second or two the row -- or the whole
 * detail page -- that started this is not on screen to spin. The task strip
 * outlives both, which is also where a failure has somewhere to be read.
 *
 * The stores are reached through getState rather than through hooks, because
 * this is called from an event handler and not from a render.
 */
export async function recreateContainer(container: Container) {
  const id = `container:${container.name}`;
  const { start, fail, finish } = useTaskStore.getState();
  const toast = useToastStore.getState().push;

  start({ id, kind: 'container', label: container.name, step: 'Recreating…' });

  try {
    await api.recreateContainer(container.id);
    toast(`Recreated ${container.name} on the newer ${shortImage(container.image)}`);
    finish(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : `Could not recreate ${container.name}`;
    fail(id, message);
    toast(message, 'error');
  }
}
