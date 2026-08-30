import { type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { MenuButton } from './MenuButton';

/**
 * The switches that narrow a list, behind one button.
 *
 * They were two controls in the header, and as words they crowded the row that
 * also holds what the page is opened to *do*. Folded in here they take one
 * button's worth of room and can say what they actually mean -- "Show
 * containers that are not running" rather than "Stopped", which is the whole
 * difference between a label somebody reads and one they interpret.
 *
 * Folding them away is safe because the list itself says when they have
 * emptied it. A filter nobody can see is a filter nobody remembers, and the
 * failure that causes is an empty list reading as lost work -- which is exactly
 * what happened once: the services restarted, every container came back
 * stopped, and the page looked as though the containers were gone. The answer
 * to that is where the emptiness is, in words, rather than a mark up here that
 * says something is wrong without saying what. The count is in the tooltip for
 * the quieter case, where some rows are held back and the list is not empty.
 */
export function FilterMenu({ hidden, children }: { hidden: number; children: ReactNode }) {
  const said = `${hidden} ${hidden === 1 ? 'container is' : 'containers are'}`;

  return (
    <MenuButton
      icon={SlidersHorizontal}
      label={hidden > 0 ? `Filters — ${said} hidden` : 'Filters'}
      title={hidden > 0 ? `${said} hidden by a filter` : 'Filters'}
    >
      {children}
    </MenuButton>
  );
}
