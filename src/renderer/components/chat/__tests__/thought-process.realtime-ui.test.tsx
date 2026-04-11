import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Thought } from '../../../types'
import { ThoughtProcess } from '../ThoughtProcess'

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('ThoughtProcess realtime UI', () => {
  it('renders a single execution status region with shimmering title while thinking', () => {
    const html = renderToStaticMarkup(
      <ThoughtProcess thoughts={[]} isThinking={true} mode="realtime" />
    )

    expect(html).toContain('AI 正在执行')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('thinking-status-shimmer')
  })

  it('does not render debug init model connection thought in user-facing content', () => {
    const thoughts: Thought[] = [
      {
        id: 'init-debug',
        type: 'system',
        content: 'Connected | Model: gpt-5.4',
        timestamp: new Date().toISOString(),
        visibility: 'debug'
      }
    ]

    const html = renderToStaticMarkup(
      <ThoughtProcess thoughts={thoughts} isThinking={true} mode="realtime" />
    )

    expect(html).not.toContain('Connected | Model:')
  })
})
