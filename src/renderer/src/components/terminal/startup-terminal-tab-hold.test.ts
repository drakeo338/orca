// @vitest-environment happy-dom

/**
 * Defect under test: the restored workspace surface used to wait for the whole
 * startup chain (SSH reconnect, PTY reconnect, legacy worker recovery) before it
 * mounted, so a session whose tab model had been in the store for seconds painted
 * nothing at all. Only terminal panes need that chain — they bind a PTY on mount.
 * The surface now mounts on the tab model, and terminal tabs are held unadmitted
 * until the gate opens and the activation plan replaces the hold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { applyTerminalColdActivation } from '../terminal-cold-activation'
import { useActivationDeferredTabAdmission } from './use-activation-deferred-tab-admission'
import {
  pruneClosedBackgroundMountTabs,
  revealActivationDeferredTabs,
  shouldMountBackgroundWorktreeTab
} from './background-terminal-worktree-mount'
import { holdTerminalTabsForStartup } from './startup-terminal-tab-hold'
import type { TabGroup, TabGroupLayoutNode } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { TerminalParkingFoundation } from '../use-terminal-parking-foundation'

const WORKTREE_ID = 'repo::/worktree'
const OTHER_WORKTREE_ID = 'repo::/other-worktree'
const TAB_1 = 'tab-1'
const TAB_2 = 'tab-2'
const GROUP_ID = 'group-1'
const SURFACE_IDS = [WORKTREE_ID, OTHER_WORKTREE_ID]

const initialState = useAppStore.getInitialState()
const originalRequestIdle = globalThis.requestIdleCallback
const originalCancelIdle = globalThis.cancelIdleCallback

function terminalTab(id: string, worktreeId: string): TerminalTab {
  return {
    id,
    ptyId: `${worktreeId}@@${id}`,
    worktreeId,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function leafLayout(worktreeId: string): {
  groups: TabGroup[]
  layout: TabGroupLayoutNode
} {
  return {
    groups: [
      { id: GROUP_ID, worktreeId, activeTabId: TAB_1, tabOrder: [TAB_1, TAB_2], recentTabIds: [] }
    ],
    layout: { type: 'leaf', groupId: GROUP_ID }
  }
}

type HarnessProps = { worktreeId: string | null; gateOpen: boolean }

/** Mirrors use-terminal-controller.ts: cold activation during render, then admission. */
function useStartupHoldHarness(props: HarnessProps) {
  const backgroundMountTabIdsByWorktreeRef = useRef(new Map<string, ReadonlySet<string>>())
  const activationDeferredMountTabIdsByWorktreeRef = useRef(new Map<string, ReadonlySet<string>>())
  const lastActivationWorktreeIdRef = useRef<string | null>(null)
  const mountedWorktreeIdsRef = useRef(new Set<string>())
  const activationDeferralPlanRevisionRef = useRef(0)
  const [backgroundMountRevision, setBackgroundMountRevision] = useState(0)
  const restored = leafLayout(props.worktreeId ?? WORKTREE_ID)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: applyTerminalColdActivation and the admission hook read only the fields listed here; the rest of the foundation is render machinery this harness never exercises.
  const foundation = {
    activationDeferralPlanRevisionRef,
    activationDeferredMountTabIdsByWorktreeRef,
    activeGroupIdByWorktree: props.worktreeId ? { [props.worktreeId]: GROUP_ID } : {},
    activeTabId: TAB_1,
    activeTabIdByWorktree: props.worktreeId ? { [props.worktreeId]: TAB_1 } : {},
    activeWorktreeDeferralHostId: 'local',
    activityTerminalPortals: [],
    backgroundMountRevision,
    backgroundMountTabIdsByWorktreeRef,
    groupsByWorktree: props.worktreeId ? { [props.worktreeId]: restored.groups } : {},
    hydrationSucceeded: props.gateOpen,
    lastActivationWorktreeIdRef,
    layoutByWorktree: props.worktreeId ? { [props.worktreeId]: restored.layout } : {},
    mountedWorktreeIdsRef,
    pairedRuntimeParkingEnvironmentIds: new Set<string>(),
    pendingStartupByTabId: {},
    renderedActiveWorktreeId: props.worktreeId,
    setBackgroundMountRevision,
    startupWorktreeRefreshCompleted: props.gateOpen,
    tabsByWorktree: useAppStore.getState().tabsByWorktree,
    terminalParkingEnabled: true,
    terminalTitleSnapshotAuthorityEnabled: true,
    workspaceSessionReady: props.gateOpen,
    workspaceSurfaceIds: SURFACE_IDS,
    workspaceSurfaceIdSet: new Set(SURFACE_IDS)
  } as unknown as TerminalParkingFoundation
  const coldActivation = Object.assign(foundation, applyTerminalColdActivation(foundation))
  useActivationDeferredTabAdmission(coldActivation)
  return {
    activationDeferredMountTabIdsByWorktreeRef,
    anyMountedWorktreeHasLayout: coldActivation.anyMountedWorktreeHasLayout,
    backgroundMountTabIdsByWorktreeRef,
    mountedWorktreeIdsRef
  }
}

function admits(
  restrictions: Map<string, ReadonlySet<string>>,
  worktreeId: string,
  tabId: string
): boolean {
  return shouldMountBackgroundWorktreeTab(restrictions.get(worktreeId) ?? null, tabId)
}

describe('startup terminal tab hold', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
    useAppStore.setState({
      tabsByWorktree: {
        [WORKTREE_ID]: [terminalTab(TAB_1, WORKTREE_ID), terminalTab(TAB_2, WORKTREE_ID)],
        [OTHER_WORKTREE_ID]: [terminalTab(TAB_1, OTHER_WORKTREE_ID)]
      }
    })
    // Deterministic drain: force scheduleActivationDeferredAdmission onto timers.
    // @ts-expect-error -- exercising the no-requestIdleCallback environment
    globalThis.requestIdleCallback = undefined
    // @ts-expect-error -- exercising the no-requestIdleCallback environment
    globalThis.cancelIdleCallback = undefined
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    globalThis.requestIdleCallback = originalRequestIdle
    globalThis.cancelIdleCallback = originalCancelIdle
    useAppStore.setState(initialState, true)
  })

  it('mounts the restored surface before the gate opens and holds every terminal tab', () => {
    const { result, rerender } = renderHook(useStartupHoldHarness, {
      initialProps: { worktreeId: WORKTREE_ID, gateOpen: false }
    })
    const restrictions = result.current.backgroundMountTabIdsByWorktreeRef.current

    // The surface mounts from the tab model alone...
    expect(result.current.mountedWorktreeIdsRef.current.has(WORKTREE_ID)).toBe(true)
    expect(result.current.anyMountedWorktreeHasLayout).toBe(true)
    // ...while no terminal pane may bind a PTY yet, and none is idle-admission work.
    expect(admits(restrictions, WORKTREE_ID, TAB_1)).toBe(false)
    expect(admits(restrictions, WORKTREE_ID, TAB_2)).toBe(false)
    expect(result.current.activationDeferredMountTabIdsByWorktreeRef.current.has(WORKTREE_ID)).toBe(
      false
    )
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(admits(restrictions, WORKTREE_ID, TAB_1)).toBe(false)

    // The gate opening runs the activation plan, which replaces the hold.
    rerender({ worktreeId: WORKTREE_ID, gateOpen: true })
    expect(result.current.mountedWorktreeIdsRef.current.has(WORKTREE_ID)).toBe(true)
    expect(admits(restrictions, WORKTREE_ID, TAB_1)).toBe(true)
    expect(admits(restrictions, WORKTREE_ID, TAB_2)).toBe(true)
  })

  it('returns a workspace switched away from mid-startup to the unmounted world', () => {
    const { result, rerender } = renderHook(useStartupHoldHarness, {
      initialProps: { worktreeId: WORKTREE_ID, gateOpen: false }
    })
    expect(result.current.mountedWorktreeIdsRef.current.has(WORKTREE_ID)).toBe(true)

    rerender({ worktreeId: OTHER_WORKTREE_ID, gateOpen: false })
    const restrictions = result.current.backgroundMountTabIdsByWorktreeRef.current
    expect(result.current.mountedWorktreeIdsRef.current.has(WORKTREE_ID)).toBe(false)
    expect(restrictions.has(WORKTREE_ID)).toBe(false)
    expect(result.current.mountedWorktreeIdsRef.current.has(OTHER_WORKTREE_ID)).toBe(true)
    expect(admits(restrictions, OTHER_WORKTREE_ID, TAB_1)).toBe(false)

    rerender({ worktreeId: OTHER_WORKTREE_ID, gateOpen: true })
    expect(admits(restrictions, OTHER_WORKTREE_ID, TAB_1)).toBe(true)
  })

  it('does not mount a surface with no active workspace', () => {
    const { result } = renderHook(useStartupHoldHarness, {
      initialProps: { worktreeId: null, gateOpen: false }
    })
    expect(result.current.mountedWorktreeIdsRef.current.size).toBe(0)
    expect(result.current.backgroundMountTabIdsByWorktreeRef.current.size).toBe(0)
  })
})

describe('holdTerminalTabsForStartup', () => {
  it('admits no terminal tab of a worktree that has not mounted yet', () => {
    const restrictions = new Map<string, ReadonlySet<string>>()
    const deferred = new Map<string, ReadonlySet<string>>()
    const mounted = new Set<string>()

    holdTerminalTabsForStartup(restrictions, deferred, mounted, 'wt-active')

    expect(restrictions.get('wt-active')).toEqual(new Set())
    expect(shouldMountBackgroundWorktreeTab(restrictions.get('wt-active') ?? null, 'tab-1')).toBe(
      false
    )
    expect(deferred.has('wt-active')).toBe(false)
  })

  it('keeps a targeted background mount that landed first and never narrows a full mount', () => {
    const restrictions = new Map<string, ReadonlySet<string>>([['wt-active', new Set(['tab-1'])]])
    const deferred = new Map<string, ReadonlySet<string>>()
    const mounted = new Set<string>(['wt-full'])

    holdTerminalTabsForStartup(restrictions, deferred, mounted, 'wt-active')
    expect(restrictions.get('wt-active')).toEqual(new Set(['tab-1']))

    holdTerminalTabsForStartup(restrictions, deferred, mounted, 'wt-full')
    expect(restrictions.has('wt-full')).toBe(false)
  })

  it('survives prune and reveal passes untouched', () => {
    const restrictions = new Map<string, ReadonlySet<string>>()
    const deferred = new Map<string, ReadonlySet<string>>()
    const mounted = new Set<string>()
    holdTerminalTabsForStartup(restrictions, deferred, mounted, 'wt-active')
    mounted.add('wt-active')

    expect(
      pruneClosedBackgroundMountTabs(
        restrictions,
        mounted,
        { 'wt-active': [{ id: 'tab-1' }] },
        deferred
      )
    ).toBe(false)
    revealActivationDeferredTabs({
      restrictions,
      deferredMountTabIdsByWorktree: deferred,
      worktreeId: 'wt-active',
      allTabIds: ['tab-1'],
      immediateTabIds: new Set(['tab-1'])
    })
    expect(restrictions.get('wt-active')).toEqual(new Set())
    expect(mounted.has('wt-active')).toBe(true)
  })

  it('releases holds on other worktrees but leaves targeted and activation restrictions alone', () => {
    const restrictions = new Map<string, ReadonlySet<string>>([
      ['wt-previous', new Set()],
      ['wt-targeted', new Set(['tab-wake'])],
      ['wt-activation', new Set()]
    ])
    const deferred = new Map<string, ReadonlySet<string>>([
      ['wt-activation', new Set(['tab-deferred'])]
    ])
    const mounted = new Set<string>(['wt-previous', 'wt-targeted', 'wt-activation'])

    holdTerminalTabsForStartup(restrictions, deferred, mounted, 'wt-active')

    expect(restrictions.has('wt-previous')).toBe(false)
    expect(mounted.has('wt-previous')).toBe(false)
    expect(restrictions.get('wt-targeted')).toEqual(new Set(['tab-wake']))
    expect(restrictions.get('wt-activation')).toEqual(new Set())
    expect(mounted.has('wt-targeted')).toBe(true)
    expect(mounted.has('wt-activation')).toBe(true)
    expect(restrictions.get('wt-active')).toEqual(new Set())
  })
})
