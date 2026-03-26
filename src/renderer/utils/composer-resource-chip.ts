import type { TriggerContext } from './composer-trigger'
import type { ComposerSuggestionType } from './composer-suggestion-types'

export interface SelectedComposerResourceChip {
  id: string
  type: ComposerSuggestionType
  displayName: string
  token: string
}

export interface ComposerResourceDisplayLookups {
  skills: Map<string, string>
  agents: Map<string, string>
}

export interface ParsedComposerMessageDisplay {
  chips: SelectedComposerResourceChip[]
  text: string
}

const TOKEN_RE = /^([/@])(\S+)$/

export function normalizeChipDisplayName(displayName: string): string {
  const separatorIndex = displayName.indexOf(':')
  if (separatorIndex < 0) return displayName
  return displayName.slice(separatorIndex + 1)
}

export function removeTriggerTokenText(
  value: string,
  context: TriggerContext
): { value: string; caret: number } {
  const before = value.slice(0, context.start)
  const after = value.slice(context.end)
  const beforeEndsWithSpace = /\s$/.test(before)
  const afterStartsWithSpace = /^\s/.test(after)

  if (beforeEndsWithSpace && afterStartsWithSpace) {
    return {
      value: `${before}${after.replace(/^\s+/, '')}`,
      caret: before.length
    }
  }

  const needsJoinSpace =
    before.length > 0 &&
    after.length > 0 &&
    !beforeEndsWithSpace &&
    !afterStartsWithSpace
  const joiner = needsJoinSpace ? ' ' : ''

  return {
    value: `${before}${joiner}${after}`,
    caret: before.length + joiner.length
  }
}

export function composeInputMessage(
  text: string,
  selectedResources: SelectedComposerResourceChip[]
): string {
  const selectedPrefix = selectedResources.map((item) => item.token).join(' ').trim()
  const trimmedText = text.trim()
  if (!selectedPrefix) return trimmedText
  if (!trimmedText) return selectedPrefix
  return `${selectedPrefix} ${trimmedText}`.trim()
}

function resolveChipFromToken(
  marker: '/' | '@',
  key: string,
  lookups: ComposerResourceDisplayLookups
): SelectedComposerResourceChip | null {
  if (marker === '@') {
    const agentDisplayName = lookups.agents.get(key)
    if (!agentDisplayName) return null
    return {
      id: `agent:${key}`,
      type: 'agent',
      displayName: normalizeChipDisplayName(agentDisplayName),
      token: `@${key}`
    }
  }

  const skillDisplayName = lookups.skills.get(key)
  if (!skillDisplayName) return null
  return {
    id: `skill:${key}`,
    type: 'skill',
    displayName: normalizeChipDisplayName(skillDisplayName),
    token: `/${key}`
  }
}

export function parseComposerMessageForDisplay(
  content: string,
  lookups: ComposerResourceDisplayLookups
): ParsedComposerMessageDisplay {
  const chips: SelectedComposerResourceChip[] = []
  const unresolvedPrefixTokens: string[] = []
  if (!content.trim()) {
    return { chips, text: content }
  }

  const len = content.length
  let pos = 0
  let consumedEnd = 0
  let restStart = len

  while (pos < len && /\s/.test(content[pos])) {
    pos += 1
  }

  while (pos < len) {
    const tokenStart = pos
    while (pos < len && !/\s/.test(content[pos])) {
      pos += 1
    }
    const word = content.slice(tokenStart, pos)
    const matched = word.match(TOKEN_RE)
    if (!matched) {
      restStart = tokenStart
      break
    }

    const marker = matched[1] as '/' | '@'
    const key = matched[2]
    if (!key) break

    const chip = resolveChipFromToken(marker, key, lookups)
    if (chip) {
      chips.push(chip)
    } else {
      unresolvedPrefixTokens.push(word)
    }
    consumedEnd = pos

    while (pos < len && /\s/.test(content[pos])) {
      pos += 1
      consumedEnd = pos
    }
  }

  if (chips.length === 0) {
    return { chips, text: content }
  }

  if (restStart === len) {
    restStart = consumedEnd
  }

  const unresolvedPrefix = unresolvedPrefixTokens.join(' ')
  const restText = content.slice(restStart).trimStart()
  const text = unresolvedPrefix && restText
    ? `${unresolvedPrefix} ${restText}`
    : unresolvedPrefix || restText

  return {
    chips,
    text
  }
}
