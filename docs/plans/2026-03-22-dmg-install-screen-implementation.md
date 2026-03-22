# DMG Install Screen Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework the macOS DMG install screen into a minimal, single-action guided layout with a single fallback install guide.

**Architecture:** Keep the DMG installer mechanics unchanged and only adjust the static background asset, support copy, and icon coordinates in `package.json`. The new layout reserves a dedicated bottom strip for a single install guide file, and removes the loose `.command` helper because Gatekeeper blocks downloaded DMG scripts before they can run.

**Tech Stack:** Electron Builder DMG config, PNG background asset, plain text support file

---

### Task 1: Document the approved design

**Files:**
- Create: `docs/plans/2026-03-22-dmg-install-screen-design.md`
- Create: `docs/plans/2026-03-22-dmg-install-screen-implementation.md`

**Step 1: Save the approved visual direction**

- Write the problem statement, approved minimalist direction, layout structure, and acceptance criteria.

**Step 2: Confirm scope stays inside DMG resources**

- Keep the change limited to `resources/*` and the `build.dmg` section in `package.json`.

### Task 2: Redesign the background asset

**Files:**
- Modify: `resources/dmg-background.png`

**Step 1: Create the new layout**

- Produce a 700x480 background with:
  - top label and headline
  - a central drag arrow zone
  - a three-step instruction band
  - a bottom fallback guide strip

**Step 2: Preserve clarity under real DMG icons**

- Keep the center zone visually open where the app icon and `Applications` alias render.
- Reserve bottom spacing so the install guide file icon does not overlap key copy.

**Step 3: Replace the background asset**

- Export the final PNG to `resources/dmg-background.png`.

### Task 3: Align the support copy and DMG coordinates

**Files:**
- Modify: `package.json`
- Modify: `resources/安装说明.txt`
- Optional Modify: `resources/README.txt`

**Step 1: Move DMG contents into the new visual slots**

- Update `build.dmg.contents` icon coordinates to match the redesigned background.
- Remove the loose `.command` helper from the DMG contents.

**Step 2: Tighten support copy**

- Make the install guide match the simplified flow:
  - normal path first
  - fallback path second
  - command-line path last
  - no promise of a double-click auto-fix script

### Task 4: Verify the asset and configuration

**Files:**
- Verify: `resources/dmg-background.png`
- Verify: `package.json`

**Step 1: Validate image output**

Run: `sips -g pixelWidth -g pixelHeight resources/dmg-background.png`
Expected: width `700`, height `480`

**Step 2: Validate DMG config shape**

Run: `node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); console.log(pkg.build.dmg);"`
Expected: JSON prints with updated `background`, `window`, and `contents`

**Step 3: Review final diff**

Run: `git diff -- resources/dmg-background.png package.json resources/安装说明.txt resources/README.txt docs/plans/2026-03-22-dmg-install-screen-design.md docs/plans/2026-03-22-dmg-install-screen-implementation.md tests/unit/build/dmg-installer-config.test.ts`
Expected: only DMG installer related files changed
