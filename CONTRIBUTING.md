# Contributing to Kite

Thanks for your interest in contributing to Kite! This guide will help you get started.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/blackholel/buddykite.git
cd buddykite

# Install dependencies
npm install

# Start development server
npm run dev
```

## Project Structure

```
src/
├── main/           # Electron Main Process
│   ├── services/   # Business logic (agent, config, space, conversation...)
│   ├── ipc/        # IPC handlers
│   └── http/       # Remote Access server
├── preload/        # Preload scripts
└── renderer/       # React Frontend
    ├── components/ # UI components
    ├── stores/     # Zustand state management
    ├── api/        # API adapter (IPC/HTTP)
    └── pages/      # Page components
```

## Tech Stack

- **Framework**: Electron + electron-vite
- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS (use CSS variables, no hardcoded colors)
- **State**: Zustand
- **Icons**: lucide-react

## Code Guidelines

### Styling

Use Tailwind CSS with theme variables:

```tsx
// Good
<div className="bg-background text-foreground border-border">

// Bad
<div className="bg-white text-black border-gray-200">
```

### Internationalization

All user-facing text must use `t()`:

```tsx
// Good
<Button>{t('Save')}</Button>

// Bad
<Button>Save</Button>
```

Run `npm run i18n` before committing to extract new strings.

### Adding IPC Channels

When adding a new IPC event, update these 3 files:

1. `src/preload/index.ts` - Expose to `window.kite`
2. `src/renderer/api/transport.ts` - Add to `methodMap`
3. `src/renderer/api/index.ts` - Export unified API

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run `npm run i18n` if you added any text
5. Test your changes (`npm run dev`)
6. Commit with clear message
7. Push and create a Pull Request

## Release Workflow

Kite Desktop releases must always satisfy all of these:

1. GitHub-reachable users can download from GitHub Releases.
2. Users who cannot reach GitHub can fallback to Baidu Netdisk.
3. In-app update surfaces ("Settings > About" and update modal) show correct version + links.

### Key Files

1. Version: `package.json`
2. Release notes: `.release-notes-current.md`
3. Dual-source manifest: `resources/update-manifest.json`
4. Manifest validator: `scripts/validate-update-manifest.mjs`
5. Release process doc: `CONTRIBUTING.md`

### One-Time Prerequisites

1. Set `GH_TOKEN` for GitHub Release publishing.
2. Prepare Baidu Netdisk account access for installer upload + share links.

### Per-Release Checklist

```bash
# 1) Bump version
npm version patch    # or minor / major

# 2) Update release notes
# edit .release-notes-current.md

# 3) Build installers as needed
npm run build:mac
npm run build:win
npm run build:linux

# 4) Upload installers to Baidu Netdisk
# collect:
# - baidu.url
# - baidu.extractCode

# 5) Update resources/update-manifest.json
# - distributionMode:
#   - "dual-source" (default): requires baidu + github links
#   - "github-only" (temporary fallback): github links only
# - latestVersion == package.json version
# - add a release node for that version
# - fill platforms: darwin-arm64, win32-x64, linux-x64, default
# - each platform must have github
# - in "dual-source", each platform must also have baidu(url/extractCode)

# 6) Validate manifest before publishing
npm run check:update-manifest

# 7) Publish release
npm run release      # publishes mac + win
npm run release:linux
```

`release*` scripts run `npm run check:update-manifest` automatically, but run it manually before publish anyway.

### Temporary GitHub-Only Mode (Emergency)

Use this only when Baidu links are not ready yet:

1. Set `distributionMode` to `"github-only"` in `resources/update-manifest.json`.
2. Keep required `github` links for all platforms.
3. Remove placeholder Baidu links for `latestVersion` release node.
4. Publish as usual after `npm run check:update-manifest` passes.

Once Baidu links are ready, switch back to `"dual-source"` and fill all Baidu fields.

### Post-Release Verification

1. Open app: "Settings > About", click "Check for updates".
2. In GitHub-reachable network, download target should be GitHub.
3. In GitHub-blocked network:
   - `dual-source`: download target should fallback to Baidu.
   - `github-only`: download target remains GitHub (known temporary limitation).
4. For the same version, after clicking "Later", update reminder should not repeat immediately.

### Common Failures

1. `latestVersion must match package.json version`:
   version mismatch between `package.json` and `resources/update-manifest.json`.
2. `platform "...": baidu.url is required`:
   missing Baidu URL for one or more required platforms.
3. `platform "...": github link must match https://github.com/<owner>/<repo>/releases/tag/vX.Y.Z`:
   repo/tag mismatch in manifest (`<owner>/<repo>` comes from `package.json > build.publish`).
4. `platform "...": baidu.url contains placeholder text`:
   you still have `replace-with-real-link-*` in manifest.
5. `platform "...": baidu.url is required in dual-source mode`:
   current `distributionMode` is `dual-source`, but Baidu links are missing.
6. App still shows old version after publish:
   `latestVersion` not updated or published tag does not match `vX.Y.Z`.

## Areas We Need Help

- **Translations** - Add/improve translations in `src/renderer/i18n/`
- **Bug fixes** - Check GitHub Issues
- **Documentation** - Improve README, add guides
- **Features** - Discuss in GitHub Discussions first

## Questions?

- Open a [GitHub Discussion](https://github.com/blackholel/buddykite/discussions)
- Check existing [Issues](https://github.com/blackholel/buddykite/issues)

Thank you for contributing!
