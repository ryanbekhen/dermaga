import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useScannerStore } from '../store/scannerStore';
import { useToastStore } from '../store/toastStore';
import type { VulnerabilityReport } from '../types';

export interface ImageScan {
  /** The stored result, or undefined until one has been made. */
  report?: VulnerabilityReport;
  /** True while this image is the one being scanned. */
  scanning: boolean;
  /** True while the scanner is installing itself or its database. */
  preparing: boolean;
  /** What the scanner is doing, for the sentence shown while it does it. */
  detail?: string;
  /** Whether the scanner is on this Mac at all. */
  installed: boolean;
  /** Asks for a scan now, rather than waiting for the sweep to reach it. */
  scan: () => Promise<void>;
}

/**
 * One image's scan, shared by everything that reads it.
 *
 * There is a single scan behind the vulnerabilities, the package list and the
 * layer sizes: Trivy reads the image once and reports all three, and the
 * result is stored once. So there is one control for it too, on the page
 * rather than inside whichever tab happens to show part of the answer — a
 * Rescan button that lived in the Vulnerabilities tab looked like it refreshed
 * vulnerabilities, and left the other two tabs looking stale for no reason.
 *
 * Nothing here waits to be pressed. The scanner works through images on its own
 * as it finds them; this only says "do that one next".
 */
export function useImageScan(reference: string): ImageScan {
  const status = useScannerStore((s) => s.status);
  const report = useScannerStore((s) => s.reports[reference]);
  const setReport = useScannerStore((s) => s.setReport);
  const pushToast = useToastStore((s) => s.push);

  // What the stored result was when a scan was asked for. The wait ends when
  // that changes, rather than when a timestamp overtakes the click: results
  // are stamped to the second while the click is known to the millisecond, so
  // a scan finishing in the same second as the click -- 0.3s is typical --
  // never appeared to be newer, and the button span for ever.
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (report) return;

    void api
      .getScanReport(reference)
      .then((found) => found && setReport(reference, found))
      .catch(() => {});
  }, [reference, report, setReport]);

  // A scan that failed has ended, so the wait is over -- and over for good,
  // not only for as long as the status bar happens to still say "failed".
  //
  // The wait used to be hidden while that state stood rather than ended, so
  // dismissing the failure put the button straight back into "Scanning…" with
  // nothing left running to ever bring it out again. Subscribed to rather than
  // derived, because the end of the wait is an event: it happens once, when
  // the scanner gives up, and there is no later render that can tell.
  useEffect(() => {
    return useScannerStore.subscribe((state, previous) => {
      if (state.status?.state === 'failed' && previous.status?.state !== 'failed') {
        setPending(null);
      }
    });
  }, []);

  const scanning =
    (status?.state === 'scanning' && status.target === reference) ||
    (pending !== null && (report?.scannedAt ?? '') === pending);

  const preparing =
    status?.state === 'installing' ||
    status?.state === 'updating' ||
    status?.state === 'updatingDatabase';

  const scan = async () => {
    setPending(report?.scannedAt ?? '');

    try {
      await api.scanImage(reference);
    } catch (err) {
      // The ask never became a scan, so there is nothing to wait for. Left
      // standing, the button would spin on a scan that was refused outright.
      setPending(null);
      pushToast(err instanceof Error ? err.message : 'Could not start the scan', 'error');
    }
  };

  return {
    report,
    scanning,
    preparing,
    detail: status?.detail,
    installed: status?.installed ?? false,
    scan,
  };
}
