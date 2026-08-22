import { LicenceList } from '../components/LicenceList';

/**
 * A page of its own rather than a section of Help.
 *
 * Reproducing these notices is a condition of the licences the app ships
 * under, not a footnote to using it -- and someone looking for what Dermaga is
 * built on should not have to read past keyboard shortcuts to find it.
 */
export function LicencesPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <header>
          <h1 className="text-xl font-semibold">Licences</h1>
          <p className="text-tiny text-ink-600 dark:text-ink-400">
            Dermaga itself is MIT licensed. What it is built on is listed here in full.
          </p>
        </header>

        <LicenceList />
      </div>
    </div>
  );
}
