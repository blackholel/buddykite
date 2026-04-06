/**
 * Composer Store - one-shot insert requests for the chat input
 *
 * This store provides a small queue of insert requests that can be
 * consumed by the InputArea to append text into the composer.
 */

import { create } from 'zustand'
import type { SelectedComposerResourceChip } from '../utils/composer-resource-chip'

export interface InsertRequest {
  id: string
  text: string
  source?: 'skill' | 'agent' | 'command'
}

interface ComposerState {
  insertQueue: InsertRequest[]
  bootstrapChipsByConversation: Map<string, SelectedComposerResourceChip[]>
  requestInsert: (text: string, source?: InsertRequest['source']) => void
  dequeueInsert: (id: string) => void
  clearInserts: () => void
  queueBootstrapChip: (conversationId: string, chip: SelectedComposerResourceChip) => void
  consumeBootstrapChips: (conversationId: string) => SelectedComposerResourceChip[]
  clearBootstrapChips: () => void
}

const createInsertId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

export const useComposerStore = create<ComposerState>((set, get) => ({
  insertQueue: [],
  bootstrapChipsByConversation: new Map<string, SelectedComposerResourceChip[]>(),

  requestInsert: (text, source) =>
    set((state) => ({
      insertQueue: [...state.insertQueue, { id: createInsertId(), text, source }]
    })),

  dequeueInsert: (id) =>
    set((state) => ({
      insertQueue: state.insertQueue.filter((item) => item.id !== id)
    })),

  clearInserts: () => set({ insertQueue: [] }),

  queueBootstrapChip: (conversationId, chip) =>
    set((state) => {
      const next = new Map(state.bootstrapChipsByConversation)
      const current = next.get(conversationId) || []
      next.set(conversationId, [...current, chip])
      return { bootstrapChipsByConversation: next }
    }),

  consumeBootstrapChips: (conversationId) => {
    const current = get().bootstrapChipsByConversation.get(conversationId) || []
    if (current.length === 0) {
      return []
    }

    set((state) => {
      const next = new Map(state.bootstrapChipsByConversation)
      next.delete(conversationId)
      return { bootstrapChipsByConversation: next }
    })
    return current
  },

  clearBootstrapChips: () => set({ bootstrapChipsByConversation: new Map() })
}))
