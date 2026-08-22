/**
 * A Dockerfile, edited with its syntax coloured.
 *
 * A real textarea with a coloured copy of its text laid under it. The layout
 * below is not a first draft: it was built and measured on its own before it
 * came here, because four attempts at it inside the app all failed the same
 * way -- the caret and the letters under it came apart, and each fix moved the
 * seam rather than closing it.
 *
 * What the measuring found, in the order it found it:
 *
 *   - Two classes set line-height, and which won depended on their order in
 *     the compiled stylesheet rather than in the class attribute. Everything
 *     that decides where a character lands is inline now.
 *   - A textarea and a pre do not shape text alike left to themselves: WebKit
 *     applies ligatures and kerning in one and not the other, so they agreed
 *     on where a line sat and disagreed about the eleventh character on it.
 *   - Given height:100%, a textarea took that as its content height and a pre
 *     took it as its border box -- 20px apart, one padding, which is what put
 *     the caret a line above its own text.
 *   - The column holding them shrank to its content, so an empty file made a
 *     box two characters wide.
 *
 * Hence: one scroller for both, so there is no synchronisation to be wrong; a
 * column that grows and never shrinks; and every metric written once and given
 * to both layers.
 */

/**
 * The whole of the grammar, which is why writing it out is reasonable.
 *
 * Instructions are matched only at the start of a line: `copy` inside a RUN is
 * a shell command, not an instruction, and colouring it as one says the file
 * does something it does not.
 */
const INSTRUCTIONS =
  /^(\s*)(FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/i;

interface Piece {
  text: string;
  tone?: 'instruction' | 'comment' | 'string' | 'variable' | 'flag';
}

/** One line, split into the pieces that get a colour. */
function read(line: string): Piece[] {
  if (/^\s*#/.test(line)) return [{ text: line, tone: 'comment' }];

  const found = INSTRUCTIONS.exec(line);
  if (!found) return rest(line);

  const [, indent, word] = found;

  return [
    { text: indent },
    { text: word, tone: 'instruction' },
    ...rest(line.slice(indent.length + word.length)),
  ];
}

/** Everything after the instruction: strings, variables, flags. */
function rest(text: string): Piece[] {
  const pieces: Piece[] = [];
  const pattern = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\$\{[^}]*\}|\$\w+|--[\w-]+)/g;

  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > at) pieces.push({ text: text.slice(at, start) });

    const piece = match[0];
    pieces.push({
      text: piece,
      tone: piece.startsWith('--') ? 'flag' : piece.startsWith('$') ? 'variable' : 'string',
    });
    at = start + piece.length;
  }

  if (at < text.length) pieces.push({ text: text.slice(at) });

  return pieces;
}

/**
 * Colour, and only colour.
 *
 * No bold and no italic, which is not a matter of taste. Only weights 400 and
 * 500 of the mono face are shipped, so anything heavier is synthesised -- and
 * synthetic bold widens every glyph it touches, which would slide the rest of
 * the line out from under the caret. An oblique is synthesised the same way.
 */
const TONE: Record<NonNullable<Piece['tone']>, string> = {
  instruction: 'text-brand-700 dark:text-brand-400',
  comment: 'text-ink-500',
  string: 'text-emerald-700 dark:text-emerald-500',
  variable: 'text-amber-700 dark:text-amber-500',
  flag: 'text-ink-500 dark:text-ink-400',
};

const LINE = 18;
const PAD = 10;

/** Every property that decides where a character lands, written once. */
const METRICS: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  // A whole number, not the 11.5px the rest of the app sets code in:
  // fractional sizes mean fractional glyph advances, and the two layers round
  // those independently.
  fontSize: '12px',
  lineHeight: `${LINE}px`,
  fontWeight: 400,
  fontStyle: 'normal',
  letterSpacing: 'normal',
  fontKerning: 'none',
  fontVariantLigatures: 'none',
  fontFeatureSettings: 'normal',
  tabSize: 4,
  whiteSpace: 'pre',
  wordBreak: 'normal',
  overflowWrap: 'normal',
  boxSizing: 'border-box',
  padding: `${PAD}px 12px`,
  margin: 0,
  border: 0,
};

export function DockerfileEditor({
  value,
  onChange,
  rows = 14,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
}) {
  const lines = value.split('\n');

  return (
    // One scroller, holding both layers. They used to have one each, kept in
    // step by copying scrollTop across -- and a synchronisation can be wrong.
    // Here neither can scroll inside itself: the pre is in flow and sets the
    // size, the textarea is laid over it at exactly that size, and what moves
    // is this box, which moves both at once because they are inside it.
    // items-start, and it is load-bearing. Stretched instead -- which is what
    // a flex row does by default -- both columns were sized to the height that
    // is *visible* rather than to the text, so the textarea covered only the
    // first screenful and sat at the top of the scroll. Clicking a line near
    // the bottom then focused a box that began above the viewport, and the
    // browser scrolled up to reveal it: the caret went back to the top on
    // every click.
    <div
      style={{ height: rows * LINE + PAD * 2 }}
      className="flex items-start overflow-auto rounded-lg border border-ink-300 bg-white dark:border-ink-700 dark:bg-ink-950"
    >
      {/* Numbered, because a build that fails quotes the line it failed on.
          Sticky, so scrolling along a long line does not carry the numbers off
          the edge with it. */}
      <div
        aria-hidden
        style={{ ...METRICS, padding: `${PAD}px 0`, minHeight: '100%' }}
        className="sticky left-0 z-10 flex-none select-none border-r border-ink-200 bg-ink-50 text-right text-ink-400 dark:border-ink-800 dark:bg-ink-900/50"
      >
        {lines.map((_, at) => (
          <div key={at} className="px-2">
            {at + 1}
          </div>
        ))}
      </div>

      {/* Grows to fill and never shrinks, and is as tall as the text rather
          than as tall as the window onto it -- which is what the textarea over
          it inherits. */}
      <div className="relative" style={{ flex: '1 0 auto', minHeight: '100%' }}>
        <pre
          aria-hidden
          style={METRICS}
          className="pointer-events-none text-ink-900 dark:text-ink-100"
        >
          {lines.map((line, at) => (
            <div key={at}>
              {read(line).map((piece, index) => (
                <span key={index} className={piece.tone ? TONE[piece.tone] : undefined}>
                  {piece.text}
                </span>
              ))}
              {/* An empty line still needs its height, or every line after it
                  sits one row higher than its own number. */}
              {line === '' && '\u200b'}
            </div>
          ))}
        </pre>

        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={'FROM alpine:3.20\nRUN apk add --no-cache curl\nCMD ["sh"]'}
          aria-label="Dockerfile"
          style={METRICS}
          // Transparent over the painted copy, with a caret that is not, and
          // no scrolling of its own to get out of step with.
          //
          // The selection is told separately: WebKit paints selected text in
          // its own foreground colour and ignores `transparent`, which brought
          // this invisible copy up over the coloured one.
          className="absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-brand-600 outline-none selection:bg-brand-600/30 selection:text-transparent placeholder:text-ink-400 dark:caret-brand-400 dark:selection:bg-brand-400/30"
        />
      </div>
    </div>
  );
}
