/** The floating panel's tab strips are its titlebar: a press on their empty chrome moves the panel. */
const FLOATING_TERMINAL_TITLEBAR_SELECTOR = '[data-tab-group-strip-id]'

/** Interactive chrome living inside the titlebar. `[data-tab-id]` and the client-hosted row marker
 *  cover every tab kind: a press on a tab starts a dnd-kit reorder, so it must never also move the panel. */
const FLOATING_TERMINAL_NO_DRAG_SELECTOR =
  'button,input,textarea,select,[role="menuitem"],[data-tab-id],[data-client-hosted-browser-row-id],[data-floating-terminal-no-drag]'

export function isFloatingTerminalDragTarget(target: EventTarget): boolean {
  // Why Element and not HTMLElement: a press on a tab's SVG icon must still resolve to its tab.
  if (typeof Element === 'undefined' || !(target instanceof Element)) {
    return false
  }
  return (
    target.closest(FLOATING_TERMINAL_TITLEBAR_SELECTOR) !== null &&
    target.closest(FLOATING_TERMINAL_NO_DRAG_SELECTOR) === null
  )
}
