import { describe, expect, it } from 'vitest'
import {
  buildComposerResourceSuggestion,
  buildSdkSlashSnapshotSuggestions
} from '../../../src/renderer/utils/composer-resource-suggestion'

describe('composer-resource-suggestion', () => {
  it('skills: 展示 displayName，插入英文 key', () => {
    const suggestion = buildComposerResourceSuggestion('skill', {
      name: 'release-check',
      displayNameLocalized: '发布检查',
      descriptionLocalized: 'Release checklist',
      namespace: 'team',
      source: 'space',
      path: '/tmp/.claude/skills/release-check/SKILL.md'
    })

    expect(suggestion.displayName).toBe('team:发布检查')
    expect(suggestion.insertText).toBe('/team:release-check')
  })

  it('agents: 展示 displayName，插入英文 key', () => {
    const suggestion = buildComposerResourceSuggestion('agent', {
      name: 'planner',
      displayNameLocalized: '规划助手',
      descriptionLocalized: 'Plan tasks',
      namespace: 'ops',
      source: 'plugin',
      path: '/tmp/plugins/demo/agents/planner.md',
      pluginRoot: '/tmp/plugins/demo'
    })

    expect(suggestion.displayName).toBe('ops:规划助手')
    expect(suggestion.insertText).toBe('@ops:planner')
    expect(suggestion.scope).toBe('global')
  })

  it('commands: 未知 source 默认按 space 处理', () => {
    const suggestion = buildComposerResourceSuggestion('command', {
      name: 'deploy',
      displayNameLocalized: '部署',
      source: 'unknown-source',
      path: '/tmp/.claude/commands/deploy.md'
    })

    expect(suggestion.displayName).toBe('部署')
    expect(suggestion.insertText).toBe('/deploy')
    expect(suggestion.scope).toBe('space')
  })

  it('sdk slash snapshot: 展示 overlay 使用本地 localized/base，insertText 保持原 token', () => {
    const suggestions = buildSdkSlashSnapshotSuggestions({
      commands: ['/ops:release-check'],
      fallbackDescription: 'Native slash command from SDK',
      skills: [
        {
          name: 'release-check',
          namespace: 'ops',
          path: '/tmp/.claude/skills/release-check/SKILL.md',
          source: 'space',
          displayNameLocalized: '发布检查',
          descriptionLocalized: '发布前检查'
        }
      ]
    })

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]?.displayName).toBe('ops:发布检查')
    expect(suggestions[0]?.insertText).toBe('/ops:release-check')
    expect(suggestions[0]?.description).toBe('发布前检查')
  })
})
