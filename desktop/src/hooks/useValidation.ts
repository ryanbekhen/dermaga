import { useCallback, useRef, useState } from 'react';

/** What is wrong with each field, keyed by the name the field carries. */
export type Problems = Record<string, string | null | undefined>;

/**
 * When a form is allowed to complain, and where the caret goes when it does.
 *
 * The rules themselves are pure functions in `utils/validate`; this is only
 * about timing, which is the part that decides whether validation helps or
 * nags. Nothing is said about a field until it has been left -- typing `80`
 * into a port passes through `8`, and a form that objects to every prefix is a
 * form somebody types with gritted teeth.
 *
 * A submit reveals everything at once. That is the moment the reader has said
 * they are finished, and the moment they are owed an answer: the button is
 * disabled while anything is wrong, and a disabled button that never says why
 * is the complaint this whole thing exists to answer. `⌘↩` still reaches it,
 * and lands on the first field that needs attention.
 */
export function useValidation(problems: Problems) {
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState(false);
  const panel = useRef<HTMLElement | null>(null);

  const valid = Object.values(problems).every((problem) => !problem);

  /** The message for one field, or nothing while it is too early to say. */
  const problem = (name: string): string | undefined =>
    revealed || touched.has(name) ? (problems[name] ?? undefined) : undefined;

  /** Marks a field as left, which is when it may start answering back. */
  const touch = useCallback((name: string) => {
    setTouched((current) => (current.has(name) ? current : new Set(current).add(name)));
  }, []);

  /**
   * Everything a field needs to take part: its name, and the blur that starts
   * it answering. Spread onto the `Field`, which passes the blur down to the
   * control inside it.
   */
  const field = (name: string) => ({
    name,
    error: problem(name),
    onBlur: () => touch(name),
  });

  /**
   * Runs the action, or says why it cannot.
   *
   * The first field in the document that has something wrong takes the caret --
   * document order rather than the order the problems happen to be listed in,
   * because the reader is looking at a form, not at an object.
   */
  const attempt = (run: () => void) => {
    if (valid) {
      run();
      return;
    }

    setRevealed(true);

    // After the paint that reveals them, so the field being focused is already
    // showing the reason it was chosen.
    requestAnimationFrame(() => {
      const root = panel.current ?? document;
      for (const group of root.querySelectorAll<HTMLElement>('[data-field]')) {
        const name = group.dataset.field;
        if (!name || !problems[name]) continue;

        group.querySelector<HTMLElement>('input, textarea, select')?.focus();
        group.scrollIntoView({ block: 'center' });

        return;
      }
    });
  };

  return { valid, problem, touch, field, attempt, panel };
}
