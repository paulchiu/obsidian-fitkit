import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatIsoDate, formatLocalTimestamp, isoDatePrefix } from '../../src/domain/dates'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('formatIsoDate', () => {
  it('pads the month and day', () => {
    expect(formatIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('uses the local calendar day east of UTC', () => {
    vi.stubEnv('TZ', 'Australia/Sydney')

    expect(formatIsoDate(new Date('2026-09-30T23:30:00Z'))).toBe('2026-10-01')
  })

  it('uses the UTC calendar day in UTC', () => {
    vi.stubEnv('TZ', 'UTC')

    expect(formatIsoDate(new Date('2026-09-30T23:30:00Z'))).toBe('2026-09-30')
  })
})

describe('isoDatePrefix', () => {
  it('reads the leading date of a filename', () => {
    expect(isoDatePrefix('2026-04-24 Draft.md')).toBe('2026-04-24')
  })

  it('is null without a leading date', () => {
    expect(isoDatePrefix('Draft.md')).toBeNull()
    expect(isoDatePrefix('')).toBeNull()
  })
})

describe('formatLocalTimestamp', () => {
  it('writes a zone behind UTC with a negative half-hour offset', () => {
    vi.stubEnv('TZ', 'America/St_Johns')

    expect(formatLocalTimestamp(new Date('2026-09-30T12:00:09Z'))).toBe('2026-09-30T09:30:09-02:30')
  })

  it('writes UTC with a positive zero offset', () => {
    vi.stubEnv('TZ', 'UTC')

    expect(formatLocalTimestamp(new Date('2026-09-30T12:00:09Z'))).toBe('2026-09-30T12:00:09+00:00')
  })
})
