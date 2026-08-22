import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { invoke, openTerminalStream } from '../services/ipc';
import { useIsDark } from '../hooks/useIsDark';

type SessionState = 'connecting' | 'connected' | 'closed' | 'error';

const STATE_LABEL: Record<SessionState, string> = {
  connecting: 'opening shell…',
  connected: 'connected',
  closed: 'session ended',
  error: 'could not connect',
};

/** The agent base64-encodes terminal bytes; xterm wants them back as text. */
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const ANSI = {
  red: '#c21322',
  green: '#2c8c52',
  yellow: '#b98200',
  cyan: '#2a9d8f',
};

const LIGHT_THEME = {
  ...ANSI,
  background: '#ffffff',
  foreground: '#322d2f',
  cursor: '#c21322',
  cursorAccent: '#ffffff',
  selectionBackground: '#c2132233',
  black: '#322d2f',
  blue: '#a50f1c',
  magenta: '#6e6a67',
  white: '#4a4644',
  brightBlack: '#8b8683',
};

const DARK_THEME = {
  ...ANSI,
  background: '#1e1a1c',
  foreground: '#f7f6f5',
  cursor: '#e4606b',
  cursorAccent: '#1e1a1c',
  selectionBackground: '#c2132255',
  black: '#322d2f',
  red: '#e4606b',
  blue: '#e4606b',
  magenta: '#a29c99',
  white: '#fcfbfb',
  brightBlack: '#8b8683',
};

/**
 * An interactive shell inside the container, over the exec WebSocket.
 *
 * The server runs the child on a real pty, so this is a full terminal: prompt,
 * line editing, colours and resize all work. Data is exchanged as binary
 * frames; window size changes go out as a JSON control frame.
 */
export function TerminalPane({
  target,
  disabled,
  disabledMessage = 'Start it to open a shell.',
}: {
  target: { kind: 'container' | 'machine'; id: string; user?: string };
  disabled: boolean;
  disabledMessage?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SessionState>('connecting');
  const [attempt, setAttempt] = useState(0);
  const isDark = useIsDark();

  useEffect(() => {
    if (disabled || !hostRef.current) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      cursorBlink: true,
      theme: isDark ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    let streamId: string | null = null;
    let close: (() => void) | null = null;
    let disposed = false;

    const sendSize = () => {
      if (!streamId) return;
      void invoke('terminal.resize', { id: streamId, cols: term.cols, rows: term.rows }).catch(
        () => {
          // The session may already have ended.
        }
      );
    };

    void openTerminalStream(target, {
      // Terminal bytes travel base64 because JSON cannot carry them raw.
      onData: (chunk) => term.write(decodeBase64(chunk)),
      onEnd: (error) => setState(error ? 'error' : 'closed'),
    })
      .then((session) => {
        if (disposed) {
          session.close();
          return;
        }

        streamId = session.streamId;
        close = session.close;
        setState('connected');
        sendSize();
        term.focus();
      })
      .catch(() => setState('error'));

    const input = term.onData((data) => {
      if (!streamId) return;
      void invoke('terminal.input', { id: streamId, data: encodeBase64(data) }).catch(() => {
        setState('closed');
      });
    });

    // Refit on container resize, and tell the pty about the new geometry.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        sendSize();
      } catch {
        // The pane can be measured at zero size while switching tabs.
      }
    });
    observer.observe(hostRef.current);

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      close?.();
      term.dispose();
    };
    // The target object is rebuilt on every render; its fields are what
    // actually identify the session -- and the user is one of them, so
    // changing it opens a new session rather than reusing this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, target.id, target.user, disabled, attempt, isDark]);

  if (disabled) {
    return (
      <div className="flex flex-1 items-center justify-center px-7 py-6 text-sm text-ink-600 dark:text-ink-400">
        {disabledMessage}
      </div>
    );
  }

  return (
    // Padded and boxed like the log pane, and for the same reason: this used to
    // sit inside a gutter the window provided, so with that gone the session
    // ran into the sidebar on one side and the rail on the other.
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-7 pb-4 pt-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex h-7 items-center rounded-lg bg-ink-150 px-2.5 font-mono text-code text-ink-700 dark:bg-ink-800 dark:text-ink-300">
          {STATE_LABEL[state]} · bash, falling back to sh
        </span>
        {(state === 'closed' || state === 'error') && (
          <button onClick={() => setAttempt((n) => n + 1)} className="btn-ghost">
            New session
          </button>
        )}
      </div>

      {/* The terminal keeps the app's own background rather than always being a
          dark slab, so it sits on the page instead of looking pasted onto it --
          but it is boxed, because a shell session is a thing with edges. */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-950">
        <div ref={hostRef} className="selectable h-full w-full" />
      </div>
    </div>
  );
}
