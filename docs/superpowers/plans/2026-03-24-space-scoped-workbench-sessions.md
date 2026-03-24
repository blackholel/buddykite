# Space-Scoped Workbench Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Refactor the unified workbench so space is the primary context, each space preserves its own mixed chat/file tab session, and the right artifact rail always follows the current space instead of a global tab pool.

**Architecture:** Move the tab model in `canvas-lifecycle` from one global tab list to a per-space session map. Treat `currentSpaceId` as the single source of truth for visible tabs and right-rail context. Keep chat/file tabs mixed within a space session, enforce per-space uniqueness and per-space tab limits, and let page-level navigation drive session switching rather than having active tabs back-drive the current space.

**Tech Stack:** React 18, Zustand, TypeScript, Electron-Vite, Vitest, Tailwind utility classes

---

## File Structure

### Existing files to modify

- `src/renderer/services/canvas-lifecycle.ts`
  - Replace the global tab pool with per-space session state and space-aware file/chat operations.
- `src/renderer/hooks/useCanvasLifecycle.ts`
  - Expose current-space session state and space-aware actions from `canvas-lifecycle`.
- `src/renderer/stores/canvas.store.ts`
  - Keep the compatibility bridge working while forwarding to the new space-scoped lifecycle API.
- `src/renderer/pages/UnifiedPage.tsx`
  - Drive workbench behavior from `currentSpaceId` and switch space sessions before opening or activating tabs.
- `src/renderer/components/unified/UnifiedSidebar.tsx`
  - Keep all spaces browsable while ensuring current-space semantics remain clear in the UI.
- `src/renderer/components/canvas/CanvasTabs.tsx`
  - Render only current-space tabs and keep chat/file mixed-tab semantics clear.
- `src/renderer/components/canvas/ContentCanvas.tsx`
  - Continue operating on the current space session without restoring removed global-tab behavior.
- `src/renderer/components/artifact/ArtifactRail.tsx`
  - Highlight and hint against the current space session instead of a global active tab interpretation.
- `src/renderer/components/artifact/ArtifactTree.tsx`
  - Open files through the current space session and avoid duplicate file tabs inside one space.
- `src/renderer/components/artifact/ArtifactCard.tsx`
  - Open cards through the same current-space file-tab path as the tree.

### New tests to create

- `src/renderer/services/__tests__/canvas-lifecycle.space-sessions.test.ts`
  - Verify per-space session restore, per-space uniqueness, and per-space LRU tab eviction.
- `src/renderer/pages/__tests__/UnifiedPage.space-session-flow.test.tsx`
  - Verify space switching, conversation activation, and current-space tab restoration.
- `src/renderer/components/artifact/__tests__/ArtifactRail.space-sync.test.tsx`
  - Verify right-rail current-space sync and no duplicate file tabs within one space.

### Existing tests to modify

- `src/renderer/services/__tests__/canvas-lifecycle.template-library.test.ts`
  - Keep existing lifecycle coverage passing after the session model changes.
- `src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx`
  - Update expectations so top tabs represent only the current space session.
- `src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx`
  - Preserve the “all spaces visible, current one expanded” contract.

## Multi-Agent Execution Model

### Phase 1: Serial foundation

This phase must be done first because every later task depends on the new session model and API shape.

- Task 1 only

### Phase 2: Parallel feature integration

After Task 1 lands and tests pass, dispatch these three workers in parallel because they own disjoint files:

- Worker A: Task 2 (`UnifiedPage` + page tests)
- Worker B: Task 3 (`ArtifactRail` / `ArtifactTree` / `ArtifactCard` + artifact tests)
- Worker C: Task 4 (`CanvasTabs` / `ContentCanvas` + canvas UI adjustments)

### Phase 3: Serial integration and final verification

After Tasks 2-4 merge cleanly, run Task 5 for cross-surface verification and cleanup.

## Task 1: Refactor Canvas Lifecycle Into Space Sessions

**Files:**
- Modify: `src/renderer/services/canvas-lifecycle.ts`
- Modify: `src/renderer/hooks/useCanvasLifecycle.ts`
- Modify: `src/renderer/stores/canvas.store.ts`
- Create: `src/renderer/services/__tests__/canvas-lifecycle.space-sessions.test.ts`
- Modify: `src/renderer/services/__tests__/canvas-lifecycle.template-library.test.ts`

- [x] **Step 1: Write failing lifecycle tests for space-scoped sessions**

Add tests that cover:

```ts
it('restores tabs when switching back to a previously visited space', async () => {
  await canvasLifecycle.switchSpaceSession('space-a')
  await canvasLifecycle.openChat('space-a', 'conv-1', '会话 A1', '/tmp/space-a')
  await canvasLifecycle.openFile('space-a', '/tmp/space-a/docs/a.md', 'a.md')

  await canvasLifecycle.switchSpaceSession('space-b')
  await canvasLifecycle.openChat('space-b', 'conv-2', '会话 B1', '/tmp/space-b')

  await canvasLifecycle.switchSpaceSession('space-a')

  expect(canvasLifecycle.getTabs().map((tab) => tab.title)).toEqual(['会话 A1', 'a.md'])
  expect(canvasLifecycle.getActiveTab()?.spaceId).toBe('space-a')
})
```

Also cover:
- same-space conversation dedupe by `spaceId + conversationId`
- same-space file dedupe by `spaceId + normalizedPath`
- per-space `MAX_TABS = 5`
- switching space updates visible tabs without deleting other spaces' sessions

- [x] **Step 2: Run the targeted lifecycle tests and confirm failure**

Run:

```bash
npm run test:unit -- src/renderer/services/__tests__/canvas-lifecycle.space-sessions.test.ts src/renderer/services/__tests__/canvas-lifecycle.template-library.test.ts
```

Expected: FAIL because current lifecycle still uses one global tab pool and `openFile` is not space-aware.

- [x] **Step 3: Replace global tab state with per-space session state**

Implementation notes:

```ts
interface SpaceSessionState {
  spaceId: string
  tabs: TabState[]
  activeTabId: string | null
  lastVisitedAt: number
}

private spaceSessions = new Map<string, SpaceSessionState>()
private currentSpaceId: string | null = null
```

Add methods with exact responsibilities:
- `switchSpaceSession(spaceId: string): Promise<void>`
- `getCurrentSpaceId(): string | null`
- `getVisibleTabs(): TabState[]`
- `getSpaceSession(spaceId: string): SpaceSessionState | undefined`

Keep `getTabs()` returning visible tabs so existing callers do not need to be rewritten all at once.

- [x] **Step 4: Make chat/file operations space-aware**

Implementation notes:

```ts
openChat(spaceId, conversationId, title, workDir?, spaceLabel?, openCanvas = true)
openFile(spaceId, path, title?)
```

Rules:
- chat unique key: `spaceId + conversationId`
- file unique key: `spaceId + normalizedPath`
- per-space max tabs: `5`
- eviction target: least recently active non-current tab inside that space only

- [x] **Step 5: Update hook and compatibility store to the new API**

Implementation notes:

```ts
// useCanvasLifecycle
const tabs = canvasLifecycle.getVisibleTabs()
const switchSpaceSession = (spaceId: string) => canvasLifecycle.switchSpaceSession(spaceId)

// canvas.store compatibility bridge
openFile: async (spaceId: string, path: string, title?: string) => {
  await canvasLifecycle.openFile(spaceId, path, title)
}
```

Do not keep a second global-tab interpretation in the bridge layer.

- [x] **Step 6: Re-run the targeted lifecycle tests**

Run:

```bash
npm run test:unit -- src/renderer/services/__tests__/canvas-lifecycle.space-sessions.test.ts src/renderer/services/__tests__/canvas-lifecycle.template-library.test.ts
```

Expected: PASS with session restoration and per-space dedupe semantics covered.

- [x] **Step 7: Commit**

```bash
git add src/renderer/services/canvas-lifecycle.ts src/renderer/hooks/useCanvasLifecycle.ts src/renderer/stores/canvas.store.ts src/renderer/services/__tests__/canvas-lifecycle.space-sessions.test.ts src/renderer/services/__tests__/canvas-lifecycle.template-library.test.ts
git commit -m "refactor: scope canvas sessions by space"
```

## Task 2: Rewire Unified Page Around Current Space Sessions

**Files:**
- Modify: `src/renderer/pages/UnifiedPage.tsx`
- Modify: `src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx`
- Create: `src/renderer/pages/__tests__/UnifiedPage.space-session-flow.test.tsx`

- [x] **Step 1: Write failing page flow tests**

Cover these behaviors:

```tsx
it('switches space session before activating a conversation from another space', async () => {
  render(<UnifiedPage />)

  await user.click(screen.getByRole('button', { name: /测试准备/i }))
  await user.click(screen.getByRole('button', { name: /会话 B1/i }))

  expect(mockSwitchSpaceSession).toHaveBeenCalledWith('space-b')
  expect(mockOpenChat).toHaveBeenCalledWith('space-b', 'conv-b1', '会话 B1', '/tmp/space-b', '测试准备', false)
})
```

Also cover:
- switching back to a space restores that space's visible tabs
- top tab clicks no longer drive cross-space navigation

- [x] **Step 2: Run the targeted page tests**

Run:

```bash
npm run test:unit -- src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/pages/__tests__/UnifiedPage.space-session-flow.test.tsx
```

Expected: FAIL because `UnifiedPage` still treats active chat tabs as a global navigation source.

- [x] **Step 3: Change page navigation direction to space-first**

Implementation notes:

```ts
await navigateToSpaceContext(...)
await switchSpaceSession(spaceId)
await openChat(spaceId, conversationId, title, workDir, spaceLabel, false)
```

Rules:
- selecting a conversation in another space must switch space first
- `currentSpaceId` drives visible tabs
- remove or replace the effect that back-drives navigation from `activeTab.spaceId`

- [x] **Step 4: Keep sidebar interactions compatible with all-space browsing**

Implementation notes:

```ts
// UnifiedPage still passes all spaces to UnifiedSidebar
// but current session switching happens in page controller logic
```

Do not move space/session orchestration into `UnifiedSidebar`.

- [x] **Step 5: Re-run the targeted page tests**

Run:

```bash
npm run test:unit -- src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/pages/__tests__/UnifiedPage.space-session-flow.test.tsx
```

Expected: PASS with space-first navigation locked in.

- [x] **Step 6: Commit**

```bash
git add src/renderer/pages/UnifiedPage.tsx src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/pages/__tests__/UnifiedPage.space-session-flow.test.tsx
git commit -m "refactor: drive workbench tabs from current space"
```

## Task 3: Make Artifact Rail Open Files In The Current Space Session

**Files:**
- Modify: `src/renderer/components/artifact/ArtifactRail.tsx`
- Modify: `src/renderer/components/artifact/ArtifactTree.tsx`
- Modify: `src/renderer/components/artifact/ArtifactCard.tsx`
- Create: `src/renderer/components/artifact/__tests__/ArtifactRail.space-sync.test.tsx`

- [x] **Step 1: Write failing artifact-rail tests**

Cover these behaviors:

```tsx
it('opens files in the current space session without duplicating file tabs', async () => {
  render(<ArtifactRail spaceId="space-a" isTemp={false} />)

  await user.click(screen.getByText('chapter1.md'))
  await user.click(screen.getByText('chapter1.md'))

  expect(mockOpenFile).toHaveBeenCalledWith('space-a', '/tmp/space-a/chapter1.md', 'chapter1.md')
  expect(mockOpenFile).toHaveBeenCalledTimes(2)
})
```

Also cover:
- active artifact highlight comes from current-space active tab only
- changing `spaceId` causes right-rail content to reload for that space

- [x] **Step 2: Run the targeted artifact tests**

Run:

```bash
npm run test:unit -- src/renderer/components/artifact/__tests__/ArtifactRail.space-sync.test.tsx
```

Expected: FAIL because artifact components still call the compatibility store with a path-only `openFile`.

- [x] **Step 3: Thread `spaceId` through all artifact open-file calls**

Implementation notes:

```tsx
openFile(spaceId, artifact.path, artifact.name)
```

Apply the same rule in:
- card click
- tree row click
- any “create then open” artifact path

- [x] **Step 4: Update active-file detection to current-space semantics**

Implementation notes:

```ts
const activeArtifactPath = activeTab?.spaceId === spaceId ? activeTab.path : null
```

Do not treat another space's file tab as active inside the current rail.

- [x] **Step 5: Re-run the targeted artifact tests**

Run:

```bash
npm run test:unit -- src/renderer/components/artifact/__tests__/ArtifactRail.space-sync.test.tsx
```

Expected: PASS with current-space-only artifact behavior.

- [x] **Step 6: Commit**

```bash
git add src/renderer/components/artifact/ArtifactRail.tsx src/renderer/components/artifact/ArtifactTree.tsx src/renderer/components/artifact/ArtifactCard.tsx src/renderer/components/artifact/__tests__/ArtifactRail.space-sync.test.tsx
git commit -m "feat: scope artifact file opening to current space"
```

## Task 4: Keep Canvas UI Aligned With Space-Scoped Tabs

**Files:**
- Modify: `src/renderer/components/canvas/CanvasTabs.tsx`
- Modify: `src/renderer/components/canvas/ContentCanvas.tsx`

- [x] **Step 1: Add or update UI assertions through existing page/canvas tests**

Use the page tests from Task 2 as the guardrail:
- current space shows only that space's tabs
- chat and file tabs remain mixed in one row
- no UI path reintroduces the old global new-conversation shortcut behavior

- [x] **Step 2: Run the relevant test set before changing UI code**

Run:

```bash
npm run test:unit -- src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/pages/__tests__/UnifiedPage.space-session-flow.test.tsx src/renderer/services/__tests__/canvas-lifecycle.space-sessions.test.ts
```

Expected: PASS or partial FAILs that reflect the UI still assuming global tabs.

- [x] **Step 3: Keep tab rendering strictly current-space**

Implementation notes:

```tsx
const { tabs, activeTabId } = useCanvasLifecycle() // tabs already current-space scoped
```

Do not add space-switch controls into the tab bar. The tab bar is not a second navigation system.

- [x] **Step 4: Verify keyboard behavior only acts on visible tabs**

Implementation notes:

```ts
// Ctrl/Cmd+W, tab cycling, and close-all operate on current visible session tabs
```

Do not revive global tab traversal.

- [x] **Step 5: Re-run the relevant test set**

Run:

```bash
npm run test:unit -- src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/pages/__tests__/UnifiedPage.space-session-flow.test.tsx src/renderer/services/__tests__/canvas-lifecycle.space-sessions.test.ts
```

Expected: PASS with no global-tab behavior leaks in the UI.

- [x] **Step 6: Commit**

```bash
git add src/renderer/components/canvas/CanvasTabs.tsx src/renderer/components/canvas/ContentCanvas.tsx
git commit -m "refactor: keep canvas ui scoped to current space tabs"
```

## Task 5: Integrate, Verify, And Clean Up

**Files:**
- Modify: `src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx`
- Modify: `docs/superpowers/plans/2026-03-24-space-scoped-workbench-sessions.md`

- [x] **Step 1: Reconcile and re-run the full targeted suite**

Run:

```bash
npm run test:unit -- src/renderer/services/__tests__/canvas-lifecycle.template-library.test.ts src/renderer/services/__tests__/canvas-lifecycle.space-sessions.test.ts src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx src/renderer/pages/__tests__/UnifiedPage.space-session-flow.test.tsx src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx src/renderer/components/artifact/__tests__/ArtifactRail.space-sync.test.tsx
```

Expected: PASS across lifecycle, page flow, sidebar structure, and artifact sync.

- [x] **Step 2: Manually verify the interactive regression path**

Checklist:
- switch from space A conversation to space B conversation from the left rail
- confirm top tabs switch to space B session
- open a file in the right rail
- switch back to space A and confirm its previous tabs restore
- switch again to space B and confirm its chat/file tabs restore
- verify no duplicate file tab appears within one space

Manual verification note:
- Verified in this run via deterministic test flows (`UnifiedPage.entry-state`, `UnifiedPage.space-session-flow`, `canvas-lifecycle.space-sessions`, `ArtifactRail.space-sync`) because this environment does not provide an interactive Electron session for click-through validation.

- [x] **Step 3: Remove stale global-tab assumptions if still present**

Examples:
- comments claiming tabs are global
- effects that infer current space from `activeTab.spaceId`
- stale bridge signatures that still accept path-only `openFile`

- [x] **Step 4: Update the plan checkboxes as work completes**

Keep the document honest. Do not leave completed tasks unchecked.

- [x] **Step 5: Final commit**

```bash
git add src/renderer/components/unified/__tests__/UnifiedSidebar.structure.test.tsx docs/superpowers/plans/2026-03-24-space-scoped-workbench-sessions.md
git commit -m "test: verify space-scoped workbench session flow"
```

## Agent Dispatch Instructions For The New Window

Use this exact execution order:

1. Controller reads this plan and the spec.
2. Controller assigns Task 1 to a single implementer agent and waits for merge.
3. After Task 1 passes review, controller dispatches in parallel:
   - Agent A: Task 2 only
   - Agent B: Task 3 only
   - Agent C: Task 4 only
4. Controller resolves any merge conflicts locally.
5. Controller runs Task 5 serially.

### Worker Ownership

- Agent A owns only:
  - `src/renderer/pages/UnifiedPage.tsx`
  - `src/renderer/pages/__tests__/UnifiedPage.entry-state.test.tsx`
  - `src/renderer/pages/__tests__/UnifiedPage.space-session-flow.test.tsx`

- Agent B owns only:
  - `src/renderer/components/artifact/ArtifactRail.tsx`
  - `src/renderer/components/artifact/ArtifactTree.tsx`
  - `src/renderer/components/artifact/ArtifactCard.tsx`
  - `src/renderer/components/artifact/__tests__/ArtifactRail.space-sync.test.tsx`

- Agent C owns only:
  - `src/renderer/components/canvas/CanvasTabs.tsx`
  - `src/renderer/components/canvas/ContentCanvas.tsx`

- Task 1 implementer owns only:
  - `src/renderer/services/canvas-lifecycle.ts`
  - `src/renderer/hooks/useCanvasLifecycle.ts`
  - `src/renderer/stores/canvas.store.ts`
  - `src/renderer/services/__tests__/canvas-lifecycle.space-sessions.test.ts`
  - `src/renderer/services/__tests__/canvas-lifecycle.template-library.test.ts`

### Review Gates

For each task:

1. Implementer finishes task and runs only the task's targeted tests.
2. Spec reviewer checks against this plan and the spec.
3. Code-quality reviewer checks for regressions, unnecessary abstraction, and state-direction mistakes.
4. Controller merges only after both reviews are green.
