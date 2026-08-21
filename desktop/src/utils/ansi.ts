/**
 * Colour codes in a log line, turned into something the page can draw.
 *
 * Programs write colour by printing escape sequences, and a browser draws none
 * of it: the escape character itself is invisible, so `\x1b[0;32m  OK  \x1b[0m`
 * arrives on screen as a stray `[0;32m` in front of the word. systemd colours
 * every line of a boot this way, which is exactly the output somebody scrolls
 * through looking for the one thing that went wrong.
 *
 * So the sequences are read rather than shown. Only the graphic ones mean
 * anything here -- colour, weight, underline. The rest move a cursor around a
 * terminal that does not exist, and are dropped rather than printed.
 */

export interface AnsiStyle {
  /** A CSS colour: one of the palette variables, or a literal from 24-bit codes. */
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

/** A run of text that is all one style. */
export interface AnsiSpan {
  text: string;
  style: AnsiStyle;
}

/**
 * The eight colours and their bright halves, by number.
 *
 * Named rather than fixed here: what "green" should be depends on whether it is
 * being read on white or on near-black, and the stylesheet is where that already
 * gets decided.
 */
function palette(index: number): string {
  if (index < 16) return `var(--ansi-${index})`;

  // 216 colours in a 6x6x6 cube, then 24 greys. Both are arithmetic, and no
  // theme gets a say: a program that asked for this exact colour meant it.
  if (index < 232) {
    const level = (value: number) => (value === 0 ? 0 : 55 + value * 40);
    const rest = index - 16;
    return rgb(level(Math.floor(rest / 36)), level(Math.floor(rest / 6) % 6), level(rest % 6));
  }

  const grey = 8 + (index - 232) * 10;
  return rgb(grey, grey, grey);
}

function rgb(red: number, green: number, blue: number): string {
  const byte = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');

  return `#${byte(red)}${byte(green)}${byte(blue)}`;
}

/**
 * Anything a terminal would swallow: cursor movements, erase-line, the window
 * title, hyperlinks. Matched so it can be thrown away -- printed, it is noise
 * around the very line somebody is trying to read.
 */
const CSI = '\x1b[';

// eslint-disable-next-line no-control-regex
const SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/** A colour set by 38/48: `5;n` from the 256 table, or `2;r;g;b` said outright. */
function extended(codes: number[], at: number): { colour?: string; next: number } {
  if (codes[at + 1] === 5) return { colour: palette(codes[at + 2] ?? 0), next: at + 3 };

  if (codes[at + 1] === 2) {
    return {
      colour: rgb(codes[at + 2] ?? 0, codes[at + 3] ?? 0, codes[at + 4] ?? 0),
      next: at + 5,
    };
  }

  // Neither form, so nothing can be trusted about what follows it.
  return { next: codes.length };
}

function apply(style: AnsiStyle, parameters: string): AnsiStyle {
  // A bare `\x1b[m` is a reset, and so is every empty field within one.
  const codes = parameters.split(';').map((code) => (code === '' ? 0 : Number(code)));
  let next = { ...style };

  for (let at = 0; at < codes.length; at++) {
    const code = codes[at];

    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 9) next.strike = true;
    // 7 swaps the two colours. Done here rather than at drawing time, so
    // everything downstream only ever deals with a foreground and a background.
    else if (code === 7) {
      const { fg = 'var(--ansi-fg)', bg = 'var(--ansi-bg)' } = next;
      next.fg = bg;
      next.bg = fg;
    } else if (code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 29) delete next.strike;
    else if (code >= 30 && code <= 37) next.fg = palette(code - 30);
    else if (code >= 90 && code <= 97) next.fg = palette(code - 90 + 8);
    else if (code >= 40 && code <= 47) next.bg = palette(code - 40);
    else if (code >= 100 && code <= 107) next.bg = palette(code - 100 + 8);
    else if (code === 39) delete next.fg;
    else if (code === 49) delete next.bg;
    else if (code === 38 || code === 48) {
      const { colour, next: after } = extended(codes, at);
      if (colour) next[code === 38 ? 'fg' : 'bg'] = colour;
      at = after - 1;
    }
    // Everything else -- blink, font selection, things no page can do -- is
    // left alone rather than guessed at.
  }

  return next;
}

/**
 * What a carriage return leaves behind.
 *
 * Progress output redraws one line in place: `[  ] Starting…\r[ OK ] Started`.
 * A terminal shows only the last pass; printed whole it reads as the same line
 * twice, once out of date.
 */
function lastPass(line: string): string {
  if (!line.includes('\r')) return line;

  const passes = line.split('\r').filter((pass) => pass !== '');

  return passes.length === 0 ? '' : passes[passes.length - 1];
}

/** Splits one log line into runs of text, each with the style in force. */
export function parseAnsi(line: string): AnsiSpan[] {
  const text = lastPass(line);
  const spans: AnsiSpan[] = [];
  let style: AnsiStyle = {};
  let at = 0;

  SEQUENCE.lastIndex = 0;
  for (let match = SEQUENCE.exec(text); match; match = SEQUENCE.exec(text)) {
    if (match.index > at) spans.push({ text: text.slice(at, match.index), style });

    // The graphic ones, and only those: `ESC [ … m`. Everything else the
    // regexp caught is a terminal instruction with nothing to act on here.
    const sequence = match[0];
    if (sequence.startsWith(CSI) && sequence.endsWith('m')) {
      style = apply(style, sequence.slice(CSI.length, -1));
    }

    at = match.index + match[0].length;
  }

  if (at < text.length) spans.push({ text: text.slice(at), style });

  return spans;
}

/** A line as it appears on screen, for anything that has to match what is read. */
export function plainAnsi(line: string): string {
  if (!hasAnsi(line)) return line;

  return parseAnsi(line)
    .map((span) => span.text)
    .join('');
}

/** Whether a line carries anything worth parsing, for skipping the common case. */
export function hasAnsi(line: string): boolean {
  return line.includes('\x1b') || line.includes('\r');
}
