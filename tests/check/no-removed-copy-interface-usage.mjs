#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const workspaceRoot = process.cwd()
const scanDirs = ['src', 'tests']
const excludedSuffixes = ['tests/check/no-removed-copy-interface-usage.mjs']

const forbiddenPatterns = [
  { name: 'renderer-api-copySkillToSpace', regex: /\bcopySkillToSpace\s*\(/g },
  { name: 'renderer-api-copyAgentToSpace', regex: /\bcopyAgentToSpace\s*\(/g },
  { name: 'renderer-api-copyCommandToSpace', regex: /\bcopyCommandToSpace\s*\(/g },
  { name: 'ipc-skills-copy-to-space', regex: /['"`]skills:copy-to-space['"`]/g },
  { name: 'ipc-agents-copy-to-space', regex: /['"`]agents:copy-to-space['"`]/g },
  { name: 'ipc-commands-copy-to-space', regex: /['"`]commands:copy-to-space['"`]/g },
  { name: 'http-skills-copy-route', regex: /['"`]\/api\/skills\/copy(?!-by-ref)['"`]/g },
  { name: 'http-agents-copy-route', regex: /['"`]\/api\/agents\/copy(?!-by-ref)['"`]/g },
  { name: 'http-commands-copy-route', regex: /['"`]\/api\/commands\/copy(?!-by-ref)['"`]/g }
]

function collectFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.git') {
      continue
    }

    const absolutePath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath))
      continue
    }

    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      continue
    }

    const relativePath = path.relative(workspaceRoot, absolutePath)
    if (excludedSuffixes.some((suffix) => relativePath.endsWith(suffix))) {
      continue
    }

    files.push({ absolutePath, relativePath })
  }

  return files
}

const findings = []

for (const scanDir of scanDirs) {
  const absoluteDir = path.join(workspaceRoot, scanDir)
  if (!fs.existsSync(absoluteDir)) continue

  const files = collectFiles(absoluteDir)
  for (const file of files) {
    const content = fs.readFileSync(file.absolutePath, 'utf-8')
    for (const pattern of forbiddenPatterns) {
      const matches = content.match(pattern.regex)
      if (!matches || matches.length === 0) continue
      findings.push({
        file: file.relativePath,
        pattern: pattern.name,
        count: matches.length
      })
    }
  }
}

if (findings.length > 0) {
  console.error('[no-removed-copy-interface-usage] Found removed copy-to-space symbols/routes:')
  for (const finding of findings) {
    console.error(`- ${finding.file} (${finding.pattern}) x${finding.count}`)
  }
  process.exit(1)
}

console.log('[no-removed-copy-interface-usage] OK')
