import { describe, expect, it } from 'vitest'

import {
  buildCodeChallenge,
  generateCodeVerifier,
  generateOAuthState,
  generatePkcePair
} from '../../../src/main/services/openai-codex/pkce'

describe('openai-codex.pkce', () => {
  it('code verifier 长度与字符集符合 PKCE base64url 约束', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  it('同一个 verifier 生成稳定的 code challenge', () => {
    const verifier = 'abc123def456ghi789abc123def456ghi789abc123def456ghi789abc123def456'
    const challengeA = buildCodeChallenge(verifier)
    const challengeB = buildCodeChallenge(verifier)

    expect(challengeA).toBe(challengeB)
    expect(challengeA).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  it('generatePkcePair 与随机 state 可正常生成', () => {
    const pair = generatePkcePair()
    const state = generateOAuthState()

    expect(pair.codeVerifier.length).toBeGreaterThan(0)
    expect(pair.codeChallenge.length).toBeGreaterThan(0)
    expect(state.length).toBeGreaterThan(0)
  })
})
