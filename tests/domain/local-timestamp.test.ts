import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatLocalTimestamp } from '../../src/domain/local-timestamp'

describe('formatLocalTimestamp', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('writes a zone behind UTC with a negative half-hour offset', () => {
    vi.stubEnv('TZ', 'America/St_Johns')

    expect(formatLocalTimestamp(new Date('2026-09-30T12:00:09Z'))).toBe('2026-09-30T09:30:09-02:30')
  })
})
