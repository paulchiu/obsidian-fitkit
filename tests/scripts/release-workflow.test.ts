import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

interface Step {
  labels?: string
  run?: string
}

/** The Determine version bump step's `LABELS` env and one-line `run`, read from the file since no YAML parser is installed. */
const bumpStep = (): Step => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8')
  const block = workflow.split(/\n(?= {6}- name: )/).find((step) => /\n {8}id: bump\n/.test(step))
  if (!block) {
    throw new Error('No step with id bump in release.yml')
  }
  const field = (pattern: RegExp): string | undefined => pattern.exec(block)?.[1]?.trim()
  return { labels: field(/\n {10}LABELS: (.+)/), run: field(/\n {8}run: (?![|>])(.+)/) }
}

/** Runs the bump step's shell as the runner does (`bash -e`), returning its exit status and outputs. */
const runBumpStep = (labels: string, cwd = ROOT): { status: number; output: string } => {
  const output = join(mkdtempSync(join(tmpdir(), 'release-bump-')), 'output')
  const { run } = bumpStep()
  if (!run) {
    throw new Error('The bump step has no one-line run command')
  }
  try {
    execFileSync('bash', ['-e', '-c', run], {
      cwd,
      env: { ...process.env, LABELS: labels, GITHUB_OUTPUT: output },
      stdio: 'pipe',
    })
    return { status: 0, output: readFileSync(output, 'utf8') }
  } catch (error) {
    return { status: (error as { status: number }).status, output: '' }
  }
}

describe('release workflow bump step', () => {
  it("passes the PR's labels to the step", () => {
    expect(bumpStep().labels).toBe("${{ join(github.event.pull_request.labels.*.name, ',') }}")
  })

  it('skips the release for a Dependabot PR carrying norelease beside a semver label', () => {
    expect(runBumpStep('dependencies,major,norelease')).toEqual({
      status: 0,
      output: 'result=norelease\n',
    })
  })

  it('releases at the bump of a PR without norelease', () => {
    expect(runBumpStep('bug,patch')).toEqual({ status: 0, output: 'result=patch\n' })
  })

  it('fails the step rather than release with an empty bump when the script cannot run', () => {
    expect(runBumpStep('bug,patch', tmpdir()).status).not.toBe(0)
  })
})
