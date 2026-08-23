import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The last thing between a bug and a white window.
 *
 * React unmounts the whole tree when a render throws, and with nothing to catch
 * it the window goes blank: no message, no stack, nothing to report but the
 * colour. That is the worst possible failure in an app with no browser console
 * behind it — the window is WebKit, not a browser, and there is no inspector to
 * open.
 *
 * So the error is caught and shown. Not to recover from — the tree that threw
 * is gone — but so that what went wrong is on screen and can be said out loud.
 */
interface State {
  error: Error | null;
  where: string;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, where: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept as well as shown: the stack is what says which component, and it is
    // easier to copy from the log than from a panel.
    console.error('Dermaga stopped drawing:', error, info.componentStack);

    this.setState({ where: info.componentStack ?? '' });
  }

  render() {
    const { error, where } = this.state;

    if (!error) return this.props.children;

    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-50 p-8 dark:bg-ink-950">
        <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-xl border border-ink-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900">
          <div>
            <h1 className="text-base font-semibold">Dermaga stopped drawing</h1>
            <p className="pt-1 text-sm text-ink-600 dark:text-ink-400">
              Something threw while the window was being drawn. Nothing on this Mac has changed —
              the containers, images and tunnels are all still where they were.
            </p>
          </div>

          <div className="min-h-0 overflow-auto rounded-lg border border-ink-150 bg-ink-50 p-3 dark:border-ink-800 dark:bg-ink-950">
            <p className="selectable font-mono text-xs text-brand-700 dark:text-brand-400">
              {error.message || String(error)}
            </p>

            {where && (
              <pre className="selectable pt-2 font-mono text-tiny whitespace-pre-wrap text-ink-500">
                {where.trim().split('\n').slice(0, 8).join('\n')}
              </pre>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => window.location.reload()} className="btn-primary">
              Reload the window
            </button>
            <span className="text-tiny text-ink-500">
              The text above is the whole of what went wrong; it is worth copying.
            </span>
          </div>
        </div>
      </div>
    );
  }
}
