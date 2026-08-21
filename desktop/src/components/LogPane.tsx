import { useEffect, useMemo, useRef, useState } from 'react';
import { useLogStream, type StreamStatus } from '../hooks/useLogStream';
import { hasAnsi, parseAnsi, plainAnsi, type AnsiStyle } from '../utils/ansi';

const STATUS_LABEL: Record<StreamStatus, string> = {
  idle: 'idle',
  connecting: 'connecting…',
  streaming: 'streaming',
  ended: 'stream ended',
  error: 'disconnected',
};

// The runtime writes no log file until the thing has run at least once, and it
// reports that as a hard error rather than as empty output. Printed raw --
// NSCocoaErrorDomain, a file path, a nested NSUnderlyingError -- it reads like a
// crash, so recognise it and explain it instead.
const NO_LOG_FILE = /failed to (get|open).{0,40}logs?|stdio\.log/i;

/** One log line, with whatever colour the program that wrote it asked for. */
function Line({ message }: { message: string }) {
  // Most lines carry none, and every one of them would otherwise pay for a
  // parse and a wrapping span. A boot log is thousands of lines long.
  if (!hasAnsi(message)) return <>{message}</>;

  return (
    <>
      {parseAnsi(message).map((span, index) => (
        <span key={index} style={css(span.style)}>
          {span.text}
        </span>
      ))}
    </>
  );
}

function css(style: AnsiStyle): React.CSSProperties {
  return {
    color: style.fg,
    backgroundColor: style.bg,
    fontWeight: style.bold ? 600 : undefined,
    // Faint, rather than a colour of its own: dim is a shade of whatever is
    // already there, and half the palette has no darker version to reach for.
    opacity: style.dim ? 0.65 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration:
      style.underline && style.strike
        ? 'underline line-through'
        : style.underline
          ? 'underline'
          : style.strike
            ? 'line-through'
            : undefined,
  };
}

interface LogPaneProps {
  /** JSON-RPC method that opens the stream, e.g. containers.logs. */
  method: string;
  params: unknown;
  /** Extra controls rendered next to the filter, e.g. a boot-log switch. */
  controls?: React.ReactNode;
  /** Explains why there is no log file yet, when the runtime says there isn't. */
  missingHint?: React.ReactNode;
}

export function LogPane({ method, params, controls, missingHint }: LogPaneProps) {
  const { entries, status } = useLogStream(method, params);

  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    if (!filter.trim()) return entries;
    const needle = filter.toLowerCase();
    // Against the line as it reads, not as it arrived: a filter that misses
    // "OK" because a colour code sits inside the word is a filter nobody trusts.
    return entries.filter((entry) => plainAnsi(entry.message).toLowerCase().includes(needle));
  }, [entries, filter]);

  const noLogFile = useMemo(
    () => entries.length > 0 && entries.every((entry) => NO_LOG_FILE.test(entry.message)),
    [entries]
  );

  useEffect(() => {
    if (!autoScroll) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visible, autoScroll]);

  // Scrolling up pauses the follow; returning to the bottom resumes it.
  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    setAutoScroll(node.scrollHeight - node.scrollTop - node.clientHeight < 40);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 pb-2 dark:border-ink-700">
        <span className="text-tiny text-ink-600 dark:text-ink-400">
          {STATUS_LABEL[status]} · {entries.length} lines
        </span>

        <div className="flex items-center gap-3">
          {controls}
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter log lines"
            className="input w-40"
          />
          <label className="flex items-center gap-2 text-xs text-ink-600 dark:text-ink-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-brand-600"
            />
            Follow
          </label>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="ansi selectable -mr-5 min-h-0 flex-1 overflow-auto py-2 pr-5 font-mono text-xs leading-relaxed"
      >
        {noLogFile ? (
          <div className="max-w-prose font-sans text-sm text-ink-500">
            <p className="text-ink-700 dark:text-ink-300">No logs yet.</p>
            <p className="mt-1">
              {missingHint ?? 'Nothing has been written here yet — there is no log file to read.'}
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="text-ink-500">
            {entries.length === 0 ? 'Waiting for output…' : 'No lines match the filter.'}
          </p>
        ) : (
          visible.map((entry, index) => (
            <p key={index} className="whitespace-pre-wrap break-all">
              {entry.timestamp && (
                <span className="mr-2 text-brand-700 dark:text-brand-400">{entry.timestamp}</span>
              )}
              <Line message={entry.message} />
            </p>
          ))
        )}
      </div>
    </div>
  );
}
