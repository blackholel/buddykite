#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const workspaceRoot = process.cwd()
const requiredTargets = [
  'src/main/services/agent/__tests__/ask-user-question-flow.test.ts',
  'src/main/services/agent/__tests__/message-flow.ask-user-question-status.test.ts',
  'src/renderer/stores/__tests__/chat.store.ask-user-question.test.ts',
  'tests/unit/services/renderer-comm.ask-user-question.test.ts'
]

const missingTargets = requiredTargets.filter((relativePath) => {
  const absolutePath = path.join(workspaceRoot, relativePath)
  return !fs.existsSync(absolutePath)
})

if (missingTargets.length > 0) {
  console.error('[check] Missing test targets for ask-user-question guard:')
  for (const relativePath of missingTargets) {
    console.error(`  - ${relativePath}`)
  }
  process.exit(1)
}

console.log('[check] OK: all ask-user-question guard test targets exist.')
