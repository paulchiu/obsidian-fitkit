export type Frontmatter = Record<string, unknown> | null | undefined

/** Reads one frontmatter field, or undefined when the frontmatter or key is absent. */
export function readFrontmatterField(frontmatter: Frontmatter, key: string): unknown {
  return frontmatter ? frontmatter[key] : undefined
}

/** Whether the frontmatter `type` equals `type`, ignoring case and surrounding whitespace. */
export function frontmatterTypeIs(frontmatter: Frontmatter, type: 'workout' | 'exercise'): boolean {
  const value = readFrontmatterField(frontmatter, 'type')
  return typeof value === 'string' && value.trim().toLowerCase() === type
}
