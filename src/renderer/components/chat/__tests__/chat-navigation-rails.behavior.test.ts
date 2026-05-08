import { describe, expect, it, vi } from 'vitest'
import {
  resolveRailVisibility,
  scrollContainerToHeading,
  scrollContainerToMessage
} from '../chat-navigation-utils'

describe('chat navigation rail visibility', () => {
  it('turn >= 1 且宽度 >= 640 时显示右 rail', () => {
    const result = resolveRailVisibility({
      containerWidth: 800,
      turnCount: 1,
      headingCount: 0,
      isGenerating: false,
      isCompact: false
    })

    expect(result.showRightRail).toBe(true)
  })

  it('turn 为 0 时不显示右 rail', () => {
    const result = resolveRailVisibility({
      containerWidth: 1200,
      turnCount: 0,
      headingCount: 3,
      isGenerating: false,
      isCompact: false
    })

    expect(result.showRightRail).toBe(false)
  })

  it('heading >= 1 且非生成态时显示左 rail', () => {
    const result = resolveRailVisibility({
      containerWidth: 1200,
      turnCount: 2,
      headingCount: 1,
      isGenerating: false,
      isCompact: true
    })

    expect(result.showLeftRail).toBe(true)
    expect(result.showRightRail).toBe(true)
  })

  it('宽度不足双 rail 时仍保留左目录（紧凑态）', () => {
    const result = resolveRailVisibility({
      containerWidth: 900,
      turnCount: 2,
      headingCount: 3,
      isGenerating: false,
      isCompact: false
    })

    expect(result.showRightRail).toBe(true)
    expect(result.showLeftRail).toBe(true)
  })

  it('窄宽度下可仅显示左目录', () => {
    const result = resolveRailVisibility({
      containerWidth: 500,
      turnCount: 1,
      headingCount: 2,
      isGenerating: false,
      isCompact: false
    })

    expect(result.showRightRail).toBe(false)
    expect(result.showLeftRail).toBe(true)
  })

  it('heading 为 0 或生成中时不显示左 rail', () => {
    const noEnoughHeading = resolveRailVisibility({
      containerWidth: 1400,
      turnCount: 2,
      headingCount: 0,
      isGenerating: false,
      isCompact: false
    })
    const generating = resolveRailVisibility({
      containerWidth: 1400,
      turnCount: 2,
      headingCount: 3,
      isGenerating: true,
      isCompact: false
    })

    expect(noEnoughHeading.showLeftRail).toBe(false)
    expect(generating.showLeftRail).toBe(false)
  })
})

describe('chat navigation rail scroll actions', () => {
  it('点击右 rail 时滚动到对应用户消息', () => {
    const scrollIntoView = vi.fn()
    const querySelector = vi.fn().mockReturnValue({
      scrollIntoView
    })
    const container = { querySelector } as unknown as Pick<HTMLDivElement, 'querySelector'>

    scrollContainerToMessage(container, 'u-2')

    expect(querySelector).toHaveBeenCalledWith('[data-message-id="u-2"]')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('点击左目录时滚动到对应标题', () => {
    const scrollIntoView = vi.fn()
    const querySelector = vi.fn().mockReturnValue({
      scrollIntoView
    })
    const container = { querySelector } as unknown as Pick<HTMLDivElement, 'querySelector'>

    scrollContainerToHeading(container, 'msg-1-intro')

    expect(querySelector).toHaveBeenCalledWith('[id="msg-1-intro"]')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })
})
