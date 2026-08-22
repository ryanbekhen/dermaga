import { describe, expect, it } from 'vitest';
import { readVector } from './cvss';

describe('reading a CVSS vector', () => {
  // The worst kind of flaw, and the one the words exist to make obvious:
  // reachable from the network, needing nothing from anybody.
  it('says how a flaw is reached, in order', () => {
    const metrics = readVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');

    expect(metrics.slice(0, 4)).toEqual([
      { label: 'Attack vector', value: 'network' },
      { label: 'Complexity', value: 'low' },
      { label: 'Privileges needed', value: 'none' },
      { label: 'User interaction', value: 'none' },
    ]);
  });

  it('tells apart the codes that share a letter', () => {
    // N is "network" for the vector and "none" for privileges; L is "low" for
    // complexity and "local" for the vector. Read against the wrong metric,
    // every one of them is plausible and wrong.
    const metrics = readVector('CVSS:3.1/AV:L/AC:H/PR:L/UI:R/S:C/C:N/I:L/A:H');

    expect(Object.fromEntries(metrics.map((m) => [m.label, m.value]))).toEqual({
      'Attack vector': 'local',
      Complexity: 'high',
      'Privileges needed': 'low',
      'User interaction': 'required',
      Scope: 'changed',
      Confidentiality: 'none',
      Integrity: 'low',
      Availability: 'high',
    });
  });

  // Temporal and environmental metrics turn up occasionally. A panel is not
  // improved by a line reading "E: U".
  it('leaves out what it cannot read', () => {
    const metrics = readVector('CVSS:3.1/AV:N/E:U/RL:O/AC:L');

    expect(metrics.map((m) => m.label)).toEqual(['Attack vector', 'Complexity']);
  });

  it('returns nothing for nothing', () => {
    expect(readVector(undefined)).toEqual([]);
    expect(readVector('')).toEqual([]);
    expect(readVector('not a vector')).toEqual([]);
  });
});
