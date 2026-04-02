import { buildSuggestionStableId } from './composer-suggestion-ranking'
import type {
  ComposerResourceSuggestionItem,
  ComposerSuggestionSource,
  ComposerSuggestionType
} from './composer-suggestion-types'
import { toResourceKey } from './resource-key'
import { getResourceDisplayName, getResourceUiDescription } from './resource-display-name'

export interface ComposerSuggestionResourceInput {
  name: string
  displayNameBase?: string
  displayNameLocalized?: string
  descriptionBase?: string
  descriptionLocalized?: string
  namespace?: string
  source?: string
  path: string
  pluginRoot?: string
}

export interface SdkSlashSuggestionBuildInput {
  commands: string[]
  skills: ComposerSuggestionResourceInput[]
  fallbackDescription: string
}

export function getLocalizedSuggestionName(item: {
  name: string
  displayNameBase?: string
  displayNameLocalized?: string
  namespace?: string
}): string {
  return getResourceDisplayName(item)
}

export function normalizeComposerSuggestionSource(source: string | undefined): ComposerSuggestionSource {
  if (source === 'app' || source === 'global' || source === 'space' || source === 'installed' || source === 'plugin') {
    return source
  }
  return 'space'
}

function toSuggestionScope(source: ComposerSuggestionSource): 'space' | 'global' {
  return source === 'space' ? 'space' : 'global'
}

function buildInsertText(type: ComposerSuggestionType, key: string): string {
  return type === 'agent' ? `@${key}` : `/${key}`
}

export function buildComposerResourceSuggestion(
  type: ComposerSuggestionType,
  item: ComposerSuggestionResourceInput
): ComposerResourceSuggestionItem {
  const source = normalizeComposerSuggestionSource(item.source)
  const key = toResourceKey(item)
  const displayName = getLocalizedSuggestionName(item)
  const description = getResourceUiDescription(item)

  return {
    kind: 'resource',
    id: `${type}:${item.path}`,
    stableId: buildSuggestionStableId({
      type,
      source,
      namespace: item.namespace,
      name: item.name,
      pluginRoot: item.pluginRoot
    }),
    type,
    source,
    scope: toSuggestionScope(source),
    displayName,
    insertText: buildInsertText(type, key),
    description,
    keywords: [
      key,
      item.name,
      item.displayNameBase,
      item.displayNameLocalized,
      item.descriptionBase,
      item.descriptionLocalized
    ].filter((entry): entry is string => Boolean(entry))
  }
}

export function buildSdkSlashSnapshotSuggestions(input: SdkSlashSuggestionBuildInput): ComposerResourceSuggestionItem[] {
  const dedup = new Set<string>()
  const localSkillByKey = new Map<string, ComposerSuggestionResourceInput>()
  const suggestions: ComposerResourceSuggestionItem[] = []

  for (const skill of input.skills) {
    const key = toResourceKey(skill).toLowerCase()
    if (!localSkillByKey.has(key)) {
      localSkillByKey.set(key, skill)
    }
  }

  for (const entry of input.commands) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed) continue
    const command = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
    const commandKey = command.slice(1).toLowerCase()
    if (dedup.has(commandKey)) continue
    dedup.add(commandKey)

    const matchedSkill = localSkillByKey.get(commandKey)
    const source = normalizeComposerSuggestionSource(matchedSkill?.source)
    const displayName = matchedSkill ? getLocalizedSuggestionName(matchedSkill) : command.slice(1)
    const description = matchedSkill
      ? getResourceUiDescription(matchedSkill)
      : input.fallbackDescription

    suggestions.push({
      kind: 'resource',
      id: `sdk-slash:${commandKey}`,
      stableId: `sdk-slash|${commandKey}`,
      type: 'skill',
      source,
      scope: toSuggestionScope(source),
      displayName,
      insertText: command,
      description,
      keywords: [
        displayName,
        command,
        command.slice(1),
        commandKey,
        matchedSkill?.name,
        matchedSkill?.displayNameBase,
        matchedSkill?.displayNameLocalized
      ].filter((token): token is string => Boolean(token))
    })
  }

  return suggestions
}
