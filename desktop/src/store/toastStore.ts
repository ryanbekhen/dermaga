import { create } from 'zustand';

export type ToastTone = 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  /**
   * Where the toast leads, when it is about something with more to say.
   *
   * A build that failed is the case this exists for: the whole of what went
   * wrong is in its output, up in the title bar, and a corner of the screen is
   * not the place to print it. So the toast is the notice and the way in --
   * click it and the output opens.
   */
  onClick?: () => void;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: ToastTone, onClick?: () => void) => void;
  dismiss: (id: number) => void;
}

/**
 * How long each kind stays.
 *
 * A success is a receipt for something the reader just did, and they are
 * already looking at the result of it -- four seconds is longer than they need.
 * A failure is news they did not ask for and may not be looking for, so it is
 * given long enough to be noticed from the other side of the screen and read.
 */
const life: Record<ToastTone, number> = { success: 4000, error: 10000 };

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'success', onClick) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, message, tone, onClick }] }));
    setTimeout(
      () => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
      life[tone]
    );
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
