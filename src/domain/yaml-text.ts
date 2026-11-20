/** Plain scalars YAML reads as null, a boolean or a number rather than text. */
const NON_TEXT_PLAIN =
  /^(?:~|null|true|false|yes|no|on|off|y|n|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|0x[\da-f]+|0o[0-7]+|[-+]?\.inf|\.nan)$/i

/** Indicators that change a plain scalar's meaning at its start. */
const UNSAFE_START = /^[-?:,[\]{}#&*!|>'"%@`\s]/

function isPlainText(value: string): boolean {
  return (
    !UNSAFE_START.test(value) &&
    !/:(?:\s|$)/.test(value) &&
    !/\s#/.test(value) &&
    !/\s$/.test(value) &&
    !/[\n\r\t]/.test(value) &&
    !NON_TEXT_PLAIN.test(value)
  )
}

/**
 * A frontmatter value YAML reads back as exactly `value`: plain where that is
 * safe, so ordinary names keep their look, otherwise double-quoted.
 */
export function formatYamlText(value: string): string {
  return value === '' || isPlainText(value) ? value : JSON.stringify(value)
}

/** The text of a raw frontmatter value, unwrapping YAML double or single quotes. */
export function readYamlText(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === 'string' ? parsed : raw
    } catch {
      return raw
    }
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replaceAll("''", "'")
  }
  return raw
}
