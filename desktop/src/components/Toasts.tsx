import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useToastStore } from '../store/toastStore';

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const Icon = toast.tone === 'error' ? TriangleAlert : CircleCheck;

        return (
          <button
            key={toast.id}
            onClick={() => {
              toast.onClick?.();
              dismiss(toast.id);
            }}
            title={toast.onClick ? 'Open the output' : 'Dismiss'}
            className={`pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-md px-4 py-3 text-left text-sm text-white shadow-panel ${
              toast.tone === 'error' ? 'bg-orange-700' : 'bg-ink-800'
            } ${toast.onClick ? 'hover:brightness-110' : ''}`}
          >
            <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
            {/*
              min-w-0 and wrap-break-word together: what goes wrong here is often
              named by an image reference, and a registry path with a digest for
              a tag is one unbroken run far wider than this box. Without the
              first it refuses to be narrowed; without the second it refuses to
              be split -- either way it is drawn out past the rounded corner.
            */}
            <span className="min-w-0 wrap-break-word">
              {toast.message}
              {/* Said out loud, because a box that can be pressed and a box
                  that only goes away look identical at this size. */}
              {toast.onClick && (
                <span className="mt-0.5 block text-tiny text-white/70">Click to see why</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
