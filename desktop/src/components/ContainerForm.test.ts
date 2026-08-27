import { describe, expect, it } from 'vitest';
import { asked, summarise } from './ContainerForm';
import type { ContainerSpec } from '../types';

const spec = (over: Partial<ContainerSpec> = {}): ContainerSpec => ({
  name: 'redis',
  image: 'docker.io/library/redis:8.10',
  cpus: 1,
  memory: '512m',
  ...over,
});

/**
 * The sentence the Create button asks its question with.
 *
 * It is the only place the form's thirty fields are readable as one thing, so
 * what it says has to be what will happen: a limit nobody set must not be
 * reported as the number the field happens to show, and a list of mounts must
 * not run off the end of the dialog.
 */
describe('what is about to be made', () => {
  it('says what it runs on', () => {
    expect(summarise(spec(), false)).toBe(
      'docker.io/library/redis:8.10 runs with 1 CPU and 512 MB of memory, and starts straight away.'
    );
  });

  it('counts CPUs', () => {
    expect(summarise(spec({ cpus: 4 }), false)).toContain('4 CPUs and 512 MB of memory');
  });

  it('does not invent a limit that was left unset', () => {
    const said = summarise(spec({ cpus: undefined, memory: undefined }), false);

    expect(said).toContain("runs on the CLI's own defaults");
    expect(said).not.toContain('CPU');
  });

  it('says a name is coming when none was typed', () => {
    expect(summarise(spec({ name: '' }), false)).toContain('The CLI will give it a name');
  });

  it('reads back the ports and the mounts', () => {
    const said = summarise(
      spec({
        ports: [{ host: '6379', container: '6379', protocol: 'tcp' }],
        mounts: [{ type: 'volume', source: 'cache', target: '/data' }],
      }),
      false
    );

    expect(said).toContain('6379 → 6379 is published on this Mac.');
    expect(said).toContain('cache → /data is mounted into it.');
  });

  it('stops listing before the dialog runs out of room', () => {
    const said = summarise(
      spec({
        ports: [
          { host: '80', container: '80', protocol: 'tcp' },
          { host: '443', container: '443', protocol: 'tcp' },
          { host: '8080', container: '8080', protocol: 'tcp' },
          { host: '9000', container: '9000', protocol: 'tcp' },
        ],
      }),
      false
    );

    expect(said).toContain('80 → 80, 443 → 443 and 2 more are published on this Mac.');
  });

  it('says the two things that outlive the run', () => {
    const said = summarise(spec({ removeOnExit: true }), true);

    expect(said).toContain('It is deleted as soon as it stops.');
    expect(said).toContain('It will start again whenever Dermaga does.');
  });
});

/**
 * The question itself. Both answers are worth a moment -- one makes something,
 * the other destroys something to make it again -- and only one of them can be
 * regretted, so only one of them says what it costs.
 */
describe('the question the button asks', () => {
  it('asks about the container being made', () => {
    const question = asked(spec(), false);

    expect(question.title).toBe('Create redis?');
    expect(question.confirmLabel).toBe('Create');
    expect(question.body).not.toContain('deleted');
  });

  it('has something to ask even when nothing is named yet', () => {
    expect(asked(spec({ name: '' }), false).title).toBe('Create this container?');
  });

  it('says what recreating costs before it says what it makes', () => {
    const question = asked(spec({ name: 'whoami' }), false, 'whoami');

    expect(question.title).toBe('Recreate whoami?');
    expect(question.confirmLabel).toBe('Recreate');
    // The part that cannot be undone comes first, for somebody who reads one
    // line and presses the button.
    expect(question.body.indexOf('stopped, deleted and run again')).toBeLessThan(
      question.body.indexOf('runs with')
    );
    expect(question.body).toContain('Named volumes survive');
  });

  it('still reads back the settings it will be recreated with', () => {
    const question = asked(spec({ cpus: 2, memory: '2g' }), false, 'whoami');

    expect(question.body).toContain('2 CPUs and 2 GB of memory');
  });
});

describe('what the dialog says about the settings the runtime always took', () => {
  it('reads shared memory back beside the other two limits', () => {
    const said = summarise(spec({ cpus: 2, memory: '1g', shmSize: '512m' }), false);

    expect(said).toContain('512 MB of that shared');
  });

  // A tmpfs keeps nothing, so it is said apart from the mounts that do. Read
  // back as "source → target" it would put a word where there is no source and
  // imply the data survives.
  it('says a tmpfs goes with the container', () => {
    const said = summarise(
      spec({ mounts: [{ type: 'tmpfs', source: 'tmpfs', target: '/scratch' }] }),
      false
    );

    expect(said).toContain('/scratch');
    expect(said).toContain('goes when the container does');
    expect(said).not.toContain('mounted into it');
  });

  it('keeps volumes and binds in the sentence about mounting', () => {
    const said = summarise(
      spec({
        mounts: [
          { type: 'volume', source: 'data', target: '/data' },
          { type: 'tmpfs', source: 'tmpfs', target: '/scratch' },
        ],
      }),
      false
    );

    expect(said).toContain('data → /data');
    expect(said).toContain('is mounted into it');
    expect(said).toContain('/scratch');
  });

  it('reads the limits back', () => {
    const said = summarise(spec({ ulimits: ['nofile=4096:8192'] }), false);

    expect(said).toContain('nofile=4096:8192');
  });

  it('says nothing about limits that were not set', () => {
    const said = summarise(spec(), false);

    expect(said).not.toContain('Its limits are set');
    expect(said).not.toContain('shared');
  });
});
