import { useEffect, type MutableRefObject } from 'react'
import type { AgentSessionModelCatalogResult } from '../../../../shared/agent-session-wire'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { AgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import {
  applyStructuredAgentSessionModelCatalog,
  type StructuredAgentSessionOptionState
} from '../../../../shared/structured-agent-session-options'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import type { NativeChatSessionOptionRecord } from '../../../../shared/native-chat-session-option-state'

/**
 * Upgrades the static seed with the host's stored catalog without waiting on
 * attach. A record-less read (no session yet) resolves the account a launch
 * would pin, so the picker warms during create. An older host answers
 * `forbidden` or `method_not_found` — both mean "no such surface", so the seed
 * stands until the live read lands.
 */
export function useHostModelCatalogUpgrade(args: {
  agent: AgentType
  sessionId: string
  target: RuntimeClientTarget
  optionCatalog: AgentSessionOptionCatalog | null
  namesDefault: boolean
  fence: number | null
  activeOptionRecordRef: MutableRefObject<NativeChatSessionOptionRecord>
  updateOptionState: (
    update: (current: StructuredAgentSessionOptionState) => StructuredAgentSessionOptionState
  ) => void
}): void {
  const {
    activeOptionRecordRef,
    agent,
    fence,
    namesDefault,
    optionCatalog,
    sessionId,
    target,
    updateOptionState
  } = args
  useEffect(() => {
    if (!optionCatalog || (agent !== 'claude' && agent !== 'codex')) {
      return
    }
    let stale = false
    void callStructuredAgentSession<AgentSessionModelCatalogResult>(
      target,
      'agentSession.modelCatalog',
      { agent, sessionId }
    )
      .then((catalog) => {
        if (!stale) {
          updateOptionState((current) =>
            current.record === activeOptionRecordRef.current
              ? applyStructuredAgentSessionModelCatalog(current, optionCatalog, catalog, {
                  namesDefault
                })
              : current
          )
        }
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [
    activeOptionRecordRef,
    agent,
    fence,
    namesDefault,
    optionCatalog,
    sessionId,
    target,
    updateOptionState
  ])
}
