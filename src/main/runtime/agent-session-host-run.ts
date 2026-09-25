import { randomUUID } from 'node:crypto'
import type { AgentSessionOwnerHostRun } from '../../shared/agent-session-record'
import {
  readDurableHostIdentity,
  readLinuxPidNamespace
} from '../agent-hooks/managed-hook-owner-identity'
import { isProcessPidPresent } from './agent-session-process-identity-probe'

/** This Orca process run; a lease stamp adds the fence the run granted. */
export type AgentSessionHostRun = Omit<AgentSessionOwnerHostRun, 'fence'>

const processRunId = randomUUID()
// Why per process: a machine with no readable id must never match another run's stamps.
const processFallbackMachine = `${process.platform}:runtime:${randomUUID()}`
let machine: string | undefined
let machineLookup: Promise<void> | undefined

/**
 * Looks this machine's id up unless one was already read. Only a read id is kept, and only a store
 * open or a restart reconcile asks: a lookup can spawn a process and a failed one may take its whole
 * timeout, so nothing per operation may retry it.
 */
export async function resolveAgentSessionHostRun(): Promise<AgentSessionHostRun> {
  if (machine === undefined) {
    // Concurrent callers share one lookup.
    machineLookup ??= readAgentSessionMachine()
      .then((read) => {
        machine ??= read
      })
      .finally(() => {
        machineLookup = undefined
      })
    await machineLookup
  }
  return currentAgentSessionHostRun()
}

/**
 * This process's run as its last lookup left it, with no lookup of its own. Stamps written while the
 * id is unread carry the per-process fallback; those are probed at the next restart.
 */
export function currentAgentSessionHostRun(): AgentSessionHostRun {
  return { runId: processRunId, pid: process.pid, machine: machine ?? processFallbackMachine }
}

/** Where a store reads the run it stamps; only `resolve` may look the machine id up again. */
export type AgentSessionHostRunSource = {
  current: () => AgentSessionHostRun
  resolve: () => Promise<AgentSessionHostRun>
}

/** This process's run, or a fixed one a test names. */
export function agentSessionHostRunSource(fixed?: AgentSessionHostRun): AgentSessionHostRunSource {
  return fixed
    ? { current: () => fixed, resolve: async () => fixed }
    : { current: currentAgentSessionHostRun, resolve: resolveAgentSessionHostRun }
}

/** Unmemoized, for tests that stand up a second run on this machine. */
export async function readAgentSessionHostRun(): Promise<AgentSessionHostRun> {
  return {
    runId: randomUUID(),
    pid: process.pid,
    machine: (await readAgentSessionMachine()) ?? processFallbackMachine
  }
}

async function readAgentSessionMachine(): Promise<string | undefined> {
  // Why not the hostname: macOS renames the host with the network, which would read a run that
  // crashed before the change as another machine's.
  const identity = await readDurableHostIdentity()
  if (identity === undefined) {
    return undefined
  }
  const machineId = `${process.platform}:${identity}`
  if (process.platform !== 'linux') {
    return machineId
  }
  // Why: containers on one host can share its id but not its pid space.
  const namespace = await readLinuxPidNamespace(process.pid)
  return namespace ? `${machineId}:${namespace}` : machineId
}

export function stampAgentSessionHostRun(
  run: AgentSessionHostRun,
  fence: number
): AgentSessionOwnerHostRun {
  return { runId: run.runId, pid: run.pid, machine: run.machine, fence }
}

/**
 * True only when the stamped run is not this one and is proven gone. A reused pid under a new run
 * id — a container's pid 1 — is this process, so the stamped run ended. Anything short of ESRCH
 * leaves the run possibly alive.
 */
export function agentSessionHostRunEnded(
  stamp: AgentSessionOwnerHostRun,
  run: AgentSessionHostRun,
  isPidPresent: (pid: number) => boolean
): boolean {
  return stamp.runId !== run.runId && (stamp.pid === run.pid || !isPidPresent(stamp.pid))
}

/** One answer per pid for the length of one reconcile. */
export function memoizeAgentSessionPidPresence(
  isPidPresent: (pid: number) => boolean = isProcessPidPresent
): (pid: number) => boolean {
  const answers = new Map<number, boolean>()
  return (pid) => {
    let present = answers.get(pid)
    if (present === undefined) {
      present = isPidPresent(pid)
      answers.set(pid, present)
    }
    return present
  }
}
