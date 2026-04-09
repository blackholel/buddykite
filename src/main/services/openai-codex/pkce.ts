import { createHash, randomBytes, randomUUID } from 'crypto'

function toBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function generateCodeVerifier(): string {
  return toBase64Url(randomBytes(48))
}

export function buildCodeChallenge(codeVerifier: string): string {
  return toBase64Url(createHash('sha256').update(codeVerifier).digest())
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = generateCodeVerifier()
  return {
    codeVerifier,
    codeChallenge: buildCodeChallenge(codeVerifier)
  }
}

export function generateOAuthState(): string {
  return randomUUID()
}
