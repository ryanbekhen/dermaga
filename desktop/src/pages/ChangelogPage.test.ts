import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { inline } from './ChangelogPage';

/** The href of the nth link in a rendered line, or undefined. */
function links(text: string): string[] {
  return inline(text)
    .filter((part): part is ReactElement<{ href?: string }> => typeof part === 'object')
    .map((part) => part.props.href)
    .filter((href): href is string => Boolean(href));
}

/** What a line comes out as, ignoring how it is dressed. */
function words(text: string): string {
  return inline(text)
    .map((part) =>
      typeof part === 'string'
        ? part
        : String((part as ReactElement<{ children?: unknown }>).props.children ?? '')
    )
    .join('');
}

/**
 * The contributors line is written into CHANGELOG.md by the release, and the
 * names in it are people. A person in this app is somebody you can go and look
 * at, not a string that happens to start with an at sign.
 */
describe('a handle in the changelog', () => {
  it('becomes a link to that person', () => {
    expect(links('This release carries work from @canks69.')).toEqual([
      'https://github.com/canks69',
    ]);
  });

  it('takes every name in a line', () => {
    expect(links('work from @canks69, @dev-01 and @ryanbekhen.')).toEqual([
      'https://github.com/canks69',
      'https://github.com/dev-01',
      'https://github.com/ryanbekhen',
    ]);
  });

  it('leaves the sentence reading as it was written', () => {
    const line = 'This release carries work from @canks69 and @ryanbekhen.';
    expect(words(line)).toBe(line);
  });

  // The one thing an at sign is otherwise used for.
  it('is not an email address', () => {
    expect(links('write to someone@example.com about it')).toEqual([]);
    expect(links('the tag api@sha256:0000 was built')).toEqual([]);
  });

  it('is not part of a word', () => {
    expect(links('a redis@7 image')).toEqual([]);
  });
});

/** What was already there, still there. */
describe('the rest of a changelog line', () => {
  it('still carries bold, italic and code', () => {
    const parts = inline('**Bold** and *italic* and `code`');
    const kinds = parts
      .filter((part) => typeof part === 'object')
      .map((part) => (part as ReactElement).type);

    expect(kinds).toEqual(['strong', 'em', 'code']);
  });

  it('leaves plain text alone', () => {
    expect(inline('nothing special here')).toEqual(['nothing special here']);
  });
});
