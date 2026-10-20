/**
 * Whether a rung name needs its compact form. The name shortens only when
 * its own rendered width overruns the space the cell offers, so an
 * arbitrarily long ladder name still fits on a wide window.
 */
export function shouldShortenLevelLabel(labelWidth: number, availableWidth: number): boolean {
  return labelWidth > availableWidth
}
