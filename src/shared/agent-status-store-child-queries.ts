import {
  serializeAgentChildWorkAliasKey,
  type AgentChildWorkAliasInput,
  type AgentChildWorkAliasRecord
} from './agent-status-child-work-alias'
import { storedAliasKey, storedRetiredAlias } from './agent-status-store-record-keys'
import {
  deepFreezeAgentStatusStoreValue,
  type AgentStatusStoreState
} from './agent-status-store-state'

/** Retired bindings fence delayed observations even after their child/history is removed. */
export function resolveAgentStatusChildBindings(
  state: AgentStatusStoreState,
  aliases: AgentChildWorkAliasInput[]
): AgentChildWorkAliasRecord[] {
  const keys = new Set(aliases.map(serializeAgentChildWorkAliasKey))
  const matches: AgentChildWorkAliasRecord[] = []
  for (const alias of state.aliases.values()) {
    if (keys.has(storedAliasKey(alias))) {
      matches.push(alias)
    }
  }
  for (const tombstone of state.tombstones.values()) {
    if (tombstone.entity !== 'alias' || state.aliases.has(tombstone.key)) {
      continue
    }
    const retired = storedRetiredAlias(tombstone)
    if (retired && keys.has(retired.key)) {
      matches.push(
        deepFreezeAgentStatusStoreValue({ ...retired.alias, revision: tombstone.revision })
      )
    }
  }
  return matches
}
