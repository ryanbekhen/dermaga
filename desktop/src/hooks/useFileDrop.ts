import { useEffect } from 'react';
import { onFilesDropped, resolveBuildDrop } from '../services/ipc';
import { useToastStore } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';

/**
 * A Dockerfile dragged in from Finder.
 *
 * Building one means telling the dialog the folder, the file within it and a
 * tag, and the first two are things the file already knows -- so dropping it on
 * the window fills them in and leaves the caret in the one field that is
 * genuinely a decision.
 *
 * Only the drop is handled here. What the window looks like while a file is
 * held over it is not a thing this side can see: on macOS the drag is caught by
 * a native view sitting over the web content, so no DOM drag event is ever
 * delivered -- Wails puts a class on the drop target instead, and the stylesheet
 * answers it. See `.file-drop-target-active` in index.css.
 */
export function useFileDrop(): void {
  const navigateWith = useUIStore((s) => s.navigateWith);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    return onFilesDropped((paths, target) => {
      // The file browser marks itself and copies what lands on it. Its drops
      // are not builds, and it has already handled them.
      if (target === 'container-files') return;

      void resolveBuildDrop(paths)
        .then((drop) => {
          if (!drop) {
            pushToast('Drop a Dockerfile, or a folder with one in it, to build an image', 'error');
            return;
          }

          navigateWith({ name: 'images' }, 'image.build', drop);
        })
        .catch(() => {
          // The shell could not read the path. Nothing to open, and nothing to
          // say about it that the drop not working has not said already.
        });
    });
  }, [navigateWith, pushToast]);
}
