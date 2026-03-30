export type ResourceDraftType = 'skill' | 'agent'

export interface ResourceDraft {
  name: string
  description: string
  content: string
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'with', 'in', 'on', 'by', 'from',
  '创建', '一个', '用于', '可以', '能够', '帮我', '帮忙', 'please', 'make', 'build'
])

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function toTitleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function pickNameFromDescription(description: string, type: ResourceDraftType): string {
  const explicitMention = description.match(/(?:\/|@)([a-z0-9-]{2,64})/i)
  if (explicitMention) {
    const slug = toSlug(explicitMention[1])
    if (slug) return slug
  }

  const words = normalizeWhitespace(description)
    .split(' ')
    .map((word) => word.replace(/[^a-zA-Z0-9-]/g, ''))
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .slice(0, 4)
  const candidate = toSlug(words.join('-'))
  if (candidate) return candidate
  return type === 'skill' ? 'new-skill' : 'new-agent'
}

function escapeYamlValue(value: string): string {
  return JSON.stringify(value)
}

function buildSkillDraft(name: string, description: string): ResourceDraft {
  const title = toTitleCase(name)
  const content = [
    '---',
    `name: ${escapeYamlValue(name)}`,
    `description: ${escapeYamlValue(description)}`,
    'triggers:',
    `  - ${name}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## Purpose',
    description,
    '',
    '## When to Use',
    '- Use when the user explicitly asks for this capability.',
    '- Use when the task can be executed with a stable step-by-step flow.',
    '',
    '## Execution Steps',
    '1. Restate goals and expected output before execution.',
    '2. Execute core steps and report key progress updates.',
    '3. Deliver results with validation notes and next steps.',
    ''
  ].join('\n')

  return {
    name,
    description,
    content
  }
}

function buildAgentDraft(name: string, description: string): ResourceDraft {
  const title = toTitleCase(name)
  const content = [
    '---',
    `name: ${escapeYamlValue(name)}`,
    `description: ${escapeYamlValue(description)}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## Role',
    description,
    '',
    '## Working Style',
    '- Confirm goals and constraints before execution.',
    '- Provide direct and executable output.',
    '- Call out risks and provide alternatives.',
    '',
    '## Output Standard',
    '- Keep conclusions clear and reproducible.',
    '- Include verification notes and suggested next steps.',
    ''
  ].join('\n')

  return {
    name,
    description,
    content
  }
}

export function generateResourceDraft(
  type: ResourceDraftType,
  userDescription: string
): ResourceDraft {
  const description = normalizeWhitespace(userDescription)
  if (!description) {
    throw new Error('Description is required')
  }

  const name = pickNameFromDescription(description, type)
  if (!name) {
    throw new Error('Failed to generate resource name')
  }

  return type === 'skill'
    ? buildSkillDraft(name, description)
    : buildAgentDraft(name, description)
}

export function generateSkillDraft(userDescription: string): ResourceDraft {
  return generateResourceDraft('skill', userDescription)
}

export function generateAgentDraft(userDescription: string): ResourceDraft {
  return generateResourceDraft('agent', userDescription)
}
