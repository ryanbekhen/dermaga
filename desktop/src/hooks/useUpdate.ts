import { useCallback, useEffect, useRef, useState } from 'react';
import { updates, type StagedUpdate, type UpdateCheck } from '../services/ipc';

type Stage =
  /** Nothing newer, or nobody has managed to ask yet. */
  | 'idle'
  /** Found and being fetched, quietly: nobody asked for this. */
  | 'fetching'
  /** Downloaded and checked. A restart is all that is left. */
  | 'ready'
  /** Downloaded, but it cannot be swapped in place -- the old road. */
  | 'manual'
  | 'installing'
  | 'failed';

/**
 * Keeps Dermaga up to date without making anybody wait for it.
 *
 * The old flow asked first and downloaded after, which put the wait between
 * pressing the button and being updated -- the worst place for it, since that
 * is the moment somebody has decided and wants it done. So the release is
 * fetched as soon as it is found, and the button appears only once there is
 * nothing left to do but restart.
 *
 * Checked again while the app runs, not only at launch. Dermaga lives in the
 * menu bar for days at a time; a check that happens once would mean the people
 * who never quit it are the last to hear about anything.
 */

/** How often to ask again. Often enough to matter, rare enough to be nothing. */
const CHECK_EVERY = 6 * 60 * 60 * 1000;

export function useUpdate() {
  const [found, setFound] = useState<UpdateCheck | null>(null);
  const [staged, setStaged] = useState<StagedUpdate | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // What is already in hand, so a later check for the same version does not
  // start the whole thing again.
  const fetching = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const look = () => {
      // A failed check is not worth reporting: the app works either way, and
      // the usual cause is simply being offline.
      void updates
        .check()
        .then((result) => {
          if (cancelled || !result.available || !result.assetUrl || !result.version) return;
          if (fetching.current === result.version) return;

          fetching.current = result.version;
          setFound(result);
          setStage('fetching');
          setPercent(0);

          return updates.stage(result.assetUrl, result.version).then((ready) => {
            if (cancelled) return;
            setStaged(ready);
            setStage(ready.restartable ? 'ready' : 'manual');
          });
        })
        .catch(() => {
          if (cancelled) return;
          // Nothing is said out loud: nobody asked for this download, so its
          // failure is not their problem to solve. The next check tries again.
          fetching.current = null;
          setStage((current) => (current === 'fetching' ? 'idle' : current));
        });
    };

    look();
    const timer = setInterval(look, CHECK_EVERY);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    return updates.onProgress(({ received, total }) => {
      setPercent(total > 0 ? Math.round((received / total) * 100) : 0);
    });
  }, []);

  const run = useCallback(async () => {
    if (!staged?.path) return;

    setStage('installing');
    setError(null);

    try {
      await updates.install(staged.path);
    } catch (err) {
      setStage('failed');
      setError(err instanceof Error ? err.message : 'The update could not be installed');
    }
  }, [staged]);

  return { update: found, staged, stage, percent, error, run };
}
