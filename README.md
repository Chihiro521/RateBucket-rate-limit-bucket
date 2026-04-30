# AI Usage Floating Monitor

Manifest V3 Chrome extension that injects a small floating usage widget into Grok, Claude, and ChatGPT pages. It is a personal-use MVP for viewing current usage and quota signals from platform usage/rate-limit endpoints.

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

The build output is written to `dist`.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `dist` directory.

## Supported Platforms

- `https://grok.com/*`
- `https://claude.ai/*`
- `https://chatgpt.com/*`

Other sites do not receive the content script.

## Data Sources

The extension uses allowlisted usage or rate-limit endpoints only:

- Grok: `/rest/rate-limits`
- Claude: `/api/organizations`, then `/api/organizations/{orgId}/usage`
- ChatGPT: `/backend-api/conversation/init`, `/backend-api/wham/usage`, `/backend-api/wham/tasks/rate_limit`, and `/codex/settings/usage`

It can also observe page fetch responses for the same usage endpoints. Intercepted responses go through the same normalizers as active refreshes.

## Security Boundaries

- Does not save cookies.
- Does not save tokens.
- Does not read Authorization headers.
- Does not read or save chat content.
- Does not upload data to any third-party service.
- Does not include telemetry.
- Does not request `cookies`, `webRequest`, `tabs`, or `activeTab` permissions.
- Stores only normalized snapshots and local estimate counters in `chrome.storage.local`.

## Known Limits

- These platforms use internal APIs that may change without notice.
- ChatGPT fields are expected to be the least stable.
- Codex usage is primarily parsed from `https://chatgpt.com/backend-api/wham/usage`, which can be requested from any `chatgpt.com/*` page with the current login session. The Codex analytics UI route `https://chatgpt.com/codex/cloud/settings/analytics#usage` is a same-origin page route, not treated as a JSON API.
- Codex usage is also attempted from `https://chatgpt.com/codex/settings/usage`; if that route returns HTML instead of JSON in a given session, it will be ignored as unavailable.
- Claude and Grok usage response shapes may also change.
- Estimate mode only counts local send actions in the current browser and is not accurate quota data.
- This extension is not designed for multiple accounts, team plans, enterprise plans, cross-device sync, or Chrome Web Store publication.

## Debug

Debug logging is off by default. To enable it on a supported site:

```js
localStorage.setItem("aiUsageDebug", "1")
```

Disable it with:

```js
localStorage.removeItem("aiUsageDebug")
```

Raw responses are not persisted, even in debug mode.

## Manual Test Steps

1. Log in to Grok, open `https://grok.com`, and confirm the widget appears.
2. Expand the widget and click refresh.
3. Repeat on `https://claude.ai`.
4. Repeat on `https://chatgpt.com`.
5. Disconnect the network or force an endpoint failure and confirm the UI shows unknown/error without crashing.
6. Open an unrelated site and confirm no widget appears.

## Development

```bash
npm test
npm run build
```
