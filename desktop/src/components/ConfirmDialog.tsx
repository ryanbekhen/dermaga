import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/55 p-6"
      onClick={onCancel}
    >
      {/* The same shell every dialog wears, at the size a question needs: a
          head with the question, paper under the explanation, a foot with the
          two answers. It is not built on Modal because it has no scrolling
          body and no close button -- an alert that can be dismissed by a third
          control is an alert with three answers. */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-ink-100 shadow-panel dark:bg-ink-950"
      >
        <div className="border-b border-ink-200 bg-white px-6 pb-4 pt-5 dark:border-ink-800 dark:bg-ink-900">
          <h2 className="text-title font-semibold">{title}</h2>
        </div>

        <p className="px-6 py-5 text-body leading-relaxed text-ink-700 dark:text-ink-300">{body}</p>

        <div className="header-actions flex items-center justify-end gap-2.5 border-t border-ink-200 bg-white px-6 py-3.5 dark:border-ink-800 dark:bg-ink-900">
          <button onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button ref={confirmRef} onClick={onConfirm} className="btn-secondary">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
