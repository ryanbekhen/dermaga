// Collects the licences of everything Dermaga ships, and writes them where
// both the app and GitHub can show them.
//
// MIT, ISC and BSD all require their notice to travel with the binary, so this
// is a condition of distributing the DMG rather than a courtesy. It is
// generated rather than written by hand because a list that drifts out of date
// is worse than none: it misstates what is actually inside.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'desktop');

const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING'];

function licenceText(dir) {
  if (!existsSync(dir)) return '';

  const found = readdirSync(dir).find((name) =>
    LICENCE_FILES.some((candidate) => name.toLowerCase() === candidate.toLowerCase())
  );

  return found ? readFileSync(join(dir, found), 'utf8').trim() : '';
}

function npmPackages() {
  const pkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));

  // Runtime dependencies: what the window is built from and ships with.
  const names = Object.keys(pkg.dependencies ?? {});

  return names
    .map((name) => {
      const dir = join(desktop, 'node_modules', name);
      if (!existsSync(dir)) return null;

      const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

      return {
        name: meta.name,
        version: meta.version,
        licence: typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? 'see text'),
        url: meta.homepage ?? repositoryUrl(meta.repository),
        text: licenceText(dir),
      };
    })
    .filter(Boolean);
}

function repositoryUrl(repository) {
  const raw = typeof repository === 'string' ? repository : (repository?.url ?? '');
  return raw.replace(/^git\+/, '').replace(/\.git$/, '');
}

function goPackages() {
  const cache = execSync('go env GOMODCACHE', { cwd: root }).toString().trim();
  const mod = readFileSync(join(root, 'go.mod'), 'utf8');

  const requires = [...mod.matchAll(/^\s*(?:require\s+)?([\w.\-]+\/[^\s]+)\s+(v[^\s/]+)/gm)];

  const modules = requires.map(([, path, version]) => {
    // Upper-case letters are escaped as !x in the module cache path.
    const escaped = path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
    const dir = join(cache, `${escaped}@${version}`);

    return {
      name: path,
      version,
      licence: 'see text',
      url: `https://${path}`,
      text: licenceText(dir),
    };
  });

  // The runtime itself travels inside the compiled agent.
  const goroot = execSync('go env GOROOT', { cwd: root }).toString().trim();

  // Homebrew installs Go as .../libexec with the licence one level above it,
  // so look at the parent when it is not where it should be.
  const goLicence = licenceText(goroot) || licenceText(join(goroot, '..'));

  modules.push({
    name: 'The Go programming language',
    version: execSync('go env GOVERSION', { cwd: root }).toString().trim(),
    licence: 'BSD-3-Clause',
    url: 'https://go.dev',
    text: goLicence,
  });

  return modules;
}

const packages = [...npmPackages(), ...goPackages()]
  .map((entry) => ({ ...entry, licence: guessLicence(entry) }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Falls back to reading the text when package metadata does not say. */
function guessLicence({ licence, text }) {
  if (licence && licence !== 'see text') return licence;
  if (/MIT License/i.test(text)) return 'MIT';
  // Many MIT files carry no title at all, only the permission grant.
  if (/Permission is hereby granted, free of charge/i.test(text)) return 'MIT';
  if (/Apache License/i.test(text)) return 'Apache-2.0';
  if (/BSD 3-Clause|Redistributions of source code/i.test(text)) return 'BSD-3-Clause';
  if (/ISC License/i.test(text)) return 'ISC';
  return 'see text';
}

// For the app: imported by the Help view, so it is inside the bundle with no
// extra plumbing and cannot go missing from a build.
const generated = join(desktop, 'src', 'generated');
mkdirSync(generated, { recursive: true });
writeFileSync(join(generated, 'notices.json'), `${JSON.stringify(packages, null, 2)}\n`);

// For GitHub: readable without installing anything.
const markdown = [
  '# Third-party notices',
  '',
  'Dermaga ships the following open-source software. Each licence is reproduced',
  'in full, as those licences require.',
  '',
  'The window is drawn by WebKit, which is part of macOS and is not shipped',
  'here.',
  '',
  ...packages.flatMap(({ name, version, licence, url, text }) => [
    `## ${name} ${version}`,
    '',
    `${licence}${url ? ` · <${url}>` : ''}`,
    '',
    '```',
    text || '(no licence file found in the published package)',
    '```',
    '',
  ]),
].join('\n');

writeFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), markdown);

console.log(`notices: ${packages.length} packages`);
