import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const DEFAULT_PLUGIN_ROOT = '/Users/dl/.kite/plugins/superpowers'
const pluginRoot = resolve(process.env.KITE_SUPERPOWERS_PLUGIN_ROOT || DEFAULT_PLUGIN_ROOT)

const targets = {
  usingSuperpowers: join(pluginRoot, 'skills', 'using-superpowers', 'SKILL.md'),
  brainstorming: join(pluginRoot, 'skills', 'brainstorming', 'SKILL.md'),
  writingPlans: join(pluginRoot, 'skills', 'writing-plans', 'SKILL.md'),
  tdd: join(pluginRoot, 'skills', 'test-driven-development', 'SKILL.md'),
  debugging: join(pluginRoot, 'skills', 'systematic-debugging', 'SKILL.md'),
  hooksJson: join(pluginRoot, 'hooks', 'hooks.json'),
  sessionStart: join(pluginRoot, 'hooks', 'session-start')
}

const SESSION_START_TEMPLATE = `#!/usr/bin/env bash
# SessionStart hook for superpowers plugin

set -euo pipefail

# Check if legacy skills directory exists and build warning
warning_message=""
legacy_skills_dir="\${HOME}/.config/superpowers/skills"
if [ -d "$legacy_skills_dir" ]; then
    warning_message="\\n\\n<important-reminder>IN YOUR FIRST REPLY AFTER SEEING THIS MESSAGE YOU MUST TELL THE USER:⚠️ **WARNING:** Superpowers now uses Claude Code's skills system. Custom skills in ~/.config/superpowers/skills will not be read. Move custom skills to ~/.claude/skills instead. To make this message go away, remove ~/.config/superpowers/skills</important-reminder>"
fi

# Escape string for JSON embedding using bash parameter substitution.
# Each \${s//old/new} is a single C-level pass - orders of magnitude
# faster than the character-by-character loop this replaces.
escape_for_json() {
    local s="$1"
    s="\${s//\\\\/\\\\\\\\}"
    s="\${s//\\"/\\\\\\"}"
    s="\${s//$'\\n'/\\\\n}"
    s="\${s//$'\\r'/\\\\r}"
    s="\${s//$'\\t'/\\\\t}"
    printf '%s' "$s"
}

warning_escaped=$(escape_for_json "$warning_message")
session_context="<EXTREMELY_IMPORTANT>\\nYou have superpowers.\\n\\nUse superpowers workflow skills only for software-development tasks that modify code behavior.\\nDo not auto-apply workflow skills for casual chat, translation, summarization, or general knowledge Q&A.\\nPrefer explicit user intent or clear code-change context before invoking process-heavy skills.\\nIf intent is ambiguous, ask one clarifying question before invoking a workflow skill.\\n\\n\${warning_escaped}\\n</EXTREMELY_IMPORTANT>"

# Output context injection as JSON.
# Keep both shapes for compatibility:
# - Cursor hooks expect additional_context.
# - Claude hooks expect hookSpecificOutput.additionalContext.
cat <<EOF
{
  "additional_context": "\${session_context}",
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "\${session_context}"
  }
}
EOF

exit 0
`

function log(message) {
  console.log(`[superpowers-patch] ${message}`)
}

function warn(message) {
  console.warn(`[superpowers-patch] ${message}`)
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function writeIfChanged(filePath, nextContent) {
  if (!existsSync(filePath)) {
    warn(`Missing file, skipped: ${filePath}`)
    return false
  }

  const current = readFileSync(filePath, 'utf-8')
  if (current === nextContent) return false
  writeFileSync(filePath, nextContent, 'utf-8')
  return true
}

function upsertFrontmatterFields(filePath, fields) {
  if (!existsSync(filePath)) {
    warn(`Missing file, skipped: ${filePath}`)
    return false
  }

  const content = readFileSync(filePath, 'utf-8')
  if (!content.startsWith('---\n')) {
    warn(`No frontmatter found, skipped: ${filePath}`)
    return false
  }
  const endIndex = content.indexOf('\n---\n', 4)
  if (endIndex < 0) {
    warn(`Invalid frontmatter block, skipped: ${filePath}`)
    return false
  }

  const frontmatterBody = content.slice(4, endIndex)
  const rest = content.slice(endIndex + '\n---\n'.length)
  const lines = frontmatterBody.length > 0 ? frontmatterBody.split('\n') : []

  let changed = false
  for (const [key, value] of Object.entries(fields)) {
    const targetLine = `${key}: ${value}`
    const matcher = new RegExp(`^${escapeRegex(key)}:\\s*`)
    const idx = lines.findIndex((line) => matcher.test(line))
    if (idx >= 0) {
      if (lines[idx] !== targetLine) {
        lines[idx] = targetLine
        changed = true
      }
      continue
    }

    lines.push(targetLine)
    changed = true
  }

  if (!changed) return false
  const next = `---\n${lines.join('\n')}\n---\n${rest}`
  writeFileSync(filePath, next, 'utf-8')
  return true
}

function patchHooksJson(filePath) {
  if (!existsSync(filePath)) {
    warn(`Missing file, skipped: ${filePath}`)
    return false
  }

  let parsed
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (error) {
    warn(`Invalid JSON, skipped: ${filePath} (${error instanceof Error ? error.message : String(error)})`)
    return false
  }

  const firstSessionStart = parsed?.hooks?.SessionStart?.[0]
  if (!firstSessionStart || typeof firstSessionStart !== 'object') {
    warn(`SessionStart hook not found, skipped: ${filePath}`)
    return false
  }
  if (firstSessionStart.matcher === 'startup') {
    return false
  }

  firstSessionStart.matcher = 'startup'
  writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8')
  return true
}

function main() {
  let changedCount = 0
  log(`Applying trigger patch under ${pluginRoot}`)

  if (upsertFrontmatterFields(targets.usingSuperpowers, {
    description: '"Use when the request is clearly software-development work (implementing code, fixing bugs, refactoring, writing tests) or the user explicitly asks to use a skill. Do not auto-trigger for casual chat, translation, summarization, or general knowledge Q&A."',
    'disable-model-invocation': 'true'
  })) changedCount += 1

  if (upsertFrontmatterFields(targets.brainstorming, {
    description: '"Use when a software-development request will modify code behavior (feature, refactor, bugfix) and design clarification is needed before implementation. Do not auto-trigger for pure writing, analysis, translation, summarization, or general knowledge Q&A."'
  })) changedCount += 1

  if (upsertFrontmatterFields(targets.writingPlans, {
    description: 'Use when an approved software design/spec needs an implementation plan for a multi-step code change (typically 3+ dependent tasks), before touching code'
  })) changedCount += 1

  if (upsertFrontmatterFields(targets.tdd, {
    description: 'Use when actively implementing a feature or bugfix in code with runnable tests; do not auto-trigger for docs-only, analysis-only, or config-only tasks'
  })) changedCount += 1

  if (upsertFrontmatterFields(targets.debugging, {
    description: 'Use when a reproducible technical failure exists (bug, failing test/build, runtime error, or performance regression) and root-cause investigation is needed before proposing fixes'
  })) changedCount += 1

  if (patchHooksJson(targets.hooksJson)) changedCount += 1
  if (writeIfChanged(targets.sessionStart, SESSION_START_TEMPLATE)) changedCount += 1

  log(changedCount > 0 ? `Patch applied, changed ${changedCount} file(s).` : 'Patch already up to date.')
}

try {
  main()
} catch (error) {
  console.error('[superpowers-patch] Failed to apply patch:', error)
  process.exitCode = 1
}
