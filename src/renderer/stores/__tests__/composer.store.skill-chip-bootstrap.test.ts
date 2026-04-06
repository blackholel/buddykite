import { beforeEach, describe, expect, it } from 'vitest'
import { useComposerStore } from '../composer.store'

describe('composer.store skill chip bootstrap', () => {
  beforeEach(() => {
    useComposerStore.getState().clearInserts()
    useComposerStore.getState().clearBootstrapChips()
  })

  it('consumes bootstrap chips once for the target conversation only', () => {
    useComposerStore.getState().queueBootstrapChip('conv-skill', {
      id: 'skill:skill-creator',
      type: 'skill',
      displayName: 'skill-creator',
      token: '/skill-creator'
    })

    expect(useComposerStore.getState().consumeBootstrapChips('conv-other')).toEqual([])
    expect(useComposerStore.getState().consumeBootstrapChips('conv-skill')).toHaveLength(1)
    expect(useComposerStore.getState().consumeBootstrapChips('conv-skill')).toEqual([])
  })

  it('clears all queued bootstrap chips', () => {
    useComposerStore.getState().queueBootstrapChip('conv-a', {
      id: 'skill:skill-creator',
      type: 'skill',
      displayName: 'skill-creator',
      token: '/skill-creator'
    })
    useComposerStore.getState().clearBootstrapChips()

    expect(useComposerStore.getState().consumeBootstrapChips('conv-a')).toEqual([])
  })
})
