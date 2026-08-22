import { create } from 'zustand';
import { api } from '../services/api';
import { useToastStore } from './toastStore';
import { onNotify } from '../services/ipc';
import type { ScannerStatus, VulnerabilityReport } from '../types';

interface ScannerState {
  status: ScannerStatus | null;
  /** Last report per image reference, so reopening a tab is instant. */
  reports: Record<string, VulnerabilityReport>;
  setStatus: (status: ScannerStatus) => void;
  setReport: (reference: string, report: VulnerabilityReport) => void;
  clearReports: () => void;
}

export const useScannerStore = create<ScannerState>((set) => ({
  status: null,
  reports: {},
  setStatus: (status) => set({ status }),
  setReport: (reference, report) =>
    set((state) => ({ reports: { ...state.reports, [reference]: report } })),
  clearReports: () => set({ reports: {} }),
}));

/**
 * The agent installs the scanner, refreshes its database and runs scans on its
 * own goroutine, pushing where it has got to. Nothing here polls. Called once,
 * from the app root.
 */
export function subscribeToScanner(): () => void {
  const { setStatus, setReport } = useScannerStore.getState();

  // The agent may have finished its startup checks -- and a whole sweep of
  // scans -- before this window existed, so take what it already has.
  void api
    .getScannerStatus()
    .then(setStatus)
    .catch(() => {});

  void api
    .getScanReports()
    .then((reports) => {
      for (const [reference, report] of Object.entries(reports)) setReport(reference, report);
    })
    .catch(() => {});

  return onNotify((message) => {
    // Reports arrive on their own channel: a sweep never returns to idle
    // between images, so waiting for that would only ever catch the last one.
    if (message.method === 'scanner.result') {
      const report = message.params as VulnerabilityReport;
      if (report?.reference) setReport(report.reference, report);
      return;
    }

    if (message.method === 'scanner.status') {
      const next = message.params as ScannerStatus;
      const previous = useScannerStore.getState().status;

      // Said once, when it happens. The scanner used to report itself along the
      // title bar, which meant a failure sat there until something replaced it;
      // with that gone, this is the only thing that would otherwise pass in
      // silence -- and it is the only scanner state anybody needs telling about.
      if (next?.state === 'failed' && previous?.state !== 'failed') {
        useToastStore
          .getState()
          .push(next.detail || next.error || 'An image could not be scanned', 'error');
      }

      setStatus(next);
    }
  });
}
