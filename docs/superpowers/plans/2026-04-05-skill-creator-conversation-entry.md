# Skill Creator Conversation Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把技能面板里的“创建技能”改成“创建一个普通 conversation，并在首次打开时一次性挂载 `skill-creator` chip”，同时让 placeholder 随 chip 状态切换，并继续复用现有 skills 落盘链路。

**Architecture:** 保持主进程 conversation schema 不变，只在 renderer 侧新增一次性 composer chip 注入能力。入口由 `ExtensionsView` 触发，通过 `chat.store + canvasLifecycle` 创建并打开普通 conversation，再由 `composer.store + InputArea` 完成一次性 `skill-creator` 注入和 placeholder 切换。

**Tech Stack:** Electron, React, Zustand, TypeScript, Vitest, existing canvas lifecycle / chat store / composer chip utilities

---

## File Structure

**Modify**
- `src/renderer/components/home/ExtensionsView.tsx`
- `src/renderer/stores/chat.store.ts`
- `src/renderer/stores/composer.store.ts`
- `src/renderer/components/chat/InputArea.tsx`
- `src/renderer/components/canvas/viewers/ChatTabViewer.tsx`
- `src/renderer/i18n/locales/zh-CN.json`
- `src/renderer/i18n/locales/en.json`

**Create**
- `src/renderer/components/home/__tests__/ExtensionsView.skill-creator-entry.test.tsx`
- `src/renderer/stores/__tests__/composer.store.skill-chip-bootstrap.test.ts`
- `src/renderer/components/chat/__tests__/InputArea.skill-creator-bootstrap.test.tsx`

**Stop Using**
- `src/renderer/components/resources/ResourceCreateModal.tsx`
  说明：第一阶段先停止从技能入口进入，不要求立即删文件。

---

### Task 1: 增加按 conversation 定向的一次性 skill chip 注入能力

**Files:**
- Modify: `src/renderer/stores/composer.store.ts`
- Test: `src/renderer/stores/__tests__/composer.store.skill-chip-bootstrap.test.ts`

- [ ] **Step 1: 写失败测试，锁定“一次性 chip 注入”只对目标 conversation 生效**

```ts
import { describe, expect, it, beforeEach } from 'vitest'
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
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
npm run test:unit -- src/renderer/stores/__tests__/composer.store.skill-chip-bootstrap.test.ts
```

Expected: FAIL，`queueBootstrapChip` / `consumeBootstrapChips` / `clearBootstrapChips` 尚不存在。

- [ ] **Step 3: 在 composer store 增加一次性 chip 注入状态**

实现要点：
- 保留现有 `insertQueue` 文本插入机制，不要回归性破坏它。
- 新增按 `conversationId` 组织的一次性 chip 队列，例如 `bootstrapChipsByConversation: Map<string, SelectedComposerResourceChip[]>`。
- 新增 action：
  - `queueBootstrapChip(conversationId, chip)`
  - `consumeBootstrapChips(conversationId)`
  - `clearBootstrapChips()`
- `consumeBootstrapChips` 需要“读一次就删”，确保关闭后重开不恢复。

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
npm run test:unit -- src/renderer/stores/__tests__/composer.store.skill-chip-bootstrap.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/stores/composer.store.ts src/renderer/stores/__tests__/composer.store.skill-chip-bootstrap.test.ts
git commit -m "feat: add one-shot composer skill chip bootstrap queue"
```

---

### Task 2: 把技能面板“创建技能”入口改成创建普通 conversation 并注册 `skill-creator` 起手注入

**Files:**
- Modify: `src/renderer/components/home/ExtensionsView.tsx`
- Modify: `src/renderer/stores/chat.store.ts`
- Test: `src/renderer/components/home/__tests__/ExtensionsView.skill-creator-entry.test.tsx`

- [ ] **Step 1: 写失败测试，锁定技能入口不再打开资源库弹框**

```tsx
it('creates a normal conversation and queues skill-creator bootstrap instead of opening modal', async () => {
  render(<ExtensionsView resourceType="skill" />)

  await user.click(screen.getByRole('button', { name: 'Create' }))

  expect(mockCreateConversation).toHaveBeenCalledWith('space-1')
  expect(mockOpenChat).toHaveBeenCalledWith(
    'space-1',
    'conv-skill',
    'New conversation',
    '/tmp/space-1',
    expect.any(String),
    false
  )
  expect(mockQueueBootstrapChip).toHaveBeenCalledWith('conv-skill', expect.objectContaining({
    token: '/skill-creator'
  }))
  expect(screen.queryByTestId('resource-create-description')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
npm run test:unit -- src/renderer/components/home/__tests__/ExtensionsView.skill-creator-entry.test.tsx
```

Expected: FAIL，当前仍然通过 `setIsCreateModalOpen(true)` 走弹框。

- [ ] **Step 3: 在 chat store 增加“创建 skill creator conversation”动作**

实现要点：
- 新增类似 `openSkillCreatorConversation(spaceId, workDir, spaceLabel)` 的 action。
- 内部顺序固定：
  - `createConversation(spaceId)`
  - `selectConversation(createdConversation.id)`
  - `canvasLifecycle.openChat(...)`
  - `useComposerStore.getState().queueBootstrapChip(createdConversation.id, skillCreatorChip)`
- `skillCreatorChip` 直接复用普通 chip 结构：

```ts
const skillCreatorChip = {
  id: 'skill:skill-creator',
  type: 'skill',
  displayName: 'skill-creator',
  token: '/skill-creator'
}
```

- 如果当前没有 `spaceId` 或 `workDir`，直接返回失败，不允许回退到 modal。

- [ ] **Step 4: 把 ExtensionsView 的技能“创建”入口改到新 action**

实现要点：
- 只改 `resourceType === 'skill'` 的创建动作。
- agent 创建入口先保持现状，不顺手重构。
- skill 模式下不再渲染或打开 `ResourceCreateModal`。
- `ResourceCreateModal` 仍可保留给遗留路径，但不再由技能面板主按钮触发。

- [ ] **Step 5: 运行测试确认通过**

Run:
```bash
npm run test:unit -- src/renderer/components/home/__tests__/ExtensionsView.skill-creator-entry.test.tsx
```

Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/home/ExtensionsView.tsx src/renderer/stores/chat.store.ts src/renderer/components/home/__tests__/ExtensionsView.skill-creator-entry.test.tsx
git commit -m "feat: route create skill entry to skill creator conversation"
```

---

### Task 3: 在 InputArea 消费一次性 `skill-creator` chip，并让 placeholder 跟随 chip 状态变化

**Files:**
- Modify: `src/renderer/components/chat/InputArea.tsx`
- Modify: `src/renderer/components/canvas/viewers/ChatTabViewer.tsx`
- Modify: `src/renderer/i18n/locales/zh-CN.json`
- Modify: `src/renderer/i18n/locales/en.json`
- Test: `src/renderer/components/chat/__tests__/InputArea.skill-creator-bootstrap.test.tsx`

- [ ] **Step 1: 写失败测试，锁定首次渲染会消费 bootstrap chip，且删除后恢复默认 placeholder**

```tsx
it('consumes skill-creator bootstrap chip once and switches placeholder back after removal', async () => {
  mockConsumeBootstrapChips
    .mockReturnValueOnce([{
      id: 'skill:skill-creator',
      type: 'skill',
      displayName: 'skill-creator',
      token: '/skill-creator'
    }])
    .mockReturnValueOnce([])

  render(<InputArea conversation={{ id: 'conv-skill' }} placeholder="Describe what you want to get done, Kite will start immediately" ... />)

  expect(screen.getByText('skill-creator')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('输入你想创建的技能内容，Kite 会帮你创建一个技能')).toBeInTheDocument()

  await user.click(screen.getByLabelText('Delete'))

  expect(screen.queryByText('skill-creator')).not.toBeInTheDocument()
  expect(screen.getByPlaceholderText('Describe what you want to get done, Kite will start immediately')).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
npm run test:unit -- src/renderer/components/chat/__tests__/InputArea.skill-creator-bootstrap.test.tsx
```

Expected: FAIL，当前 `InputArea` 不会消费 bootstrap chip，也不会因为 chip 状态切换 placeholder。

- [ ] **Step 3: 在 InputArea 中消费一次性 chip 注入**

实现要点：
- 组件拿到 `conversation?.id` 后，在首次可用时调用 `consumeBootstrapChips(conversation.id)`。
- 只把返回的 chip 追加到 `selectedResourceChips` 中，不要覆盖用户已有选择。
- 要去重，避免同一 chip 因重复渲染出现两次。
- 这一步消费后即完成，不允许重新打开 conversation 时恢复。

- [ ] **Step 4: 按 chip 状态切换 placeholder**

实现要点：
- 新增类似 `hasSkillCreatorChip = selectedResourceChips.some((chip) => chip.token === '/skill-creator')`
- `hasSkillCreatorChip === true` 时：

```ts
t('Describe the skill you want to create, Kite will help you create it')
```

- `hasSkillCreatorChip === false` 时继续走现有 placeholder。
- 删除 chip 后不需要额外状态机，直接靠 `selectedResourceChips` 当前值回退即可。
- `ChatTabViewer` 继续传普通 placeholder；不要把“创建技能”场景硬编码到 tab viewer 里。

- [ ] **Step 5: 补齐多语言文案**

至少补充：
- `src/renderer/i18n/locales/zh-CN.json`
- `src/renderer/i18n/locales/en.json`

建议 key：

```json
"Describe the skill you want to create, Kite will help you create it": "输入你想创建的技能内容，Kite 会帮你创建一个技能"
```

- [ ] **Step 6: 运行测试确认通过**

Run:
```bash
npm run test:unit -- src/renderer/components/chat/__tests__/InputArea.skill-creator-bootstrap.test.tsx
```

Expected: PASS

- [ ] **Step 7: 运行回归测试**

Run:
```bash
npm run test:unit -- \
  src/renderer/components/home/__tests__/ExtensionsView.skill-creator-entry.test.tsx \
  src/renderer/stores/__tests__/composer.store.skill-chip-bootstrap.test.ts \
  src/renderer/components/chat/__tests__/InputArea.skill-creator-bootstrap.test.tsx \
  src/renderer/components/home/__tests__/ExtensionsView.library-mode.test.tsx \
  src/renderer/stores/__tests__/chat.store.mode-switch.test.ts
```

Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add src/renderer/components/chat/InputArea.tsx src/renderer/components/canvas/viewers/ChatTabViewer.tsx src/renderer/i18n/locales/zh-CN.json src/renderer/i18n/locales/en.json src/renderer/components/chat/__tests__/InputArea.skill-creator-bootstrap.test.tsx
git commit -m "feat: bootstrap skill creator chip in chat composer"
```

---

## Implementation Notes

- 不要给 conversation 新增 `presetSkill` 或任何持久化 schema。
- 不要把 `/skill-creator` 作为真实文本塞进输入框。
- 不要在 `ChatTabViewer` 里引入“创建技能会话”专用分支，只保留普通 chat viewer。
- `skill-creator` 删除后，placeholder 必须立刻恢复默认。
- agent / skill 最终落盘链路不在这次范围内，继续复用现有 `skills service`。

## Verification Checklist

- 技能面板点击 `创建技能` 后不再出现 `ResourceCreateModal`
- 创建的是普通 conversation，标题走默认逻辑
- 首次打开时能看到 `skill-creator` chip
- chip 可移除
- 移除后 placeholder 恢复默认文案
- 关闭再打开 conversation 时不恢复 `skill-creator`
- 现有普通 conversation / modal 相关测试无回归
