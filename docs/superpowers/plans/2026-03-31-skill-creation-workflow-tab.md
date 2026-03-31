# Skill Creation Workflow Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把“创建技能”从资源库弹框改成“当前工作区内的新建技能创建工作标签页”，并在同一标签页里完成创建、评审、成功摘要和详情跳转。

**Architecture:** 复用现有 conversation + canvas chat tab + skills service 链路，只新增轻量 workflow metadata、专用 chat tab 壳子和入口改道。严格模式不再显式预配置，默认普通创建，命中评审类意图后在流程头中提示切换。

**Tech Stack:** Electron, React, Zustand, TypeScript, Canvas tab lifecycle, existing skills IPC/services, Vitest

---

## File Structure

**Modify**
- `src/renderer/components/home/ExtensionsView.tsx`
- `src/renderer/components/canvas/viewers/ChatTabViewer.tsx`
- `src/renderer/components/canvas/ContentCanvas.tsx`
- `src/renderer/services/canvas-lifecycle.ts`
- `src/renderer/hooks/useCanvasLifecycle.ts`
- `src/renderer/stores/chat.store.ts`
- `src/renderer/types/index.ts`
- `src/main/services/conversation.service.ts`
- `src/main/controllers/conversation.controller.ts`
- `src/main/ipc/conversation.ts`
- `src/main/services/agent/message-flow.service.ts`
- `src/main/ipc/skills.ts`

**Create**
- `src/shared/types/skill-creation-workflow.ts`
- `src/renderer/components/chat/SkillCreationWorkflowShell.tsx`
- `src/renderer/components/chat/SkillCreationSuccessCard.tsx`
- `src/renderer/components/home/__tests__/ExtensionsView.skill-creation-entry.test.tsx`
- `src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx`
- `src/renderer/stores/__tests__/chat.store.skill-creation.test.ts`
- `src/main/services/__tests__/conversation.service.skill-workflow.test.ts`
- `src/main/services/agent/__tests__/message-flow.skill-creation.test.ts`

**Remove or Stop Using**
- `src/renderer/components/resources/ResourceCreateModal.tsx`
  说明：第一阶段先停止入口引用，不要求立刻删文件；等 workflow tab 稳定后再删除遗留组件和测试。

---

### Task 1: 定义技能创建 workflow 元数据并贯穿 conversation/tab

**Files:**
- Create: `src/shared/types/skill-creation-workflow.ts`
- Modify: `src/renderer/types/index.ts`
- Modify: `src/main/services/conversation.service.ts`
- Modify: `src/main/controllers/conversation.controller.ts`
- Modify: `src/main/ipc/conversation.ts`
- Test: `src/main/services/__tests__/conversation.service.skill-workflow.test.ts`

- [ ] **Step 1: 写失败测试，锁定 workflow 元数据会被持久化**

```ts
it('persists skill creation workflow metadata on conversation create', () => {
  const conversation = createConversation(spaceId, '创建技能', {
    workflow: {
      type: 'skill-creation',
      stage: 'idle',
      boundSkill: '创建技能'
    }
  })

  expect(conversation.workflow?.type).toBe('skill-creation')
  expect(conversation.workflow?.boundSkill).toBe('创建技能')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
npm run test:unit -- src/main/services/__tests__/conversation.service.skill-workflow.test.ts
```

Expected: FAIL，`workflow` 字段或 createConversation 选项尚不存在。

- [ ] **Step 3: 新增共享类型并扩展 conversation schema**

实现要点：
- 在 `src/shared/types/skill-creation-workflow.ts` 定义：
  - `type SkillCreationWorkflowStage = 'idle' | 'clarifying' | 'drafting' | 'strict-suggested' | 'strict-running' | 'created' | 'failed'`
  - `interface SkillCreationWorkflowState`
  - `type ConversationWorkflow = { type: 'skill-creation'; ... }`
- 在 `src/renderer/types/index.ts` 和主进程 conversation 类型同步接入 `workflow?`
- `createConversation` 增加可选 `options.workflow`
- `toMeta()` 保留最小 workflow 摘要，至少包含 `type` 和 `stage`

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
npm run test:unit -- src/main/services/__tests__/conversation.service.skill-workflow.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/shared/types/skill-creation-workflow.ts src/renderer/types/index.ts src/main/services/conversation.service.ts src/main/controllers/conversation.controller.ts src/main/ipc/conversation.ts src/main/services/__tests__/conversation.service.skill-workflow.test.ts
git commit -m "feat: persist skill creation workflow metadata"
```

---

### Task 2: 把资源库“创建技能”入口改成“新建 workflow 会话并打开 chat tab”

**Files:**
- Modify: `src/renderer/components/home/ExtensionsView.tsx`
- Modify: `src/renderer/stores/chat.store.ts`
- Modify: `src/renderer/services/canvas-lifecycle.ts`
- Modify: `src/renderer/hooks/useCanvasLifecycle.ts`
- Test: `src/renderer/components/home/__tests__/ExtensionsView.skill-creation-entry.test.tsx`
- Test: `src/renderer/stores/__tests__/chat.store.skill-creation.test.ts`

- [ ] **Step 1: 写失败测试，锁定入口不再打开弹框**

```tsx
it('opens a new skill creation workflow tab instead of resource modal', async () => {
  render(<ExtensionsView resourceType="skill" />)

  await user.click(screen.getByRole('button', { name: 'Create' }))

  expect(mockCreateConversation).toHaveBeenCalledWith(spaceId, '创建技能', expect.objectContaining({
    workflow: expect.objectContaining({ type: 'skill-creation' })
  }))
  expect(mockOpenChat).toHaveBeenCalled()
  expect(screen.queryByTestId('resource-create-description')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
npm run test:unit -- src/renderer/components/home/__tests__/ExtensionsView.skill-creation-entry.test.tsx src/renderer/stores/__tests__/chat.store.skill-creation.test.ts
```

Expected: FAIL，当前仍然是 `setIsCreateModalOpen(true)`。

- [ ] **Step 3: 在 chat store 增加专用 action**

实现要点：
- 在 `chat.store.ts` 增加 `openSkillCreationWorkflow(spaceId, workDir)` 之类的 action
- 内部顺序固定：
  - 调用 `createConversation(spaceId, '创建技能', { workflow: ... })`
  - 调用 `canvasLifecycle.openChat(...)`
  - tab title 用明确文案，例如 `创建技能`
- `ExtensionsView.tsx` 的 skill create 按钮改为调用这个 action
- 没有当前工作区时，直接禁用按钮或显示错误提示，不允许退回弹框

- [ ] **Step 4: 扩展 chat tab open 接口支持 workflow tab 标题/元数据**

实现要点：
- `TabState` 新增 `workflowType?`、`workflowStage?`
- `openChat()` 接收可选 workflow 摘要，写入 tab
- 保证重复打开同一 conversation 时 tab 元数据同步刷新

- [ ] **Step 5: 运行测试确认通过**

Run:
```bash
npm run test:unit -- src/renderer/components/home/__tests__/ExtensionsView.skill-creation-entry.test.tsx src/renderer/stores/__tests__/chat.store.skill-creation.test.ts
```

Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/home/ExtensionsView.tsx src/renderer/stores/chat.store.ts src/renderer/services/canvas-lifecycle.ts src/renderer/hooks/useCanvasLifecycle.ts src/renderer/components/home/__tests__/ExtensionsView.skill-creation-entry.test.tsx src/renderer/stores/__tests__/chat.store.skill-creation.test.ts
git commit -m "feat: route skill creation entry to workflow tab"
```

---

### Task 3: 给 chat tab 加专用 Skill Creator 壳子和固定流程头

**Files:**
- Create: `src/renderer/components/chat/SkillCreationWorkflowShell.tsx`
- Modify: `src/renderer/components/canvas/viewers/ChatTabViewer.tsx`
- Modify: `src/renderer/components/canvas/ContentCanvas.tsx`
- Test: `src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx`

- [ ] **Step 1: 写失败测试，锁定 workflow tab 的专用 UI**

```tsx
it('renders fixed skill creation workflow header for skill creation conversations', () => {
  render(<ChatTabViewer tab={skillCreationTab} />)

  expect(screen.getByText('创建技能')).toBeInTheDocument()
  expect(screen.getByText('Skill Creator')).toBeInTheDocument()
  expect(screen.getByText(/当前工作区/)).toBeInTheDocument()
  expect(screen.getByText(/未开始|草稿中|已创建/)).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
npm run test:unit -- src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx
```

Expected: FAIL，当前 `ChatTabViewer` 只有通用聊天壳子。

- [ ] **Step 3: 实现 SkillCreationWorkflowShell**

实现要点：
- 把“固定流程头”独立成薄组件，不把整个聊天再复制一份
- props 只接收：
  - `workflow`
  - `workDir`
  - `title`
  - `children`
- 流程头始终显示：
  - `Skill Creator`
  - `创建技能`
  - 当前工作区
  - 当前阶段
  - 是否检测到严格模式建议

- [ ] **Step 4: 在 ChatTabViewer 中按 workflow 切壳，不改消息流主体**

实现要点：
- `tab.workflowType === 'skill-creation'` 或 conversation.workflow.type 命中时，外层包裹 `SkillCreationWorkflowShell`
- `MessageList`、`InputArea`、`AskUserQuestionPanel`、`ChangeReviewBar` 继续复用
- `ContentCanvas.tsx` 不新增新 tab type，只继续走 `chat`

- [ ] **Step 5: 运行测试确认通过**

Run:
```bash
npm run test:unit -- src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx
```

Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/chat/SkillCreationWorkflowShell.tsx src/renderer/components/canvas/viewers/ChatTabViewer.tsx src/renderer/components/canvas/ContentCanvas.tsx src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx
git commit -m "feat: add skill creation workflow shell for chat tabs"
```

---

### Task 4: 把 Skill Create 真正绑定到 workflow 会话，而不是靠 placeholder 假装

**Files:**
- Modify: `src/renderer/components/canvas/viewers/ChatTabViewer.tsx`
- Modify: `src/renderer/stores/chat.store.ts`
- Modify: `src/main/services/agent/message-flow.service.ts`
- Test: `src/main/services/agent/__tests__/message-flow.skill-creation.test.ts`
- Test: `src/renderer/stores/__tests__/chat.store.skill-creation.test.ts`

- [ ] **Step 1: 写失败测试，锁定 workflow 首条用户消息会自动带 `/创建技能` 语境**

```ts
it('prepends /创建技能 for skill creation workflow conversations when user sends plain text', async () => {
  await submitTurn({
    spaceId,
    conversationId,
    content: '帮我做一个讲义展示页模板技能'
  })

  expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.stringContaining('/创建技能')
  }))
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
npm run test:unit -- src/renderer/stores/__tests__/chat.store.skill-creation.test.ts src/main/services/agent/__tests__/message-flow.skill-creation.test.ts
```

Expected: FAIL，当前不会自动挂载 skill directive。

- [ ] **Step 3: 在中心链路做 workflow-aware 消息改写**

实现要点：
- 不要在输入框 placeholder 里做假挂载
- 不要要求用户自己手输 `/创建技能`
- 在中心发送链路中根据 conversation.workflow.type 判断：
  - 若为 `skill-creation`
  - 且用户消息未显式写 `/创建技能`
  - 则发送前自动 prepend `/创建技能\n`
- 这段逻辑落在中心发送链路，不要散在多个组件

- [ ] **Step 4: 同步 workflow stage**

实现要点：
- 首次用户输入后，stage 从 `idle` -> `clarifying`
- 识别到严格意图后，stage 更新到 `strict-suggested`
- 这里先允许 renderer 根据后端 draft/strict 响应更新 conversation/tab stage；不要额外造状态中心

- [ ] **Step 5: 运行测试确认通过**

Run:
```bash
npm run test:unit -- src/renderer/stores/__tests__/chat.store.skill-creation.test.ts src/main/services/agent/__tests__/message-flow.skill-creation.test.ts
```

Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/canvas/viewers/ChatTabViewer.tsx src/renderer/stores/chat.store.ts src/main/services/agent/message-flow.service.ts src/renderer/stores/__tests__/chat.store.skill-creation.test.ts src/main/services/agent/__tests__/message-flow.skill-creation.test.ts
git commit -m "feat: bind skill create directive to workflow conversations"
```

---

### Task 5: 把“严格模式建议”和“创建成功摘要卡片”接入 workflow 页

**Files:**
- Create: `src/renderer/components/chat/SkillCreationSuccessCard.tsx`
- Modify: `src/renderer/components/canvas/viewers/ChatTabViewer.tsx`
- Modify: `src/main/ipc/skills.ts`
- Test: `src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx`

- [ ] **Step 1: 写失败测试，锁定严格模式建议和成功摘要都在 workflow 头部区域表达**

```tsx
it('shows strict suggestion badge when intent matches and renders success summary card after creation', () => {
  render(<ChatTabViewer tab={createdSkillWorkflowTab} />)

  expect(screen.getByText(/建议切换严格模式/)).toBeInTheDocument()
  expect(screen.getByText(/创建成功/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /查看技能详情/ })).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
npm run test:unit -- src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx
```

Expected: FAIL

- [ ] **Step 3: 统一严格模式建议来源**

实现要点：
- 继续复用 `pickStrictIntentHints` / `resolveStrictIntentKeywordsFromConfig`
- 提示只放在 workflow shell 中
- 默认不出现模式切换器
- 只有命中 hint 后显示“建议切换严格模式”的轻提示 CTA

- [ ] **Step 4: 成功后置顶摘要卡片**

实现要点：
- 成功卡片显示：
  - 技能名
  - 落盘路径
  - 当前工作区
  - 创建时间
- 提供两个动作：
  - `查看技能详情`
  - `继续迭代`
- 继续保留原始消息流，不自动关闭 tab

- [ ] **Step 5: 运行测试确认通过**

Run:
```bash
npm run test:unit -- src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx
```

Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/chat/SkillCreationSuccessCard.tsx src/renderer/components/canvas/viewers/ChatTabViewer.tsx src/main/ipc/skills.ts src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx
git commit -m "feat: show skill creation workflow status and success summary"
```

---

### Task 6: 切断旧弹框主路径并清理回归风险

**Files:**
- Modify: `src/renderer/components/home/ExtensionsView.tsx`
- Modify: `src/renderer/components/resources/__tests__/resource-create-modal.test.tsx`
- Modify: `docs/superpowers/plans/2026-03-29-kite-library-resources-implementation.md`

- [ ] **Step 1: 写或更新回归测试，保证资源库页不会再触发 modal**

```tsx
it('does not render ResourceCreateModal from library create button anymore', async () => {
  render(<ExtensionsView resourceType="skill" />)
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(screen.queryByTestId('resource-create-description')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败或旧断言需要更新**

Run:
```bash
npm run test:unit -- src/renderer/components/home/__tests__/ExtensionsView.skill-creation-entry.test.tsx src/renderer/components/resources/__tests__/resource-create-modal.test.tsx
```

Expected: 如果还有旧 modal 断言，会失败。

- [ ] **Step 3: 清理旧入口引用**

实现要点：
- `ExtensionsView` 不再持有 `isCreateModalOpen`
- 保留 `ResourceCreateModal` 文件仅作为过渡遗留，不再从用户主路径进入
- 更新历史实现文档，明确主路径已切换为 workflow tab

- [ ] **Step 4: 运行目标回归集**

Run:
```bash
npm run test:unit -- src/main/services/__tests__/conversation.service.skill-workflow.test.ts src/main/services/agent/__tests__/message-flow.skill-creation.test.ts src/renderer/components/home/__tests__/ExtensionsView.skill-creation-entry.test.tsx src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx src/renderer/stores/__tests__/chat.store.skill-creation.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/home/ExtensionsView.tsx src/renderer/components/resources/__tests__/resource-create-modal.test.tsx docs/superpowers/plans/2026-03-29-kite-library-resources-implementation.md
git commit -m "refactor: replace skill creation modal entry with workflow tab"
```

---

## Final Verification

- [ ] **Step 1: 运行完整定向回归**

Run:
```bash
npm run test:unit -- src/main/services/__tests__/conversation.service.skill-workflow.test.ts src/main/services/agent/__tests__/message-flow.skill-creation.test.ts src/renderer/components/home/__tests__/ExtensionsView.skill-creation-entry.test.tsx src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx src/renderer/stores/__tests__/chat.store.skill-creation.test.ts src/renderer/components/home/__tests__/ExtensionsView.library-mode.test.tsx
```

Expected: PASS

- [ ] **Step 2: 手动验证**

Run app and verify:
1. 进入一个工作区
2. 打开技能资源库
3. 点击 `Create`
4. 不出现弹框
5. 新建一个 `创建技能` chat tab
6. 顶部固定显示 `Skill Creator` 流程头
7. 输入普通自然语言需求，无需手敲 `/创建技能`
8. 创建成功后出现摘要卡片，且可跳技能详情

- [ ] **Step 3: 最终提交**

```bash
git add src/shared/types/skill-creation-workflow.ts src/renderer/components/chat/SkillCreationWorkflowShell.tsx src/renderer/components/chat/SkillCreationSuccessCard.tsx src/renderer/components/home/ExtensionsView.tsx src/renderer/components/canvas/viewers/ChatTabViewer.tsx src/renderer/components/canvas/ContentCanvas.tsx src/renderer/services/canvas-lifecycle.ts src/renderer/hooks/useCanvasLifecycle.ts src/renderer/stores/chat.store.ts src/renderer/types/index.ts src/main/services/conversation.service.ts src/main/controllers/conversation.controller.ts src/main/ipc/conversation.ts src/main/services/agent/message-flow.service.ts src/main/ipc/skills.ts src/renderer/components/home/__tests__/ExtensionsView.skill-creation-entry.test.tsx src/renderer/components/canvas/viewers/__tests__/ChatTabViewer.skill-creation.test.tsx src/renderer/stores/__tests__/chat.store.skill-creation.test.ts src/main/services/__tests__/conversation.service.skill-workflow.test.ts src/main/services/agent/__tests__/message-flow.skill-creation.test.ts
git commit -m "feat: move skill creation into dedicated workflow tab"
```

---

## Notes

- 不要把这次改造做成新的 `tab.type = 'skill-creation'`。现有 `chat` tab 已经够用，新增 workflow metadata 就够了。
- 不要在输入框 placeholder 里伪造“已挂载 Skill Create”。必须在中心消息链路里真实 prepend `/创建技能`。
- 不要保留显式 Quick/Strict 切换器。严格模式只做命中提示，不做先验配置。
- `ResourceCreateModal.tsx` 第一阶段只退出主路径，不强制立即删除；等 workflow tab 稳定后再做遗留清理。
