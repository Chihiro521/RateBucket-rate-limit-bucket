# RateBucket

[中文文档](README.zh-CN.md)

RateBucket is a Manifest V3 Chrome extension that shows a compact floating usage widget on Grok, Claude, and ChatGPT. It is intended as a personal-use monitor for current usage, quota, reset-window, and rate-limit signals exposed by each platform's own web endpoints.

The extension is not affiliated with OpenAI, Anthropic, xAI, or proxycheck.io.

## Features

- Floating usage widgets for Grok, Claude, and ChatGPT.
- Collapsible and draggable compact chips for supported platforms.
- Meter-level snapshot merging so multiple ChatGPT usage sources can appear together.
- Local estimate counters for actions that do not expose reliable quota data.
- Optional ChatGPT sentinel and optional IP reputation panel.
- No telemetry and no external backend owned by this project.

## Supported Sites

- `https://grok.com/*`
- `https://claude.ai/*`
- `https://chatgpt.com/*`

The content scripts are only declared for these sites.

## Data Sources

The extension uses allowlisted usage or rate-limit endpoints:

- Grok: `/rest/rate-limits`
- Claude: `/api/organizations`, then `/api/organizations/{orgId}/usage`
- ChatGPT: `/backend-api/conversation/init`, `/backend-api/wham/usage`, `/backend-api/wham/tasks/rate_limit`, and `/codex/settings/usage`

It can also observe page fetch responses for the same usage endpoints. Intercepted responses are normalized through the same parsers as active refreshes.

For ChatGPT Codex usage, if a direct request is unavailable from the current page, the extension may briefly load the same-origin Codex analytics route in a hidden iframe and observe the page's own usage response.

## Optional IP Risk Check

The IP risk panel is disabled by default. When enabled by the user, it:

- stores the proxycheck.io API key in `chrome.storage.local`;
- fetches the current public IP from `https://api64.ipify.org/?format=json`;
- queries `https://proxycheck.io/v2/{ip}` with `vpn=1` and `risk=1`;
- stores only the normalized risk result locally.

The extension does not store historical IP addresses.

## Security Boundaries

- Does not save cookies.
- Does not save platform tokens.
- Does not read Authorization headers.
- Does not read or save chat content.
- Does not include analytics or telemetry.
- Does not request `cookies`, `webRequest`, `tabs`, or `activeTab` permissions.
- Stores normalized snapshots, local estimate counters, optional proxycheck.io settings, and optional normalized IP risk state in `chrome.storage.local`.

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

The build output is written to `dist/`.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the generated `dist/` directory.

## Development

```bash
npm test
npm run build
```

This project uses TypeScript, Vite, and Vitest. There is no separate linter or formatter script, so follow the existing style in nearby files.

## Debug Logging

Debug logging is off by default. To enable it on a supported site:

```js
localStorage.setItem("aiUsageDebug", "1");
```

Disable it with:

```js
localStorage.removeItem("aiUsageDebug");
```

Raw endpoint responses are not persisted, even when debug logging is enabled.

## Manual Verification

1. Log in to Grok and open `https://grok.com`.
2. Confirm the widget appears, expands, collapses, drags, and refreshes.
3. Repeat on `https://claude.ai`.
4. Repeat on `https://chatgpt.com`.
5. Disconnect the network or force an endpoint failure and confirm the UI shows an unknown/error state without crashing.
6. Open an unrelated site and confirm no widget appears.

## Known Limits

- Supported platforms use internal web APIs that may change without notice.
- ChatGPT usage fields are expected to be the least stable.
- Claude and Grok usage response shapes may also change.
- Estimate mode only counts local send actions in the current browser and is not authoritative quota data.
- The extension is not designed for multiple accounts, team plans, enterprise plans, cross-device sync, or Chrome Web Store publication.
