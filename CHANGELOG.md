# Changelog

## v0.1.4

Prepared on 2026-10-02 for synchronized Chrome Web Store and GitHub publication.

### Changed

- Refresh ChatGPT quota endpoints independently every 30 seconds while visible, with concurrent partial updates, request deduplication and per-endpoint backoff.
- Add library capacity and available reset opportunities; keep image quota explicitly uncalibrated without adding historical image statistics.
- Preserve the original UI theme and mascot while keeping scroll, focus, language selection and drag nodes stable during updates.
- Remove IP detection and PoW/account-status heuristics, including their listeners, storage and third-party host access.
- Isolate cached quota by confirmed account scope and remove retired records on upgrade.

### Fixed

- Read explicit percent fields as percentage points rather than guessing ratios.
- Anchor relative resets at response reception and preserve per-meter timestamps through failures.
- Prioritize explicit blocking and prevent optional zero balances from implying plan exhaustion.
- Filter ChatPass sublimits without changing ordinary five-hour or weekly windows.
- Fit narrow/short viewports, including pages with scrollbars.

### Validation

- `npm test`: 102 tests in 16 files passed.
- `npm run build`: TypeScript and extension builds passed.
- Local browser UI fixture checks completed; no real-account generation requests were sent during validation.

## v0.1.3

Released on GitHub as `v0.1.3`.

Release page:

- https://github.com/Chihiro521/RateBucket-rate-limit-bucket/releases/tag/v0.1.3

### Release

- Publish the live ChatGPT/Codex quota refresh already released on GitHub as `v0.1.2` to the Chrome Web Store under version `0.1.3`.
- Runtime behavior is unchanged from GitHub `v0.1.2`; the manifest/package version is incremented so the Chrome Web Store accepts the update.
- Use the same root-manifest ZIP for the Chrome Web Store package and the GitHub Release asset.

## v0.1.2

Released on GitHub as `v0.1.2`.

Release page:

- https://github.com/Chihiro521/RateBucket-rate-limit-bucket/releases/tag/v0.1.2

### Changed

- Recheck ChatGPT feature and Codex quotas about once a minute while a ChatGPT tab is visible, without reloading the page.
- Read Codex limits from the verified `/backend-api/codex/usage` endpoint, with `/backend-api/wham/usage` as a fallback.
- Show the last successful quota check separately from the last value change.

### Fixed

- Removed the hidden Codex analytics iframe probe and obsolete `/codex/settings/usage` JSON parsing.
- Use the current ChatGPT web session only for the active request; no access token or Authorization header is persisted.
- Avoid stale responses overwriting newer quota readings and back off after failed requests.

### Validation

- `npm test` (70 tests passed)
- `npm run build`
- Verified in Comet that a timed Codex request returned HTTP 200 and the displayed five-hour and weekly remaining percentages matched the response.

## v0.1.1-chatgpt-usage

Released on GitHub as `v0.1.1-chatgpt-usage`.

Release page:

- https://github.com/Chihiro521/RateBucket-rate-limit-bucket/releases/tag/v0.1.1-chatgpt-usage

### Changed

- Added ChatGPT subscription expiry parsing from observed accounts-check responses.
- Improved ChatGPT reset-time formatting with two-unit previews such as `23h 59m` and `6d 23h`.
- Added explicit ChatGPT feature labels for deep research, image generation, Odyssey, and computer-use style features.
- Grouped GPT-5.3 Codex Spark additional rate-limit windows under the Codex section.
- Removed the ChatGPT half-collapsed panel state and kept the full panel or hidden restore chip behavior.

### Fixed

- Treated `limits_progress.reset_after` as either an absolute timestamp or relative seconds based on its actual shape.
- Normalized `blocked_features` object responses into zero-remaining feature meters.
- Reused the canonical feature meter key for blocked ChatGPT features, so disabled features replace stale positive quota during snapshot merge.
- Avoided actively polling the ChatGPT accounts-check endpoint during refresh because it can return `401` outside page-owned request flows.

### Validation

- `npm test`
- `npm run build`

## v0.1.1-grok-4ac56a6

Released on GitHub as `v0.1.1-grok-4ac56a6`.

Release page:

- https://github.com/Chihiro521/RateBucket-rate-limit-bucket/releases/tag/v0.1.1-grok-4ac56a6

### Changed

- Migrated Grok usage collection from the retired `/rest/rate-limits` flow to `grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig`.
- Added gRPC-web protobuf decoding for the Grok credits config response.
- Changed Grok display semantics from independent remaining-limit meters to one combined weekly Grok usage bucket.
- Rendered Imagine, Chat, Grok Build, and API as weighted contribution segments inside the Grok total usage bar.
- Renamed the Grok total label from `SuperGrok limit` to `Grok limit`.
- Rebuilt `dist/` for the Chrome extension package.

### Fixed

- Prevented Grok `1%` product usage values from being normalized as `100%`.
- Mapped Grok product enum values `1` and `2` to `Grok Build` and `API`.

### Validation

- `npm run build`
