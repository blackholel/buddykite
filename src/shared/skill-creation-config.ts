const DEFAULT_STRICT_INTENT_KEYWORDS = [
  'review',
  'audit',
  'eval',
  'benchmark',
  'assertion',
  'compare',
  '评测',
  '对比',
  '评审',
  '审查'
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeKeywordList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null

  const seen = new Set<string>()
  const normalized: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const keyword = item.trim()
    if (!keyword) continue
    const dedupeKey = keyword.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    normalized.push(keyword)
  }
  return normalized
}

export function resolveStrictIntentKeywordsFromConfig(config: unknown): string[] {
  if (!isRecord(config)) {
    return [...DEFAULT_STRICT_INTENT_KEYWORDS]
  }

  const resourceCreation = isRecord(config.resourceCreation) ? config.resourceCreation : null
  const skill = resourceCreation && isRecord(resourceCreation.skill) ? resourceCreation.skill : null
  if (!skill) {
    return [...DEFAULT_STRICT_INTENT_KEYWORDS]
  }

  if (!Object.prototype.hasOwnProperty.call(skill, 'strictIntentKeywords')) {
    return [...DEFAULT_STRICT_INTENT_KEYWORDS]
  }

  const normalized = normalizeKeywordList(skill.strictIntentKeywords)
  if (normalized === null) {
    return [...DEFAULT_STRICT_INTENT_KEYWORDS]
  }
  return normalized
}

export function pickStrictIntentHints(description: string, keywords: readonly string[]): string[] {
  const normalized = description.toLowerCase()
  return keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()))
}

export { DEFAULT_STRICT_INTENT_KEYWORDS }
