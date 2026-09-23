// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  armFloatingPanelReclaimIntent,
  clearFloatingPanelReclaimIntent,
  isFloatingPanelReclaimIntentArmed
} from '@/lib/floating-workspace-focus-reclaim'
import { useFloatingTerminalPanelFocusReclaim } from './use-floating-terminal-panel-focus-reclaim'

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

// Closing the panel's last tab from inside it keeps keyboard ownership. Save closes the note after
// an awaited write, so the intent can arm after the panel already rendered empty.
describe('floating panel keyboard reclaim ordering', () => {
  let panel: HTMLDivElement

  beforeEach(() => {
    clearFloatingPanelReclaimIntent()
    panel = document.createElement('div')
    panel.tabIndex = -1
    document.body.append(panel)
  })
  afterEach(() => {
    cleanup()
    panel.remove()
  })

  // Why refs made once: the panel's refs are stable, so its effect reruns only when its inputs change.
  function mountPanel(count: number) {
    const refs = {
      panelRef: { current: panel },
      shortcutFocusFrameRef: { current: null },
      shortcutFocusTimeoutRef: { current: null }
    }
    return renderHook(
      ({ visibleFloatingItemCount }) =>
        useFloatingTerminalPanelFocusReclaim({ ...refs, visibleFloatingItemCount }),
      { initialProps: { visibleFloatingItemCount: count } }
    )
  }

  it('reclaims when the intent arms after the panel rendered empty', async () => {
    const { rerender } = mountPanel(1)
    rerender({ visibleFloatingItemCount: 0 })

    act(() => armFloatingPanelReclaimIntent())
    await act(nextFrame)

    expect(document.activeElement).toBe(panel)
    expect(isFloatingPanelReclaimIntentArmed()).toBe(false)
  })

  // Why one batch: the reaction arms only once the store is already empty, as Discard's close does.
  it('reclaims when the intent arms in the same update that empties the panel', async () => {
    const { rerender } = mountPanel(1)

    act(() => {
      armFloatingPanelReclaimIntent()
      rerender({ visibleFloatingItemCount: 0 })
    })
    await act(nextFrame)

    expect(document.activeElement).toBe(panel)
    expect(isFloatingPanelReclaimIntentArmed()).toBe(false)
  })
})
