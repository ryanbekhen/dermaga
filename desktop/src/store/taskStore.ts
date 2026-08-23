import { create } from 'zustand';

export type TaskKind = 'image' | 'machine' | 'container';
export type TaskStatus = 'running' | 'failed' | 'done';

export interface Task {
  id: string;
  kind: TaskKind;
  /** What is being created or pulled, shown as the row's name. */
  label: string;
  /** The CLI's current step, e.g. "Fetching image". */
  step: string;
  current?: number;
  total?: number;
  /** Everything it printed, kept for the details dialog. */
  lines: string[];
  /**
   * What the agent calls this run, when it is one the agent is streaming.
   *
   * Two names for one thing, and both are needed: the window files a task
   * under something a person would recognise, so that starting the same build
   * twice replaces the row rather than stacking it -- and the agent knows only
   * its own `build-7`, which is what comes back on a notification raised from
   * that side.
   */
  streamId?: string;
  status: TaskStatus;
  error?: string;
}

interface TaskState {
  tasks: Task[];
  /**
   * The task whose output is open, if any.
   *
   * Here rather than inside the panel that draws it, because the panel is not
   * the only way in any more: a failure raises a toast in the corner, and
   * clicking that has to be able to open the same window.
   */
  inspecting: string | null;
  /** Takes either name: the window's own, or the agent's. */
  inspect: (id: string | null) => void;
  /** Notes the agent's name for a run once it has one. */
  name: (id: string, streamId: string) => void;
  /** Fills the list from what the agent kept of earlier runs. */
  restore: (tasks: Task[]) => void;
  start: (task: Pick<Task, 'id' | 'kind' | 'label'> & { step?: string }) => void;
  append: (id: string, line: string) => void;
  fail: (id: string, error: string) => void;
  finish: (id: string) => void;
  dismiss: (id: string) => void;
}

// `[2/6] Unpacking image [4s]` -- the shape every streaming CLI command uses.
const STEP = /^\[(\d+)\/(\d+)\]\s*(.*?)\s*(?:\[\d+m?s\])?$/;

// How much of a command's output is kept.
//
// It was the last five hundred lines, which is the wrong end of a build: what
// went wrong is usually said once, near the step that did it, and a long build
// pushes that off the top long before it finishes. Twenty thousand lines is
// more than any build here produces and still only a couple of megabytes -- a
// ceiling against a runaway loop rather than a budget.
const maxLines = 20000;

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  inspecting: null,
  inspect: (id) =>
    set((state) => ({
      inspecting:
        id === null ? null : (state.tasks.find((t) => t.id === id || t.streamId === id)?.id ?? id),
    })),
  name: (id, streamId) =>
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, streamId } : task)),
    })),

  // Put in front of nothing, at startup, and never over live work: a command
  // that is running now is the window's own and knows more than the shelf does.
  restore: (restored) =>
    set((state) => ({
      // Underneath, and in the order the agent kept them, which is newest
      // first: everything from an earlier run is older than anything this one
      // has started.
      tasks: [
        ...state.tasks,
        ...restored.filter((task) => !state.tasks.some((t) => t.id === task.id)),
      ],
    })),

  // Newest first. The list is read from the top, and what somebody wants from
  // it is nearly always the thing they started a moment ago -- which was at the
  // bottom, under everything they had already finished with.
  start: ({ id, kind, label, step = 'Starting…' }) =>
    set((state) => ({
      tasks: [
        { id, kind, label, step, lines: [], status: 'running' },
        ...state.tasks.filter((t) => t.id !== id),
      ],
    })),

  append: (id, line) =>
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== id) return task;

        const lines = [...task.lines, line].slice(-maxLines);
        const match = STEP.exec(line.trim());

        if (!match) {
          // Not a step line; keep it as the status only if nothing better.
          return { ...task, lines, step: line.trim() || task.step };
        }

        return {
          ...task,
          lines,
          current: Number(match[1]),
          total: Number(match[2]),
          step: match[3] || task.step,
        };
      }),
    })),

  fail: (id, error) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, status: 'failed', error } : task
      ),
    })),

  // A finished build stays until it is put away. It used to vanish the moment
  // it worked, on the grounds that the image appearing in the list said so --
  // but the output is the only record of *how* it was built, and it was being
  // thrown away at the exact moment somebody might want to read it back.
  finish: (id) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, status: 'done', step: 'Done' } : task
      ),
    })),
  dismiss: (id) => set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) })),
}));
