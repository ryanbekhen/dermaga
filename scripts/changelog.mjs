// Turns CHANGELOG.md into something the app can show.
//
// The file is the single record of what changed; parsing it here means the
// window and the repository can never disagree, and nobody has to remember to
// write the same entry twice. Generated rather than read at runtime because a
// packaged app has no repository to read from.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'desktop');
const source = join(root, 'CHANGELOG.md');
const target = join(desktop, 'src', 'generated', 'changelog.json');

/**
 * Only the shape this project writes: `## [v1.2.0] — 2026-08-18` releases,
 * `### Added` groups, and `- ` entries that may run onto following lines.
 */
function parse(markdown) {
  const releases = [];
  let release = null;
  let section = null;

  const push = (line) => {
    if (!release) return;
    if (!section) {
      // Prose under a version with no group of its own, as the first release
      // has: keep it as the release's own summary.
      release.summary = release.summary ? `${release.summary} ${line}` : line;
      return;
    }
    section.entries.push(line);
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.trim();

    const version = line.match(/^##\s+\[?([^\]]+?)\]?(?:\s+[—-]\s+(.+))?$/);
    if (line.startsWith('## ') && version) {
      release = { version: version[1], date: version[2] ?? null, summary: '', sections: [] };
      releases.push(release);
      section = null;
      continue;
    }

    if (line.startsWith('### ') && release) {
      section = { title: line.slice(4).trim(), entries: [] };
      release.sections.push(section);
      continue;
    }

    if (!release) continue;

    if (line.startsWith('- ')) {
      push(line.slice(2).trim());
      continue;
    }

    // A wrapped continuation of the entry above, or a paragraph of its own.
    if (line === '' || line.startsWith('[') || line.startsWith('#')) continue;

    if (section && section.entries.length > 0) {
      section.entries[section.entries.length - 1] += ` ${line}`;
    } else {
      push(line);
    }
  }

  return releases;
}

const releases = parse(readFileSync(source, 'utf8'));

if (releases.length === 0) {
  console.error('changelog: nothing parsed out of CHANGELOG.md');
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(releases, null, 2)}\n`);

// The generated file is committed, so it has to satisfy the same formatter as
// everything else -- a short array printed over three lines is the only thing
// Prettier and JSON.stringify disagree about here.
execFileSync(join(desktop, 'node_modules', '.bin', 'prettier'), ['--write', target], {
  stdio: 'ignore',
});

console.log(`changelog: ${releases.length} releases -> ${target.replace(`${root}/`, '')}`);
