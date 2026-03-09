export type SessionKey = string

export interface SessionScopeKey {
  spaceId: string
  conversationId: string
}

const SESSION_KEY_DELIMITER = '|'
const SESSION_KEY_LENGTH_DELIMITER = '#'

function encodePart(value: string): string {
  return `${value.length}${SESSION_KEY_LENGTH_DELIMITER}${value}`
}

function decodePart(input: string, startIndex: number): { value: string; nextIndex: number } | null {
  const lengthDelimiterIndex = input.indexOf(SESSION_KEY_LENGTH_DELIMITER, startIndex)
  if (lengthDelimiterIndex === -1) return null

  const lengthText = input.slice(startIndex, lengthDelimiterIndex)
  if (!/^\d+$/.test(lengthText)) return null

  const expectedLength = Number(lengthText)
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0) return null

  const valueStart = lengthDelimiterIndex + 1
  const valueEnd = valueStart + expectedLength
  if (valueEnd > input.length) return null

  return {
    value: input.slice(valueStart, valueEnd),
    nextIndex: valueEnd
  }
}

export function encodeSessionScopeKey(scope: SessionScopeKey): SessionKey {
  return `${encodePart(scope.spaceId)}${SESSION_KEY_DELIMITER}${encodePart(scope.conversationId)}`
}

export function decodeSessionScopeKey(sessionKey: string): SessionScopeKey | null {
  if (typeof sessionKey !== 'string' || sessionKey.length === 0) return null

  const firstPart = decodePart(sessionKey, 0)
  if (!firstPart) return null
  if (sessionKey[firstPart.nextIndex] !== SESSION_KEY_DELIMITER) return null

  const secondPart = decodePart(sessionKey, firstPart.nextIndex + 1)
  if (!secondPart) return null
  if (secondPart.nextIndex !== sessionKey.length) return null

  return {
    spaceId: firstPart.value,
    conversationId: secondPart.value
  }
}

export function isValidSessionKey(sessionKey: string): boolean {
  return decodeSessionScopeKey(sessionKey) !== null
}

export function assertValidSessionKey(sessionKey: string): SessionScopeKey {
  const decoded = decodeSessionScopeKey(sessionKey)
  if (decoded) return decoded
  const error = new Error(`Invalid session key: ${sessionKey}`) as Error & { errorCode: string }
  error.errorCode = 'SESSION_KEY_INVALID'
  throw error
}

export function buildSessionKey(spaceId: string, conversationId: string): SessionKey {
  return encodeSessionScopeKey({ spaceId, conversationId })
}
