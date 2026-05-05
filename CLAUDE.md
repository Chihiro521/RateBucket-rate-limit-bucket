# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RateBucket is a local-first Chrome Manifest V3 extension that shows a floating usage widget on Grok, Claude, ChatGPT, and Kimi. It tracks platform-specific rate-limit and quota signals through endpoint polling and fetch interception, normalizes them into shared usage snapshots, and renders a compact UI. There is no project-owned backend.

## Common Commands

```bash
npm install    # Install dependencies
npm run build  # Type-check and build the extension into dist/
npm test       # Run all Vitest unit tests
```

The build script (`scripts/build.mjs`) compiles three IIFE bundles with Vite:
- `src/content/content.ts` → `dist/content.js`
- `src/background/serviceWorker.ts` → `dist/serviceWorker.js`
- `src/injected/mainWorldBridge.ts` → `dist/mainWorldBridge.js`

After building, load `dist/` as an unpacked extension in Chrome.

## Architecture

### Extension Entry Points

- **`content.js`** (isolated world): Owns the floating widget (`src/content/widget.ts`), orchestrates refreshes, and coordinates between storage, platform fetchers, and the main-world bridge.
- **`mainWorldBridge.js`** (main world): Injected early to observe page `fetch` responses for allowlisted usage endpoints and forward them to `content.js` via `CustomEvent`. Also hooks ChatGPT-specific sentinel events.
- **`serviceWorker.js`**: Background-only tasks. Currently handles the optional IP reputation refresh when enabled.

### Data Flow

1. Platform is detected with `detectPlatform()` (`src/platforms/detect.ts`).
2. Usage is gathered from one or more sources:
   - **Active fetch**: `fetchPlatformUsage()` (`src/platforms/index.ts`) calls the platform-specific endpoint logic.
   - **Intercepted response**: The bridge catches same-page fetches and `normalizeInterceptedUsage()` parses them.
   - **Estimate mode**: `src/content/estimator.ts` increments local counters when authoritative data is missing.
3. Snapshots are merged at the meter level (`src/platforms/merge.ts`) so multiple ChatGPT endpoints can coalesce into one view.
4. The widget renders meters from the merged snapshot.

### Key Types

`src/platforms/types.ts` defines the shared shapes:

- `PlatformId = "grok" | "claude" | "chatgpt" | "kimi"`
- `UsageSource = "api" | "intercepted" | "estimate" | "unknown"`
- `UsageSnapshot` contains `meters: UsageMeter[]`, `status`, `source`, and `updatedAt`.
- `UsageMeter` tracks `remaining`, `total`, `used`, `resetAt`, `windowSeconds`, plus `source` and `confidence`.

### Storage

All persistence uses `chrome.storage.local`. Wrappers live under `src/storage/`:

- `cache.ts` — snapshot cache, last refresh time, failure count, and exponential backoff timestamps.
- `chatgptSentinel.ts` — state from the ChatGPT sentinel hook.
- `ipRisk.ts` — optional proxycheck.io settings and cached risk result.
- `language.ts` — UI language preference (`"en" | "zh-CN"`).

### i18n

`src/utils/i18n.ts` provides English and Simplified Chinese strings. The UI auto-detects the browser language unless the user manually selects one.

### Testing

Tests are in `tests/` and run under Vitest with a Node environment. Normalizer tests exercise the platform-specific parsers with sample endpoint JSON. There is no separate linter or formatter command; keep edits consistent with nearby code.

### Debug Logging

Enable debug logs on a supported site by running in the page console:

```js
localStorage.setItem("aiUsageDebug", "1");
```

Disable with `localStorage.removeItem("aiUsageDebug")`.

## Important Boundaries

- Do not read or store cookies, tokens, Authorization headers, or chat content.
- Do not add analytics or telemetry.
- Avoid requesting `cookies`, `webRequest`, `tabs`, or `activeTab` permissions.
- `chrome.storage.local` should only hold normalized usage data, local counters, retry metadata, language preference, and optional IP risk settings.
