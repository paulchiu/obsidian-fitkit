/**
 * Escapes regex metacharacters in `value` so it can be embedded literally
 * inside a `RegExp` pattern (used when building a pattern from a
 * user-supplied string such as an exercise name).
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
