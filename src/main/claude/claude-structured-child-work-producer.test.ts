// A Claude session's frames, through the real adapter, into the host's child records: the order
// the host receives them in, and whether the parent row the records imply is today's row.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { foldAgentLeadStatus } from '../../shared/agent-lead-status-fold'
import { createAgentChildWorkAdmission } from '../../shared/agent-status-child-work-admission'
import type { AgentChildWorkRecord } from '../../shared/agent-status-child-work'
import type { AgentChildWorkEvidence } from '../../shared/agent-status-child-work-evidence'
import { agentChildWorkLiveness } from '../../shared/agent-status-child-work-liveness'
import {
  reconcileAgentChildWorkEvidence,
  type AgentChildWorkReconcileOutcome
} from '../../shared/agent-status-child-work-reconciliation'
import { createAgentStatusStore } from '../../shared/agent-status-store'
import { makeStructuredAgentStatusSubject } from '../../shared/agent-status-subject'
import { AgentHookServer } from '../agent-hooks/server'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { ClaudeStructuredSessionAdapter } from './claude-structured-session-adapter'
import {
  fakeClaude,
  identityFor,
  PROVIDER_SESSION_ID
} from './claude-structured-session-test-support'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn(() => ({})) }))
afterEach(() => vi.restoreAllMocks())

const parent = makeStructuredAgentStatusSubject(
  {
    executionHostId: 'local',
    wslDistro: null,
    workspaceId: 'workspace-1',
    workspaceKind: 'folder'
  },
  'session-1'
)

let uuid = 0
function frame(fields: Record<string, unknown>): Record<string, unknown> {
  return { session_id: PROVIDER_SESSION_ID, uuid: `frame-${++uuid}`, ...fields }
}
function system(subtype: string, fields: Record<string, unknown>) {
  return frame({ type: 'system', subtype, ...fields })
}
function toolUse(id: string, name: string, input: unknown, parentToolUseId: string | null = null) {
  return frame({
    type: 'assistant',
    parent_tool_use_id: parentToolUseId,
    message: {
      id: `msg-${id}`,
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }]
    }
  })
}
function toolResult(
  toolUseId: string,
  text: string,
  parentToolUseId: string | null = null,
  isError = false
) {
  return frame({
    type: 'user',
    parent_tool_use_id: parentToolUseId,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text, is_error: isError }]
    }
  })
}

type Delivery = { kind: 'journal' | 'legacy' | 'evidence'; detail: string }

/** A real hook server already holding the session's parent row. */
function hostWithParent(): AgentHookServer {
  const host = new AgentHookServer()
  host.ingestStructuredStatus(
    {
      sessionId: parent.sessionId,
      workspaceId: parent.workspaceId,
      agent: 'claude',
      status: 'working',
      hostExecutionOwned: true,
      latestPrompt: 'find the flaky tests',
      updatedAt: 100
    },
    parent
  )
  return host
}

/** With `host`, evidence goes through the host's own ingest instead of straight to reconciliation. */
async function producer(host?: AgentHookServer) {
  const claude = fakeClaude()
  const store = createAgentStatusStore({ epoch: 'epoch-1', mode: 'authority' })
  expect(store.applyMutation({ parent: { subject: parent } })).not.toBeNull()
  const admission = createAgentChildWorkAdmission(store, {
    mintChildWorkId: (() => {
      let minted = 0
      return () => `child-${++minted}`
    })()
  })
  const deliveries: Delivery[] = []
  /** The producer linkage the journal stamped on each child row. */
  const stamps: { providerParentRef?: string; attempt?: number }[] = []
  const evidenceLog: AgentChildWorkEvidence[][] = []
  const ingested: (AgentChildWorkReconcileOutcome | null)[] = []
  const adapter = new ClaudeStructuredSessionAdapter({
    resolveLaunch: async () => ({
      pathToClaudeCodeExecutable: 'claude',
      options: {},
      cwd: '/work/repo',
      claudeConfigDir: '/accounts/claude',
      providerSessionId: PROVIDER_SESSION_ID,
      resumeLeafUuid: null,
      resumesTranscript: false,
      continuesChain: false
    }),
    openConnection: claude.openConnection,
    readProcessStartTime: async () => 1_700_000_000_000,
    now: () => 1_700_000_000_500,
    persistHandle: async () => {},
    onBackgroundTasksChanged: (_sessionId, state) =>
      deliveries.push({ kind: 'legacy', detail: String(state?.tasks?.length ?? 0) }),
    onChildWorkEvidence: (sessionId, evidence) => {
      expect(sessionId).toBe('session-1')
      deliveries.push({ kind: 'evidence', detail: evidence.map((edge) => edge.type).join(',') })
      evidenceLog.push(evidence)
      if (host) {
        ingested.push(host.ingestStructuredChildWork(parent, evidence, 'claude'))
      } else {
        reconcileAgentChildWorkEvidence({ store, admission, parent, provider: 'claude', evidence })
      }
    }
  })
  const journal: StructuredAgentSessionEventSink = {
    appendItem: (identity, _body, options) => {
      deliveries.push({ kind: 'journal', detail: JSON.stringify(identity) })
      if (options?.agentId !== undefined) {
        stamps.push(options)
      }
    },
    appendTombstone: () => {},
    publish: () => {}
  }
  await adapter.acquire({
    identity: identityFor(),
    fence: 7,
    spawnToken: 'spawn-9',
    events: journal
  })
  const send = (message: Record<string, unknown>): Delivery[] => {
    const from = deliveries.length
    claude.connections[0]!.handlers.onMessage?.(message)
    return deliveries.slice(from)
  }
  const records = (): AgentChildWorkRecord[] =>
    host ? host.getStructuredChildWork(parent) : store.getChildren(parent)
  const byDescription = (description: string) =>
    records().find((record) => record.description === description)
  return { adapter, store, send, records, byDescription, evidenceLog, stamps, ingested }
}

describe('Claude structured child-work producer', () => {
  it('delivers evidence only after the journal wrote the frame and the legacy row republished', async () => {
    const { send, records } = await producer()
    send(toolUse('toolu_bg', 'Agent', { description: 'Audit the build' }))
    const deliveries = send(
      system('task_started', {
        task_id: 'agent-bg',
        tool_use_id: 'toolu_bg',
        task_type: 'local_agent',
        subagent_type: 'general-purpose',
        description: 'Audit the build',
        is_backgrounded: true
      })
    )
    const kinds = deliveries.map((delivery) => delivery.kind)
    // The frame's own rows, then the parent's republished row, and only then its children.
    expect(kinds.filter((kind) => kind === 'journal').length).toBeGreaterThan(0)
    expect(kinds.slice(kinds.indexOf('legacy'))).toEqual(['legacy', 'evidence'])
    expect(records()).toEqual([
      expect.objectContaining({ description: 'Audit the build', membership: 'live' })
    ])
  })

  it('records the parent state today reads, frame by frame, while adding outcome and activity', async () => {
    const { adapter, send, records, byDescription } = await producer()
    const steps: {
      message: Record<string, unknown>
      lead: 'working' | 'done'
      check?: () => void
    }[] = [
      {
        message: toolUse('toolu_fg', 'Agent', { description: 'Find flaky tests' }),
        lead: 'working'
      },
      {
        message: system('task_started', {
          task_id: 'agent-fg',
          tool_use_id: 'toolu_fg',
          task_type: 'local_agent',
          subagent_type: 'Explore',
          description: 'Find flaky tests',
          is_backgrounded: false
        }),
        lead: 'working'
      },
      // The foreground child starts a background shell of its own.
      {
        message: toolUse(
          'toolu_bash',
          'Bash',
          { command: 'npm test', run_in_background: true },
          'toolu_fg'
        ),
        lead: 'working',
        // Its own call is what it is doing, previewed as a CLI row previews Bash.
        check: () =>
          expect(byDescription('Find flaky tests')?.operation).toMatchObject({
            toolName: 'Bash',
            input: 'npm test',
            basis: 'open'
          })
      },
      {
        message: system('task_started', {
          task_id: 'shell-1',
          tool_use_id: 'toolu_bash',
          task_type: 'local_bash',
          description: 'npm test',
          is_backgrounded: true
        }),
        lead: 'working'
      },
      {
        message: system('background_tasks_changed', {
          tasks: [{ task_id: 'shell-1', task_type: 'local_bash', description: 'npm test' }]
        }),
        lead: 'working',
        check: () =>
          expect(byDescription('npm test')?.parentChildWorkId).toBe(
            byDescription('Find flaky tests')?.childWorkId
          )
      },
      {
        message: toolResult('toolu_bash', 'Command running in background', 'toolu_fg'),
        lead: 'working',
        check: () => expect(byDescription('Find flaky tests')?.operation).toBeUndefined()
      },
      {
        message: system('task_progress', {
          task_id: 'agent-fg',
          description: 'Running Bash',
          last_tool_name: 'Bash',
          usage: { total_tokens: 1_200, tool_uses: 2, duration_ms: 800 }
        }),
        lead: 'working',
        check: () =>
          expect(byDescription('Find flaky tests')).toMatchObject({
            operation: { toolName: 'Bash', basis: 'reported' },
            totalTokens: 1_200
          })
      },
      {
        message: toolResult('toolu_fg', 'Two tests flake on CI'),
        lead: 'working',
        check: () =>
          expect(byDescription('Find flaky tests')).toMatchObject({
            membership: 'settled',
            outcome: 'succeeded',
            lastMessage: 'Two tests flake on CI'
          })
      },
      {
        message: toolUse('toolu_bg', 'Agent', { description: 'Audit the build' }),
        lead: 'working'
      },
      {
        message: system('task_started', {
          task_id: 'agent-bg',
          tool_use_id: 'toolu_bg',
          task_type: 'local_agent',
          description: 'Audit the build',
          is_backgrounded: true
        }),
        lead: 'working'
      },
      {
        message: system('background_tasks_changed', {
          tasks: [
            { task_id: 'shell-1', task_type: 'local_bash', description: 'npm test' },
            { task_id: 'agent-bg', task_type: 'local_agent', description: 'Audit the build' }
          ]
        }),
        lead: 'working'
      },
      { message: frame({ type: 'result', subtype: 'success', is_error: false }), lead: 'done' },
      // Claude drops a finished task from the roster BEFORE its outcome frame arrives.
      {
        message: system('background_tasks_changed', {
          tasks: [{ task_id: 'shell-1', task_type: 'local_bash', description: 'npm test' }]
        }),
        lead: 'done',
        check: () => expect(byDescription('Audit the build')).toMatchObject({ outcome: 'unknown' })
      },
      {
        message: system('task_notification', {
          task_id: 'agent-bg',
          status: 'failed',
          summary: 'Build broke',
          usage: { total_tokens: 900 }
        }),
        lead: 'done',
        check: () =>
          expect(byDescription('Audit the build')).toMatchObject({
            membership: 'settled',
            outcome: 'failed',
            lastMessage: 'Build broke'
          })
      },
      { message: system('background_tasks_changed', { tasks: [] }), lead: 'done' },
      {
        message: system('task_updated', { task_id: 'shell-1', patch: { status: 'killed' } }),
        lead: 'done',
        check: () => expect(byDescription('npm test')).toMatchObject({ outcome: 'cancelled' })
      },
      // Claude resumes a finished background agent by listing it again.
      {
        message: system('background_tasks_changed', {
          tasks: [{ task_id: 'agent-bg', task_type: 'local_agent', description: 'Audit the build' }]
        }),
        lead: 'done',
        check: () =>
          expect(byDescription('Audit the build')).toMatchObject({
            membership: 'live',
            invocation: { generation: 2 },
            previousInvocations: [expect.objectContaining({ outcome: 'failed' })]
          })
      }
    ]
    for (const [index, step] of steps.entries()) {
      send(step.message)
      const legacy = agentChildWorkLiveness(adapter.backgroundTaskState('session-1')?.tasks)
      const recorded = agentChildWorkLiveness(
        records().filter((record) => record.membership === 'live')
      )
      const fold = (childWorkLiveness: typeof legacy) =>
        foldAgentLeadStatus({ leadState: step.lead, childWorkLiveness })
      expect({ index, parent: fold(recorded) }).toEqual({ index, parent: fold(legacy) })
      if (step.lead === 'done') {
        expect({ index, liveness: recorded }).toEqual({ index, liveness: legacy })
      }
      step.check?.()
    }
    await adapter.closeSession('session-1')
    expect(records()).toEqual([])
    expect(adapter.backgroundTaskState('session-1')).toBeUndefined()
  })

  it("counts a child's runs the way the journal does, and hears a restarted run before any roster", async () => {
    const { adapter, send, byDescription, stamps } = await producer()
    const start = (toolUseId: string) =>
      system('task_started', {
        task_id: 'agent-fg',
        tool_use_id: toolUseId,
        task_type: 'local_agent',
        description: 'Find flaky tests',
        is_backgrounded: false
      })
    const childSays = (toolUseId: string, text: string) =>
      frame({
        type: 'assistant',
        parent_tool_use_id: toolUseId,
        message: { id: `msg-${text}`, role: 'assistant', content: [{ type: 'text', text }] }
      })
    // The journal stamps a child row with its roster attempt only once it is past the first.
    const runs = (toolUseId: string) => ({
      generation: byDescription('Find flaky tests')?.invocation.generation,
      attempt: stamps.findLast((stamp) => stamp.providerParentRef === toolUseId)?.attempt ?? 1
    })
    send(toolUse('toolu_1', 'Agent', { description: 'Find flaky tests' }))
    send(start('toolu_1'))
    send(childSays('toolu_1', 'first run'))
    expect(runs('toolu_1')).toEqual({ generation: 1, attempt: 1 })
    send(toolResult('toolu_1', 'Found it'))
    send(system('task_notification', { task_id: 'agent-fg', status: 'completed' }))

    // The provider runs the finished child again under a new spawn call.
    send(toolUse('toolu_2', 'Agent', { description: 'Find flaky tests' }))
    const legacy = adapter.backgroundTaskState('session-1')
    send(start('toolu_2'))
    // The legacy row still waits for a roster; the record hears the new run now.
    expect(adapter.backgroundTaskState('session-1')).toEqual(legacy)
    send(childSays('toolu_2', 'second run'))
    expect(runs('toolu_2')).toEqual({ generation: 2, attempt: 2 })
    send(
      system('task_progress', {
        task_id: 'agent-fg',
        last_tool_name: 'Grep',
        usage: { total_tokens: 300, tool_uses: 1, duration_ms: 10 }
      })
    )
    expect(byDescription('Find flaky tests')).toMatchObject({
      membership: 'live',
      operation: { toolName: 'Grep', basis: 'reported' },
      totalTokens: 300
    })
    send(toolResult('toolu_2', 'Could not reproduce', null, true))
    expect(byDescription('Find flaky tests')).toMatchObject({
      membership: 'settled',
      outcome: 'unknown',
      lastMessage: 'Could not reproduce',
      invocation: { invocationId: 'toolu_2', generation: 2 },
      previousInvocations: [expect.objectContaining({ outcome: 'succeeded' })]
    })
    send(system('task_notification', { task_id: 'agent-fg', status: 'failed' }))
    expect(byDescription('Find flaky tests')).toMatchObject({
      outcome: 'failed',
      invocation: { invocationId: 'toolu_2', generation: 2 }
    })
  })

  describe('a second ending for a settled child', () => {
    async function settledForegroundChild() {
      const host = hostWithParent()
      const warn = vi.spyOn(console, 'warn')
      const error = vi.spyOn(console, 'error')
      const run = await producer(host)
      run.send(toolUse('toolu_fg', 'Agent', { description: 'Find flaky tests' }))
      run.send(
        system('task_started', {
          task_id: 'agent-fg',
          tool_use_id: 'toolu_fg',
          task_type: 'local_agent',
          description: 'Find flaky tests',
          is_backgrounded: false
        })
      )
      run.send(toolResult('toolu_fg', 'Two tests flake on CI'))
      expect(run.byDescription('Find flaky tests')).toMatchObject({
        membership: 'settled',
        outcome: 'succeeded',
        lastMessage: 'Two tests flake on CI'
      })
      return { ...run, warn, error }
    }

    it('keeps a definite outcome through an unclassified ending and lands its evidence', async () => {
      const { send, byDescription } = await settledForegroundChild()
      // A notification with no status the host can classify still carries the final summary.
      send(
        system('task_notification', {
          task_id: 'agent-fg',
          summary: 'Two tests flake on CI; both time out on the shared runner',
          usage: { total_tokens: 1_500 }
        })
      )
      expect(byDescription('Find flaky tests')).toMatchObject({
        membership: 'settled',
        outcome: 'succeeded',
        lastMessage: 'Two tests flake on CI; both time out on the shared runner',
        totalTokens: 1_500
      })
    })

    it('keeps the first definite outcome over a conflicting one, and reports no fault', async () => {
      const { send, byDescription, ingested, warn, error } = await settledForegroundChild()
      send(
        system('task_notification', {
          task_id: 'agent-fg',
          status: 'failed',
          summary: 'Crashed after returning'
        })
      )
      expect(byDescription('Find flaky tests')).toMatchObject({
        membership: 'settled',
        outcome: 'succeeded',
        lastMessage: 'Two tests flake on CI'
      })
      // Admission refuses it; the host counts that refusal as the fence doing its job.
      expect(ingested.at(-1)).toMatchObject({
        settled: 0,
        rejected: [{ handleId: 'agent-fg', reason: 'stale-invocation' }]
      })
      expect(warn).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
    })
  })

  describe('an interrupted foreground child', () => {
    const rejected =
      "The user doesn't want to proceed with this tool use. The tool use was rejected."
    const killed = system('task_updated', { task_id: 'agent-fg', patch: { status: 'killed' } })
    const stopped = system('task_notification', {
      task_id: 'agent-fg',
      tool_use_id: 'toolu_fg',
      status: 'stopped',
      summary: 'Run sleep command and report'
    })
    // Frame orders captured from the real CLI interrupting a foreground agent.
    it.each([
      [
        'its own tool running, the spawn result first',
        [toolResult('toolu_fg', rejected, null, true), killed, stopped]
      ],
      [
        'between tools, its own stop first',
        [killed, stopped, toolResult('toolu_fg', rejected, null, true)]
      ]
    ])('ends cancelled with %s', async (_case, ending) => {
      const { send, byDescription } = await producer()
      send(toolUse('toolu_fg', 'Agent', { description: 'Run sleep command and report' }))
      send(
        system('task_started', {
          task_id: 'agent-fg',
          tool_use_id: 'toolu_fg',
          task_type: 'local_agent',
          subagent_type: 'general-purpose',
          description: 'Run sleep command and report',
          is_backgrounded: false
        })
      )
      for (const message of ending) {
        send(message)
      }
      send(frame({ type: 'result', subtype: 'error_during_execution', is_error: true }))
      expect(byDescription('Run sleep command and report')).toMatchObject({
        membership: 'settled',
        outcome: 'cancelled'
      })
    })
  })

  it("keeps a finished foreground child's final summary and usage, in the order the CLI sends them", async () => {
    const { send, byDescription, ingested } = await producer(hostWithParent())
    send(toolUse('toolu_fg', 'Agent', { description: 'Run echo hi command' }))
    send(
      system('task_started', {
        task_id: 'agent-fg',
        tool_use_id: 'toolu_fg',
        task_type: 'local_agent',
        subagent_type: 'general-purpose',
        description: 'Run echo hi command',
        is_backgrounded: false
      })
    )
    // Captured from the real CLI: the child's own ending, then its summary, then the spawn result.
    send(system('task_updated', { task_id: 'agent-fg', patch: { status: 'completed' } }))
    send(
      system('task_notification', {
        task_id: 'agent-fg',
        tool_use_id: 'toolu_fg',
        status: 'completed',
        summary: 'The command ran. Output: hi',
        usage: { total_tokens: 16_908, tool_uses: 1, duration_ms: 3_393 }
      })
    )
    send(toolResult('toolu_fg', 'hi'))
    send(frame({ type: 'result', subtype: 'success', is_error: false }))
    expect(byDescription('Run echo hi command')).toMatchObject({
      membership: 'settled',
      outcome: 'succeeded',
      lastMessage: 'The command ran. Output: hi',
      totalTokens: 16_908,
      invocation: { invocationId: 'toolu_fg', generation: 1 }
    })
    expect(ingested.flatMap((outcome) => outcome?.rejected ?? [])).toEqual([])
  })
})
