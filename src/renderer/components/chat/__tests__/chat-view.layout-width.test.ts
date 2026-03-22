import { describe, expect, it } from 'vitest'
import { resolveChatThreadMaxWidthValue } from '../ChatView'

describe('ChatView thread width resolver', () => {
  it('returns auto clamp width by default', () => {
    expect(resolveChatThreadMaxWidthValue(undefined)).toBe('clamp(860px, 72vw, 1280px)')
    expect(resolveChatThreadMaxWidthValue(null)).toBe('clamp(860px, 72vw, 1280px)')
    expect(resolveChatThreadMaxWidthValue({ mode: 'auto', manualWidthPx: 1200 })).toBe(
      'clamp(860px, 72vw, 1280px)'
    )
  })

  it('returns normalized manual width value', () => {
    expect(resolveChatThreadMaxWidthValue({ mode: 'manual', manualWidthPx: 1240 })).toBe('1240px')
    expect(resolveChatThreadMaxWidthValue({ mode: 'manual', manualWidthPx: 120 })).toBe('860px')
    expect(resolveChatThreadMaxWidthValue({ mode: 'manual', manualWidthPx: 99999 })).toBe('1600px')
  })

  it('falls back to default manual width when value is invalid', () => {
    expect(resolveChatThreadMaxWidthValue({ mode: 'manual' })).toBe('1100px')
    expect(resolveChatThreadMaxWidthValue({ mode: 'manual', manualWidthPx: Number.NaN })).toBe('1100px')
  })
})
