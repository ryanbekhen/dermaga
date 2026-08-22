/**
 * A CVSS vector, said in words.
 *
 * "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H" is the standard way to state
 * how a flaw is reached and what it costs, and it is unreadable unless you
 * have the table memorised. It is also the most decision-shaped thing on a
 * finding: a flaw reachable over the network with no privileges and no user
 * involvement is a different problem from one needing a local account, and the
 * score alone flattens that difference into a number.
 *
 * Only the base metrics are decoded. Temporal and environmental ones are
 * rarely published, and where they are they describe somebody else's estimate
 * of somebody else's deployment.
 */

const METRICS: Record<string, { label: string; values: Record<string, string> }> = {
  AV: {
    label: 'Attack vector',
    values: { N: 'network', A: 'adjacent network', L: 'local', P: 'physical' },
  },
  AC: { label: 'Complexity', values: { L: 'low', H: 'high' } },
  PR: {
    label: 'Privileges needed',
    values: { N: 'none', L: 'low', H: 'high' },
  },
  UI: { label: 'User interaction', values: { N: 'none', R: 'required' } },
  S: { label: 'Scope', values: { U: 'unchanged', C: 'changed' } },
  C: { label: 'Confidentiality', values: { H: 'high', L: 'low', N: 'none' } },
  I: { label: 'Integrity', values: { H: 'high', L: 'low', N: 'none' } },
  A: { label: 'Availability', values: { H: 'high', L: 'low', N: 'none' } },
};

// The order they are read in, which is how the standard writes them: how it is
// reached first, then what it costs.
const ORDER = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'];

export interface Metric {
  label: string;
  value: string;
}

/**
 * Decodes a vector into labelled values, dropping anything not understood.
 *
 * An unrecognised metric is left out rather than printed raw: a panel is not
 * improved by a line reading "E: U", and a vector this cannot read at all
 * returns nothing, which the caller shows as nothing.
 */
export function readVector(vector?: string): Metric[] {
  if (!vector) return [];

  const parts = new Map<string, string>();
  for (const piece of vector.split('/')) {
    const [key, value] = piece.split(':');
    if (key && value) parts.set(key, value);
  }

  const out: Metric[] = [];

  for (const key of ORDER) {
    const metric = METRICS[key];
    const code = parts.get(key);
    if (!metric || !code) continue;

    const value = metric.values[code];
    if (value) out.push({ label: metric.label, value });
  }

  return out;
}
