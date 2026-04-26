/**
 * Move the element at `from` to position `to` and return a new array.
 *
 * Returns a copy of `items` unchanged when either index is out of range,
 * when `from === to`, or when the array is empty.
 */
export function reorderArray<T>(items: ReadonlyArray<T>, from: number, to: number): T[] {
  const length = items.length
  const next = items.slice()
  if (length === 0) {
    return next
  }
  if (from < 0 || from >= length || to < 0 || to >= length || from === to) {
    return next
  }
  const [moved] = next.splice(from, 1)
  if (moved === undefined) {
    return items.slice()
  }
  next.splice(to, 0, moved)
  return next
}
