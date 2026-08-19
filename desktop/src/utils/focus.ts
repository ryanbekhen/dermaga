/**
 * Where Tab should land when it reaches the edge of a dialog.
 *
 * A modal covers the page but does not remove it: without this, Tab off the
 * last field lands on whatever button is behind the overlay, which the user
 * cannot see and did not mean to reach.
 *
 * `null` means the browser's own behaviour is right and nothing should be
 * intercepted -- most of the time.
 */
export function tabWrap(
  count: number,
  /** Position of the focused element among the dialog's stops, or -1 if it escaped. */
  activeIndex: number,
  shiftKey: boolean
): 'first' | 'last' | null {
  if (count === 0) return null;

  // Focus outside the dialog is already wrong, wherever Tab was heading.
  if (activeIndex < 0) return shiftKey ? 'last' : 'first';

  if (shiftKey) return activeIndex === 0 ? 'last' : null;

  return activeIndex === count - 1 ? 'first' : null;
}
