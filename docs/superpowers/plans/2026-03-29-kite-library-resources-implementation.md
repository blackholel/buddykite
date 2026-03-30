# Kite Library 技能与智能体全局资产库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将技能与智能体从隐藏配置目录中的内部资源，重构为基于 `Kite/Skills` 与 `Kite/Agents` 的用户可见全局资产库，并提供顶层入口、启用/停用、导入和自然语言创建闭环。

**Architecture:** 保持插件资源加载规则不变，把用户资产真源迁移到用户可见的 `Kite` 目录，把启用状态从资源文件中剥离到 `~/.kite/resource-library-state.json`，再以此为基础改造 IPC、store 和顶层页面。UI 只暴露“全集资源 + 详情页控制 + 创建/导入动作”，不暴露 `.claude` 或其他执行层概念。

**Tech Stack:** Electron 32, React 18, Zustand, TypeScript, Electron IPC, Vitest, Tailwind

## 实施进度快照（2026-03-30）

### 已完成范围

- Task 1（目录真源 + 历史迁移）已落地：
  - 新增 `kite-library.service.ts`
  - `index.ts` 启动阶段接入 `ensureKiteLibraryDirs()` + `migrateLegacyResourceDirs()`
  - `config.service.ts` 的 `getSpacesDir()` 切到 `Kite/Spaces`
- Task 2（状态索引 + enabled 合并）已落地：
  - 新增 `resource-library-state.service.ts`（`~/.kite/resource-library-state.json`）
  - `skills/agents` 扫描改为 `Kite/Skills` / `Kite/Agents`，并合并 enabled 状态
  - watcher 监听状态文件变化并触发索引刷新
  - `resource-index` 哈希纳入 enabled 位
- Task 3（library 合约层）已落地：
  - `skills/agents` IPC + preload + renderer API 补齐 library 级 CRUD / 启停 / 打开目录能力
  - `skills.store.ts` / `agents.store.ts` 补齐 library 方法与 enabled 局部更新
  - 新增 store 合约测试：`skills.store.library.test.ts` / `agents.store.library.test.ts`
- Task 4（顶层页面与详情页）已落地：
  - `UnifiedSidebar` 顶层入口改为 `技能 / 智能体`
  - `UnifiedPage` 使用 `rightPanelMode: artifacts | skills | agents`
  - `ExtensionsView` 改为 `resourceType: 'skill' | 'agent'` 单类型视图，排序为 `enabled desc + name asc`
  - `ResourceCard` 详情动作支持：`插入到对话`、`启用/停用`、`打开所在文件夹`、`删除(仅 app 资源)`
  - `SkillDetailModal` / `AgentDetailModal` 同步为 library 语义控制
  - 新增测试：`ExtensionsView.library-mode.test.tsx`、`resource-library-detail-actions.test.tsx`
- Task 5（导入服务 + 拖拽导入）已落地：
  - 新增 `resource-library-import.service.ts`，支持技能目录与智能体 markdown 导入、冲突检测与覆盖替换
  - `skills/agents` IPC、preload、renderer API 补齐导入接口
  - `ExtensionsView` 新增顶部“打开文件夹”按钮与页面级拖拽导入
  - 新增测试：`resource-library-import.service.test.ts`、`ExtensionsView.import-drop.test.tsx`
- Task 6（自然语言创建流）已落地：
  - 新增 `resource-draft-generator.service.ts`，生成 `name/description/content` 草稿
  - 新增 `ResourceCreateModal.tsx` 并接入顶层“创建”入口
  - `SkillSuggestionCard`、`SkillEditorModal`、`AgentEditorModal` 改为以 library 为主目标
  - 新增测试：`resource-create-modal.test.tsx`
- Task 7（回归与文档）已执行：
  - 完成计划定义的回归测试批次和构建验证
  - 文档状态已同步（本次更新）

### 已验证（PASS）

- `npm run test:unit -- src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx src/renderer/components/unified/__tests__/UnifiedSidebar.actions.test.tsx src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/components/home/__tests__/ExtensionsView.library-mode.test.tsx src/renderer/components/resources/__tests__/resource-library-detail-actions.test.tsx`
- `npm run test:unit -- src/main/services/__tests__/resource-library-import.service.test.ts src/renderer/components/home/__tests__/ExtensionsView.import-drop.test.tsx src/renderer/components/resources/__tests__/resource-create-modal.test.tsx`
- `npm run test:unit -- src/main/services/__tests__/kite-library.service.test.ts src/main/services/__tests__/resource-library-state.service.test.ts src/main/services/__tests__/skills-library-source.test.ts src/main/services/__tests__/agents-library-source.test.ts src/main/services/__tests__/resource-library-import.service.test.ts src/main/services/__tests__/resource-copy-by-ref.test.ts src/renderer/stores/__tests__/skills.store.library.test.ts src/renderer/stores/__tests__/agents.store.library.test.ts src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx src/renderer/components/unified/__tests__/UnifiedSidebar.actions.test.tsx src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/components/home/__tests__/ExtensionsView.library-mode.test.tsx src/renderer/components/home/__tests__/ExtensionsView.import-drop.test.tsx src/renderer/components/resources/__tests__/resource-library-detail-actions.test.tsx src/renderer/components/resources/__tests__/resource-create-modal.test.tsx`
- `npm run build`

### 未完成与注意事项

- Task 7 Step 3（人工关键路径验收）尚未执行，仍需在桌面端手测。
- 计划中的各 Task `Step 7: Commit` 当前均未执行（仓库处于持续开发态，存在多文件未提交变更）。

---

## File Structure

### Existing files to modify

- `src/main/services/config.service.ts`
  - 定义新的 `Kite` 用户可见目录，调整 `Spaces` 根目录来源。
- `src/main/index.ts`
  - 在主进程启动时触发一次性历史资源迁移。
- `src/main/services/space.service.ts`
  - 让工作区默认根目录切换到 `Kite/Spaces`，并补充打开库目录的能力。
- `src/main/services/skills.service.ts`
  - 把用户资产源从 `~/.kite/skills` 切到 `Kite/Skills`，并接入启用状态。
- `src/main/services/agents.service.ts`
  - 把用户资产源从 `~/.kite/agents` 切到 `Kite/Agents`，并接入启用状态。
- `src/main/services/skills-agents-watch.service.ts`
  - 监听新的用户资产目录和状态索引文件。
- `src/shared/resource-access.ts`
  - 扩展资源元数据，支持 `enabled` 及顶层资源列表视图。
- `src/main/ipc/skills.ts`
  - 新增用户资产库级创建、更新、删除、启停、打开目录、导入接口。
- `src/main/ipc/agents.ts`
  - 新增用户资产库级创建、更新、删除、启停、打开目录、导入接口。
- `src/main/ipc/space.ts`
  - 复用或扩展目录选择能力，避免新建重复 dialog handler。
- `src/preload/index.ts`
  - 暴露新的 library 级 IPC 接口。
- `src/renderer/api/index.ts`
  - 封装新的 library 级 API。
- `src/renderer/stores/skills.store.ts`
  - 从“space 创建/编辑”为主改成支持全局资产库 CRUD 和启停。
- `src/renderer/stores/agents.store.ts`
  - 从“space 创建/编辑”为主改成支持全局资产库 CRUD 和启停。
- `src/renderer/components/unified/UnifiedSidebar.tsx`
  - 用 `技能 / 智能体` 顶层入口替换当前单一能力入口。
- `src/renderer/pages/UnifiedPage.tsx`
  - 驱动技能页/智能体页的顶层切换。
- `src/renderer/components/home/ExtensionsView.tsx`
  - 改造成资源库列表视图，支持单资源类型、启用排序、打开详情。
- `src/renderer/components/resources/ResourceCard.tsx`
  - 显示启用状态、来源和新的详情动作。
- `src/renderer/components/skills/SkillDetailModal.tsx`
  - 从 `space` 资源详情改成用户资产库详情控制面板。
- `src/renderer/components/agents/AgentDetailModal.tsx`
  - 从 `space` 资源详情改成用户资产库详情控制面板。
- `src/renderer/components/skills/SkillEditorModal.tsx`
  - 从 `workDir` 驱动改成 library 创建/编辑，或作为后备编辑器被新创建流调用。
- `src/renderer/components/agents/AgentEditorModal.tsx`
  - 从 `workDir` 驱动改成 library 创建/编辑，或作为后备编辑器被新创建流调用。
- `src/renderer/components/skills/SkillSuggestionCard.tsx`
  - 把当前 suggestion 创建路径从 `workDir` 改成 library 目标。

### New files to create

- `src/main/services/kite-library.service.ts`
  - 用户可见 `Kite` 根目录、`Skills`/`Agents`/`Spaces` 路径和迁移逻辑。
- `src/main/services/resource-library-state.service.ts`
  - 读写 `~/.kite/resource-library-state.json` 并合并启用状态。
- `src/main/services/resource-library-import.service.ts`
  - 处理技能文件夹 / 智能体 markdown 的导入、冲突和默认启用。
- `src/main/services/resource-draft-generator.service.ts`
  - 根据自然语言描述生成技能/智能体草稿内容。
- `src/renderer/components/resources/ResourceCreateModal.tsx`
  - 顶层“创建技能 / 创建智能体”的自然语言创建流程。
- `src/main/services/__tests__/kite-library.service.test.ts`
  - 覆盖新目录路径解析与历史目录迁移。
- `src/main/services/__tests__/resource-library-state.service.test.ts`
  - 覆盖启用状态读写、默认值和索引清理。
- `src/main/services/__tests__/resource-library-import.service.test.ts`
  - 覆盖技能文件夹导入、智能体文件导入和冲突替换。
- `src/main/services/__tests__/skills-library-source.test.ts`
  - 覆盖技能服务从 `Kite/Skills` 扫描并合并 enabled 状态。
- `src/main/services/__tests__/agents-library-source.test.ts`
  - 覆盖智能体服务从 `Kite/Agents` 扫描并合并 enabled 状态。
- `src/renderer/components/home/__tests__/ExtensionsView.library-mode.test.tsx`
  - 覆盖顶层资源页按启用优先和字母序展示。
- `src/renderer/components/resources/__tests__/resource-library-detail-actions.test.tsx`
  - 覆盖详情页启停、删除、打开路径等动作显隐。
- `src/renderer/components/resources/__tests__/resource-create-modal.test.tsx`
  - 覆盖自然语言创建流程的 happy path 和失败路径。

### Existing tests to modify

- `src/main/services/__tests__/resource-copy-by-ref.test.ts`
  - 让 app 级资源来源从历史 `~/.kite/skills`/`agents` 切到新 `Kite` 目录。
- `src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx`
  - 校验顶层入口变为 `技能 / 智能体`。
- `src/renderer/components/unified/__tests__/UnifiedSidebar.actions.test.tsx`
  - 校验点击顶层资源入口切换页面。
- `src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx`
  - 校验顶层页面切换后的初始状态与渲染。
- `src/renderer/components/resources/__tests__/template-library-filter-behavior.test.ts`
  - 保持现有模板库行为不被全局资源库改造打坏。

## Multi-Agent Execution Model

### Phase 1: Serial foundation

必须先完成目录真源和状态真源，否则后续 UI、创建流都会建立在错误路径上。

- Task 1
- Task 2

### Phase 2: Serial contract locking

在 foundation 稳定后，锁定 IPC / preload / API / store 合约，避免多个执行代理各自定义接口。

- Task 3

### Phase 3: Parallel feature integration

Task 3 完成并通过后，可以并行执行：

- Worker A: Task 4（顶层页面与详情页）
- Worker B: Task 5（打开文件夹与拖拽导入）
- Worker C: Task 6（自然语言创建流）

### Phase 4: Serial integration and final verification

三条功能线合并后，由一个代理执行最终回归与文档同步：

- Task 7

## Task 1: 建立 Kite Library 目录真源并完成历史资源迁移

**Status（2026-03-30）:** ✅ 实现完成；验证通过；`Step 7: Commit` 未执行。

**Files:**
- Create: `src/main/services/kite-library.service.ts`
- Modify: `src/main/services/config.service.ts`
- Modify: `src/main/index.ts`
- Create: `src/main/services/__tests__/kite-library.service.test.ts`

**关键实现补充（已完成）:**
- `kite-library.service.ts` 已实现 `getKiteLibraryDir/getKiteSkillsDir/getKiteAgentsDir/getKiteSpacesDir`、`ensureKiteLibraryDirs`、`migrateLegacyResourceDirs`。
- 迁移为一次性执行，落盘 marker `resource-library-migration.v1.json`；旧目录重命名为 `skills.legacy-backup` / `agents.legacy-backup`。
- `index.ts` 已在主进程启动阶段接入目录确保与迁移；`config.service.ts` 的 `getSpacesDir()` 已切到 `Kite/Spaces`。

- [x] **Step 1: 写失败测试，锁定新目录结构和迁移行为**

新增测试覆盖：

```ts
it('resolves user-visible Kite library directories from config root', () => {
  expect(getKiteLibraryDir()).toBe('/tmp/kite')
  expect(getKiteSkillsDir()).toBe('/tmp/kite/Skills')
  expect(getKiteAgentsDir()).toBe('/tmp/kite/Agents')
  expect(getKiteSpacesDir()).toBe('/tmp/kite/Spaces')
})

it('migrates legacy ~/.kite skills and agents into the new Kite library once', () => {
  migrateLegacyResourceDirs()
  expect(existsSync('/tmp/kite/Skills/review/SKILL.md')).toBe(true)
  expect(existsSync('/tmp/kite/Agents/reviewer.md')).toBe(true)
  expect(existsSync('/tmp/.kite/skills.legacy-backup')).toBe(true)
})
```

- [x] **Step 2: 运行目录与迁移测试，确认失败（阶段已完成）**

Run:

```bash
npm run test:unit -- src/main/services/__tests__/kite-library.service.test.ts
```

Expected: FAIL，因为当前还没有 `Kite Library` 路径服务，也没有迁移逻辑。

- [x] **Step 3: 实现 Kite Library 路径服务**

在 `kite-library.service.ts` 中实现：

- `getKiteLibraryDir()`
- `getKiteSkillsDir()`
- `getKiteAgentsDir()`
- `getKiteSpacesDir()`
- `ensureKiteLibraryDirs()`
- `migrateLegacyResourceDirs()`

规则：

- 用户可见目录基于当前 config root 推导
- 统一使用 `Kite/Skills`、`Kite/Agents`、`Kite/Spaces`
- 迁移只做一次；若新目录已有同名内容，采用“保留新目录、跳过旧目录该项”的保守策略

- [x] **Step 4: 接入主进程启动流程**

在 `src/main/index.ts` 中，在 essential services 初始化前调用：

- `ensureKiteLibraryDirs()`
- `migrateLegacyResourceDirs()`

不要把迁移放到 renderer 触发路径。

- [x] **Step 5: 将默认工作区根目录切到 Kite/Spaces**

在 `config.service.ts` 中让现有 `getSpacesDir()` 指向 `getKiteSpacesDir()` 语义，保留调用方不变，避免大面积接口改名。

- [x] **Step 6: 重新运行目录与迁移测试**

Run:

```bash
npm run test:unit -- src/main/services/__tests__/kite-library.service.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/services/kite-library.service.ts src/main/services/config.service.ts src/main/index.ts src/main/services/__tests__/kite-library.service.test.ts
git commit -m "feat: add kite library directories and migrate legacy resources"
```

## Task 2: 建立资源状态索引并把 enabled 合并到 skills / agents

**Status（2026-03-30）:** ✅ 实现完成；验证通过；`Step 7: Commit` 未执行。

**Files:**
- Create: `src/main/services/resource-library-state.service.ts`
- Modify: `src/shared/resource-access.ts`
- Modify: `src/main/services/skills.service.ts`
- Modify: `src/main/services/agents.service.ts`
- Modify: `src/main/services/skills-agents-watch.service.ts`
- Create: `src/main/services/__tests__/resource-library-state.service.test.ts`
- Create: `src/main/services/__tests__/skills-library-source.test.ts`
- Create: `src/main/services/__tests__/agents-library-source.test.ts`
- Modify: `src/main/services/__tests__/resource-copy-by-ref.test.ts`

**关键实现补充（已完成）:**
- 状态真源已落到 `~/.kite/resource-library-state.json`，实现 `read/write/get/set/delete/prune` 全套接口。
- `SkillDefinition/AgentDefinition` 均已支持 `enabled` 字段并与状态索引合并；无状态记录默认 `enabled=true`。
- `skills.service.ts` / `agents.service.ts` 扫描源已切换为 `Kite/Skills` / `Kite/Agents`。
- `skills-agents-watch.service.ts` 已监听 `Kite/Skills`、`Kite/Agents` 与状态文件变更，并触发 cache invalidate + index rebuild + renderer 刷新。

- [x] **Step 1: 写失败测试，锁定 enabled 状态和新扫描来源**

新增测试覆盖：

```ts
it('defaults user library resources to enabled when no state exists', () => {
  const resources = listSkills(undefined, 'extensions')
  expect(resources.find((item) => item.name === 'review')?.enabled).toBe(true)
})

it('applies disabled state from resource-library-state.json', () => {
  setResourceLibraryState({ resources: { 'skill:app:review': { enabled: false } } })
  const resources = listSkills(undefined, 'extensions')
  expect(resources.find((item) => item.name === 'review')?.enabled).toBe(false)
})
```

同时更新 `resource-copy-by-ref.test.ts`，让 app 级资源 fixture 来自 `Kite/Skills` / `Kite/Agents`。

- [x] **Step 2: 运行资源状态与扫描测试，确认失败（阶段已完成）**

Run:

```bash
npm run test:unit -- src/main/services/__tests__/resource-library-state.service.test.ts src/main/services/__tests__/skills-library-source.test.ts src/main/services/__tests__/agents-library-source.test.ts src/main/services/__tests__/resource-copy-by-ref.test.ts
```

Expected: FAIL，因为当前没有状态服务，也没有 `enabled` 字段，更没有新目录扫描。

- [x] **Step 3: 实现 resource-library-state 服务**

在 `resource-library-state.service.ts` 中实现：

- `readResourceLibraryState()`
- `writeResourceLibraryState()`
- `getResourceEnabledState(key)`
- `setResourceEnabledState(key, enabled)`
- `deleteResourceState(key)`
- `pruneMissingResourceState(validKeys)`

第一版状态字段只存：

- `enabled`
- `updatedAt`

- [x] **Step 4: 扩展资源定义并在 skills / agents 扫描时合并 enabled**

修改 `src/shared/resource-access.ts` 及相关资源 definition：

- `SkillDefinition.enabled`
- `AgentDefinition.enabled`

实现要求：

- `app` 级用户资产从 `Kite/Skills` / `Kite/Agents` 读取
- 若状态索引中无记录，则默认 `enabled = true`
- 插件资源也要能有 `enabled` 状态，以支持后续停用

- [x] **Step 5: 让 watch service 监听新的资产目录与状态文件**

`skills-agents-watch.service.ts` 需要新增监听：

- `Kite/Skills`
- `Kite/Agents`
- `~/.kite/resource-library-state.json`

状态文件变化也必须触发：

- invalidate cache
- rebuild resource index
- 通知 renderer 刷新

- [x] **Step 6: 重新运行资源状态与扫描测试**

Run:

```bash
npm run test:unit -- src/main/services/__tests__/resource-library-state.service.test.ts src/main/services/__tests__/skills-library-source.test.ts src/main/services/__tests__/agents-library-source.test.ts src/main/services/__tests__/resource-copy-by-ref.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/services/resource-library-state.service.ts src/shared/resource-access.ts src/main/services/skills.service.ts src/main/services/agents.service.ts src/main/services/skills-agents-watch.service.ts src/main/services/__tests__/resource-library-state.service.test.ts src/main/services/__tests__/skills-library-source.test.ts src/main/services/__tests__/agents-library-source.test.ts src/main/services/__tests__/resource-copy-by-ref.test.ts
git commit -m "feat: add resource library enabled state"
```

## Task 3: 锁定 library 级 IPC、preload、API 与 store 合约

**Status（2026-03-30）:** ✅ 实现完成（保留旧接口兼容）；新增 store 合约测试通过；`Step 7: Commit` 未执行。

**Files:**
- Modify: `src/main/ipc/skills.ts`
- Modify: `src/main/ipc/agents.ts`
- Modify: `src/main/ipc/space.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/api/index.ts`
- Modify: `src/renderer/stores/skills.store.ts`
- Modify: `src/renderer/stores/agents.store.ts`
- Create: `src/renderer/stores/__tests__/skills.store.library.test.ts`
- Create: `src/renderer/stores/__tests__/agents.store.library.test.ts`

**关键实现补充（已完成）:**
- `skills/agents` IPC、preload、renderer api 已补齐 library 级 `create/update/delete/toggle/open/show/copy-to-space` 合约。
- 新旧链路兼容：`copy-to-space-by-ref` 保持不变，原 `space` 创建链路仍可用但 UI 主流程已切 library。
- `skills.store.ts` / `agents.store.ts` 已补齐 `create*InLibrary`、`delete*FromLibrary`、`toggle*Enabled` 与缓存局部更新逻辑。
- store 合约测试新增并通过：`skills.store.library.test.ts`、`agents.store.library.test.ts`。

- [x] **Step 1: 写失败测试，锁定新 API 合约**

新增 store 测试覆盖：

- `loadSkills()` / `loadAgents()` 读取全集资源且保留 `enabled`
- `toggleSkillEnabled()` / `toggleAgentEnabled()` 能局部更新状态
- `createSkillInLibrary()` / `createAgentInLibrary()` 不再依赖 `workDir`
- `deleteSkillFromLibrary()` / `deleteAgentFromLibrary()` 能更新当前列表缓存

- [x] **Step 2: 运行 store 测试，确认失败（阶段已完成）**

Run:

```bash
npm run test:unit -- src/renderer/stores/__tests__/skills.store.library.test.ts src/renderer/stores/__tests__/agents.store.library.test.ts
```

Expected: FAIL，因为当前 store 仍围绕 `workDir` 和 `space` 级创建/删除设计。

- [x] **Step 3: 在 skills / agents IPC 中补齐 library 接口**

新增或扩展 handler：

- list library resources
- create in library
- update in library
- delete in library
- toggle enabled
- open library folder
- show item in folder
- import from selected path

要求：

- 不要破坏现有 `copy-to-space-by-ref`
- 尽量把新的 library 语义放进 skills / agents IPC，而不是再造一套平行资源协议

- [x] **Step 4: 在 preload 和 renderer api 中暴露新能力**

`preload/index.ts` 与 `renderer/api/index.ts` 补齐对应方法，保持 Electron/HTTP 两种模式行为一致；远程模式不支持的操作明确返回失败，不要 silent ignore。

- [x] **Step 5: 重构 skills / agents store 为“全局资产库优先”**

重点要求：

- `createSkill(workDir, ...)` / `createAgent(workDir, ...)` 改成 library 版本，或新增 library 版本并让 UI 只走 library 版本
- 加入 `enabled` 的排序和局部更新逻辑
- 保留现有 `copyToSpace` 能力，供后续模板库或兼容链路使用

- [x] **Step 6: 重新运行 store 测试**

Run:

```bash
npm run test:unit -- src/renderer/stores/__tests__/skills.store.library.test.ts src/renderer/stores/__tests__/agents.store.library.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/skills.ts src/main/ipc/agents.ts src/main/ipc/space.ts src/preload/index.ts src/renderer/api/index.ts src/renderer/stores/skills.store.ts src/renderer/stores/agents.store.ts src/renderer/stores/__tests__/skills.store.library.test.ts src/renderer/stores/__tests__/agents.store.library.test.ts
git commit -m "refactor: add kite library resource contracts"
```

## Task 4: 改造顶层页面与详情页为全局资源库体验

**Status（2026-03-30）:** ✅ 实现完成；新增与改造测试通过；`Step 7: Commit` 未执行。

**Files:**
- Modify: `src/renderer/components/unified/UnifiedSidebar.tsx`
- Modify: `src/renderer/pages/UnifiedPage.tsx`
- Modify: `src/renderer/components/home/ExtensionsView.tsx`
- Modify: `src/renderer/components/resources/ResourceCard.tsx`
- Modify: `src/renderer/components/skills/SkillDetailModal.tsx`
- Modify: `src/renderer/components/agents/AgentDetailModal.tsx`
- Modify: `src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx`
- Modify: `src/renderer/components/unified/__tests__/UnifiedSidebar.actions.test.tsx`
- Modify: `src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx`
- Create: `src/renderer/components/home/__tests__/ExtensionsView.library-mode.test.tsx`
- Create: `src/renderer/components/resources/__tests__/resource-library-detail-actions.test.tsx`

**关键实现补充（已完成）:**
- `UnifiedSidebar` 顶层入口已切 `技能/智能体`；`UnifiedPage` 新增 `rightPanelMode: artifacts|skills|agents` 页面切换。
- `ExtensionsView` 已切 `resourceType: 'skill'|'agent'`，排序为 `enabled desc + name asc`，展示全集资源并以详情模式为主。
- `ResourceCard` 详情动作已支持 `插入到对话/启用停用/打开所在文件夹/删除(仅 app)`，插件资源不可删。
- 顶层与详情交互测试已补齐并通过。

- [x] **Step 1: 写失败测试，锁定顶层入口与列表排序**

测试覆盖：

- 左侧顶层出现 `技能`、`智能体`
- 点击后切到对应页面
- 列表展示全集资源，不按来源分组
- 排序规则是“启用优先 + 字母序”
- 详情页展示 `插入到对话`、`启用/停用`、`打开所在文件夹`、`删除`

- [x] **Step 2: 运行顶层页面测试，确认失败（阶段已完成）**

Run:

```bash
npm run test:unit -- src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx src/renderer/components/unified/__tests__/UnifiedSidebar.actions.test.tsx src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/components/home/__tests__/ExtensionsView.library-mode.test.tsx src/renderer/components/resources/__tests__/resource-library-detail-actions.test.tsx
```

Expected: FAIL，因为当前 UI 仍然围绕 `Extensions / abilities / space-only resource` 设计。

- [x] **Step 3: 把 UnifiedSidebar 和 UnifiedPage 改为技能页 / 智能体页导航**

实现要求：

- 用 `技能` / `智能体` 顶层入口替换当前 `abilities` 驱动
- `UnifiedPage` 负责切换单资源类型页面
- 不再把资源库页面命名为 `Extensions`

- [x] **Step 4: 把列表视图改成全集资源库模式**

在 `ExtensionsView.tsx` 中完成最小变更：

- 接收 `resourceType: 'skill' | 'agent'`
- 只渲染对应资源类型
- 排序采用 `enabled desc + name asc`
- 资源卡片默认点击进入详情页，不显示“Add to space”

为控制风险，不重命名文件，先改语义和 props。

- [x] **Step 5: 改造详情页动作**

`SkillDetailModal.tsx` / `AgentDetailModal.tsx` 需要改成 library 模式：

- 用户资产可编辑、可删除、可启停
- 插件资源不可删除、不可编辑，但可停用
- `Copy to Space` 不再作为默认主动作

- [x] **Step 6: 重新运行顶层页面测试**

Run:

```bash
npm run test:unit -- src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx src/renderer/components/unified/__tests__/UnifiedSidebar.actions.test.tsx src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/components/home/__tests__/ExtensionsView.library-mode.test.tsx src/renderer/components/resources/__tests__/resource-library-detail-actions.test.tsx
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/unified/UnifiedSidebar.tsx src/renderer/pages/UnifiedPage.tsx src/renderer/components/home/ExtensionsView.tsx src/renderer/components/resources/ResourceCard.tsx src/renderer/components/skills/SkillDetailModal.tsx src/renderer/components/agents/AgentDetailModal.tsx src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx src/renderer/components/unified/__tests__/UnifiedSidebar.actions.test.tsx src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/components/home/__tests__/ExtensionsView.library-mode.test.tsx src/renderer/components/resources/__tests__/resource-library-detail-actions.test.tsx
git commit -m "feat: add top-level kite library resource views"
```

## Task 5: 实现打开文件夹与拖拽导入

**Status（2026-03-30）:** ✅ 实现完成；测试通过；`Step 6: Commit` 未执行。

**Files:**
- Create: `src/main/services/resource-library-import.service.ts`
- Modify: `src/main/ipc/skills.ts`
- Modify: `src/main/ipc/agents.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/api/index.ts`
- Modify: `src/renderer/components/home/ExtensionsView.tsx`
- Create: `src/main/services/__tests__/resource-library-import.service.test.ts`
- Create: `src/renderer/components/home/__tests__/ExtensionsView.import-drop.test.tsx`

**关键实现补充（已完成）:**
- 新增 `importSkillDirectory()` / `importAgentFile()`，分别校验“技能目录必须含 `SKILL.md`”和“智能体必须是 `.md` 文件”。
- 冲突语义统一为 `{ status: 'conflict' }`；`overwrite: true` 时覆盖目标并返回 `{ status: 'imported' }`。
- 导入成功后统一写状态索引 `enabled = true`（`resource-library-state.json`）。
- `skills:import-from-path` / `agents:import-from-path` IPC 已接入并在导入成功后清理缓存。
- `ExtensionsView` 顶部已接入“打开文件夹”，页面级已接入 `onDragOver/onDrop`，并基于 `resourceType` 选择导入接口。
- 导入成功后自动刷新列表并自动打开导入项详情（通过 `autoOpenResourcePath` + `ResourceCard.autoOpen`）。

- [x] **Step 1: 写测试，锁定技能文件夹与智能体文件导入规则**

新增服务测试覆盖：

- 技能导入只接受包含 `SKILL.md` 的文件夹
- 智能体导入只接受 `.md` 文件
- 冲突时返回 `conflict`
- `overwrite: true` 时替换目标
- 导入成功后默认写入 `enabled = true`

新增页面测试覆盖：

- 技能页拖入文件夹时触发 skill import
- 智能体页拖入 markdown 文件时触发 agent import

- [x] **Step 2: 运行导入测试，确认失败（阶段已完成）**

Run:

```bash
npm run test:unit -- src/main/services/__tests__/resource-library-import.service.test.ts src/renderer/components/home/__tests__/ExtensionsView.import-drop.test.tsx
```

Expected: FAIL，因为当前没有 library import 服务，也没有页面级拖拽导入。

- [x] **Step 3: 实现导入服务**

在 `resource-library-import.service.ts` 中实现：

- `importSkillDirectory(sourcePath, options?)`
- `importAgentFile(sourcePath, options?)`

规则：

- 技能目标是 `Kite/Skills/<folder-name>`
- 智能体目标是 `Kite/Agents/<file-name>.md`
- 导入成功后写状态索引 `enabled = true`

- [x] **Step 4: 在 UI 中接入打开文件夹与拖拽导入**

`ExtensionsView.tsx` 需要支持：

- 顶部 `打开文件夹`
- 页面 `onDragOver` / `onDrop`
- 根据当前 `resourceType` 选择导入接口
- 冲突时弹窗 `替换 / 取消`

- [x] **Step 5: 重新运行导入测试**

Run:

```bash
npm run test:unit -- src/main/services/__tests__/resource-library-import.service.test.ts src/renderer/components/home/__tests__/ExtensionsView.import-drop.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/services/resource-library-import.service.ts src/main/ipc/skills.ts src/main/ipc/agents.ts src/preload/index.ts src/renderer/api/index.ts src/renderer/components/home/ExtensionsView.tsx src/main/services/__tests__/resource-library-import.service.test.ts src/renderer/components/home/__tests__/ExtensionsView.import-drop.test.tsx
git commit -m "feat: add kite library import and folder actions"
```

## Task 6: 实现自然语言创建流程并把结果直接写入全局资产库

**Status（2026-03-30）:** ✅ 实现完成；测试通过；`Step 7: Commit` 未执行。

**Files:**
- Create: `src/main/services/resource-draft-generator.service.ts`
- Create: `src/renderer/components/resources/ResourceCreateModal.tsx`
- Modify: `src/main/ipc/skills.ts`
- Modify: `src/main/ipc/agents.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/api/index.ts`
- Modify: `src/renderer/components/home/ExtensionsView.tsx`
- Modify: `src/renderer/components/skills/SkillSuggestionCard.tsx`
- Modify: `src/renderer/components/skills/SkillEditorModal.tsx`
- Modify: `src/renderer/components/agents/AgentEditorModal.tsx`
- Create: `src/renderer/components/resources/__tests__/resource-create-modal.test.tsx`

**关键实现补充（已完成）:**
- 新增 `resource-draft-generator.service.ts`：`generateSkillDraft/generateAgentDraft`，输出标准化 `{ name, description, content }`。
- 第一版生成器采用确定性模板（规则驱动）以保证离线可用与可测试性；后续可无缝替换为模型生成。
- 新增 `ResourceCreateModal`：输入描述 -> 生成草稿 -> 预览/编辑 -> 创建写库 -> 刷新列表 -> 自动打开详情。
- `skills:generate-draft` / `agents:generate-draft` IPC、preload、renderer api 已全链路打通。
- `SkillSuggestionCard` 已改为 `create*InLibrary`；`SkillEditorModal` / `AgentEditorModal` 新建走 library，编辑按资源来源路由到 `update` 或 `update*InLibrary`。

- [x] **Step 1: 写测试，锁定自然语言创建 happy path**

测试覆盖：

- 用户输入一句描述后请求 draft generation
- 服务返回 `{ name, description, content }`
- 用户确认后写入 `Kite/Skills/<name>/SKILL.md` 或 `Kite/Agents/<name>.md`
- 写入完成后默认 `enabled = true`
- 创建成功后自动打开详情页

- [x] **Step 2: 运行创建流程测试，确认失败（阶段已完成）**

Run:

```bash
npm run test:unit -- src/renderer/components/resources/__tests__/resource-create-modal.test.tsx
```

Expected: FAIL，因为当前顶层没有自然语言创建 modal，也没有 draft generation service。

- [x] **Step 3: 实现 draft generation service**

`resource-draft-generator.service.ts` 负责：

- 接收 `type: skill | agent`
- 接收自然语言描述
- 生成标准化 `{ name, description, content }`

实现约束：

- 不复用 chat UI 的 suggestion card 协议作为唯一执行链路
- 允许内部复用现有 suggestion 结构作为 preview 数据格式
- 生成失败时返回明确错误，不要 silent fallback

- [x] **Step 4: 实现 ResourceCreateModal**

`ResourceCreateModal.tsx` 流程：

- 用户输入描述
- 点击 `生成草稿`
- 展示 loading
- 展示 preview
- 用户点击 `创建`
- 写入 library
- 自动刷新列表并打开详情页

先实现单轮草稿生成，不做多轮 prompt 优化器。

- [x] **Step 5: 让顶层创建按钮和 suggestion 创建都走 library 目标**

要求：

- 顶层页面的 `创建` 打开新 modal
- 现有 `SkillSuggestionCard.tsx` 创建建议资源时，目标也改为 library，而不是 `workDir`
- 现有 `SkillEditorModal.tsx` / `AgentEditorModal.tsx` 保留为 fallback 编辑器，不再是主创建入口

- [x] **Step 6: 重新运行创建流程测试**

Run:

```bash
npm run test:unit -- src/renderer/components/resources/__tests__/resource-create-modal.test.tsx
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/services/resource-draft-generator.service.ts src/renderer/components/resources/ResourceCreateModal.tsx src/main/ipc/skills.ts src/main/ipc/agents.ts src/preload/index.ts src/renderer/api/index.ts src/renderer/components/home/ExtensionsView.tsx src/renderer/components/skills/SkillSuggestionCard.tsx src/renderer/components/skills/SkillEditorModal.tsx src/renderer/components/agents/AgentEditorModal.tsx src/renderer/components/resources/__tests__/resource-create-modal.test.tsx
git commit -m "feat: add natural-language library resource creation"
```

## Task 7: 全量回归、计划对齐检查与收尾

**Status（2026-03-30）:** ⏳ 部分完成：自动化验证与文档同步已完成；人工关键路径手测与 final commit 未执行。

**Files:**
- Modify: `docs/superpowers/specs/2026-03-29-kite-library-resources-design.md`
- Modify: `docs/superpowers/plans/2026-03-29-kite-library-resources-implementation.md`

- [x] **Step 1: 运行本次改动相关的完整单元测试批次**

Run:

```bash
npm run test:unit -- src/main/services/__tests__/kite-library.service.test.ts src/main/services/__tests__/resource-library-state.service.test.ts src/main/services/__tests__/skills-library-source.test.ts src/main/services/__tests__/agents-library-source.test.ts src/main/services/__tests__/resource-library-import.service.test.ts src/main/services/__tests__/resource-copy-by-ref.test.ts src/renderer/stores/__tests__/skills.store.library.test.ts src/renderer/stores/__tests__/agents.store.library.test.ts src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx src/renderer/components/unified/__tests__/UnifiedSidebar.actions.test.tsx src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/components/home/__tests__/ExtensionsView.library-mode.test.tsx src/renderer/components/home/__tests__/ExtensionsView.import-drop.test.tsx src/renderer/components/resources/__tests__/resource-library-detail-actions.test.tsx src/renderer/components/resources/__tests__/resource-create-modal.test.tsx
```

Expected: PASS

结果：PASS（`15 files, 55 tests`）。

- [x] **Step 2: 运行基础构建验证**

Run:

```bash
npm run build
```

Expected: SUCCESS with no TypeScript errors.

结果：PASS（`electron-vite build` 成功；仅有既有 dynamic import warning，无 TS error）。

- [ ] **Step 3: 手动检查关键用户路径**

人工检查：

- 首次启动时历史目录迁移
- 顶层 `技能 / 智能体` 页面能打开
- 创建后资源立刻出现且默认启用
- 停用后新会话默认不加载
- 打开文件夹和拖拽导入可用

- [x] **Step 4: 同步文档状态**

更新 design / plan 文档中的复选框和已知偏差；若实现与设计有必要差异，记录具体原因，不要默默偏离。

- [ ] **Step 5: Final Commit**

```bash
git add docs/superpowers/specs/2026-03-29-kite-library-resources-design.md docs/superpowers/plans/2026-03-29-kite-library-resources-implementation.md
git commit -m "docs: sync kite library resource implementation status"
```

## Execution Handoff

当前状态（2026-03-30）：
- Task 1-6 已完成（代码与自动化测试通过），相关关键实现已补充到各 Task 小节。
- Task 7 已完成 Step 1/2/4；Step 3（人工关键路径手测）与 Step 5（final commit）待执行。

建议下一动作：
1. 在桌面端执行 Task 7 Step 3 的人工验收清单。
2. 验收通过后按 Task 7 Step 5 进行文档与代码提交。
