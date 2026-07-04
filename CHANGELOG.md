# Changelog

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
