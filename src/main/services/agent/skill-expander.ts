/**
 * Lazy Directive Expander
 *
 * Expands:
 * - "/skill-name" → <skill>SKILL.md</skill>
 * - "@agent-name" → <task-request>agent.md</task-request>
 *
 * Only active when skillsLazyLoad is enabled.
 */

import { createHash } from 'crypto'
import { getSkillContent, getSkillDefinition } from '../skills.service'
import { getAgent, getAgentContent } from '../agents.service'
import type { InvocationContext, ResourceExposure } from '../../../shared/resource-access'
import type { DirectiveRef } from './types'

const SLASH_LINE_RE = /^\/([\p{L}\p{N}._:-]+)(?:\s+(.+))?$/u
const AT_LINE_RE = /^@([\p{L}\p{N}._:-]+)(?:\s+(.+))?$/u
const TOKEN_CHAR_RE = /[\p{L}\p{N}._:-]/u

interface ParsedDirectiveToken {
  raw: string
  name: string
  namespace?: string
}

interface ExpansionState {
  expanded: LazyExpansionResult['expanded']
  missing: LazyExpansionResult['missing']
  expandedSeen: {
    skills: Set<string>
    commands: Set<string>
    agents: Set<string>
  }
  missingSeen: {
    skills: Set<string>
    commands: Set<string>
    agents: Set<string>
  }
}

interface InlineTokenMatch {
  type: 'slash' | 'at'
  token: ParsedDirectiveToken
}

interface CodeRange {
  start: number
  end: number
}

interface ExpandLazyDirectiveOptions {
  skip?: Set<string>
  allowSources?: string[]
  invocationContext?: InvocationContext
  locale?: string
  resourceExposureEnabled?: boolean
  allowLegacyWorkflowInternalDirect?: boolean
  legacyDependencyRegexEnabled?: boolean
}

export interface LazyExpansionResult {
  text: string
  expanded: {
    skills: string[]
    commands: string[]
    agents: string[]
  }
  missing: {
    skills: string[]
    commands: string[]
    agents: string[]
  }
}

function createEmptyExpansionState(): ExpansionState {
  return {
    expanded: { skills: [], commands: [], agents: [] },
    missing: { skills: [], commands: [], agents: [] },
    expandedSeen: {
      skills: new Set<string>(),
      commands: new Set<string>(),
      agents: new Set<string>()
    },
    missingSeen: {
      skills: new Set<string>(),
      commands: new Set<string>(),
      agents: new Set<string>()
    }
  }
}

function emitResourceExposureBlockEvent(
  type: 'skill' | 'agent' | 'command',
  token: ParsedDirectiveToken,
  context: InvocationContext,
  exposure: ResourceExposure | undefined
): void {
  console.warn('[telemetry] resource_exposure_block', {
    type,
    token: token.raw,
    exposure: exposure || 'public',
    context,
    callerChannel: context
  })
}

/**
 * Escapes HTML special characters to prevent XSS attacks.
 */
function escapeHtml(str: string): string {
  const htmlEscapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;'
  }

  return str.replace(/[&<>"']/g, (char) => htmlEscapeMap[char])
}

function buildArgsAttr(args?: string): string {
  if (!args) return ''
  return ` args="${escapeHtml(args)}"`
}

/**
 * Parse token using first ":" separator (split(':', 2)).
 * This MUST stay aligned with skills/commands/agents service lookup behavior.
 */
export function parseDirectiveToken(raw: string): ParsedDirectiveToken | null {
  const value = raw.trim()
  if (!value) return null

  if (!value.includes(':')) {
    return { raw: value, name: value }
  }

  const [namespace, name] = value.split(':', 2)
  if (!namespace || !name) return null

  return {
    raw: value,
    namespace,
    name
  }
}

function pushUnique(
  list: string[],
  seen: Set<string>,
  value: string
): void {
  if (seen.has(value)) return
  seen.add(value)
  list.push(value)
}

function pushExpanded(
  state: ExpansionState,
  type: 'skills' | 'commands' | 'agents',
  value: string
): void {
  pushUnique(state.expanded[type], state.expandedSeen[type], value)
}

function pushMissing(
  state: ExpansionState,
  type: 'skills' | 'commands' | 'agents',
  value: string
): void {
  pushUnique(state.missing[type], state.missingSeen[type], value)
}

/**
 * Removes YAML frontmatter from content.
 * Protects against ReDoS by using simple string operations and size limits.
 */
export function stripFrontmatter(content: string): string {
  const MAX_SIZE = 1024 * 1024 // 1MB
  if (content.length > MAX_SIZE) {
    throw new Error(`Input too large: ${content.length} bytes exceeds ${MAX_SIZE} byte limit`)
  }

  if (!content.startsWith('---')) {
    return content
  }

  const lines = content.split('\n')
  if (lines[0].trim() !== '---') {
    return content
  }

  const maxLinesToCheck = Math.min(lines.length, 1000)
  for (let i = 1; i < maxLinesToCheck; i++) {
    if (lines[i].trim() === '---') {
      return lines.slice(i + 1).join('\n')
    }
  }

  return content
}

function findReferencedSkill(commandContent: string): string | null {
  const body = stripFrontmatter(commandContent)
  const match = body.match(/\b(?:invoke|use|run)\s+(?:the\s+)?([\p{L}\p{N}._:-]+)\s+skill\b/iu)
  if (!match) return null
  return match[1]
}

function isAllowedSource(allowedSources: string[] | undefined, source: string | undefined): boolean {
  if (!allowedSources || allowedSources.length === 0) return true
  if (!source) return false
  return allowedSources.includes(source)
}

function shouldSkipToken(token: ParsedDirectiveToken, options?: ExpandLazyDirectiveOptions): boolean {
  if (!options?.skip) return false
  return options.skip.has(token.raw) || options.skip.has(token.name)
}

function canUseExposure(
  exposure: ResourceExposure | undefined,
  context: InvocationContext,
  options?: ExpandLazyDirectiveOptions
): boolean {
  if (options?.resourceExposureEnabled === false) return true
  if (exposure !== 'internal-only') return true
  if (context === 'command-dependency') return true
  if (context === 'workflow-step' && options?.allowLegacyWorkflowInternalDirect) return true
  return false
}

function warnWorkflowLegacyInternal(
  type: 'skill' | 'agent' | 'command',
  token: ParsedDirectiveToken,
  context: InvocationContext,
  exposure: ResourceExposure | undefined,
  options?: ExpandLazyDirectiveOptions
): void {
  if (context !== 'workflow-step') return
  if (!options?.allowLegacyWorkflowInternalDirect) return
  if (options?.resourceExposureEnabled === false) return
  if (exposure !== 'internal-only') return
  console.warn(`[ResourceExposure] Workflow legacy direct access allowed for internal-only ${type}: ${token.raw}`)
}

function buildSkillInjectionBlock(
  tokenRaw: string,
  content: string,
  args?: string,
  injectedType = 'skill'
): string {
  const argsAttr = buildArgsAttr(args)
  return [
    `<!-- injected: ${injectedType} -->`,
    `<skill name="${tokenRaw}"${argsAttr}>`,
    content.trimEnd(),
    '</skill>'
  ].join('\n')
}

function buildCommandInjectionBlock(
  tokenRaw: string,
  content: string,
  args?: string,
  injectedType = 'command'
): string {
  const argsAttr = buildArgsAttr(args)
  return [
    `<!-- injected: ${injectedType} -->`,
    `<command name="${tokenRaw}"${argsAttr}>`,
    content.trimEnd(),
    '</command>'
  ].join('\n')
}

function buildAgentInjectionBlock(
  tokenRaw: string,
  content: string,
  args?: string,
  injectedType = 'agent'
): string {
  const argsAttr = buildArgsAttr(args)
  return [
    `<!-- injected: ${injectedType} -->`,
    `<task-request name="${tokenRaw}"${argsAttr}>`,
    content.trimEnd(),
    '</task-request>'
  ].join('\n')
}

function expandRequiredSkillDependency(
  token: ParsedDirectiveToken,
  state: ExpansionState,
  workDir?: string,
  options?: ExpandLazyDirectiveOptions,
  args?: string
): string | null {
  const skillDefinition = getSkillDefinition(token.raw, workDir, { locale: options?.locale })
  if (!skillDefinition || !isAllowedSource(options?.allowSources, skillDefinition.source)) {
    pushMissing(state, 'skills', token.raw)
    return null
  }

  if (!canUseExposure(skillDefinition.exposure, 'command-dependency', options)) {
    pushMissing(state, 'skills', token.raw)
    return null
  }

  const skill = getSkillContent(token.raw, workDir, { locale: options?.locale })
  if (!skill) {
    pushMissing(state, 'skills', token.raw)
    return null
  }

  pushExpanded(state, 'skills', token.raw)
  return buildSkillInjectionBlock(token.raw, skill.content, args, 'command-skill')
}

function expandRequiredAgentDependency(
  token: ParsedDirectiveToken,
  state: ExpansionState,
  workDir?: string,
  options?: ExpandLazyDirectiveOptions
): string | null {
  const agentDefinition = getAgent(token.raw, workDir)
  if (!agentDefinition || !isAllowedSource(options?.allowSources, agentDefinition.source)) {
    pushMissing(state, 'agents', token.raw)
    return null
  }

  if (!canUseExposure(agentDefinition.exposure, 'command-dependency', options)) {
    pushMissing(state, 'agents', token.raw)
    return null
  }

  const agentContent = getAgentContent(token.raw, workDir)
  if (!agentContent) {
    pushMissing(state, 'agents', token.raw)
    return null
  }

  pushExpanded(state, 'agents', token.raw)
  return buildAgentInjectionBlock(token.raw, agentContent)
}

function expandSkillDirective(
  token: ParsedDirectiveToken,
  state: ExpansionState,
  workDir?: string,
  args?: string,
  options?: ExpandLazyDirectiveOptions,
  injectedType = 'skill'
): string | null {
  if (shouldSkipToken(token, options)) {
    return null
  }

  const skillDefinition = getSkillDefinition(token.raw, workDir, { locale: options?.locale })
  if (!skillDefinition || !isAllowedSource(options?.allowSources, skillDefinition.source)) {
    pushMissing(state, 'skills', token.raw)
    return null
  }
  const invocationContext = options?.invocationContext || 'interactive'
  if (!canUseExposure(skillDefinition.exposure, invocationContext, options)) {
    emitResourceExposureBlockEvent('skill', token, invocationContext, skillDefinition.exposure)
    pushMissing(state, 'skills', token.raw)
    return null
  }
  warnWorkflowLegacyInternal('skill', token, invocationContext, skillDefinition.exposure, options)

  const skill = getSkillContent(token.raw, workDir, { locale: options?.locale })
  if (!skill) {
    pushMissing(state, 'skills', token.raw)
    return null
  }

  pushExpanded(state, 'skills', token.raw)
  return buildSkillInjectionBlock(token.raw, skill.content, args, injectedType)
}

function expandCommandDirective(
  token: ParsedDirectiveToken,
  state: ExpansionState,
  workDir?: string,
  args?: string,
  options?: ExpandLazyDirectiveOptions,
  injectedType = 'command',
  fallbackToSkill = false
): string | null {
  return expandSkillDirective(
    token,
    state,
    workDir,
    args,
    options,
    fallbackToSkill ? 'skill' : injectedType
  )
}

function expandAgentDirective(
  token: ParsedDirectiveToken,
  state: ExpansionState,
  workDir?: string,
  args?: string,
  options?: ExpandLazyDirectiveOptions
): string | null {
  if (shouldSkipToken(token, options)) {
    return null
  }

  const agentDefinition = getAgent(token.raw, workDir)
  if (!agentDefinition || !isAllowedSource(options?.allowSources, agentDefinition.source)) {
    pushMissing(state, 'agents', token.raw)
    return null
  }
  const invocationContext = options?.invocationContext || 'interactive'
  if (!canUseExposure(agentDefinition.exposure, invocationContext, options)) {
    emitResourceExposureBlockEvent('agent', token, invocationContext, agentDefinition.exposure)
    pushMissing(state, 'agents', token.raw)
    return null
  }
  warnWorkflowLegacyInternal('agent', token, invocationContext, agentDefinition.exposure, options)

  const agentContent = getAgentContent(token.raw, workDir)
  if (!agentContent) {
    pushMissing(state, 'agents', token.raw)
    return null
  }

  pushExpanded(state, 'agents', token.raw)
  return buildAgentInjectionBlock(token.raw, agentContent, args)
}

function expandSlashDirective(
  token: ParsedDirectiveToken,
  state: ExpansionState,
  workDir?: string,
  args?: string,
  options?: ExpandLazyDirectiveOptions
): string | null {
  return expandCommandDirective(
    token,
    state,
    workDir,
    args,
    options,
    'command',
    true
  )
}

function isSlashBoundary(prev: string | undefined): boolean {
  if (!prev) return true
  return !/[A-Za-z0-9_/:.@-]/.test(prev)
}

function isAtBoundary(prev: string | undefined): boolean {
  if (!prev) return true
  return !/[A-Za-z0-9_.+-]/.test(prev)
}

function getInlineCodeRanges(line: string): CodeRange[] {
  const ranges: CodeRange[] = []
  let i = 0

  while (i < line.length) {
    if (line[i] !== '`') {
      i += 1
      continue
    }

    let tickCount = 1
    while (i + tickCount < line.length && line[i + tickCount] === '`') {
      tickCount += 1
    }

    const marker = '`'.repeat(tickCount)
    const closeIndex = line.indexOf(marker, i + tickCount)
    if (closeIndex === -1) {
      break
    }

    ranges.push({
      start: i,
      end: closeIndex + tickCount
    })

    i = closeIndex + tickCount
  }

  return ranges
}

function collectInlineDirectiveTokens(line: string): InlineTokenMatch[] {
  const ranges = getInlineCodeRanges(line)
  const matches: InlineTokenMatch[] = []
  let i = 0
  let rangeIdx = 0

  while (i < line.length) {
    const currentRange = ranges[rangeIdx]
    if (currentRange && i >= currentRange.start && i < currentRange.end) {
      i = currentRange.end
      rangeIdx += 1
      continue
    }

    const ch = line[i]
    if (ch !== '/' && ch !== '@') {
      i += 1
      continue
    }

    if (i > 0 && line[i - 1] === '\\') {
      i += 1
      continue
    }

    const prev = i > 0 ? line[i - 1] : undefined
    if (ch === '/' && !isSlashBoundary(prev)) {
      i += 1
      continue
    }
    if (ch === '@' && !isAtBoundary(prev)) {
      i += 1
      continue
    }

    let j = i + 1
    while (j < line.length && TOKEN_CHAR_RE.test(line[j])) {
      j += 1
    }

    if (j === i + 1) {
      i += 1
      continue
    }

    // Skip path-like fragments such as "/alpha/log.txt".
    if (ch === '/' && j < line.length && line[j] === '/') {
      i = j
      continue
    }

    const token = parseDirectiveToken(line.slice(i + 1, j))
    if (token) {
      matches.push({
        type: ch === '/' ? 'slash' : 'at',
        token
      })
    }

    i = j
  }

  return matches
}

function mergeUnique(base: string[], next: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const value of base) {
    if (seen.has(value)) continue
    seen.add(value)
    merged.push(value)
  }
  for (const value of next) {
    if (seen.has(value)) continue
    seen.add(value)
    merged.push(value)
  }
  return merged
}

function directiveTokenFromRef(directive: DirectiveRef): ParsedDirectiveToken | null {
  const tokenRaw = directive.namespace
    ? `${directive.namespace}:${directive.name}`
    : directive.name
  return parseDirectiveToken(tokenRaw)
}

export function expandStructuredDirectives(
  directives?: DirectiveRef[],
  workDir?: string,
  options?: ExpandLazyDirectiveOptions
): LazyExpansionResult {
  if (!directives || directives.length === 0) {
    return {
      text: '',
      expanded: { skills: [], commands: [], agents: [] },
      missing: { skills: [], commands: [], agents: [] }
    }
  }

  const state = createEmptyExpansionState()
  const blocks: string[] = []
  for (const directive of directives) {
    const token = directiveTokenFromRef(directive)
    if (!token) {
      pushMissing(state, `${directive.type}s` as 'skills' | 'commands' | 'agents', directive.name)
      continue
    }

    let block: string | null = null
    if (directive.type === 'skill') {
      block = expandSkillDirective(
        token,
        state,
        workDir,
        directive.args,
        options,
        'skill (structured)'
      )
    } else if (directive.type === 'command') {
      block = expandCommandDirective(
        token,
        state,
        workDir,
        directive.args,
        options,
        'command (structured)',
        false
      )
    } else if (directive.type === 'agent') {
      block = expandAgentDirective(token, state, workDir, directive.args, options)
    }

    if (block) {
      blocks.push(block)
    }
  }

  return {
    text: blocks.join('\n\n'),
    expanded: state.expanded,
    missing: state.missing
  }
}

export function mergeExpansions(
  left: LazyExpansionResult,
  right: LazyExpansionResult
): LazyExpansionResult {
  const text = [left.text, right.text].filter((item) => item.trim().length > 0).join('\n\n')
  return {
    text,
    expanded: {
      skills: mergeUnique(left.expanded.skills, right.expanded.skills),
      commands: mergeUnique(left.expanded.commands, right.expanded.commands),
      agents: mergeUnique(left.expanded.agents, right.expanded.agents)
    },
    missing: {
      skills: mergeUnique(left.missing.skills, right.missing.skills),
      commands: mergeUnique(left.missing.commands, right.missing.commands),
      agents: mergeUnique(left.missing.agents, right.missing.agents)
    }
  }
}

export function computeFingerprint(content: string): string {
  return createHash('sha256')
    .update(content.slice(0, 1024))
    .digest('hex')
    .slice(0, 8)
}

export function expandLazyDirectives(
  input: string,
  workDir?: string,
  options?: ExpandLazyDirectiveOptions
): LazyExpansionResult {
  const state: ExpansionState = createEmptyExpansionState()

  const lines = input.split(/\r?\n/)
  const inlineInjectionBlocks: string[] = []
  const seenInlineTokenKeys = new Set<string>()
  let inFence = false

  const outLines = lines.map((line) => {
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      inFence = !inFence
      return line
    }

    if (inFence) return line

    const agentMatch = trimmed.match(AT_LINE_RE)
    if (agentMatch) {
      const token = parseDirectiveToken(agentMatch[1])
      if (!token) return line
      const expanded = expandAgentDirective(token, state, workDir, agentMatch[2], options)
      return expanded ?? line
    }

    const slashMatch = trimmed.match(SLASH_LINE_RE)
    if (slashMatch) {
      const token = parseDirectiveToken(slashMatch[1])
      if (!token) return line
      const expanded = expandSlashDirective(token, state, workDir, slashMatch[2], options)
      return expanded ?? line
    }

    const inlineTokens = collectInlineDirectiveTokens(line)
    for (const match of inlineTokens) {
      const tokenKey = `${match.type}:${match.token.raw}`
      if (seenInlineTokenKeys.has(tokenKey)) continue

      const block = match.type === 'at'
        ? expandAgentDirective(match.token, state, workDir, undefined, options)
        : expandSlashDirective(match.token, state, workDir, undefined, options)

      if (!block) continue
      seenInlineTokenKeys.add(tokenKey)
      inlineInjectionBlocks.push(block)
    }

    return line
  })

  const outText = outLines.join('\n')
  const prefixedText = inlineInjectionBlocks.length > 0
    ? (outText.trim().length > 0
      ? `${inlineInjectionBlocks.join('\n\n')}\n\n${outText}`
      : inlineInjectionBlocks.join('\n\n'))
    : outText

  return {
    text: prefixedText,
    expanded: state.expanded,
    missing: state.missing
  }
}
