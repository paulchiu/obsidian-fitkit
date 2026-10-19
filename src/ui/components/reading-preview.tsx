import type { ReadingPreview, ReadingTable } from '../model/reading-preview'

/** The contents of a reading-mode preview: summary, note, plan lines and the set table. */
export function ReadingPreviewBody({ preview }: { preview: ReadingPreview }) {
  return (
    <>
      <div class="fitkit-reading-summary">
        <span class="fitkit-reading-kind">{preview.typeLabel}</span>
        <span class="fitkit-reading-count">{preview.rowCountLabel}</span>
      </div>
      {preview.note !== undefined && <div class="fitkit-reading-note">{preview.note}</div>}
      {preview.plans.map((plan) => (
        <div class="fitkit-reading-plan">{plan}</div>
      ))}
      <SetTable table={preview.table} />
    </>
  )
}

function SetTable({ table }: { table: ReadingTable }) {
  if ('emptyMessage' in table) {
    return <div class="fitkit-reading-empty">{table.emptyMessage}</div>
  }
  return (
    <table class="fitkit-reading-table">
      <thead>
        <tr>
          {table.headings.map((heading) => (
            <th>{heading}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr>
            {row.map((cell) => (
              <td>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
