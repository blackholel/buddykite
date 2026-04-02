import { describe, expect, it } from 'vitest'
import {
  getResourceDisplayName,
  getResourceUiDescription
} from '../../../src/renderer/utils/resource-display-name'

describe('getResourceDisplayName', () => {
  it('prefers displayName and keeps namespace prefix', () => {
    const result = getResourceDisplayName({
      name: 'planner',
      displayNameLocalized: '规划助手',
      namespace: 'superpowers'
    })
    expect(result).toBe('superpowers:规划助手')
  })

  it('falls back to base name when localized name missing', () => {
    const result = getResourceDisplayName({
      name: 'planner',
      displayNameBase: 'Planner'
    })
    expect(result).toBe('Planner')
  })

  it('falls back to key name when display fields missing', () => {
    const result = getResourceDisplayName({ name: 'planner' })
    expect(result).toBe('planner')
  })

  it('description 优先 localized 后回退 base', () => {
    expect(getResourceUiDescription({
      name: 'planner',
      descriptionBase: 'Plan tasks',
      descriptionLocalized: '规划任务'
    })).toBe('规划任务')
    expect(getResourceUiDescription({
      name: 'planner',
      descriptionBase: 'Plan tasks'
    })).toBe('Plan tasks')
  })
})
