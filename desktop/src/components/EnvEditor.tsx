import { useMemo, useRef } from 'react';

/**
 * Environment variables as a .env file.
 *
 * Pasting a dozen variables into a list of key/value rows is miserable, and a
 * .env file is what people already have. Colouring is drawn on a layer behind
 * a transparent textarea: the two share the same font and metrics, so the text
 * lines up exactly while editing stays a plain textarea with all its native
 * behaviour intact.
 */
export function EnvEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const highlight = useRef<HTMLPreElement>(null);

  const painted = useMemo(() => paint(value), [value]);

  return (
    <div className="relative w-full overflow-hidden rounded-md border border-ink-300 bg-ink-50 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/20 dark:border-ink-700 dark:bg-ink-950">
      <pre
        ref={highlight}
        aria-hidden
        className="pointer-events-none m-0 min-h-40 overflow-hidden whitespace-pre-wrap wrap-break-word p-2.5 font-mono text-xs leading-relaxed"
      >
        {painted}
        {/* A trailing newline keeps the last line visible while typing. */}
        {'\n'}
      </pre>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (highlight.current) highlight.current.scrollTop = e.currentTarget.scrollTop;
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Environment variables"
        placeholder={'# One per line\nDATABASE_URL=postgres://localhost/app\nLOG_LEVEL=debug'}
        className="absolute inset-0 h-full w-full resize-none whitespace-pre-wrap wrap-break-word bg-transparent p-2.5 font-mono text-xs leading-relaxed text-transparent caret-brand-600 outline-hidden placeholder:text-ink-500"
      />
    </div>
  );
}

/** Splits each line into the parts worth colouring differently. */
function paint(text: string) {
  return text.split('\n').map((line, index) => {
    const key = `${index}`;

    if (!line.trim()) return <span key={key}>{'\n'}</span>;

    // Comments win over everything: a # at the start makes the line inert.
    if (line.trimStart().startsWith('#')) {
      return (
        <span key={key} className="text-emerald-700 italic dark:text-emerald-500/80">
          {line}
          {'\n'}
        </span>
      );
    }

    const at = line.indexOf('=');

    // A line with no `=` is not a variable; showing it as wrong is the point.
    if (at === -1) {
      return (
        <span key={key} className="text-brand-600 underline decoration-wavy dark:text-brand-400">
          {line}
          {'\n'}
        </span>
      );
    }

    const name = line.slice(0, at);
    const value = line.slice(at + 1);
    const quoted = /^\s*(".*"|'.*')\s*$/.test(value);

    return (
      <span key={key}>
        <span className="font-semibold text-sky-700 dark:text-sky-400">{name}</span>
        <span className="text-ink-500">=</span>
        <span
          className={
            quoted ? 'text-amber-700 dark:text-amber-500' : 'text-ink-800 dark:text-ink-200'
          }
        >
          {value}
        </span>
        {'\n'}
      </span>
    );
  });
}

/** `.env` text to the KEY=value list the runtime wants. */
export function parseEnv(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const at = line.indexOf('=');
      const name = line.slice(0, at).trim();
      let value = line.slice(at + 1).trim();

      // Quotes are how a .env file protects spaces; the runtime does not want
      // them as part of the value.
      if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);

      return `${name}=${value}`;
    });
}

export function formatEnv(entries: string[]): string {
  return entries.join('\n');
}
