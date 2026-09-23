import type { AppState } from './types'

export type FloatingWorkspacePanelVisibilityState = Pick<
  AppState,
  'settings' | 'floatingWorkspacePanelOpen'
>

/**
 * Whether the floating workspace panel is on screen. The overlay only renders while the feature is
 * on, and its panel is aria-hidden while closed — so that pair is what "on screen" means.
 */
export function selectFloatingWorkspacePanelVisible(
  state: FloatingWorkspacePanelVisibilityState
): boolean {
  return state.settings?.floatingTerminalEnabled === true && state.floatingWorkspacePanelOpen
}
