# Changelog

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
