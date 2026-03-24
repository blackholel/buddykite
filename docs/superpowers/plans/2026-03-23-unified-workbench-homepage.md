# Unified Workbench Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current onboarding-first homepage with a single default workbench where chat is the primary entry point, spaces are scoped in the left sidebar, tabs represent open work content, and the right rail remains a collapsed results panel.

**Architecture:** Reuse the existing `UnifiedPage` path as the implementation base instead of inventing a third shell. Extract the persistent workbench structure into a focused shared page/component, migrate `HomePage` away from onboarding cards, and reduce `SpacePage` to layout/content responsibilities that still matter after the shell merge. Keep responsibilities strict: sidebar for scope/history, center for chat, top tabs for opened content, right rail for files/artifacts.

**Tech Stack:** React 18, Zustand, Electron-Vite, TypeScript, Vitest, Tailwind utility classes

---

## File Structure

### Existing files to modify

- `src/renderer/App.tsx`
  - Switch the default rendered route to the unified workbench flow.
- `src/renderer/stores/app.store.ts`
  - Update initialization and back-navigation assumptions so the app lands on the workbench by default.
- `src/renderer/pages/HomePage.tsx`
  - Remove onboarding-first homepage content or reduce it to a migration wrapper while the workbench becomes the default entry.
- `src/renderer/pages/UnifiedPage.tsx`
  - Become the canonical default workbench shell.
- `src/renderer/pages/SpacePage.tsx`
  - Remove duplicated shell responsibilities or extract reusable workbench content from it.
- `src/renderer/components/unified/UnifiedSidebar.tsx`
  - Implement the final left sidebar behavior: only current space expanded, other spaces collapsed with name/status only.
- `src/renderer/components/chat/ChatView.tsx`
  - Rewrite empty/gated states so the input area remains the primary interaction zone.
- `src/renderer/components/chat/ConversationList.tsx`
  - Strip out advanced configuration panels from the primary conversation rail if they are still mounted in the default workbench path.
- `src/renderer/components/canvas/CanvasTabs.tsx`
  - Preserve tab semantics as “opened work content”, not history/navigation.
- `src/renderer/utils/workspace-view-mode.ts`
  - Simplify workspace mode switching logic if `home`/`space`/`unified` behavior changes.

### New files to create

- `src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx`
  - Verify the default workbench states: gated, empty, active conversation.
- `src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx`
  - Verify only the current space expands and other spaces remain collapsed.
- `src/renderer/components/chat/__tests__/chat-view.empty-state.test.tsx`
  - Verify the new empty state and model-gate copy/layout expectations.
- `docs/superpowers/plans/2026-03-23-unified-workbench-homepage.md`
  - This implementation plan.

### Existing tests to modify

- `tests/unit/renderer/workspace-view-mode.test.ts`
  - Update route/mode expectations if workbench selection logic changes.
- `src/renderer/components/chat/__tests__/chat-view.layout-width.test.ts`
  - Keep existing width behavior passing after empty-state refactor.

## Task 1: Lock Default Entry To The Unified Workbench

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/stores/app.store.ts`
- Modify: `src/renderer/utils/workspace-view-mode.ts`
- Test: `tests/unit/renderer/workspace-view-mode.test.ts`

- [ ] **Step 1: Write the failing route-selection test**

```ts
it('defaults to the workbench entry instead of the legacy homepage', () => {
  const target = pickWorkspaceSwitchTarget({
    currentSpace: { id: 'space-1' },
    kiteSpace: null,
    spaces: []
  })

  expect(target?.id).toBe('space-1')
})
```

- [ ] **Step 2: Run the targeted test to confirm current assumptions**

Run:

```bash
npm run test:unit -- tests/unit/renderer/workspace-view-mode.test.ts
```

Expected: existing assertions pass, but no coverage yet for “default workbench entry”.

- [ ] **Step 3: Change app initialization and route fallback to land on the workbench**

Implementation notes:

```ts
// app.store.ts
set({ view: 'unified' })

// App.tsx
case 'home':
  return renderViewWithDragStrip('home', <UnifiedPage />)
```

Keep the change minimal: do not preserve both onboarding-first and workbench-first defaults behind flags.

- [ ] **Step 4: Simplify workspace mode switching**

Implementation notes:

```ts
persistWorkspaceViewMode('unified')
// remove branches that bounce the user back into legacy homepage hub behavior
```

- [ ] **Step 5: Re-run the targeted test**

Run:

```bash
npm run test:unit -- tests/unit/renderer/workspace-view-mode.test.ts
```

Expected: PASS with updated mode-selection expectations.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/stores/app.store.ts src/renderer/utils/workspace-view-mode.ts tests/unit/renderer/workspace-view-mode.test.ts
git commit -m "refactor: make unified workbench the default entry"
```

## Task 2: Collapse The Homepage Into The Workbench Shell

**Files:**
- Modify: `src/renderer/pages/HomePage.tsx`
- Modify: `src/renderer/pages/UnifiedPage.tsx`
- Modify: `src/renderer/pages/SpacePage.tsx`
- Test: `src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx`

- [ ] **Step 1: Write the failing page-state test**

```tsx
it('renders the workbench shell without onboarding cards', () => {
  render(<UnifiedPage />)

  expect(screen.queryByText('What can I do')).not.toBeInTheDocument()
  expect(screen.queryByText('Start in 3 simple steps')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the targeted page test**

Run:

```bash
npm run test:unit -- src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx
```

Expected: FAIL because the test file is new and the workbench shell contract is not covered yet.

- [ ] **Step 3: Move the default shell responsibility into `UnifiedPage`**

Implementation notes:

```tsx
// UnifiedPage owns:
// - left sidebar
// - top tabs bar
// - center chat surface
// - right results rail trigger
```

If `SpacePage` still contains reusable content-canvas layout logic, extract only that logic. Do not keep two competing page shells.

- [ ] **Step 4: Reduce `HomePage` to a thin wrapper or remove legacy content**

Implementation notes:

```tsx
export function HomePage() {
  return <UnifiedPage />
}
```

Prefer this temporary compatibility move over maintaining the old onboarding grid during migration.

- [ ] **Step 5: Re-run the page-state test**

Run:

```bash
npm run test:unit -- src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx
```

Expected: PASS with no homepage onboarding content in the default shell.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/HomePage.tsx src/renderer/pages/UnifiedPage.tsx src/renderer/pages/SpacePage.tsx src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx
git commit -m "refactor: converge homepage and space shell into unified workbench"
```

## Task 3: Rebuild The Left Sidebar Around Current-Space Focus

**Files:**
- Modify: `src/renderer/components/unified/UnifiedSidebar.tsx`
- Modify: `src/renderer/pages/UnifiedPage.tsx`
- Test: `src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx`

- [ ] **Step 1: Write the failing sidebar structure test**

```tsx
it('expands only the current space conversations', () => {
  render(
    <UnifiedSidebar
      spaces={[spaceA, spaceB]}
      currentSpaceId="space-a"
      currentConversationId="conv-1"
      conversationsBySpaceId={new Map([
        ['space-a', [conv1, conv2]],
        ['space-b', [conv3]]
      ])}
      {...handlers}
    />
  )

  expect(screen.getByText('conv-1')).toBeInTheDocument()
  expect(screen.queryByText('conv-3')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the targeted sidebar test**

Run:

```bash
npm run test:unit -- src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx
```

Expected: FAIL because the new structure contract is not implemented yet.

- [ ] **Step 3: Change the sidebar rendering rules**

Implementation notes:

```tsx
// current space:
// - expanded by default
// - show recent conversations

// other spaces:
// - collapsed by default
// - show name + status badge only
```

Add `主页` and `设置` anchors, but do not reintroduce skills/agents/commands/workflows in the sidebar.

- [ ] **Step 4: Ensure space metadata is enough for collapsed rows**

Implementation notes:

```tsx
<span>{space.name}</span>
<span>{statusLabel}</span>
```

Use existing activity/conversation count or last-updated data; do not invent extra persistence.

- [ ] **Step 5: Re-run the sidebar test**

Run:

```bash
npm run test:unit -- src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx
```

Expected: PASS with only current-space conversations visible by default.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/unified/UnifiedSidebar.tsx src/renderer/pages/UnifiedPage.tsx src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx
git commit -m "feat: focus unified sidebar on current space history"
```

## Task 4: Rewrite The Chat Empty State And Model Gate

**Files:**
- Modify: `src/renderer/components/chat/ChatView.tsx`
- Modify: `src/renderer/components/canvas/viewers/ChatTabViewer.tsx`
- Test: `src/renderer/components/chat/__tests__/chat-view.empty-state.test.tsx`
- Test: `src/renderer/components/chat/__tests__/chat-view.layout-width.test.ts`

- [ ] **Step 1: Write the failing chat empty-state test**

```tsx
it('shows direct-start copy when AI is configured and there are no messages', () => {
  render(<ChatView {...props} />)

  expect(screen.getByText('直接开始')).toBeInTheDocument()
  expect(screen.getByText('描述目标，Kite 会产出文件、草稿、代码和步骤。')).toBeInTheDocument()
})
```

- [ ] **Step 2: Add the model-gate test**

```tsx
it('shows model setup blocking copy inside the composer area', () => {
  render(<ChatView {...gatedProps} />)

  expect(screen.getByText('先完成模型配置')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '去设置模型' })).toBeInTheDocument()
})
```

- [ ] **Step 3: Run the targeted chat tests**

Run:

```bash
npm run test:unit -- src/renderer/components/chat/__tests__/chat-view.empty-state.test.tsx src/renderer/components/chat/__tests__/chat-view.layout-width.test.ts
```

Expected: FAIL on the new copy/placement assertions.

- [ ] **Step 4: Rewrite the empty state without reintroducing onboarding blocks**

Implementation notes:

```tsx
// configured + no messages
<h2>直接开始</h2>
<p>描述目标，Kite 会产出文件、草稿、代码和步骤。</p>

// not configured
<h3>先完成模型配置</h3>
<button>去设置模型</button>
```

Keep the composer area visually primary. Do not add “what is a space” or “3 steps” copy here.

- [ ] **Step 5: Mirror the same state model in `ChatTabViewer`**

Implementation notes:

```tsx
// tab viewer empty state must match ChatView semantics
```

- [ ] **Step 6: Re-run the targeted chat tests**

Run:

```bash
npm run test:unit -- src/renderer/components/chat/__tests__/chat-view.empty-state.test.tsx src/renderer/components/chat/__tests__/chat-view.layout-width.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/chat/ChatView.tsx src/renderer/components/canvas/viewers/ChatTabViewer.tsx src/renderer/components/chat/__tests__/chat-view.empty-state.test.tsx src/renderer/components/chat/__tests__/chat-view.layout-width.test.ts
git commit -m "feat: make chat the primary start state"
```

## Task 5: Keep Tabs As Open Work Content And Right Rail As Result Context

**Files:**
- Modify: `src/renderer/components/canvas/CanvasTabs.tsx`
- Modify: `src/renderer/pages/UnifiedPage.tsx`
- Modify: `src/renderer/pages/SpacePage.tsx`
- Modify: `src/renderer/components/artifact/ArtifactRail.tsx`
- Test: `src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx`

- [ ] **Step 1: Extend the page-state test for tabs and right-rail affordance**

```tsx
it('renders tabs for open work and a collapsed artifact affordance', () => {
  render(<UnifiedPage />)

  expect(screen.getByRole('tablist')).toBeInTheDocument()
  expect(screen.getByLabelText('Files and artifacts')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the page-state test**

Run:

```bash
npm run test:unit -- src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx
```

Expected: FAIL until the workbench shell exposes the right affordances consistently.

- [ ] **Step 3: Keep `CanvasTabs` semantics strict**

Implementation notes:

```tsx
// tabs represent:
// - current chat
// - plan
// - file preview
// - result preview
```

Do not add conversation history or space switching into the tab bar.

- [ ] **Step 4: Make the artifact/file rail collapsed-by-default in the unified shell**

Implementation notes:

```tsx
// show icon + badge in collapsed state
// expand only on user action or after fresh outputs
```

Preserve existing artifact browsing behavior; only change default prominence and placement.

- [ ] **Step 5: Re-run the page-state test**

Run:

```bash
npm run test:unit -- src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx
```

Expected: PASS with visible tablist and collapsed file/artifact affordance.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/canvas/CanvasTabs.tsx src/renderer/pages/UnifiedPage.tsx src/renderer/pages/SpacePage.tsx src/renderer/components/artifact/ArtifactRail.tsx src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx
git commit -m "refactor: align tabs and artifact rail with workbench roles"
```

## Task 6: Remove Advanced Panels From The Primary Workbench Path

**Files:**
- Modify: `src/renderer/components/chat/ConversationList.tsx`
- Modify: `src/renderer/pages/SpacePage.tsx`
- Modify: `src/renderer/pages/UnifiedPage.tsx`
- Modify: `src/renderer/pages/HomePage.tsx`

- [ ] **Step 1: Identify which advanced panels still mount in the default workbench path**

Run:

```bash
rg -n "SkillsPanel|AgentsPanel|CommandsPanel|WorkflowsPanel" src/renderer
```

Expected: references in `ConversationList.tsx` and possibly page-level mounts.

- [ ] **Step 2: Remove those panels from the default workbench sidebar path**

Implementation notes:

```tsx
// keep conversation sidebar focused on:
// - home
// - spaces
// - current-space recent chats
// - settings
```

Do not create replacement helpers inside the sidebar. The destination is Settings, not another sidebar section.

- [ ] **Step 3: Leave navigation access via Settings only**

Implementation notes:

```tsx
onClick={() => setView('settings')}
```

- [ ] **Step 4: Run smoke unit coverage for affected renderer areas**

Run:

```bash
npm run test:unit -- src/renderer/components/chat/__tests__/chat-view.empty-state.test.tsx src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx tests/unit/renderer/workspace-view-mode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/chat/ConversationList.tsx src/renderer/pages/SpacePage.tsx src/renderer/pages/UnifiedPage.tsx src/renderer/pages/HomePage.tsx
git commit -m "refactor: move advanced config out of the default workbench"
```

## Task 7: Final Verification And Cleanup

**Files:**
- Modify: `docs/superpowers/specs/2026-03-23-unified-workbench-homepage-design.md`
- Modify: `docs/superpowers/plans/2026-03-23-unified-workbench-homepage.md`

- [ ] **Step 1: Run the focused renderer unit suite**

Run:

```bash
npm run test:unit -- tests/unit/renderer/workspace-view-mode.test.ts src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx src/renderer/components/chat/__tests__/chat-view.empty-state.test.tsx src/renderer/components/chat/__tests__/chat-view.layout-width.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run a full renderer unit pass if the focused suite passes**

Run:

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 3: Sanity-check the app manually**

Run:

```bash
npm run dev
```

Manual checks:

1. App opens into the workbench, not the legacy onboarding homepage.
2. Current space is expanded in the left sidebar.
3. Other spaces are collapsed.
4. Empty configured state shows “直接开始”.
5. Unconfigured state blocks in the composer area with “去设置模型”.
6. Tabs remain “opened content”.
7. Right rail remains collapsed until used.

- [ ] **Step 4: Update the spec if implementation diverged**

Only update the spec if concrete implementation constraints required a design deviation.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-03-23-unified-workbench-homepage-design.md docs/superpowers/plans/2026-03-23-unified-workbench-homepage.md
git commit -m "docs: finalize unified workbench implementation plan"
```
