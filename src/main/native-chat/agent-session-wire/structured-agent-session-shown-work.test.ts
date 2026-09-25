import { describe, expect, it } from 'vitest'
import {
  structuredAgentSessionHasOwedWork,
  structuredAgentSessionShowsWork
} from './structured-agent-session-shown-work'
import { submission } from './structured-agent-session-restart-resume-test-harness'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../shared/agent-session-journal-types'

describe('whether a session shows as working', () => {
  // The status feed scopes unanswered sends to the lease fence; a stale one would otherwise keep an
  // unheld session's provider alive forever while the sidebar shows it idle.
  it('does not count a send left pending under an older lease fence', () => {
    const journal = { items: [], submissions: [submission('msg-1', 'pending')] }
    expect(structuredAgentSessionShowsWork(journal, undefined, 2)).toBe(false)
    expect(structuredAgentSessionShowsWork(journal, undefined, 1)).toBe(true)
  })

  it('counts a settled lead whose monitor still runs', () => {
    const journal = { items: [], submissions: [] }
    expect(
      structuredAgentSessionShowsWork(
        journal,
        [{ id: 'watch', kind: 'monitor', description: 'Watch CI', state: 'working' }],
        1
      )
    ).toBe(true)
    expect(structuredAgentSessionShowsWork(journal, [], 1)).toBe(false)
  })

  it('does not keep an unheld child alive for an admitted send with no turn', () => {
    const journal = { items: [], submissions: [submission('msg-1', 'pending')] }
    expect(structuredAgentSessionShowsWork(journal, undefined, 1)).toBe(true)
    expect(structuredAgentSessionHasOwedWork(journal, undefined, 1)).toBe(false)
  })

  it('keeps a live turn, prompt, or background task alive', () => {
    const turn: { items: AgentJournalRenderItem[]; submissions: AgentJournalSubmission[] } = {
      items: [
        {
          itemId: 'turn',
          revision: 0,
          sequence: 0,
          body: {
            kind: 'status',
            text: 'working',
            turnLifecycle: { turnId: 'turn', state: 'running' }
          },
          observedAt: 1
        }
      ],
      submissions: []
    }
    const prompt: { items: AgentJournalRenderItem[]; submissions: AgentJournalSubmission[] } = {
      items: [
        {
          itemId: 'prompt',
          revision: 0,
          sequence: 0,
          body: {
            kind: 'question',
            question: 'Continue?',
            options: [{ id: 'yes', label: 'Yes' }],
            resolution: {
              state: 'pending',
              selectedOptionId: null,
              resolvedBy: null,
              resolvedAt: null
            }
          },
          observedAt: 1
        }
      ],
      submissions: []
    }
    expect(structuredAgentSessionHasOwedWork(turn, undefined, 1)).toBe(true)
    expect(structuredAgentSessionHasOwedWork(prompt, undefined, 1)).toBe(true)
    expect(
      structuredAgentSessionHasOwedWork(
        { items: [], submissions: [] },
        [{ id: 'watch', kind: 'monitor', description: 'Watch CI', state: 'working' }],
        1
      )
    ).toBe(true)
  })
})
