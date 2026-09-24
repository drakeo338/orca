// Grok's per-pane background-task inventory: what Grok last reported running behind the main
// agent, and the child-lifecycle adjustments to it. Kept apart from grok-events so the event
// mapping stays about turn state. Measured against Grok 1.0.41:
// src/shared/__fixtures__/grok-cancel-subagent-dialog-hooks.jsonl.
import {
  normalizeAgentStatusPayload,
  type ParsedAgentStatusPayload
} from '../../agent-status-types'
import { foldAgentLeadStatus } from '../../agent-lead-status-fold'
import type { AgentChildWorkKind } from '../../agent-status-child-work'
import {
  agentChildWorkLiveness,
  type AgentChildWorkLiveness,
  type AgentChildWorkLivenessCandidate
} from '../../agent-status-child-work-liveness'
import type { HookListenerState } from '../listener-state'
import { resolvePrompt, resolveToolState } from '../prompt-fields'
import { readString } from '../tool-input-preview'
import { isGrokEvent } from '../provider-event-names'

function aliasedField(
  payload: Record<string, unknown>,
  primary: string,
  alias: string
): { present: boolean; value?: unknown } {
  if (Object.hasOwn(payload, primary)) {
    return { present: true, value: payload[primary] }
  }
  if (Object.hasOwn(payload, alias)) {
    return { present: true, value: payload[alias] }
  }
  return { present: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function grokIdentityField(
  hookPayload: Record<string, unknown>,
  primary: string,
  alias: string
): string | undefined {
  const value = readString(hookPayload, primary) ?? readString(hookPayload, alias)
  return value && value.length <= 512 ? value : undefined
}

/** A finite `backgroundTasks[]` entry as child work. Grok lists only in-flight tasks, so none
 *  carries a settled state. Monitors are left out: they can run indefinitely and would hold the
 *  pane (and silence its completion) forever. */
function grokFiniteTaskKind(task: unknown): AgentChildWorkKind | null {
  if (!isRecord(task)) {
    return null
  }
  return task.type === 'subagent' ? 'agent' : task.type === 'shell' ? 'command' : null
}

/** A hook that carries the `backgroundTasks` key restates the pane's inventory whole; one without
 *  it (measured: `stop_cancelled`) leaves the last reported inventory standing. */
export function restateGrokTaskInventory(
  state: HookListenerState,
  paneKey: string,
  hookPayload: Record<string, unknown>
): void {
  const backgroundTasks = aliasedField(hookPayload, 'backgroundTasks', 'background_tasks')
  if (!backgroundTasks.present || !Array.isArray(backgroundTasks.value)) {
    return
  }
  const inventory = new Map<string, AgentChildWorkKind>()
  backgroundTasks.value.forEach((task, index) => {
    const kind = grokFiniteTaskKind(task)
    if (!kind) {
      return
    }
    const id = isRecord(task) ? readString(task, 'id') : undefined
    inventory.set(id ?? `unidentified-task-${index}`, kind)
  })
  if (inventory.size === 0) {
    state.grokBackgroundTasksByPaneKey.delete(paneKey)
  } else {
    state.grokBackgroundTasksByPaneKey.set(paneKey, inventory)
  }
}

/** What the turn's end leaves running behind the main agent, from the inventory Grok last
 *  reported. A background subagent is agent work and keeps the pane `working`; a shell, or a
 *  still-active stop hook holding the turn, is watch work and reads as monitoring. */
export function grokChildWorkLivenessAfterTurnEnd(
  state: HookListenerState,
  paneKey: string,
  hookPayload: Record<string, unknown>
): AgentChildWorkLiveness {
  const stopHookActive = aliasedField(hookPayload, 'stopHookActive', 'stop_hook_active')
  const candidates: AgentChildWorkLivenessCandidate[] = [
    ...(state.grokBackgroundTasksByPaneKey.get(paneKey)?.values() ?? [])
  ].map((kind) => ({ kind }))
  return agentChildWorkLiveness(candidates) ?? (stopHookActive.value === true ? 'monitoring' : null)
}

/** A child's lifecycle cannot settle the parent, but it does adjust the task inventory: a
 *  SubagentStart joins it, and a subagent's own end (SubagentStop, or the child's SessionEnd —
 *  the only signal a killed subagent leaves, its session id equal to the SubagentStart's
 *  subagentId) drops it. When that inventory is the only thing holding a settled row open, the
 *  drop re-derives the row so the pane does not keep reporting work Grok no longer runs. */
export function normalizeGrokSubagentLifecycleEvent(
  state: HookListenerState,
  eventName: unknown,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const subagentId =
    grokIdentityField(hookPayload, 'subagentId', 'subagent_id') ??
    grokIdentityField(hookPayload, 'sessionId', 'session_id')
  if (!subagentId) {
    return null
  }
  if (isGrokEvent(eventName, 'subagent_start')) {
    const inventory =
      state.grokBackgroundTasksByPaneKey.get(paneKey) ?? new Map<string, AgentChildWorkKind>()
    inventory.set(subagentId, 'agent')
    state.grokBackgroundTasksByPaneKey.set(paneKey, inventory)
    return null
  }
  if (!isGrokEvent(eventName, 'subagent_stop', 'subagent_end', 'session_end')) {
    return null
  }
  const inventory = state.grokBackgroundTasksByPaneKey.get(paneKey)
  if (!inventory?.delete(subagentId)) {
    return null
  }
  if (inventory.size === 0) {
    state.grokBackgroundTasksByPaneKey.delete(paneKey)
  }
  const mainAgent = state.grokMainAgentStatusByPaneKey.get(paneKey)
  // Why: a live lead turn already owns the row; only a row the inventory holds open re-derives.
  if (mainAgent?.state !== 'done') {
    return null
  }
  const resolution = foldAgentLeadStatus({
    leadState: 'done',
    childWorkLiveness: grokChildWorkLivenessAfterTurnEnd(state, paneKey, hookPayload)
  })
  const snapshot = resolveToolState(state, paneKey, {}, { resetOnNewTurn: false })
  return normalizeAgentStatusPayload({
    state: resolution.stateName,
    prompt: resolvePrompt(state, paneKey, '', { resetOnNewTurn: false }),
    agentType: 'grok',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    lastAssistantMessageIsToolOutput: snapshot.lastAssistantMessageIsToolOutput,
    ...(resolution.workingMode ? { workingMode: resolution.workingMode } : {}),
    ...(mainAgent.outcome === 'cancellation' ? { interrupted: true } : {}),
    mainAgent
  })
}
