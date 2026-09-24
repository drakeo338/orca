import { GENERATED_HOST_NAME_PATTERN, getNextHostNameFromHosts } from './host-names'
import type { StoredHostProfile } from './types'

/**
 * The rules that keep a stored host's `name` equal to
 * `personalName ?? lastKnownMachineName ?? "Host N"`. Pure: host-store applies them inside its
 * serialized mutation pass, so the resolved name and its sources are always written together.
 */

export type ReportedHostDescriptor = {
  machineName: string | null
  platform: NodeJS.Platform | null
}

/**
 * Classifies a record written before the name-identity fields existed. Legacy storage held one
 * `name` that was either the generated "Host N" or typed by the user, and only the typed one is an
 * override. Safe to re-run on every parse: any record a current build has written carries at least
 * one of the three fields (clearing an override either restores the machine name — a field — or
 * keeps a generated "Host N", which this pattern skips), so only true legacy records are classified.
 */
export function classifyLegacyHostName(profile: StoredHostProfile): StoredHostProfile {
  if (
    profile.personalName !== undefined ||
    profile.lastKnownMachineName !== undefined ||
    profile.lastKnownHostPlatform !== undefined ||
    GENERATED_HOST_NAME_PATTERN.test(profile.name)
  ) {
    return profile
  }
  return { ...profile, personalName: profile.name }
}

/**
 * Why: a re-pair rebuilds the profile from the pairing offer, which carries no name identity;
 * replacing the record wholesale would silently erase a phone rename on every re-pair.
 */
export function mergeHostNameIdentity(
  incoming: StoredHostProfile,
  existing: StoredHostProfile
): StoredHostProfile {
  const personalName = incoming.personalName ?? existing.personalName
  const lastKnownMachineName = incoming.lastKnownMachineName ?? existing.lastKnownMachineName
  const lastKnownHostPlatform = incoming.lastKnownHostPlatform ?? existing.lastKnownHostPlatform
  return {
    ...incoming,
    ...(personalName !== undefined ? { personalName } : {}),
    ...(lastKnownMachineName !== undefined ? { lastKnownMachineName } : {}),
    ...(lastKnownHostPlatform !== undefined ? { lastKnownHostPlatform } : {}),
    name: personalName ?? lastKnownMachineName ?? incoming.name
  }
}

/** Sets the phone's override, or clears it (`null`) to return the row to the desktop's name. */
export function withPersonalName(
  current: StoredHostProfile,
  personalName: string | null,
  hosts: readonly StoredHostProfile[]
): StoredHostProfile {
  if (personalName !== null) {
    return { ...current, personalName, name: personalName }
  }
  const { personalName: _cleared, ...rest } = current
  // Why: with no machine name to fall back to, an already-generated name is kept, not renumbered.
  const fallback = GENERATED_HOST_NAME_PATTERN.test(current.name)
    ? current.name
    : getNextHostNameFromHosts(hosts)
  return { ...rest, name: current.lastKnownMachineName ?? fallback }
}

/**
 * Applies what the desktop reported; returns `current` itself when nothing changed. An answered
 * status is authoritative, so an omitted half clears its last-known value, and an unoverridden
 * row adopts a newly reported machine name as its display name.
 */
export function withReportedDescriptor(
  current: StoredHostProfile,
  descriptor: ReportedHostDescriptor
): StoredHostProfile {
  const { lastKnownMachineName: _machineName, lastKnownHostPlatform: _platform, ...rest } = current
  const lastKnownMachineName = descriptor.machineName ?? undefined
  const lastKnownHostPlatform = descriptor.platform ?? undefined
  const name = current.personalName ?? lastKnownMachineName ?? current.name
  if (
    name === current.name &&
    lastKnownMachineName === current.lastKnownMachineName &&
    lastKnownHostPlatform === current.lastKnownHostPlatform
  ) {
    return current
  }
  return {
    ...rest,
    name,
    ...(lastKnownMachineName !== undefined ? { lastKnownMachineName } : {}),
    ...(lastKnownHostPlatform !== undefined ? { lastKnownHostPlatform } : {})
  }
}
