import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { openStream } from '../services/ipc';

type State = 'idle' | 'running' | 'done' | 'failed';

/**
 * Runs a streaming agent method and reports it inline: the latest line while it
 * works, the failure if it fails. Used where the work belongs to the screen
 * you are on rather than to a list -- installing or updating the CLI.
 */
export function useCommandProgress(method: string) {
  const [state, setState] = useState<State>('idle');
  const [line, setLine] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = async (onDone?: (failed: boolean) => void) => {
    setState('running');
    setError(null);
    setLine('');

    const lines: string[] = [];

    try {
      await openStream(method, undefined, {
        onData: (chunk) => {
          lines.push(chunk);
          // Homebrew's progress lines are noisy; the last one is the useful one.
          if (chunk.trim()) setLine(chunk.trim());
        },
        onEnd: (streamError) => {
          const problem = streamError ?? lines.find((l) => /^error|failed|cannot/i.test(l.trim()));

          if (problem) {
            setState('failed');
            setError(problem.trim().slice(0, 200));
            onDone?.(true);
          } else {
            setState('done');
            onDone?.(false);
          }
        },
      });
    } catch (err) {
      setState('failed');
      setError(err instanceof Error ? err.message : 'Could not reach the Dermaga agent');
      onDone?.(true);
    }
  };

  return { state, line, error, run };
}

export function CommandProgress({ state, line, error }: ReturnType<typeof useCommandProgress>) {
  if (state === 'idle') return null;

  if (state === 'failed') {
    return (
      <p className="max-w-md wrap-break-word text-tiny leading-relaxed text-brand-600 dark:text-brand-400">
        {error}
      </p>
    );
  }

  if (state === 'done') {
    return <p className="text-tiny text-ink-600 dark:text-ink-400">Finished.</p>;
  }

  return (
    <p className="flex max-w-md items-center gap-2 text-tiny text-ink-600 dark:text-ink-400">
      <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden />
      <span className="truncate font-mono">{line || 'Working…'}</span>
    </p>
  );
}
