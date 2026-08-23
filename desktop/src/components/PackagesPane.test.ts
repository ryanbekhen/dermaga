import { describe, expect, it } from 'vitest';
import { buildRows } from './PackagesPane';
import type { Finding, VulnerabilityReport } from '../types';

const finding = (id: string, pkg: string, installed: string, fixed?: string): Finding => ({
  id,
  package: pkg,
  installed,
  fixed,
  severity: 'HIGH',
});

const report = (over: Partial<VulnerabilityReport>): VulnerabilityReport =>
  ({ reference: 'x', scannedAt: '', findings: [], ...over }) as VulnerabilityReport;

describe('buildRows', () => {
  // The bug this was written for: an image carrying setuptools twice showed
  // every finding against both, so the 84.0.0 row listed a flaw fixed in
  // 83.0.0 directly underneath the 70.3.0 it was actually about.
  it('gives a finding to the version it was found in, not to the name', () => {
    const rows = buildRows(
      report({
        packages: [
          { name: 'setuptools', version: '70.3.0' },
          { name: 'setuptools', version: '84.0.0' },
        ],
        findings: [
          finding('CVE-2025-47273', 'setuptools', '70.3.0', '78.1.1'),
          finding('CVE-2026-59890', 'setuptools', '70.3.0', '83.0.0'),
        ],
      })
    );

    expect(rows.map((row) => row.findings.map((f) => f.id))).toEqual([
      ['CVE-2025-47273', 'CVE-2026-59890'],
      [],
    ]);
  });

  // Both copies can be vulnerable, in different ways.
  it('keeps each version to its own findings', () => {
    const rows = buildRows(
      report({
        packages: [
          { name: 'openssl', version: '3.0.1' },
          { name: 'openssl', version: '3.5.0' },
        ],
        findings: [
          finding('CVE-A', 'openssl', '3.0.1'),
          finding('CVE-B', 'openssl', '3.5.0'),
        ],
      })
    );

    expect(rows[0].findings.map((f) => f.id)).toEqual(['CVE-A']);
    expect(rows[1].findings.map((f) => f.id)).toEqual(['CVE-B']);
  });

  // A finding nobody can see is worse than one shown beside a version it might
  // not be about: the two sides can spell a version differently.
  it('falls back to the name when no version matches', () => {
    const rows = buildRows(
      report({
        packages: [{ name: 'zlib', version: '1.3.1-r2' }],
        findings: [finding('CVE-C', 'zlib', '1.3.1')],
      })
    );

    expect(rows[0].findings.map((f) => f.id)).toEqual(['CVE-C']);
  });

  // And that fallback does not undo the fix: a row that matched exactly keeps
  // only what matched.
  it('does not hand an orphan to a version that matched its own', () => {
    const rows = buildRows(
      report({
        packages: [
          { name: 'curl', version: '8.9.0' },
          { name: 'curl', version: '8.1.0' },
        ],
        findings: [finding('CVE-EXACT', 'curl', '8.1.0'), finding('CVE-ORPHAN', 'curl', '7.0.0')],
      })
    );

    expect(rows[0].findings.map((f) => f.id)).toEqual(['CVE-ORPHAN']);
    expect(rows[1].findings.map((f) => f.id)).toEqual(['CVE-EXACT']);
  });

  // An older report has findings and no inventory; the packages they name are
  // the inventory, and the same name at two versions is still two rows.
  it('makes an inventory out of the findings when there is none', () => {
    const rows = buildRows(
      report({
        findings: [finding('CVE-A', 'setuptools', '70.3.0'), finding('CVE-B', 'setuptools', '84.0.0')],
      })
    );

    expect(rows.map((row) => row.pkg.version)).toEqual(['70.3.0', '84.0.0']);
    expect(rows.map((row) => row.findings.length)).toEqual([1, 1]);
  });
});
