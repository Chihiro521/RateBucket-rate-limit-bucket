# RateBucket

[English](README.md#user-content-readme-en) | [中文](README.md#user-content-readme-zh)

RateBucket is a local-first Chrome extension for checking AI usage and rate-limit signals on Grok, Claude, ChatGPT, Gemini, Kimi, Perplexity, and Muse. It injects a compact floating widget into supported sites so you can see quota windows, reset times, usage meters, and platform-specific limit signals without opening a separate dashboard.

[Website and interactive demo](https://chihiro521.github.io/RateBucket-rate-limit-bucket/) · This README is the project documentation.

This project is an independent personal-use tool. It is not affiliated with OpenAI, Anthropic, xAI, Google, Moonshot AI, Perplexity AI.

## Project Status

RateBucket can be installed from source, and Chrome Web Store submission/update materials are maintained under `chrome-webstore-archive/`.

The source version is v0.1.5. Download published packages from [GitHub Releases](https://github.com/Chihiro521/RateBucket-rate-limit-bucket/releases). See the [v0.1.5 announcement](docs/releases/v0.1.5.md) and [CHANGELOG.md](CHANGELOG.md) for updates.

Before each public Chrome Web Store release or update, review the store listing copy, hosted privacy policy, permissions, screenshots, and bundled visual assets so they match the current extension behavior.

## What It Does

- Shows a floating usage widget on supported AI web apps.
- Supports compact collapsed chips and expanded detail panels.
- Tracks Grok, Claude, ChatGPT, Gemini, Kimi, Perplexity, and Muse usage signals through platform-specific normalizers.
- Shows Grok credits as one combined weighted usage bucket, with Imagine, Chat, Grok Build, and API displayed as contribution segments.
- Merges compatible snapshots at the meter level, so ChatGPT data from multiple endpoints can appear together without keeping stale feature quota when a feature becomes blocked.
- Shows ChatGPT subscription expiry, input/attachment quotas, feature quotas, usage windows, and Codex-related windows when those signals are available.
- Rechecks ChatGPT quotas every 30 seconds while its tab is visible, and updates changed values without reloading the page.
- Keeps short-lived local cache and backoff state to avoid noisy refresh loops.
- Provides local estimate counters on other platforms; ChatGPT and Muse use server quota readings.
- Supports English and Simplified Chinese UI, with browser-language auto detection and manual language selection.

## Supported Platforms

| Platform | Supported URLs | Main Data Sources |
| --- | --- | --- |
| Grok | `https://grok.com/*` | `grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig` gRPC-web credits config |
| Claude | `https://claude.ai/*` | `/api/organizations`, `/api/organizations/{orgId}/usage` |
| ChatGPT | `https://chatgpt.com/*` | `/backend-api/conversation/init`, `/backend-api/wham/usage`, `/backend-api/files/library/storage/usage`, observed `/backend-api/accounts/check/...` responses |
| Gemini | `https://gemini.google.com/*` | `jSf9Qc` RPC inside `/_/BardChatUi/data/batchexecute` |
| Kimi | `https://www.kimi.com/*` | `/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription` |
| Perplexity | `https://perplexity.ai/*`, `https://www.perplexity.ai/*` | `/rest/rate-limit/all` |
| Muse | `https://muse.ai/*` | `fetchSubscriptionAction` via same-origin `POST /` (Next.js server action) |

The extension can also observe same-page fetch responses for allowlisted usage endpoints. Those intercepted responses go through the same normalizers as active refreshes.
Active ChatGPT requests share the current web session lookup in page memory for up to 60 seconds; RateBucket does not persist the token or an Authorization header. The old hidden Codex analytics iframe is no longer used.

## Browser Compatibility

RateBucket has currently only been tested on Chrome/Chromium-based desktop browsers.

Known working target:

- Google Chrome / Chromium-compatible desktop builds

Other Chromium-based browsers may work, but have not been systematically tested. Firefox, Safari, and mobile browsers are not officially supported.

## How It Works

RateBucket is built as a Manifest V3 extension:

- `content.js` runs on supported sites and owns the floating UI.
- `mainWorldBridge.js` runs in the page's main world so platform fetch behavior can be observed when needed.
- `serviceWorker.js` handles injection support and one-time retired-feature cache cleanup.
- Platform parsers normalize raw endpoint shapes into shared usage snapshots.
- Grok credits are decoded from a gRPC-web protobuf response and normalized locally into weighted usage meters.
- `chrome.storage.local` stores normalized snapshots, local estimate counters, retry state, language preference.

No project-owned backend is used.

## Muse quota updates

Muse shows the weekly plan's used/remaining percentage and reset countdown, plus additional usage with the official token balance text and “Never expires”. Every refresh uses the returned balance, total, and official text; the extra token balance is not fixed, and its internal numeric unit is not converted into tokens. Official plan and balance text follows the Muse page language; widget controls follow RateBucket's language setting.

On first load, RateBucket checks the current login before displaying cached Muse readings. Visible Muse tabs query once per minute, pause polling while hidden, and check freshness when visible again. Manual refresh is also available. Temporary failures keep the previous readings and query time with an explicit notice; authentication failures clear the Muse readings and cache.

The page bridge discovers the current `fetchSubscriptionAction` reference from Muse's loaded, same-origin scripts, prioritizing later application chunks and scanning at most four at once using the browser cache. Workers continue independently, and discovery stops immediately and cancels remaining scans when a reference is found, so unrelated slow scripts cannot block it. It caches the reference in page memory and rediscovers it once if the server rejects an outdated action ID. Discovery and the quota request share a ten-second timeout; errors distinguish discovery, request, and response-reading stages. Passive observation matches only the discovered quota action and returns Muse's original response without consuming its stream. Only normalized quota fields are retained.

## Download A GitHub Release

The current extension package is published as a GitHub Release asset:

- [Latest RateBucket release](https://github.com/Chihiro521/RateBucket-rate-limit-bucket/releases/latest)

Download the zip asset from the release page, unzip it, and load the extracted extension directory through `chrome://extensions` with Developer mode enabled.

## Visual Design

The current UI uses a compact botanical green/gold visual theme with decorative PNG assets. For Chrome Web Store publication or standalone asset reuse, make sure the visual assets have clear ownership or replace them with original project branding.

## Third-Party IP Notice

RateBucket is an independent project and is not affiliated with, endorsed by, sponsored by, or approved by miHoYo, HoYoverse, Cognosphere, or any related rights holder. All trademarks, character references, copyrights, and visual IP belong to their respective owners.

If you are a rights holder and believe any bundled visual asset, naming, or presentation in this repository infringes your rights, please open a GitHub issue or contact `1139524867@qq.com`. I will review the request and remove or replace the disputed material promptly.

## Install From Source

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run build
```

Load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `dist/` directory.

## Development

Daily development takes place on `dev`. Merge validated changes into `master`. Published versions are preserved as Git tags and GitHub Releases.

Edit `README.en.md` or `README.zh-CN.md`, then run `npm run docs:build` to update the bilingual repository README.

Run tests:

```bash
npm test
```

Build production files:

```bash
npm run build
```

The repository uses TypeScript, Vite, and Vitest. There is no separate formatter or linter command, so keep edits consistent with nearby code.

## Repository Layout

```text
src/background/   Extension service worker
src/content/      Floating widget, styles, bridge client, estimators, probes
src/injected/     Main-world bridge code
src/platforms/    Platform detection, endpoint logic, normalizers, merge types
src/storage/      chrome.storage.local helpers
src/utils/        Shared utilities
tests/            Vitest unit tests
scripts/          Build scripts
dist/             Generated extension output
```

`dist/` is generated by `npm run build`.

## Privacy And Security Boundaries

RateBucket is designed to stay local where possible:

- It does not save cookies.
- It does not save platform tokens.
- It does not read Authorization headers.
- Image notices transiently inspect final replies in page memory and retain only the notice type, provenance and cooldown; chat content and raw message streams are not stored.
- It does not include analytics or telemetry.
- It does not request `cookies`, `webRequest`, `tabs`, or `activeTab` permissions.
- It stores only normalized usage data, local counters, retry metadata, language preference in `chrome.storage.local`.

Same-site requests may use the browser's existing login session for that website, but RateBucket does not read or store cookie values.

The extension requests host access only for Grok, Claude, ChatGPT, Gemini, Kimi, Perplexity, and Muse.

## ChatGPT quota updates

ChatGPT uses conversation/init, wham/usage, and library storage usage. The visible page checks every 30 seconds and also accepts observed quota responses. Requests run independently; failures do not reset the age of successful readings. File capacity uses GiB; optional Credits and reset opportunities are not ordinary plan quotas. Image quota remains visible as an uncalibrated reading, not a verified live image balance. No seven-day image statistics are collected.

When a final assistant reply to a current-page request reports a daily image limit, the existing Image Generation row shows “Limit reached” and a local estimated recovery time derived from the reply. Missing times remain unknown. Subsequent uncalibrated readings of 120 cannot override the limit. At the estimated time the row changes to “Recovery unconfirmed”; a later actual image result clears it, while another daily-limit report updates the time. Timed limits last at most 24 hours; those without a time become unconfirmed after 30 minutes. Assistant provenance is labelled and is not a calibrated server quota. This feature only observes current-page requests and related responses; it does not generate images, retry requests or fetch historical chats.

Subscription expiry is retained within the same account scope, independently of the 30-minute quota TTL. Its local countdown updates every second, catches up when the tab becomes visible, and is recalibrated only when a new subscription response arrives.

Normalized ChatGPT readings are cached under a hashed user/account scope. Authentication remains in page memory for up to 60 seconds. Old IP-check settings and unscoped ChatGPT caches are removed once on upgrade. The original theme and mascot remain; UI updates preserve scrolling, focus and dragging.

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

## Chrome Web Store Status

RateBucket can be distributed from source or packaged for Chrome Web Store updates. Store-facing materials live in `chrome-webstore-archive/`.

Before submission or update, review:

- extension icons, including a 128x128 PNG icon;
- store screenshots and promotional images;
- a hosted privacy policy that matches the extension's actual behavior;
- clear permission explanations for `storage`, `scripting`, and host permissions;
- final listing copy that describes the extension's single purpose;
- visual assets with clear ownership or licensing.

Until then, use the source installation flow above.

## Known Limits

- Supported platforms use internal or site-owned web APIs that may change without notice.
- ChatGPT usage fields are expected to be the least stable. Some ChatGPT feature quota values can only be observed from page fetch responses and may remain marked as captured/cache data when active refresh endpoints return `401`.
- ChatGPT blocked feature responses replace the matching feature quota meter so disabled features do not keep a stale positive remaining count.
- Grok currently uses the new credits config gRPC-web endpoint. The old `/rest/rate-limits` path is no longer treated as authoritative.
- Gemini uses a Google Web internal batchexecute RPC, so fields and token sources may change with the page implementation.
- Perplexity's rate-limit endpoint does not currently provide authoritative weekly caps or reset timestamps.
- Claude and Grok response shapes may also change.
- Estimate mode only counts local actions in the current browser and is not authoritative quota data.
- The extension is not designed for multiple accounts, team plans, enterprise plans, or cross-device sync.

## License

RateBucket is released under the MIT License. See [LICENSE](LICENSE).

The bundled visual assets are part of the current project package. Before publishing to the Chrome Web Store or reusing those assets separately, confirm their ownership/licensing or replace them with fully original branding assets.

## Acknowledgements

A small nod to my informal teachers and collaborators:

- Claude, the resident philosopher.
- [Codex](https://github.com/codex), the coding collaborator for implementation, testing, and release maintenance.
- GPT, the most pragmatic pair-programming partner.
- Grok, the back-channel rumor desk.
- Gemini, the occasional spark of inspiration, even when mostly cameoing.
- Kimi, the diligent note-taker who keeps the quota in check.
- Perplexity, the research scout now reporting its own bucket.

This project was built by a human, with plenty of conversations along the way.
