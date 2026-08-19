import { create } from 'zustand';

/**
 * Which version's notes the user has already read.
 *
 * Kept in localStorage rather than in the settings file: it is a fact about
 * this window's history, not a preference worth syncing or a setting anyone
 * would look for in Settings.
 */
const KEY = 'dermaga.changelog.seen';

interface ChangelogState {
  seen: string | null;
  markSeen: (version: string) => void;
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Private mode, a wiped profile: the worst case is a dot that stays.
    return null;
  }
}

export const useChangelogStore = create<ChangelogState>((set) => ({
  seen: read(),
  markSeen: (version) => {
    try {
      localStorage.setItem(KEY, version);
    } catch {
      // Nothing to do; the dot simply comes back next launch.
    }

    set({ seen: version });
  },
}));

/** True when the running version's notes have not been opened yet. */
export function useUnreadChangelog(version?: string): boolean {
  const seen = useChangelogStore((s) => s.seen);
  return Boolean(version) && seen !== version;
}
