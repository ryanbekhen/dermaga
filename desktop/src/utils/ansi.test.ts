import { describe, expect, it } from 'vitest';
import { hasAnsi, parseAnsi } from './ansi';

const ESC = '\x1b';
const plain = (line: string) =>
  parseAnsi(line)
    .map((span) => span.text)
    .join('');

describe('parseAnsi', () => {
  it('leaves an ordinary line whole', () => {
    expect(parseAnsi('starting up')).toEqual([{ text: 'starting up', style: {} }]);
  });

  // The shape systemd prints for every unit it brings up.
  it('colours what the sequence colours, and nothing after the reset', () => {
    expect(parseAnsi(`[${ESC}[0;32m  OK  ${ESC}[0m] Started dbus.service`)).toEqual([
      { text: '[', style: {} },
      { text: '  OK  ', style: { fg: 'var(--ansi-2)' } },
      { text: '] Started dbus.service', style: {} },
    ]);
  });

  it('keeps a style running across the sequences that do not end it', () => {
    const spans = parseAnsi(`${ESC}[1mbold ${ESC}[31mand red${ESC}[0m plain`);

    expect(spans).toEqual([
      { text: 'bold ', style: { bold: true } },
      { text: 'and red', style: { bold: true, fg: 'var(--ansi-1)' } },
      { text: ' plain', style: {} },
    ]);
  });

  it('drops each attribute on its own code', () => {
    expect(parseAnsi(`${ESC}[1;4mboth${ESC}[24mbold only`)).toEqual([
      { text: 'both', style: { bold: true, underline: true } },
      { text: 'bold only', style: { bold: true } },
    ]);
  });

  it('reads the bright half as its own colours', () => {
    expect(parseAnsi(`${ESC}[91mred${ESC}[m`)[0].style.fg).toBe('var(--ansi-9)');
  });

  it('takes 256-colour and 24-bit codes at their word', () => {
    // 208 is in the cube: orange, and not a colour any theme should reinterpret.
    expect(parseAnsi(`${ESC}[38;5;208mx`)[0].style.fg).toBe('#ff8700');
    expect(parseAnsi(`${ESC}[38;5;7mx`)[0].style.fg).toBe('var(--ansi-7)');
    expect(parseAnsi(`${ESC}[38;2;18;52;86mx`)[0].style.fg).toBe('#123456');
    expect(parseAnsi(`${ESC}[48;5;236mx`)[0].style.bg).toBe('#303030');
  });

  it('swaps the two colours when asked to invert', () => {
    expect(parseAnsi(`${ESC}[7minverted`)[0].style).toEqual({
      fg: 'var(--ansi-bg)',
      bg: 'var(--ansi-fg)',
    });
    expect(parseAnsi(`${ESC}[32;7minverted`)[0].style).toEqual({
      fg: 'var(--ansi-bg)',
      bg: 'var(--ansi-2)',
    });
  });

  // Cursor moves, erase-line, a window title: a terminal acts on these, and a
  // log pane has nothing to act with.
  it('throws away the sequences that are not about colour', () => {
    expect(plain(`${ESC}[2K${ESC}[1;7Hcleared${ESC}]0;a title${ESC}\\ and titled`)).toBe(
      'cleared and titled'
    );
  });

  it('shows only the last pass over a redrawn line', () => {
    expect(plain('[    ] Starting apache2…\r[  OK  ] Started apache2')).toBe(
      '[  OK  ] Started apache2'
    );
  });

  // Trailing returns are how a line ends, not a line that was blanked.
  it('does not lose a line to a carriage return at the end of it', () => {
    expect(plain('done\r')).toBe('done');
  });

  it('survives a sequence that was cut in half by the stream', () => {
    expect(plain(`half a colour ${ESC}[3`)).toBe(`half a colour ${ESC}[3`);
  });
});

describe('hasAnsi', () => {
  it('spots the lines worth parsing', () => {
    expect(hasAnsi('nothing here')).toBe(false);
    expect(hasAnsi(`${ESC}[32mgreen`)).toBe(true);
    expect(hasAnsi('redrawn\rline')).toBe(true);
  });
});
