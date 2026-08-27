import { useSettingsStore } from '../store/settingsStore';
import { DEFAULT_PROJECT } from '../utils/projects';

/**
 * The project the window is looking through.
 *
 * A window that has never chosen is in `default`, not in "All". That is how a
 * project works everywhere it already exists -- `lxc` puts you *inside*
 * default, `kubectl` inside the default namespace -- and it is the difference
 * between an app that opens on a point of view and one that opens on
 * everything at once. "All" is Dermaga's own, for widening; it is not
 * somewhere to stand.
 *
 * Read through here rather than off the store, so what an unset preference
 * means is written down once. It is unset far more often than it looks:
 * `activeProject` is stored with `omitempty`, so "" never reaches the file and
 * comes back as nothing at all.
 */
export function useActiveProject(): string {
  return useSettingsStore((s) => s.activeProject ?? DEFAULT_PROJECT);
}
