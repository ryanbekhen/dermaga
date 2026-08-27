import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT,
  EVERYTHING,
  attachedInProject,
  builtInProject,
  countIn,
  inProject,
  networkInProject,
  prefixed,
  unprefixed,
} from './projects';
import type { Container } from '../types';

const container = (name: string, project?: string): Container =>
  ({ id: name, name, project }) as Container;

const all = [
  container('api', 'bengkel'),
  container('web', 'bengkel'),
  container('notes', 'arsip'),
  container('redis'),
  container('mailpit'),
];

describe('what a project shows', () => {
  it('shows everything when no project is in force', () => {
    expect(all.filter((c) => inProject(c, EVERYTHING))).toHaveLength(5);
  });

  // A project shows what is filed under it and nothing else -- default
  // included. What is out of view is out of this list, never out of reach.
  it('shows only what is filed under the project', () => {
    const seen = all.filter((c) => inProject(c, 'bengkel')).map((c) => c.name);

    expect(seen).toEqual(['api', 'web']);
  });

  it('shows default alone when default is the one in force', () => {
    const seen = all.filter((c) => inProject(c, DEFAULT_PROJECT)).map((c) => c.name);

    expect(seen).toEqual(['redis', 'mailpit']);
  });
});

describe('counting', () => {
  it('counts what is filed under a name, default included', () => {
    expect(countIn(all, 'bengkel')).toBe(2);
    expect(countIn(all, DEFAULT_PROJECT)).toBe(2);
  });

});

// A blank string in the record means the same thing as no record at all.
it('treats an empty membership as default', () => {
  expect(inProject(container('x', '  '), DEFAULT_PROJECT)).toBe(true);
  expect(inProject(container('x', ''), 'bengkel')).toBe(false);
});

describe('volumes and networks, which have no project of their own', () => {
  const withUsers = (usedBy: string[]) => attachedInProject(usedBy, all, 'bengkel');

  it('is in view when something using it is', () => {
    expect(withUsers(['api'])).toBe(true);
  });

  it('is out of view when only another project uses it', () => {
    expect(withUsers(['notes'])).toBe(false);
  });

  it('is out of view when only default is mounting it', () => {
    expect(withUsers(['redis'])).toBe(false);
  });

  it('is in view when any one of its users is', () => {
    expect(withUsers(['notes', 'api'])).toBe(true);
  });

  // Nobody has claimed it, so it is default's -- a volume waiting to be
  // mounted should not vanish because a project happens to be open.
  it('is in view when nothing is using it', () => {
    expect(withUsers([])).toBe(true);
    expect(attachedInProject(undefined, all, 'bengkel')).toBe(true);
  });

  // The builder is hidden by its own filter; a user the reader cannot see is
  // no reason to hide what it is holding.
  it('does not hide on account of a user it cannot see', () => {
    expect(withUsers(['buildkit'])).toBe(true);
  });

  it('hides nothing when no project is in force', () => {
    expect(attachedInProject(['notes'], all, EVERYTHING)).toBe(true);
  });
});

describe('images, which belong where they were built', () => {
  it('is in view when a tag on it is filed under the project', () => {
    expect(builtInProject(['bengkel'], 'bengkel')).toBe(true);
  });

  // One set of bytes can carry dev and latest; either being filed is enough.
  it('is in view when any one of its tags is', () => {
    expect(builtInProject([undefined, 'bengkel'], 'bengkel')).toBe(true);
  });

  it('is out of view when it belongs to another project', () => {
    expect(builtInProject(['arsip'], 'bengkel')).toBe(false);
  });

  // Pulled from a registry: the same bytes for everybody, claimed by nobody,
  // and in view wherever you are. A project that cannot see the image it is
  // about to run is a project getting in the way.
  it('keeps a pulled image global', () => {
    expect(builtInProject([undefined], DEFAULT_PROJECT)).toBe(true);
    expect(builtInProject([undefined], 'bengkel')).toBe(true);
    expect(builtInProject(['  '], 'bengkel')).toBe(true);
  });

  // And the other side of it: built here means this project's alone.
  it('keeps a built image to the project that built it', () => {
    expect(builtInProject(['bengkel'], DEFAULT_PROJECT)).toBe(false);
  });

  it('hides nothing when no project is in force', () => {
    expect(builtInProject(['arsip'], EVERYTHING)).toBe(true);
  });
});

describe('the prefix, which is what lets two projects hold a dashboard', () => {
  it('names what is born in a project', () => {
    expect(prefixed('bengkel', 'dashboard')).toBe('bengkel_dashboard');
  });

  it('leaves default and All alone', () => {
    expect(prefixed(DEFAULT_PROJECT, 'dashboard')).toBe('dashboard');
    expect(prefixed(EVERYTHING, 'dashboard')).toBe('dashboard');
  });

  // Somebody who types the prefix themselves gets what they typed.
  it('does not stutter', () => {
    expect(prefixed('bengkel', 'bengkel_dashboard')).toBe('bengkel_dashboard');
  });

  it('reads back short', () => {
    expect(unprefixed('bengkel', 'bengkel_dashboard')).toBe('dashboard');
  });

  // Made before the project existed, or filed in by hand: nothing to take off,
  // and trimming it into something else would be worse than leaving it long.
  it('leaves an unprefixed name alone', () => {
    expect(unprefixed('bengkel', 'mysql')).toBe('mysql');
    expect(unprefixed(DEFAULT_PROJECT, 'bengkel_dashboard')).toBe('bengkel_dashboard');
  });
});

describe('networks, which say which project they are for', () => {
  const labelled = (project: string) => ({ labels: { 'dermaga.project': project } });

  // The one the screenshot caught: a project's own empty network showing up in
  // every project, because nothing was attached to place it.
  it('keeps a project network to its project, attached or not', () => {
    expect(networkInProject(labelled('linxpay'), [], 'linxpay')).toBe(true);
    expect(networkInProject(labelled('linxpay'), [], 'test123')).toBe(false);
  });

  // The built-in one is the default project's network -- the one a container
  // with no project lands on -- so it is scoped like every other project's.
  it('keeps the built-in network to default', () => {
    expect(networkInProject({ builtin: true }, [], DEFAULT_PROJECT)).toBe(true);
    expect(networkInProject({ builtin: true }, [], 'linxpay')).toBe(false);
  });

  // Somebody's own network, with no label to go on: read off what is attached.
  it('falls back to what is attached for a network nobody claimed', () => {
    expect(networkInProject({ usedBy: ['api'] }, all, 'bengkel')).toBe(true);
    expect(networkInProject({ usedBy: ['notes'] }, all, 'bengkel')).toBe(false);
  });

  it('hides nothing when no project is in force', () => {
    expect(networkInProject(labelled('linxpay'), [], EVERYTHING)).toBe(true);
  });
});
