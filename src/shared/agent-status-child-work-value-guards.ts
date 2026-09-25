export const AGENT_CHILD_WORK_ID_MAX_LENGTH = 256

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasOnlyKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const keys = Object.keys(record)
  return (
    required.every((key) => Object.hasOwn(record, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  )
}

/** A C0 control or DEL: never part of a record's one-line text. */
export function isControlCharCode(code: number): boolean {
  return code <= 0x1f || code === 0x7f
}

/** Nonempty, trimmed, single-line text within `maxLength`. */
export function isBoundedString(
  value: unknown,
  maxLength = AGENT_CHILD_WORK_ID_MAX_LENGTH
): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value !== value.trim()
  ) {
    return false
  }
  for (let index = 0; index < value.length; index += 1) {
    if (isControlCharCode(value.charCodeAt(index))) {
      return false
    }
  }
  return true
}

export function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
