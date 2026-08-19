import { useState } from 'react';
import { useUIStore, type Intent } from '../store/uiStore';

/**
 * A dialog that either this page opened or someone else asked for on the way in.
 *
 * The command palette can then mean "pull an image" rather than "go to Images
 * and press the button", without any page exporting its own state. Derived
 * rather than copied into an effect: an intent that arrives with the route is
 * already true on the first render, so there is nothing to synchronise.
 */
export function useDialog(intent: Intent) {
  const [open, setOpen] = useState(false);
  const wanted = useUIStore((s) => s.intent) === intent;
  const target = useUIStore((s) => s.intentTarget);
  const clearIntent = useUIStore((s) => s.clearIntent);

  return {
    open: open || wanted,
    /** What the intent named, for dialogs that act on one thing. */
    target: wanted ? target : null,
    show: () => setOpen(true),
    close: () => {
      setOpen(false);
      // Otherwise the dialog would reopen the moment anything re-renders.
      if (wanted) clearIntent();
    },
  };
}
