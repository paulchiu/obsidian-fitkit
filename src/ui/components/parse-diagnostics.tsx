import type { JSX } from 'preact'

export interface DiagnosticsItem {
  path?: string
  name?: string
  warnings: readonly string[]
}

/** One heading per diagnostic with its warnings listed beneath. */
export function ParseDiagnosticsBody({
  diagnostics,
}: {
  diagnostics: readonly DiagnosticsItem[]
}): JSX.Element {
  return (
    <>
      {diagnostics.map((diagnostic) => (
        <>
          <h3>{diagnostic.path ?? diagnostic.name ?? 'General diagnostic'}</h3>
          <ul>
            {diagnostic.warnings.map((warning) => (
              <li>{warning}</li>
            ))}
          </ul>
        </>
      ))}
    </>
  )
}
