import type { Message } from '../../types'
import { splitGuidedMessagesForActiveRun } from './MessageList'

export type ChatTurnState = 'open' | 'closed'

export interface ChatTurn {
  id: string
  index: number
  userMessageId: string
  assistantMessageId: string | null
  state: ChatTurnState
  userText: string
  timestamp: string
}

const SUMMARY_MAX_LENGTH = 120

function summarizeUserText(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= SUMMARY_MAX_LENGTH) return normalized
  return `${normalized.slice(0, SUMMARY_MAX_LENGTH - 1)}…`
}

export function deriveChatTurns(
  messages: Message[],
  isGenerating: boolean,
  activeRunId?: string | null
): ChatTurn[] {
  const { mainMessages } = splitGuidedMessagesForActiveRun(messages, isGenerating, activeRunId)

  const turns: ChatTurn[] = []
  let currentTurn: ChatTurn | null = null

  for (const message of mainMessages) {
    if (message.role === 'user') {
      if (currentTurn) {
        turns.push({
          ...currentTurn,
          state: 'closed'
        })
      }

      currentTurn = {
        id: `turn-${message.id}`,
        index: turns.length + 1,
        userMessageId: message.id,
        assistantMessageId: null,
        state: 'open',
        userText: summarizeUserText(message.content || ''),
        timestamp: message.timestamp
      }
      continue
    }

    if (message.role !== 'assistant') {
      continue
    }

    if (!currentTurn) {
      continue
    }

    turns.push({
      ...currentTurn,
      assistantMessageId: message.id,
      state: 'closed'
    })
    currentTurn = null
  }

  if (currentTurn) {
    turns.push(currentTurn)
  }

  return turns
}
