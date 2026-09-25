import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentSessionConversationCommand } from '../../../../shared/agent-session-conversation-command'
import type {
  AgentSessionOptionResult,
  AgentSessionOptionsResult
} from '../../../../shared/agent-session-wire'
import type { AgentType } from '../../../../shared/agent-status-types'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import type { SessionOptionsSurface } from '../../../../shared/native-chat-session-options'
import {
  applyStructuredAgentSessionOptions,
  canSetStructuredAgentSessionOption,
  commitStructuredAgentSessionOptionValues,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionPicks,
  structuredAgentSessionOptionSnapshot,
  structuredAgentSessionOptionView,
  type StructuredAgentSessionOptionState
} from '../../../../shared/structured-agent-session-options'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { enqueueSessionOptionSettingsWrite } from './native-chat-session-option-settings-write'
import { encodeStructuredAgentSessionOptionValue } from '../../../../shared/structured-agent-session-option-codec'
import type { StructuredAgentSessionMutate } from './use-structured-agent-session-mutate'
import {
  createCoalescedPollRunner,
  type CoalescedPollRunner
} from '../right-sidebar/coalesced-poll-runner'
import { useHostModelCatalogUpgrade } from './use-host-model-catalog-upgrade'
import {
  useHeldStructuredOptionPicks,
  type StructuredOptionSendOutcome
} from './use-held-structured-option-picks'

export function useStructuredAgentSessionOptions(args: {
  agent: AgentType
  sessionId: string
  target: RuntimeClientTarget
  transportEnabled: boolean
  providerVisible: boolean
  fence: number | null
  turnId: string | null
  unloadedTurnRevisions: number | undefined
  mutate: StructuredAgentSessionMutate
  /** The encoded selection a launch seeds, shown until the host names the model. */
  launchSeedOptions?: Readonly<Record<string, string>>
}) {
  const {
    agent,
    fence,
    launchSeedOptions,
    mutate,
    providerVisible,
    sessionId,
    target,
    transportEnabled,
    turnId
  } = args
  const [conversationSupport, setConversationSupport] = useState<{
    sessionId: string
    commands: readonly AgentSessionConversationCommand[]
    threadGoal: AgentSessionOptionsResult['threadGoal']
    contextUsage: AgentSessionOptionsResult['contextUsage']
  } | null>(null)
  // A revision the loaded window dropped can move the host's whole-journal context facts.
  const contextRefresh = conversationSupport?.contextUsage ? (args.unloadedTurnRevisions ?? 0) : 0
  const optionCatalog = useMemo(() => getAgentSessionOptionCatalog(agent), [agent])
  const identity = `${agent}:${sessionId}`
  // Seeded from the first frame: the picker renders the static catalog while
  // create, attach and the first live options read are still running.
  const [optionState, setOptionState] = useState(() =>
    createStructuredAgentSessionOptionState(agent, optionCatalog)
  )
  const optionStateRef = useRef(optionState)
  const activeOptionRecordRef = useRef(optionState.record)
  const pendingOptionRef = useRef<string | null>(null)
  const optionMutationGeneration = useRef(0)
  const updateOptionState = useCallback(
    (update: (current: StructuredAgentSessionOptionState) => StructuredAgentSessionOptionState) => {
      const next = update(optionStateRef.current)
      optionStateRef.current = next
      setOptionState(next)
    },
    []
  )
  const optionIdentityRef = useRef(identity)
  useEffect(() => {
    const previous = optionStateRef.current
    const sameSession = optionIdentityRef.current === identity
    optionIdentityRef.current = identity
    const seeded = createStructuredAgentSessionOptionState(
      agent,
      getAgentSessionOptionCatalog(agent)
    )
    // A host catalog is the account's, not the fence's: keep it rather than blank the default.
    const next =
      sameSession && previous.catalogSource === 'host'
        ? { ...seeded, catalog: previous.catalog, catalogSource: previous.catalogSource }
        : seeded
    optionMutationGeneration.current += 1
    pendingOptionRef.current = null
    optionStateRef.current = next
    activeOptionRecordRef.current = next.record
    setOptionState(next)
  }, [agent, fence, identity])

  useHostModelCatalogUpgrade({
    agent,
    sessionId,
    target,
    optionCatalog,
    fence,
    activeOptionRecordRef,
    updateOptionState
  })

  const optionsReadRef = useRef<CoalescedPollRunner | null>(null)
  // Refresh options each turn to confirm which model the provider actually selected.
  useEffect(() => {
    if (!providerVisible || !optionCatalog) {
      return
    }
    let stale = false
    const runner = createCoalescedPollRunner(async () => {
      const readGeneration = optionMutationGeneration.current
      const result = await callStructuredAgentSession<AgentSessionOptionsResult>(
        target,
        'agentSession.options',
        { sessionId }
      )
      if (!stale && optionMutationGeneration.current === readGeneration) {
        setConversationSupport({
          sessionId,
          commands: result.conversationCommands ?? [],
          threadGoal: result.threadGoal,
          contextUsage: result.contextUsage
        })
        updateOptionState((current) =>
          current.record === activeOptionRecordRef.current
            ? applyStructuredAgentSessionOptions(current, optionCatalog, result)
            : current
        )
      }
    })
    optionsReadRef.current = runner
    runner.run()
    return () => {
      stale = true
      runner.dispose()
    }
  }, [fence, optionCatalog, providerVisible, sessionId, target, turnId, updateOptionState])

  // Reads share the session's host queue with sends and interrupts, so a burst of
  // missed revisions keeps one read in flight and at most one behind it.
  const seenContextRefresh = useRef(contextRefresh)
  useEffect(() => {
    if (contextRefresh !== seenContextRefresh.current) {
      seenContextRefresh.current = contextRefresh
      optionsReadRef.current?.run()
    }
  }, [contextRefresh])

  const sendStructuredOption = useCallback(
    async (id: string, encoded: string): Promise<StructuredOptionSendOutcome> => {
      const currentState = optionStateRef.current
      const targetRecord = currentState.record
      const mutationGeneration = ++optionMutationGeneration.current
      const isCurrent = (): boolean =>
        activeOptionRecordRef.current === targetRecord &&
        optionMutationGeneration.current === mutationGeneration
      pendingOptionRef.current = id
      updateOptionState((current) => ({ ...current, pendingId: id }))
      try {
        const result = await mutate<AgentSessionOptionResult>(
          'agentSession.setOption',
          'agentSession.setOption',
          { key: id, value: encoded }
        )
        if (!result) {
          return isCurrent() ? 'refused' : 'superseded'
        }
        if (isCurrent()) {
          const committed = result.options ?? { [id]: encoded }
          updateOptionState((current) =>
            current.record === targetRecord
              ? commitStructuredAgentSessionOptionValues(current, committed)
              : current
          )
          // The launch seed names the model an effort-only pick was made under.
          const picks = structuredAgentSessionOptionPicks(
            structuredAgentSessionOptionView(currentState, launchSeedOptions, {}),
            committed
          )
          if (picks.length > 0) {
            void enqueueSessionOptionSettingsWrite(target, { type: 'apply-picks', agent, picks })
          }
          void callStructuredAgentSession<AgentSessionOptionsResult>(
            target,
            'agentSession.options',
            { sessionId }
          )
            .then((refreshed) => {
              if (isCurrent()) {
                updateOptionState((latest) =>
                  latest.record === targetRecord && optionCatalog
                    ? applyStructuredAgentSessionOptions(latest, optionCatalog, refreshed)
                    : latest
                )
              }
            })
            .catch(() => {})
        }
        return 'accepted'
      } finally {
        if (isCurrent()) {
          pendingOptionRef.current = null
          updateOptionState((current) =>
            current.record === targetRecord && current.pendingId === id
              ? { ...current, pendingId: null }
              : current
          )
        }
      }
    },
    [agent, launchSeedOptions, mutate, optionCatalog, sessionId, target, updateOptionState]
  )
  // Until the launch publishes and a fence attaches, a pick has nowhere to go.
  const { held, currentHeld, hold } = useHeldStructuredOptionPicks({
    identity,
    deliverable: transportEnabled && fence !== null,
    pending: optionState.pendingId !== null,
    send: sendStructuredOption
  })
  const optionSnapshot = useMemo(
    () =>
      structuredAgentSessionOptionSnapshot(
        structuredAgentSessionOptionView(optionState, launchSeedOptions, held)
      ),
    [held, launchSeedOptions, optionState]
  )
  const setStructuredOption = useCallback(
    async (id: string, value: string | boolean): Promise<boolean> => {
      const view = structuredAgentSessionOptionView(
        optionStateRef.current,
        launchSeedOptions,
        currentHeld()
      )
      const encoded = encodeStructuredAgentSessionOptionValue(id, value)
      if (
        !optionCatalog ||
        encoded === null ||
        !canSetStructuredAgentSessionOption(view, id, value)
      ) {
        return false
      }
      // Held, not sent: no pendingId, so the picker stays open and a re-pick replaces it.
      if (!transportEnabled || fence === null) {
        hold(id, encoded)
        return true
      }
      if (pendingOptionRef.current !== null) {
        return false
      }
      return (await sendStructuredOption(id, encoded)) === 'accepted'
    },
    [
      currentHeld,
      fence,
      hold,
      launchSeedOptions,
      optionCatalog,
      sendStructuredOption,
      transportEnabled
    ]
  )
  const setOption = useCallback(
    async (id: string, value: string | boolean) => {
      await setStructuredOption(id, value)
      return {
        snapshot: structuredAgentSessionOptionSnapshot(
          structuredAgentSessionOptionView(optionStateRef.current, launchSeedOptions, currentHeld())
        )
      }
    },
    [currentHeld, launchSeedOptions, setStructuredOption]
  )
  const optionSurface = useMemo<SessionOptionsSurface>(
    () => ({
      getSnapshot: () => optionSnapshot,
      setOption,
      invokeAction: async () => ({ snapshot: optionSnapshot }),
      subscribe: () => () => {}
    }),
    [setOption, optionSnapshot]
  )

  return {
    conversationCommands:
      transportEnabled && conversationSupport?.sessionId === sessionId
        ? conversationSupport.commands
        : [],
    /** Absent unless this host and session can change the goal. */
    threadGoal:
      transportEnabled && conversationSupport?.sessionId === sessionId
        ? conversationSupport.threadGoal
        : undefined,
    /** Absent from a host that predates it or a session that writes no context facts. */
    contextUsage:
      transportEnabled && conversationSupport?.sessionId === sessionId
        ? conversationSupport.contextUsage
        : undefined,
    optionSnapshot,
    optionSurface,
    setStructuredOption
  }
}
