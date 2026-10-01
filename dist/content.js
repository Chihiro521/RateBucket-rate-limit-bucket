(function() {
  "use strict";
  const STALE_METER_MS = 2 * 6e4;
  function isChatPassPath(path) {
    return path.split(/[.:]/).some((part) => part.replaceAll("_", "").toLowerCase().startsWith("chatpass"));
  }
  function hasMeaningfulValue(meter) {
    return meter.quotaState === "blocked" || meter.quotaState === "unknown" || meter.metricKind === "subscription" || meter.rawKind === "chatgpt.subscription" || [meter.remaining, meter.total, meter.used, meter.remainingPercent, meter.usedPercent].some((value) => typeof value === "number" && Number.isFinite(value)) || meter.label === "Credits (unlimited)";
  }
  function isAlertMeter(meter) {
    if (meter.metricKind === "balance" || meter.metricKind === "subscription" || meter.rawKind === "credits" || meter.rawKind === "chatgpt.subscription" || meter.source === "estimate") {
      return false;
    }
    if (meter.quotaState === "blocked") return true;
    if (meter.quotaState === "unknown") return false;
    return typeof meter.remaining === "number" && meter.remaining <= 0 || typeof meter.remainingPercent === "number" && meter.remainingPercent <= 5 || typeof meter.usedPercent === "number" && meter.usedPercent >= 95;
  }
  function meterProgress(meter) {
    if (meter.metricKind === "balance" || meter.metricKind === "subscription" || meter.rawKind === "credits" || meter.rawKind === "chatgpt.subscription") return null;
    const clamp2 = (value) => Math.max(0, Math.min(100, value));
    if (typeof meter.remainingPercent === "number") return clamp2(meter.remainingPercent);
    if (typeof meter.usedPercent === "number") return clamp2(meter.usedPercent);
    if (typeof meter.total === "number" && meter.total > 0) {
      if (typeof meter.used === "number") return clamp2(meter.used / meter.total * 100);
      if (typeof meter.remaining === "number") return clamp2((meter.total - meter.remaining) / meter.total * 100);
    }
    return null;
  }
  function chatGptPrimaryMeter(meters) {
    const quotas = meters.filter((meter) => hasMeaningfulValue(meter) && !isChatPassPath(meter.key) && meter.metricKind !== "balance" && meter.metricKind !== "subscription" && meter.unit !== "bytes" && meter.rawKind !== "credits" && meter.rawKind !== "chatgpt.subscription" && meter.source !== "estimate");
    return quotas.find((meter) => meter.quotaState === "blocked") ?? quotas.find((meter) => meter.key === "wham:primary_window") ?? quotas.find((meter) => meter.key === "wham:secondary_window") ?? quotas.find((meter) => meter.quotaState !== "unknown") ?? quotas[0];
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function asRecord(value) {
    return isRecord(value) ? value : null;
  }
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }
  function asString(value) {
    return typeof value === "string" ? value : null;
  }
  function asNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  function asBoolean(value) {
    return typeof value === "boolean" ? value : null;
  }
  function getRecord(record, key2) {
    return asRecord(record[key2]);
  }
  function getArray(record, key2) {
    return asArray(record[key2]);
  }
  function getNumber(record, key2) {
    return asNumber(record[key2]);
  }
  function getString(record, key2) {
    return asString(record[key2]);
  }
  function percentFromRatioOrPercent(value) {
    if (value === null) {
      return null;
    }
    const percent = value >= 0 && value <= 1 ? value * 100 : value;
    return Math.max(0, Math.min(100, percent));
  }
  function titleFromKey(key2) {
    return key2.replace(/[_-]+/g, " ").trim().replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1));
  }
  const FEATURE_LABELS$1 = {
    deep_research: "Deep Research",
    image_gen: "Image Generation",
    computer_control: "Computer Control",
    computer_use: "Computer Use",
    computer_use_preview: "Computer Use",
    file_upload: "File Upload",
    odyssey: "Odyssey",
    reason: "Reasoning Quota"
  };
  function explicitPercent(value) {
    return value === null ? null : Math.max(0, Math.min(100, value));
  }
  function normalizeChatGptConversationInit(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return { meters: [], blockedFeatures: [] };
    }
    const meters = [];
    for (const item of getArray(root, "limits_progress")) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const featureName = getString(record, "feature_name") ?? "unknown_feature";
      const remaining = getNumber(record, "remaining");
      const resetAfter = resetAfterValue(record.reset_after);
      const resetAt = resetAfter.resetAt ?? resetValueFromRecord(record);
      meters.push({
        key: `limits_progress:${featureName}`,
        label: FEATURE_LABELS$1[featureName] ?? titleFromKey(featureName),
        remaining,
        resetAt,
        resetAfterSeconds: resetAfter.resetAfterSeconds,
        source,
        metricKind: "quota",
        unit: "count",
        quotaState: featureName === "image_gen" ? "unknown" : void 0,
        confidence: featureName === "image_gen" ? "low" : remaining !== null && (resetAt !== null || resetAfter.resetAfterSeconds !== null) ? "high" : "medium",
        rawKind: "limits_progress"
      });
    }
    const defaultModelSlug = getString(root, "default_model_slug") ?? void 0;
    const blocked = normalizeBlockedFeatures(root, source);
    for (const meter of blocked.meters) {
      const index = meters.findIndex((item) => item.key === meter.key);
      if (index >= 0) meters[index] = meter;
      else meters.push(meter);
    }
    return { meters, defaultModelSlug, blockedFeatures: blocked.names };
  }
  function normalizeBlockedFeatures(root, source) {
    const meters = [];
    const names = [];
    for (const item of asArray(root.blocked_features)) {
      if (typeof item === "string") {
        names.push(item);
        meters.push({ key: `limits_progress:${item}`, label: FEATURE_LABELS$1[item] ?? titleFromKey(item), source, confidence: "high", metricKind: "quota", unit: "count", quotaState: "blocked", rawKind: "blocked_features" });
        continue;
      }
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const featureName = getString(record, "name") ?? getString(record, "feature_name") ?? getString(record, "feature");
      if (!featureName) {
        continue;
      }
      names.push(featureName);
      const resetAfter = resetAfterValue(record.reset_after ?? record.resets_after);
      const resetAt = resetAfter.resetAt ?? resetValueFromRecord(record);
      const rawTotal = getNumber(record, "limit");
      meters.push({
        key: `limits_progress:${featureName}`,
        label: FEATURE_LABELS$1[featureName] ?? titleFromKey(featureName),
        remaining: getNumber(record, "remaining"),
        metricKind: "quota",
        unit: "count",
        quotaState: "blocked",
        total: rawTotal !== null && rawTotal > 0 ? rawTotal : null,
        resetAt,
        resetAfterSeconds: resetAfter.resetAfterSeconds,
        source,
        confidence: resetAt !== null || resetAfter.resetAfterSeconds !== null ? "high" : "medium",
        rawKind: "blocked_features"
      });
    }
    return { meters, names };
  }
  function normalizeWindowMeter(args) {
    const explicitRemainingPercent = explicitPercent(
      numberFromKeys(args.record, [
        "remaining_percent",
        "remainingPercent",
        "percent_remaining",
        "percentRemaining",
        "remaining_percentage",
        "remainingPercentage",
        "remaining_pct",
        "remainingPct"
      ])
    );
    const rawUsedPercent = explicitPercent(
      numberFromKeys(args.record, [
        "used_percent",
        "usedPercent",
        "used_percentage",
        "usedPercentage",
        "percent_used",
        "percentUsed"
      ])
    );
    const remainingPercent = explicitRemainingPercent ?? (args.displayAsRemaining && rawUsedPercent !== null ? explicitPercent(100 - rawUsedPercent) : null);
    const usedPercent = rawUsedPercent ?? (remainingPercent !== null ? explicitPercent(100 - remainingPercent) : null);
    const resetValue = resetValueFromRecord(args.record);
    const windowSeconds = numberFromKeys(args.record, [
      "limit_window_seconds",
      "limitWindowSeconds",
      "window_seconds",
      "windowSeconds",
      "window_size_seconds",
      "windowSizeSeconds"
    ]);
    if (usedPercent === null && remainingPercent === null && resetValue === null && windowSeconds === null) {
      return null;
    }
    return {
      key: args.key,
      label: args.label,
      usedPercent,
      remainingPercent,
      resetAt: resetValue,
      windowSeconds,
      source: args.source,
      confidence: usedPercent !== null && resetValue !== null ? "high" : "medium",
      metricKind: "quota",
      unit: "percent",
      rawKind: args.rawKind
    };
  }
  function normalizeChatGptWhamUsage(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return [];
    }
    const meters = [];
    const rateLimit = getRecord(root, "rate_limit");
    if (rateLimit) {
      const primary = getRecord(rateLimit, "primary_window");
      if (primary) {
        const meter = normalizeWindowMeter({
          key: "wham:primary_window",
          label: codexWindowLabel(primary, "Primary window"),
          record: primary,
          source,
          rawKind: "rate_limit.primary_window",
          displayAsRemaining: true
        });
        if (meter) {
          meters.push(meter);
        }
      }
      const secondary = getRecord(rateLimit, "secondary_window");
      if (secondary) {
        const meter = normalizeWindowMeter({
          key: "wham:secondary_window",
          label: codexWindowLabel(secondary, "Secondary window"),
          record: secondary,
          source,
          rawKind: "rate_limit.secondary_window",
          displayAsRemaining: true
        });
        if (meter) {
          meters.push(meter);
        }
      }
    }
    const codeReviewRateLimit = getRecord(root, "code_review_rate_limit");
    const codeReviewPrimary = codeReviewRateLimit ? getRecord(codeReviewRateLimit, "primary_window") : null;
    if (codeReviewPrimary) {
      const meter = normalizeWindowMeter({
        key: "wham:code_review",
        label: "Code Review",
        record: codeReviewPrimary,
        source,
        rawKind: "code_review_rate_limit.primary_window",
        displayAsRemaining: true
      });
      if (meter) {
        meters.push(meter);
      }
    }
    const credits = getRecord(root, "credits");
    if (credits) {
      const unlimited = asBoolean(credits.unlimited);
      const balance = getNumber(credits, "balance");
      if (unlimited !== null || balance !== null || asBoolean(credits.has_credits) !== null) {
        meters.push({
          key: "wham:credits",
          label: unlimited ? "Credits (unlimited)" : "Credits",
          remaining: balance,
          source,
          confidence: balance !== null || unlimited === true ? "medium" : "low",
          metricKind: "balance",
          unit: "credits",
          rawKind: "credits"
        });
      }
    }
    const resets = getRecord(root, "rate_limit_reset_credits");
    const available = resets ? getNumber(resets, "available_count") : null;
    if (available !== null && available >= 0 && Number.isInteger(available)) {
      meters.push({ key: "wham:resetCredits", label: "Available resets", remaining: available, source, confidence: "high", metricKind: "balance", unit: "count", rawKind: "chatgpt.reset_credits" });
    }
    meters.push(...normalizeAdditionalWhamUsageWindows(root, source));
    meters.push(...normalizeWhamCodexNamedUsage(root, source));
    return dedupeMeters(meters);
  }
  function normalizeAdditionalWhamUsageWindows(root, source) {
    const knownPaths = /* @__PURE__ */ new Set([
      "root.rate_limit.primary_window",
      "root.rate_limit.secondary_window",
      "root.code_review_rate_limit.primary_window",
      "root.credits"
    ]);
    return collectUsageCandidates(root, "root", {
      maxDepth: 7,
      includeRecord: (path, record) => !knownPaths.has(path) && isGeneralChatGptUsageLike(path, record)
    }).map((candidate) => {
      const additionalLabel = codexAdditionalRateLimitLabel(
        candidate.path,
        candidate.record
      );
      return normalizeGenericUsageObject(candidate.path, candidate.record, source, {
        keyPrefix: additionalLabel ? "codex" : "wham",
        rawKind: additionalLabel ? "codex.additional_rate_limit" : "chatgpt.usage.window",
        displayAsRemaining: true,
        label: additionalLabel ?? void 0
      });
    }).filter((meter) => meter !== null);
  }
  function normalizeWhamCodexNamedUsage(root, source) {
    const codexRoots = collectCodexNamedSubtrees(root);
    const meters = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of codexRoots) {
      for (const meter of normalizeCodexUsageRecordTree(
        item.record,
        `wham.${item.path}`,
        source
      )) {
        if (seen.has(meter.key)) {
          continue;
        }
        seen.add(meter.key);
        meters.push(meter);
      }
    }
    return meters;
  }
  function collectCodexNamedSubtrees(root) {
    const queue = [
      { path: "root", value: root, depth: 0 }
    ];
    const matches = [];
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || item.depth > 4) {
        continue;
      }
      const record = asRecord(item.value);
      if (!record) {
        continue;
      }
      for (const [key2, value] of Object.entries(record)) {
        const path = `${item.path}.${key2}`;
        if (isChatPassPath(path)) continue;
        const childRecord = asRecord(value);
        if (childRecord) {
          if (isCodexPath(path)) {
            matches.push({ path, record: childRecord });
          }
          queue.push({ path, value, depth: item.depth + 1 });
        } else if (Array.isArray(value)) {
          value.forEach((entry, index) => {
            queue.push({
              path: `${path}.${index}`,
              value: entry,
              depth: item.depth + 1
            });
          });
        }
      }
    }
    return matches;
  }
  function isCodexPath(path) {
    const normalized = path.toLowerCase();
    return normalized.includes("codex") && !normalized.includes("code_review");
  }
  function normalizeTasksRateLimit(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return [];
    }
    const meters = [];
    const direct = normalizeWindowMeter({
      key: "tasks:rate_limit",
      label: "Tasks rate limit",
      record: root,
      source,
      rawKind: "tasks.rate_limit"
    });
    if (direct) {
      meters.push(direct);
    }
    return meters;
  }
  function normalizeChatGptAccountsCheck(json, source = "api") {
    const root = asRecord(json);
    const accounts = root ? getRecord(root, "accounts") : null;
    if (!accounts) {
      return [];
    }
    const account = accountCheckRecord(accounts);
    const entitlement = account ? getRecord(account, "entitlement") : null;
    if (!entitlement) {
      return [];
    }
    const expiresAt = getString(entitlement, "expires_at");
    const renewsAt = getString(entitlement, "renews_at");
    const hasActiveSubscription = asBoolean(entitlement.has_active_subscription);
    const subscriptionPlan = getString(entitlement, "subscription_plan");
    const resetAt = expiresAt ?? renewsAt;
    if (!resetAt && hasActiveSubscription === null && !subscriptionPlan) {
      return [];
    }
    return [
      {
        key: "chatgpt:subscription",
        label: "ChatGPT subscription",
        requestKind: expiresAt ? "expires" : renewsAt ? "renews" : void 0,
        modelName: subscriptionPlan ?? void 0,
        resetAt,
        source,
        confidence: resetAt ? "high" : "medium",
        metricKind: "subscription",
        rawKind: "chatgpt.subscription"
      }
    ];
  }
  function accountCheckRecord(accounts) {
    const defaultAccount = getRecord(accounts, "default");
    if (defaultAccount) {
      return defaultAccount;
    }
    for (const value of Object.values(accounts)) {
      const record = asRecord(value);
      if (record) {
        return record;
      }
    }
    return null;
  }
  function normalizeCodexUsageRecordTree(root, rootPath, source) {
    const candidates = collectCodexUsageCandidates(root, rootPath);
    const meters = [];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      const meter = normalizeCodexUsageObject(candidate.path, candidate.record, source);
      if (!meter || seen.has(meter.key)) {
        continue;
      }
      seen.add(meter.key);
      meters.push(meter);
    }
    return meters;
  }
  function collectCodexUsageCandidates(root, rootPath) {
    return collectUsageCandidates(root, rootPath, {
      maxDepth: 7,
      includeRecord: (_path, record) => isCodexUsageLike(record)
    });
  }
  function isCodexUsageLike(record) {
    return numberFromKeys(record, ["remaining", "remaining_credits", "remainingCredits"]) !== null || numberFromKeys(record, ["total", "limit", "quota", "total_credits", "totalCredits"]) !== null || numberFromKeys(record, ["used", "usage", "used_credits", "usedCredits"]) !== null || numberFromKeys(record, ["used_percent", "usedPercent", "utilization"]) !== null || numberFromKeys(record, [
      "remaining_percent",
      "remainingPercent",
      "percent_remaining",
      "percentRemaining",
      "remaining_percentage",
      "remainingPercentage"
    ]) !== null || numberFromKeys(record, ["reset_after", "resetAfter", "reset_after_seconds"]) !== null || stringOrNumberFromKeys(record, ["reset_at", "resetAt", "resets_at"]) !== null;
  }
  function isGeneralChatGptUsageLike(path, record) {
    if (isCodexPath(path)) {
      return false;
    }
    if (!isCodexUsageLike(record)) {
      return false;
    }
    const normalizedPath = path.toLowerCase();
    const label = usageLabel(record, path).toLowerCase();
    const hasUsageNameSignal = normalizedPath.includes("limit") || normalizedPath.includes("window") || normalizedPath.includes("usage") || normalizedPath.includes("quota") || normalizedPath.includes("bucket") || label.includes("limit") || label.includes("window") || label.includes("usage") || label.includes("额度") || label.includes("使用限额");
    const hasCountQuotaSignal = numberFromKeys(record, ["remaining", "remaining_credits", "remainingCredits"]) !== null && numberFromKeys(record, [
      "total",
      "limit",
      "quota",
      "total_credits",
      "totalCredits"
    ]) !== null;
    const hasCurrentWindowSignal = hasCountQuotaSignal || numberFromKeys(record, [
      "remaining_percent",
      "remainingPercent",
      "percent_remaining",
      "percentRemaining",
      "remaining_percentage",
      "remainingPercentage",
      "remaining_pct",
      "remainingPct",
      "used_percent",
      "usedPercent",
      "used_percentage",
      "usedPercentage",
      "percent_used",
      "percentUsed"
    ]) !== null || resetValueFromRecord(record) !== null || numberFromKeys(record, [
      "reset_after",
      "resetAfter",
      "reset_after_seconds",
      "limit_window_seconds",
      "limitWindowSeconds",
      "window_seconds",
      "windowSeconds",
      "window_size_seconds",
      "windowSizeSeconds"
    ]) !== null;
    return hasUsageNameSignal && hasCurrentWindowSignal;
  }
  function normalizeCodexUsageObject(path, record, source) {
    return normalizeGenericUsageObject(path, record, source, {
      keyPrefix: "codex",
      rawKind: "codex.settings.usage",
      displayAsRemaining: true
    });
  }
  function normalizeGenericUsageObject(path, record, source, options) {
    const remaining = numberFromKeys(record, [
      "remaining",
      "remaining_credits",
      "remainingCredits"
    ]);
    const total = numberFromKeys(record, [
      "total",
      "limit",
      "quota",
      "total_credits",
      "totalCredits"
    ]);
    const used = numberFromKeys(record, ["used", "usage", "used_credits", "usedCredits"]) ?? (remaining !== null && total !== null ? Math.max(0, total - remaining) : null);
    const explicitRemainingPercent = explicitPercent(
      numberFromKeys(record, [
        "remaining_percent",
        "remainingPercent",
        "percent_remaining",
        "percentRemaining",
        "remaining_percentage",
        "remainingPercentage",
        "remaining_pct",
        "remainingPct"
      ])
    );
    const rawUsedPercent = explicitPercent(
      numberFromKeys(record, [
        "used_percent",
        "usedPercent",
        "used_percentage",
        "usedPercentage",
        "percent_used",
        "percentUsed"
      ])
    );
    const remainingPercent = explicitRemainingPercent ?? (options.displayAsRemaining && rawUsedPercent !== null ? explicitPercent(100 - rawUsedPercent) : null);
    const usedPercent = rawUsedPercent ?? (remainingPercent !== null ? explicitPercent(100 - remainingPercent) : null);
    const resetAt = resetValueFromRecord(record);
    const resetAfterSeconds = numberFromKeys(record, [
      "reset_after",
      "resetAfter",
      "reset_after_seconds"
    ]);
    const windowSeconds = numberFromKeys(record, [
      "limit_window_seconds",
      "limitWindowSeconds",
      "window_seconds",
      "windowSeconds",
      "window_size_seconds",
      "windowSizeSeconds"
    ]);
    const label = options.label ?? usageLabel(record, path);
    if (remaining === null && total === null && used === null && usedPercent === null && remainingPercent === null && resetAt === null && resetAfterSeconds === null && windowSeconds === null) {
      return null;
    }
    return {
      key: `${options.keyPrefix}:${path}`,
      label,
      remaining,
      total,
      used,
      usedPercent: usedPercent ?? (used !== null && total !== null && total > 0 ? percentFromRatioOrPercent(used / total) : null),
      remainingPercent: remainingPercent ?? (remaining !== null && total !== null && total > 0 ? percentFromRatioOrPercent(remaining / total) : null),
      resetAt,
      resetAfterSeconds,
      windowSeconds,
      source,
      confidence: remaining !== null || total !== null || usedPercent !== null || remainingPercent !== null ? "medium" : "low",
      rawKind: options.rawKind
    };
  }
  function codexWindowLabel(record, fallback) {
    const duration = numberFromKeys(record, [
      "limit_window_seconds",
      "limitWindowSeconds",
      "window_seconds",
      "windowSeconds"
    ]);
    if (duration === 18e3) {
      return "5-hour window";
    }
    if (duration === 604800) {
      return "Weekly window";
    }
    return fallback;
  }
  function codexAdditionalRateLimitLabel(path, record) {
    const normalized = path.toLowerCase();
    if (!normalized.includes("additional_rate_limits")) {
      return null;
    }
    const name = getString(record, "model_name") ?? getString(record, "model_slug") ?? "Additional";
    if (normalized.endsWith(".primary_window")) {
      return `${name} Primary window`;
    }
    if (normalized.endsWith(".secondary_window")) {
      return `${name} Weekly window`;
    }
    return `${name} usage limit`;
  }
  function collectUsageCandidates(root, rootPath, options) {
    const queue = [
      { path: rootPath, value: root, depth: 0 }
    ];
    const candidates = [];
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || item.depth > options.maxDepth) {
        continue;
      }
      if (isChatPassPath(item.path)) continue;
      const record = asRecord(item.value);
      if (!record) {
        continue;
      }
      if (options.includeRecord(item.path, record)) {
        candidates.push({ path: item.path, record });
      }
      for (const [key2, value] of Object.entries(record)) {
        if (Array.isArray(value)) {
          value.forEach((entry, index) => {
            queue.push({
              path: `${item.path}.${key2}.${index}`,
              value: entry,
              depth: item.depth + 1
            });
          });
        } else if (asRecord(value)) {
          queue.push({
            path: `${item.path}.${key2}`,
            value,
            depth: item.depth + 1
          });
        }
      }
    }
    return candidates;
  }
  function usageLabel(record, path) {
    const direct = getString(record, "label") ?? getString(record, "title") ?? getString(record, "name") ?? getString(record, "display_name") ?? getString(record, "displayName") ?? getString(record, "feature_name") ?? getString(record, "bucket_name") ?? getString(record, "bucketName") ?? getString(record, "limit_name") ?? getString(record, "limitName");
    if (direct) {
      const titled = displayUsageLabel(direct);
      if (path.toLowerCase().includes("codex") && isSimpleUsageKey(direct) && !/codex|gpt/i.test(titled)) {
        return `Codex ${titled}`;
      }
      return titled;
    }
    const model = getString(record, "model") ?? getString(record, "model_name") ?? getString(record, "modelName") ?? getString(record, "model_slug") ?? getString(record, "modelSlug");
    const windowName = getString(record, "window") ?? getString(record, "window_name") ?? getString(record, "windowName") ?? getString(record, "period") ?? getString(record, "period_name") ?? getString(record, "periodName");
    if (model && windowName) {
      return `${model} ${titleFromKey(windowName)} 使用限额`;
    }
    if (model) {
      return `${model} 使用限额`;
    }
    const normalizedPath = path.toLowerCase();
    if (normalizedPath === "codex" || normalizedPath.includes("codex_usage")) {
      return "Codex usage";
    }
    const pathLabel = path.split(".").filter((part) => part !== "root" && !/^\d+$/.test(part)).slice(-3).join(" ");
    return pathLabel ? titleFromKey(pathLabel) : "Codex usage";
  }
  function displayUsageLabel(value) {
    const trimmed = value.trim();
    if (!isSimpleUsageKey(trimmed)) {
      return trimmed;
    }
    return titleFromKey(trimmed);
  }
  function isSimpleUsageKey(value) {
    return /^[A-Za-z0-9_]+$/.test(value.trim());
  }
  function resetValueFromRecord(record) {
    return stringOrNumberFromKeys(record, [
      "reset_at",
      "resetAt",
      "resets_at",
      "resetsAt",
      "reset_time",
      "resetTime",
      "resets"
    ]);
  }
  function resetAfterValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return { resetAt: null, resetAfterSeconds: value };
    }
    if (typeof value !== "string") {
      return { resetAt: null, resetAfterSeconds: null };
    }
    const trimmed = value.trim();
    if (trimmed === "") {
      return { resetAt: null, resetAfterSeconds: null };
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return { resetAt: null, resetAfterSeconds: numeric };
    }
    return { resetAt: trimmed, resetAfterSeconds: null };
  }
  function dedupeMeters(meters) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const meter of meters) {
      if (seen.has(meter.key)) {
        continue;
      }
      seen.add(meter.key);
      result.push(meter);
    }
    return result;
  }
  function numberFromKeys(record, keys) {
    for (const key2 of keys) {
      const value = getNumber(record, key2);
      if (value !== null) {
        return value;
      }
    }
    return null;
  }
  function stringOrNumberFromKeys(record, keys) {
    for (const key2 of keys) {
      const value = record[key2];
      if (typeof value === "string" || typeof value === "number") {
        return value;
      }
    }
    return null;
  }
  const CHATGPT_USAGE_ENDPOINTS = ["chatgpt:conversationInit", "chatgpt:whamUsage", "chatgpt:libraryStorage"];
  function normalizeChatGptLibraryStorage(json, source = "api") {
    const root = asRecord(json);
    if (!root) return [];
    const used = getNumber(root, "used_bytes"), total = getNumber(root, "allowed_bytes"), remaining = getNumber(root, "remaining_bytes");
    if (used === null || total === null || remaining === null || used < 0 || total <= 0 || remaining < 0) return [];
    return [{
      key: "chatgpt:libraryStorage",
      label: "Library storage",
      used,
      total,
      remaining,
      usedPercent: Math.min(100, used / total * 100),
      source,
      confidence: "high",
      metricKind: "quota",
      unit: "bytes",
      quotaState: asBoolean(root.is_over_limit) === true || remaining === 0 ? "blocked" : void 0,
      rawKind: "chatgpt.library_storage"
    }];
  }
  function normalizeChatGptEndpoint(key2, json, source = "api") {
    if (key2 === "chatgpt:conversationInit") return normalizeChatGptConversationInit(json, source).meters;
    if (key2 === "chatgpt:libraryStorage") return normalizeChatGptLibraryStorage(json, source);
    if (key2 === "chatgpt:accountsCheck") return normalizeChatGptAccountsCheck(json, source);
    return normalizeChatGptWhamUsage(json, source);
  }
  async function fetchChatGptUsage(fetcher) {
    const results = await Promise.all(CHATGPT_USAGE_ENDPOINTS.map(async (key2) => {
      const response = await fetcher(key2);
      return { response, meters: response.ok ? normalizeChatGptEndpoint(key2, response.json) : [] };
    }));
    const meters = results.flatMap((item) => item.meters);
    const failed = results.some((item) => !item.response.ok);
    return {
      platform: "chatgpt",
      meters: dedupeMeters(meters),
      source: meters.length ? "api" : "unknown",
      updatedAt: Date.now(),
      status: meters.length ? failed || meters.some((m) => m.quotaState === "blocked") ? "partial" : "ok" : "error",
      errorMessage: failed ? "部分查询失败，保留上次数据" : void 0,
      debug: { endpoint: CHATGPT_USAGE_ENDPOINTS.join(","), parser: "chatgpt" }
    };
  }
  function normalizeChatGptIntercepted(url, json) {
    const path = safePathname(url);
    if (path === "/backend-api/conversation/init") {
      return normalizeChatGptConversationInit(json, "intercepted").meters;
    }
    if (path === "/backend-api/files/library/storage/usage") {
      return normalizeChatGptLibraryStorage(json, "intercepted");
    }
    if (path === "/backend-api/wham/usage") {
      return normalizeChatGptWhamUsage(json, "intercepted");
    }
    if (path === "/backend-api/codex/usage") {
      return normalizeChatGptWhamUsage(json, "intercepted");
    }
    if (path === "/backend-api/wham/tasks/rate_limit") {
      return normalizeTasksRateLimit(json, "intercepted");
    }
    if (/^\/backend-api\/accounts\/check\//.test(path)) {
      return normalizeChatGptAccountsCheck(json, "intercepted");
    }
    return [];
  }
  function safePathname(url) {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  }
  const MERGED_METER_TTL_MS = 30 * 6e4;
  function mergeUsageSnapshots(existing, incoming, now = Date.now()) {
    const normalizedIncoming = withObservedAt(incoming, incoming.updatedAt);
    if (!existing || existing.platform !== incoming.platform || existing.scopeKey !== incoming.scopeKey) {
      return {
        ...normalizedIncoming,
        cacheAgeMs: Math.max(0, now - normalizedIncoming.updatedAt)
      };
    }
    const normalizedExisting = withObservedAt(existing, existing.updatedAt);
    normalizedIncoming.meters = normalizedIncoming.meters.map((meter) => {
      const previous = normalizedExisting.meters.find((item) => item.key === meter.key);
      if (!previous) return meter;
      if ((meter.requestStartedAt ?? meter.observedAt ?? 0) < (previous.requestStartedAt ?? previous.observedAt ?? 0)) return previous;
      if (previous.quotaState === "blocked" && meter.quotaState === "unknown") {
        return now - (previous.observedAt ?? 0) <= MERGED_METER_TTL_MS ? previous : { ...meter, remaining: null };
      }
      return meter;
    });
    const incomingKeys = new Set(normalizedIncoming.meters.map((meter) => meter.key));
    const incomingHasAuthoritativeMeter = normalizedIncoming.meters.some(
      (meter) => meter.source !== "estimate"
    );
    const retainedExisting = normalizedExisting.meters.filter((meter) => {
      if (incomingKeys.has(meter.key)) {
        return false;
      }
      if (incomingHasAuthoritativeMeter && isLocalEstimateMeter(meter)) {
        return false;
      }
      const observedAt = meter.observedAt ?? normalizedExisting.updatedAt;
      return now - observedAt <= MERGED_METER_TTL_MS;
    });
    const meters = [...retainedExisting, ...normalizedIncoming.meters];
    const updatedAt = Math.max(normalizedExisting.updatedAt, normalizedIncoming.updatedAt);
    return {
      platform: incoming.platform,
      scopeKey: incoming.scopeKey,
      checkedAt: incoming.checkedAt ?? existing.checkedAt,
      meters,
      source: normalizedIncoming.source,
      updatedAt,
      cacheAgeMs: Math.max(0, now - updatedAt),
      status: mergedStatus(normalizedExisting, normalizedIncoming, meters.length),
      errorMessage: mergedErrorMessage(normalizedExisting, normalizedIncoming, meters.length),
      debug: {
        endpoint: joinDebugField(
          normalizedExisting.debug?.endpoint,
          normalizedIncoming.debug?.endpoint
        ),
        parser: joinDebugField(
          normalizedExisting.debug?.parser,
          normalizedIncoming.debug?.parser
        )
      }
    };
  }
  function isLocalEstimateMeter(meter) {
    return meter.rawKind === "localEstimate" || meter.key === "local:sent-count";
  }
  function withObservedAt(snapshot, fallbackObservedAt) {
    return {
      ...snapshot,
      meters: snapshot.meters.filter((meter) => snapshot.platform !== "chatgpt" || !isChatPassPath(meter.key)).map((meter) => ({
        ...meter,
        observedAt: meter.observedAt ?? fallbackObservedAt
      }))
    };
  }
  function mergedStatus(existing, incoming, meterCount) {
    if (meterCount === 0) {
      return incoming.status !== "unknown" ? incoming.status : existing.status;
    }
    if (incoming.status === "error") {
      return "partial";
    }
    if (incoming.status === "partial" || existing.status === "partial") {
      return "partial";
    }
    return "ok";
  }
  function mergedErrorMessage(existing, incoming, meterCount) {
    if (meterCount === 0) {
      return incoming.errorMessage ?? existing.errorMessage;
    }
    if (incoming.errorMessage === "部分功能被限制") {
      return incoming.errorMessage;
    }
    return void 0;
  }
  function joinDebugField(existing, incoming) {
    const values = [existing, incoming].filter(
      (value) => Boolean(value)
    );
    if (values.length === 0) {
      return void 0;
    }
    return Array.from(new Set(values.flatMap((value) => value.split(",")))).join(",");
  }
  const CHATGPT_POLL_CHECK_MS = 3e4;
  function startVisibleUsagePolling(options) {
    const refreshIfVisible = () => {
      if (options.isVisible()) {
        options.refresh();
      }
    };
    const stopVisibilityListener = options.onVisibilityChange(refreshIfVisible);
    const intervalId = options.setInterval(refreshIfVisible, CHATGPT_POLL_CHECK_MS);
    return () => {
      options.clearInterval(intervalId);
      stopVisibilityListener();
    };
  }
  function sameUsageValues(previous, next) {
    if (!previous || previous.platform !== next.platform) {
      return false;
    }
    if (previous.status !== next.status || previous.errorMessage !== next.errorMessage || previous.meters.length !== next.meters.length) {
      return false;
    }
    const previousValues = new Map(
      previous.meters.map((meter) => [meter.key, meterValue(meter)])
    );
    return next.meters.every(
      (meter) => previousValues.get(meter.key) === meterValue(meter)
    );
  }
  function meterValue(meter) {
    return JSON.stringify({
      label: meter.label,
      modelName: meter.modelName,
      requestKind: meter.requestKind,
      remaining: meter.remaining,
      total: meter.total,
      used: meter.used,
      usedPercent: meter.usedPercent,
      remainingPercent: meter.remainingPercent,
      resetAt: meter.quotaState === "unknown" ? null : meter.resetAt,
      resetAfterSeconds: meter.quotaState === "unknown" ? null : meter.resetAfterSeconds,
      windowSeconds: meter.windowSeconds,
      source: meter.source,
      confidence: meter.confidence,
      rawKind: meter.rawKind,
      metricKind: meter.metricKind,
      unit: meter.unit,
      quotaState: meter.quotaState
    });
  }
  const CHATGPT_REFRESH_MS = 3e4;
  const CHATGPT_OPERATION_INTERVAL_MS = 5e3;
  class ChatGptUsageController {
    constructor(options) {
      this.options = options;
      this.now = options.now ?? Date.now;
    }
    snapshot = null;
    scope;
    epoch = 0;
    states = /* @__PURE__ */ new Map();
    lastOperation = -Infinity;
    loading = 0;
    scopeLoad;
    writes = Promise.resolve();
    disposed = false;
    now;
    reset() {
      this.epoch++;
      this.scope = void 0;
      this.scopeLoad = void 0;
      this.snapshot = null;
      this.states.clear();
      this.loading = 0;
      this.options.onLoading(false);
      this.lastOperation = -Infinity;
      this.options.onSnapshot(null);
    }
    destroy() {
      this.disposed = true;
      this.epoch++;
    }
    async refresh(reason = "poll") {
      if (this.disposed) return;
      if (this.loading > 0 && (reason === "manual" || reason === "operation")) {
        await Promise.all([...this.states.values()].flatMap((state) => state.flight ? [state.flight] : []));
        return;
      }
      const now = this.now();
      if (reason === "operation" || reason === "manual") {
        if (now - this.lastOperation < CHATGPT_OPERATION_INTERVAL_MS) return;
        this.lastOperation = now;
      }
      const epoch = this.epoch;
      const queries = [];
      for (const key2 of CHATGPT_USAGE_ENDPOINTS) {
        const state = this.state(key2);
        if (state.flight) {
          queries.push(state.flight);
          continue;
        }
        if (state.retryAt > now) continue;
        if (reason === "poll" && state.lastSuccess > 0 && now - state.lastSuccess < CHATGPT_REFRESH_MS) continue;
        const flight = this.query(key2, state, epoch);
        state.flight = flight;
        void flight.finally(() => {
          if (state.flight === flight) state.flight = void 0;
        });
        queries.push(flight);
      }
      if (!queries.length) {
        this.publish();
        return;
      }
      this.loading++;
      this.options.onLoading(true);
      try {
        await Promise.all(queries);
        if (epoch === this.epoch && !this.disposed) {
          if (!this.snapshot) this.snapshot = this.empty();
          this.snapshot = { ...this.snapshot, checkedAt: this.now() };
          this.publish();
        }
      } finally {
        if (epoch === this.epoch && !this.disposed) {
          this.loading--;
          this.options.onLoading(this.loading > 0);
        }
      }
    }
    async acceptIntercept(key2, json, observedAt, requestedAt = observedAt, scope) {
      const epoch = this.epoch;
      if (this.scope && !scope) return;
      await this.adoptScope(scope);
      if (this.disposed || epoch !== this.epoch) return;
      const meters = this.stamp(normalizeChatGptEndpoint(key2, json, "intercepted"), observedAt, requestedAt);
      if (!meters.length) return;
      const state = this.state(key2);
      state.lastSuccess = Math.max(state.lastSuccess, observedAt);
      state.retryAt = 0;
      state.failures = 0;
      this.accept(meters, observedAt);
    }
    state(key2) {
      let state = this.states.get(key2);
      if (!state) {
        state = { lastSuccess: 0, retryAt: 0, failures: 0 };
        this.states.set(key2, state);
      }
      return state;
    }
    async adoptScope(scope) {
      if (!scope) return;
      if (this.scope === scope) {
        await this.scopeLoad;
        return;
      }
      const epoch = this.epoch;
      this.scope = scope;
      this.snapshot = null;
      this.scopeLoad = this.options.readCache(scope).then((cached) => {
        if (epoch !== this.epoch || this.scope !== scope || this.disposed) return;
        if (cached?.scopeKey === scope) {
          this.snapshot = cached;
          this.publish();
        }
      }).catch(() => void 0);
      await this.scopeLoad;
    }
    async query(key2, state, epoch) {
      const started = this.now();
      let response;
      try {
        response = await this.options.fetcher(key2);
      } catch {
        response = { source: "ai-usage-floating-monitor", direction: "main-to-content", requestId: "failed", platform: "chatgpt", ok: false };
      }
      if (epoch !== this.epoch || this.disposed) return;
      if (response.ok) {
        await this.adoptScope(response.scopeKey);
        if (epoch !== this.epoch || this.disposed) return;
        const observedAt = response.observedAt ?? this.now();
        const meters = this.stamp(normalizeChatGptEndpoint(key2, response.json), observedAt, response.requestStartedAt ?? started);
        if (meters.length) {
          state.lastSuccess = observedAt;
          state.retryAt = 0;
          state.failures = 0;
          this.accept(meters, observedAt);
          return;
        }
      }
      if (state.lastSuccess > started) return;
      state.failures++;
      const status = response.error?.status;
      state.retryAt = this.now() + (status === 403 || status === 404 ? 3e5 : [6e4, 12e4, 3e5][Math.min(state.failures - 1, 2)]);
      this.publish();
    }
    stamp(meters, observedAt, requestStartedAt) {
      return meters.filter(hasMeaningfulValue).map((meter) => ({
        ...meter,
        observedAt,
        requestStartedAt,
        resetAt: meter.resetAfterSeconds !== null && meter.resetAfterSeconds !== void 0 ? observedAt + meter.resetAfterSeconds * 1e3 : meter.resetAt
      }));
    }
    accept(meters, time) {
      const previous = this.snapshot;
      const incoming = {
        platform: "chatgpt",
        scopeKey: this.scope,
        meters,
        source: meters[0]?.source ?? "api",
        updatedAt: time,
        status: "ok"
      };
      const merged = mergeUsageSnapshots(previous, incoming, this.now());
      if (sameUsageValues(previous, merged)) merged.updatedAt = previous.updatedAt;
      this.snapshot = merged;
      this.publish();
    }
    empty() {
      return { platform: "chatgpt", scopeKey: this.scope, meters: [], source: "unknown", updatedAt: this.now(), status: "unknown" };
    }
    publish() {
      if (this.disposed) return;
      if (!this.snapshot) this.snapshot = this.empty();
      const meters = this.snapshot.meters.filter((meter) => !isChatPassPath(meter.key) && this.now() - (meter.observedAt ?? this.snapshot.updatedAt) <= MERGED_METER_TTL_MS);
      const failed = [...this.states.values()].some((state) => state.failures > 0);
      this.snapshot = {
        ...this.snapshot,
        meters,
        status: meters.length ? failed || meters.some((meter) => meter.quotaState === "blocked") ? "partial" : "ok" : failed ? "error" : "unknown",
        errorMessage: failed ? meters.length ? "部分查询失败，保留上次数据" : "暂时无法获取额度" : void 0
      };
      this.options.onSnapshot(this.snapshot);
      if (this.scope && meters.length) {
        const value = this.snapshot;
        this.writes = this.writes.then(() => this.options.writeCache(value)).catch(() => void 0);
      }
    }
  }
  const SOURCE = "ai-usage-floating-monitor";
  function isBridgeResponse(value) {
    return isRecord(value) && value.source === SOURCE && value.direction === "main-to-content" && typeof value.requestId === "string" && typeof value.ok === "boolean" && typeof value.platform === "string" && !("kind" in value);
  }
  function isInterceptedUsageMessage(value) {
    return isRecord(value) && value.source === SOURCE && value.direction === "main-to-content" && value.kind === "interceptedUsage" && typeof value.platform === "string" && typeof value.url === "string" && typeof value.ts === "number";
  }
  class BridgeClient {
    pending = /* @__PURE__ */ new Map();
    interceptHandlers = /* @__PURE__ */ new Set();
    contextHandlers = /* @__PURE__ */ new Set();
    onMessage = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.source === window && event.data && typeof event.data === "object" && event.data.kind === "chatgptContextChanged" && event.data.source === SOURCE && event.data.direction === "main-to-content") {
        for (const handler of this.contextHandlers) handler();
        return;
      }
      if (isInterceptedUsageMessage(event.data)) {
        for (const handler of this.interceptHandlers) {
          handler(event.data);
        }
        return;
      }
      if (event.source !== window) {
        return;
      }
      if (!isBridgeResponse(event.data)) {
        return;
      }
      const pending = this.pending.get(event.data.requestId);
      if (!pending) {
        return;
      }
      window.clearTimeout(pending.timeoutId);
      this.pending.delete(event.data.requestId);
      pending.resolve(event.data);
    };
    constructor() {
      window.addEventListener("message", this.onMessage);
    }
    destroy() {
      window.removeEventListener("message", this.onMessage);
      for (const pending of this.pending.values()) {
        window.clearTimeout(pending.timeoutId);
      }
      this.pending.clear();
      this.interceptHandlers.clear();
      this.contextHandlers.clear();
    }
    onContextChanged(handler) {
      this.contextHandlers.add(handler);
      return () => this.contextHandlers.delete(handler);
    }
    onIntercepted(handler) {
      this.interceptHandlers.add(handler);
      return () => this.interceptHandlers.delete(handler);
    }
    fetchUsage(platform2, endpointKey, payload) {
      return this.send(platform2, "fetchUsage", endpointKey, payload);
    }
    enableIntercept(platform2) {
      return this.send(platform2, "enableIntercept");
    }
    send(platform2, action, endpointKey, payload) {
      const requestId = makeRequestId();
      return new Promise((resolve) => {
        const timeoutId = window.setTimeout(() => {
          this.pending.delete(requestId);
          resolve({
            source: SOURCE,
            direction: "main-to-content",
            requestId,
            ok: false,
            platform: platform2,
            endpointKey,
            error: {
              message: "Bridge request timed out"
            }
          });
        }, 12e3);
        this.pending.set(requestId, {
          resolve,
          timeoutId,
          platform: platform2,
          endpointKey
        });
        window.postMessage(
          {
            source: SOURCE,
            direction: "content-to-main",
            requestId,
            action,
            platform: platform2,
            endpointKey,
            payload
          },
          window.location.origin
        );
      });
    }
  }
  function makeRequestId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  const CACHE_TTL_MS = 6e4;
  const MIN_REFRESH_INTERVAL_MS = 3e4;
  const FAILED_BACKOFF_STEPS_MS = [6e4, 12e4, 3e5];
  function snapshotKey(platform2, scope) {
    return platform2 === "chatgpt" && scope ? `aiUsage:chatgpt:${scope}:snapshot` : `aiUsage:${platform2}:snapshot`;
  }
  function lastRefreshKey(platform2) {
    return `aiUsage:${platform2}:lastRefreshAt`;
  }
  function backoffKey(platform2) {
    return `aiUsage:${platform2}:backoffUntil`;
  }
  function failureCountKey(platform2) {
    return `aiUsage:${platform2}:failureCount`;
  }
  function estimateKey(platform2) {
    return `aiUsage:${platform2}:estimate`;
  }
  function storageGet$1(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (items) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(items);
      });
    });
  }
  function storageSet$1(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }
  async function getCachedSnapshot(platform2, scope) {
    if (platform2 === "chatgpt" && !scope) return null;
    const key2 = snapshotKey(platform2, scope);
    const items = await storageGet$1(key2);
    const value = items[key2];
    if (!isUsageSnapshot(value, platform2)) {
      return null;
    }
    return {
      ...value,
      cacheAgeMs: Math.max(0, Date.now() - (value.checkedAt ?? value.updatedAt))
    };
  }
  function setCachedSnapshot(snapshot) {
    if (snapshot.platform === "chatgpt" && !snapshot.scopeKey) return Promise.resolve();
    const { cacheAgeMs: _cacheAgeMs, ...persisted } = snapshot;
    return storageSet$1({ [snapshotKey(snapshot.platform, snapshot.scopeKey)]: persisted });
  }
  async function getLastRefreshAt(platform2) {
    const key2 = lastRefreshKey(platform2);
    const items = await storageGet$1(key2);
    return typeof items[key2] === "number" ? items[key2] : 0;
  }
  function setLastRefreshAt(platform2, value) {
    return storageSet$1({ [lastRefreshKey(platform2)]: value });
  }
  async function getBackoffUntil(platform2) {
    const key2 = backoffKey(platform2);
    const items = await storageGet$1(key2);
    return typeof items[key2] === "number" ? items[key2] : 0;
  }
  function setBackoffUntil(platform2, value) {
    return storageSet$1({ [backoffKey(platform2)]: value });
  }
  async function getFailureCount(platform2) {
    const key2 = failureCountKey(platform2);
    const items = await storageGet$1(key2);
    return typeof items[key2] === "number" ? items[key2] : 0;
  }
  function setFailureCount(platform2, value) {
    return storageSet$1({ [failureCountKey(platform2)]: value });
  }
  async function getEstimateState(platform2) {
    const key2 = estimateKey(platform2);
    const items = await storageGet$1(key2);
    const value = items[key2];
    if (!isEstimateState(value)) {
      return null;
    }
    return value;
  }
  async function incrementEstimateState(platform2) {
    const existing = await getEstimateState(platform2);
    const now = Date.now();
    const next = {
      sentCount: (existing?.sentCount ?? 0) + 1,
      firstSentAt: existing?.firstSentAt ?? now,
      lastSentAt: now
    };
    await storageSet$1({ [estimateKey(platform2)]: next });
    return next;
  }
  function isUsageSnapshot(value, platform2) {
    return typeof value === "object" && value !== null && value.platform === platform2 && Array.isArray(value.meters) && typeof value.updatedAt === "number";
  }
  function isEstimateState(value) {
    return typeof value === "object" && value !== null && typeof value.sentCount === "number" && typeof value.firstSentAt === "number" && typeof value.lastSentAt === "number";
  }
  function installSendEstimator(platform2, onEstimate, options = {}) {
    let lastIncrementAt = 0;
    const increment = () => {
      const now = Date.now();
      if (now - lastIncrementAt < 1200) {
        return;
      }
      lastIncrementAt = now;
      if (options.recordCounts === false) {
        onEstimate({ platform: platform2, meters: [], source: "unknown", status: "unknown", updatedAt: now });
        return;
      }
      void incrementEstimateState(platform2).then((state) => {
        onEstimate(snapshotFromEstimate(platform2, state));
      });
    };
    const onClick = (event) => {
      if (isLikelySendButton(event.target)) {
        increment();
      }
    };
    const onSubmit = () => {
      increment();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }
  async function getEstimateSnapshot(platform2) {
    const state = await getEstimateState(platform2);
    if (!state || state.sentCount <= 0) {
      return null;
    }
    return snapshotFromEstimate(platform2, state);
  }
  function snapshotFromEstimate(platform2, state) {
    return {
      platform: platform2,
      meters: [
        {
          key: "local:sent-count",
          label: "Sent locally",
          used: state.sentCount,
          source: "estimate",
          confidence: "low",
          rawKind: "localEstimate"
        }
      ],
      source: "estimate",
      updatedAt: state.lastSentAt,
      status: "unknown",
      errorMessage: "Using local estimate only"
    };
  }
  function isLikelySendButton(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    const button = target.closest("button,[role='button']");
    if (!button) {
      return false;
    }
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-testid"),
      button.textContent
    ].filter((value) => Boolean(value)).join(" ").toLowerCase();
    return /\bsend\b|发送|submit|composer-submit|send-button/.test(label);
  }
  function resolveResetMs(meter, now = Date.now()) {
    const anchor = meter.observedAt ?? now;
    if (typeof meter.resetAfterSeconds === "number" && !meter.resetAt) {
      return anchor + meter.resetAfterSeconds * 1e3;
    }
    if (typeof meter.resetAt === "number") {
      if (meter.resetAt > 1e10) {
        return meter.resetAt;
      }
      if (meter.resetAt > 1e9) {
        return meter.resetAt * 1e3;
      }
      if (meter.resetAt > 0) {
        return anchor + meter.resetAt * 1e3;
      }
    }
    if (typeof meter.resetAt === "string") {
      const numeric = Number(meter.resetAt.trim());
      if (Number.isFinite(numeric)) {
        return resolveNumericResetMs(numeric, anchor);
      }
      const parsed = Date.parse(meter.resetAt);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  function resolveNumericResetMs(value, now) {
    if (value > 1e10) {
      return value;
    }
    if (value > 1e9) {
      return value * 1e3;
    }
    if (value > 0) {
      return now + value * 1e3;
    }
    return null;
  }
  const DEFAULT_LANGUAGE_MODE = "auto";
  const ZH_TEXT = {
    "action.closeSettings": "关闭设置",
    "action.collapseWidget": "收起用量组件",
    "action.hidePanel": "隐藏用量面板",
    "action.openUsage": "打开 {platform} 用量",
    "action.refreshUsage": "刷新用量",
    "action.restoreGptPanel": "恢复 GPT 用量面板",
    "action.settings": "设置",
    "gpt.alertCount": "{count} 项预警",
    "gpt.title": "GPT 用量",
    "language.auto": "跟随浏览器",
    "language.en": "English",
    "language.label": "语言",
    "language.zhCN": "简体中文",
    "meta.cacheSeconds": "缓存 {seconds}秒",
    "meta.checkedAt": "最近查询 {age}",
    "meta.loading": "加载中",
    "meta.neverUpdated": "尚未更新",
    "meta.updatedAt": "更新于 {age}",
    "meta.waitSeconds": "等待 {seconds}秒",
    "meter.unknown": "未知",
    "meter.used": "已用 {used}/{total}",
    "meter.usedPercent": "{percent}% 已用",
    "meter.remaining": "剩余 {remaining}",
    "meter.remainingPercent": "{percent}% 剩余",
    "model.label": "模型",
    "settings.save": "保存",
    "settings.title": "设置",
    "usage.empty": "暂无用量数据",
    "usage.title": "{platform} 用量"
  };
  const EN_TEXT = {
    "action.closeSettings": "Close settings",
    "action.collapseWidget": "Collapse usage widget",
    "action.hidePanel": "Hide usage panel",
    "action.openUsage": "Open {platform} usage",
    "action.refreshUsage": "Refresh usage",
    "action.restoreGptPanel": "Restore GPT usage panel",
    "action.settings": "Settings",
    "gpt.alertCount": "{count} alerts",
    "gpt.title": "GPT Usage",
    "language.auto": "Follow browser",
    "language.en": "English",
    "language.label": "Language",
    "language.zhCN": "Simplified Chinese",
    "meta.cacheSeconds": "Cached {seconds}s",
    "meta.checkedAt": "Queried {age}",
    "meta.loading": "Loading",
    "meta.neverUpdated": "Not updated yet",
    "meta.updatedAt": "Updated {age}",
    "meta.waitSeconds": "Wait {seconds}s",
    "meter.unknown": "Unknown",
    "meter.used": "Used {used}/{total}",
    "meter.usedPercent": "{percent}% used",
    "meter.remaining": "Remaining {remaining}",
    "meter.remainingPercent": "{percent}% remaining",
    "model.label": "Model",
    "settings.save": "Save",
    "settings.title": "Settings",
    "usage.empty": "No usage data yet",
    "usage.title": "{platform} Usage"
  };
  const TEXT = {
    "zh-CN": ZH_TEXT,
    en: EN_TEXT
  };
  const GPT_SECTION_LABELS = {
    "zh-CN": {
      subscription: "订阅",
      input: "输入与附件",
      features: "GPT 功能额度",
      windows: "用量窗口",
      codex: "余额 / Codex",
      other: "其他"
    },
    en: {
      subscription: "Subscription",
      input: "Input and attachments",
      features: "GPT feature limits",
      windows: "Usage windows",
      codex: "Balance / Codex",
      other: "Other"
    }
  };
  const SOURCE_LABELS = {
    "zh-CN": {
      api: "接口",
      intercepted: "捕获",
      estimate: "估算",
      unknown: "未知"
    },
    en: {
      api: "API",
      intercepted: "Captured",
      estimate: "Estimate",
      unknown: "Unknown"
    }
  };
  const CONFIDENCE_LABELS = {
    "zh-CN": {
      high: "高",
      medium: "中",
      low: "低"
    },
    en: {
      high: "High",
      medium: "Medium",
      low: "Low"
    }
  };
  const METER_LABELS_ZH = {
    "Library storage": "文件库空间",
    "Available resets": "可用重置次数",
    "File Upload": "文件上传",
    "Paste Text To File": "粘贴文本转文件",
    Dictation: "听写",
    "Deep Research": "深度研究",
    "Image Generation": "图像生成",
    "Computer Control": "电脑操控",
    "Computer Use": "电脑操控",
    "Reasoning Quota": "思考额度",
    "Primary window": "主窗口",
    "Secondary window": "次窗口",
    "5-hour window": "5 小时窗口",
    "Weekly window": "每周窗口",
    "Additional Primary window": "额外主窗口",
    "Additional Weekly window": "额外每周窗口",
    "ChatGPT subscription": "ChatGPT 订阅",
    "Current Grok limit": "当前 Grok 限额",
    "Weekly Grok limit": "每周 Grok 限额",
    "Monthly Grok limit": "每月 Grok 限额",
    Chat: "聊天",
    "Grok Build": "Grok Build",
    API: "API",
    Build: "Build",
    Voice: "Voice",
    "Tasks rate limit": "任务限额",
    "Code Review": "代码审查",
    Credits: "余额",
    "Credits (unlimited)": "余额（无限）",
    "Gemini 5h": "Gemini 5 小时",
    "Gemini weekly": "Gemini 每周",
    Pro: "Pro",
    Labs: "Labs",
    "Agentic Research": "智能体研究",
    "Free queries": "免费查询"
  };
  function isLanguageMode(value) {
    return value === "auto" || value === "zh-CN" || value === "en";
  }
  function languageModeFromValue(value) {
    return isLanguageMode(value) ? value : DEFAULT_LANGUAGE_MODE;
  }
  function resolveLanguage(mode, browserLanguages = browserLanguageCandidates()) {
    if (mode !== "auto") {
      return mode;
    }
    for (const language of browserLanguages) {
      const normalized = language.trim().toLowerCase();
      if (normalized.startsWith("zh")) {
        return "zh-CN";
      }
      if (normalized.startsWith("en")) {
        return "en";
      }
    }
    return "en";
  }
  function t(language, key2, params = {}) {
    return TEXT[language][key2].replace(
      /\{(\w+)\}/g,
      (_, name) => params[name] === void 0 ? "" : String(params[name])
    );
  }
  function formatAgeLocalized(language, timestamp, now = Date.now()) {
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1e3));
    if (seconds < 5) {
      return language === "zh-CN" ? "刚刚" : "just now";
    }
    if (seconds < 60) {
      return language === "zh-CN" ? `${seconds}秒前` : `${seconds}s ago`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return language === "zh-CN" ? `${minutes}分钟前` : `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return language === "zh-CN" ? `${hours}小时前` : `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    return language === "zh-CN" ? `${days}天前` : `${days}d ago`;
  }
  function formatResetLocalized(language, meter, now = Date.now()) {
    const resetMs = resolveResetMs(meter, now);
    if (resetMs === null) {
      return "";
    }
    const seconds = Math.max(0, Math.floor((resetMs - now) / 1e3));
    if (seconds < 60) {
      return language === "zh-CN" ? `${seconds}秒` : `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return language === "zh-CN" ? `${minutes}分钟` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      const remainingMinutes = minutes % 60;
      if (remainingMinutes > 0) {
        return language === "zh-CN" ? `${hours}小时 ${remainingMinutes}分钟` : `${hours}h ${remainingMinutes}m`;
      }
      return language === "zh-CN" ? `${hours}小时` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return language === "zh-CN" ? `${days}天 ${remainingHours}小时` : `${days}d ${remainingHours}h`;
    }
    return language === "zh-CN" ? `${days}天` : `${days}d`;
  }
  function formatSubscriptionExpiryLocalized(language, meter) {
    const resetMs = resolveResetMs(meter);
    if (resetMs === null) {
      return "";
    }
    const date = new Date(resetMs);
    const exact = [
      date.getFullYear(),
      pad2(date.getMonth() + 1),
      pad2(date.getDate())
    ].join("-") + ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
      date.getSeconds()
    )}`;
    const verb = meter.requestKind === "renews" ? language === "zh-CN" ? "续订" : "Renews" : language === "zh-CN" ? "到期" : "Expires";
    return `${verb} ${exact}`;
  }
  function formatMeterValueLocalized(language, meter) {
    if (meter.quotaState === "blocked") return language === "zh-CN" ? "已达上限" : "Limit reached";
    if (meter.unit === "bytes") {
      const gib = (n) => (n / 1073741824).toLocaleString(language, { maximumFractionDigits: 2 });
      return typeof meter.remaining === "number" ? (language === "zh-CN" ? "剩余 " : "Remaining ") + gib(meter.remaining) + " GiB" : t(language, "meter.unknown");
    }
    if (meter.label === "Credits (unlimited)") return language === "zh-CN" ? "无限" : "Unlimited";
    if (meter.rawKind === "chatgpt.subscription") {
      return formatSubscriptionRemainingLocalized(language, meter);
    }
    if (typeof meter.remainingPercent === "number") {
      return t(language, "meter.remainingPercent", {
        percent: Math.round(meter.remainingPercent)
      });
    }
    if (typeof meter.remaining === "number" && typeof meter.total === "number") {
      return `${meter.remaining}/${meter.total}`;
    }
    if (typeof meter.remaining === "number") {
      return t(language, "meter.remaining", { remaining: meter.remaining });
    }
    if (typeof meter.used === "number" && typeof meter.total === "number") {
      return t(language, "meter.used", {
        used: meter.used,
        total: meter.total
      });
    }
    if (typeof meter.usedPercent === "number") {
      return t(language, "meter.usedPercent", {
        percent: Math.round(meter.usedPercent)
      });
    }
    return t(language, "meter.unknown");
  }
  function formatSubscriptionRemainingLocalized(language, meter, now = Date.now()) {
    const resetMs = resolveResetMs(meter, now);
    if (resetMs === null) {
      return t(language, "meter.unknown");
    }
    const seconds = Math.max(0, Math.floor((resetMs - now) / 1e3));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    if (language === "zh-CN") {
      if (days > 0) {
        return `剩余 ${days}天 ${hours}小时 ${minutes}分钟`;
      }
      if (hours > 0) {
        return `剩余 ${hours}小时 ${minutes}分钟`;
      }
      return `剩余 ${minutes}分钟`;
    }
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m left`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m left`;
    }
    return `${minutes}m left`;
  }
  function pad2(value) {
    return String(value).padStart(2, "0");
  }
  function formatMeterLabelLocalized(language, meter) {
    if (language === "en") {
      return meter.label;
    }
    const direct = METER_LABELS_ZH[meter.label];
    if (direct) {
      return direct;
    }
    return meter.label.replace(/\bquery limit\b/gi, "查询额度").replace(/\btoken limit\b/gi, "token 额度").replace(/\bLow \/ Fast \/ Normal\b/g, "低 / 快速 / 普通").replace(/\bHigh \/ Thinking \/ Expert\b/g, "高 / 思考 / 专家").replace(/\bCodex usage\b/gi, "Codex 用量").replace(/\bPrimary window\b/gi, "主窗口").replace(/\bWeekly window\b/gi, "每周窗口").replace(/\b5[- ]?hour\b/gi, "5 小时").replace(/\bweekly\b/gi, "每周").replace(/\busage limit\b/gi, "使用限额").replace(/\brate limit\b/gi, "使用限额");
  }
  function formatGptSectionLabelLocalized(language, section) {
    return GPT_SECTION_LABELS[language][section];
  }
  function formatSourceLabelLocalized(language, source) {
    return SOURCE_LABELS[language][source] ?? source;
  }
  function formatConfidenceLabelLocalized(language, confidence) {
    return CONFIDENCE_LABELS[language][confidence] ?? confidence;
  }
  function browserLanguageCandidates() {
    if (typeof navigator === "undefined") {
      return [];
    }
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      return [...navigator.languages];
    }
    return navigator.language ? [navigator.language] : [];
  }
  function key(node2) {
    return node2 instanceof Element ? node2.getAttribute("data-node-key") : null;
  }
  function compatible(a, b) {
    return a.nodeType === b.nodeType && (!(a instanceof Element) || b instanceof Element && a.tagName === b.tagName && key(a) === key(b));
  }
  function reconcileChildren(parent, desired) {
    const old = Array.from(parent.childNodes);
    const claimed = /* @__PURE__ */ new Set();
    let cursor = parent.firstChild;
    for (const next of desired) {
      const nodeKey = key(next);
      const previous = nodeKey !== null ? old.find((node22) => !claimed.has(node22) && key(node22) === nodeKey && compatible(node22, next)) : cursor && !claimed.has(cursor) && compatible(cursor, next) ? cursor : void 0;
      const node2 = previous ?? next;
      claimed.add(node2);
      if (previous) patch(previous, next);
      if (node2 !== cursor) parent.insertBefore(node2, cursor);
      cursor = node2.nextSibling;
    }
    for (const node2 of old) if (!claimed.has(node2) && node2.parentNode === parent) parent.removeChild(node2);
  }
  function patch(current, next) {
    if (!(current instanceof Element) || !(next instanceof Element)) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    for (const attr of Array.from(current.attributes)) if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    for (const attr of Array.from(next.attributes)) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
    const selected = next instanceof HTMLSelectElement ? next.value : void 0;
    reconcileChildren(current, Array.from(next.childNodes));
    if (current instanceof HTMLSelectElement && selected !== void 0) current.value = selected;
  }
  const WIDGET_CSS = `
:host {
  color-scheme: light dark;
  position: fixed;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  z-index: 2147483000;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.35;
}

:host([data-platform="chatgpt"]) {
  top: clamp(12px, 4vh, 28px);
  right: clamp(10px, 2vw, 24px);
  transform: none;
}

* {
  box-sizing: border-box;
}

button {
  font: inherit;
}

.collapsed {
  min-width: 72px;
  height: 40px;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 92%, CanvasText 8%);
  color: CanvasText;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  display: grid;
  grid-template-columns: 8px 1fr;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.gpt-restore-chip {
  min-width: 88px;
  min-height: 48px;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 94%, CanvasText 6%);
  color: CanvasText;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  display: grid;
  grid-template-columns: 8px 1fr;
  gap: 9px;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #9ca3af;
}

.status-ok {
  background: #315d86;
}

.status-partial {
  background: #f59e0b;
}

.status-error {
  background: #ef4444;
}

.collapsed-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.platform {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
}

.primary {
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
}

.panel {
  width: min(320px, calc(100vw - 28px));
  border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  color: CanvasText;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.gpt-panel {
  width: min(400px, calc(100vw - 20px));
  height: min(560px, calc(100vh - 24px));
  min-height: 320px;
  border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  color: CanvasText;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
}

.gpt-header {
  flex: 0 0 auto;
  min-height: 58px;
}

.gpt-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.gpt-alerts {
  color: color-mix(in srgb, CanvasText 66%, transparent);
  font-size: 12px;
  white-space: nowrap;
}

.title {
  font-size: 14px;
  font-weight: 750;
}

.gpt-title {
  font-size: 18px;
  font-weight: 780;
  letter-spacing: 0;
  min-width: 0;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 6px;
}

.gpt-actions {
  flex: 0 0 auto;
}

.icon-button {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
  background: color-mix(in srgb, Canvas 90%, CanvasText 10%);
  color: CanvasText;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.icon-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.meta {
  padding: 8px 10px;
  color: color-mix(in srgb, CanvasText 70%, transparent);
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.gpt-panel > .meta {
  flex: 0 0 auto;
  border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  padding: 9px 12px;
}

.model-meta {
  padding: 7px 10px 8px;
  border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
  border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  color: color-mix(in srgb, CanvasText 70%, transparent);
  font-size: 11px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.model-label {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}

.model-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.content {
  padding: 4px 10px 10px;
}

.gpt-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 12px 12px;
  scrollbar-width: none;
  scrollbar-color: transparent transparent;
}

.gpt-content:hover,
.gpt-content:focus-within {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, CanvasText 26%, transparent) transparent;
}

.gpt-content::-webkit-scrollbar {
  width: 0;
}

.gpt-content:hover::-webkit-scrollbar,
.gpt-content:focus-within::-webkit-scrollbar {
  width: 6px;
}

.gpt-content::-webkit-scrollbar-track {
  background: transparent;
}

.gpt-content::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, CanvasText 24%, transparent);
  border-radius: 999px;
}

.meter {
  padding: 8px 0;
  border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
}

.gpt-content .meter {
  padding: 11px 0;
}

.meter-section {
  border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  padding: 8px 0 2px;
}

.meter-section:first-child {
  border-top: 0;
}

.meter-section-title {
  color: color-mix(in srgb, CanvasText 58%, transparent);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0;
  padding: 3px 0 2px;
}

.meter-section .meter:first-of-type {
  border-top: 0;
}

.meter:first-child {
  border-top: 0;
}

.meter-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
}

.meter-label {
  font-weight: 650;
  min-width: 0;
}

.meter-value {
  color: color-mix(in srgb, CanvasText 82%, transparent);
  white-space: nowrap;
}

.bar {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, CanvasText 12%, transparent);
  overflow: hidden;
  margin-top: 7px;
}

.bar-fill {
  height: 100%;
  width: 0%;
  border-radius: inherit;
  background: #2563eb;
}

.bar-fill.remaining-fill {
  background: #3f5874;
}

.grok-stack-bar {
  overflow: visible;
}

.grok-stack-fill {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
}

.grok-stack-segment {
  display: block;
  height: 100%;
}

.grok-contribution-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 10px;
  margin-top: 8px;
  color: color-mix(in srgb, CanvasText 70%, transparent);
  font-size: 11px;
}

.grok-contribution {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.grok-contribution-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  box-shadow: 0 0 0 1px color-mix(in srgb, Canvas 35%, transparent);
}

.grok-contribution-value {
  color: color-mix(in srgb, CanvasText 82%, transparent);
  font-weight: 700;
}

.error-text {
  color: #ef4444;
}

.settings-popover {
  position: fixed;
  top: clamp(12px, 5vh, 40px);
  right: clamp(10px, 2vw, 24px);
  width: min(360px, calc(100vw - 20px));
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, Canvas 98%, CanvasText 2%);
  color: CanvasText;
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.26);
  padding: 12px;
  z-index: 2147483001;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.settings-title {
  font-size: 14px;
  font-weight: 760;
}

.settings-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 650;
  margin: 4px 0 12px;
}

.settings-label {
  display: block;
  color: color-mix(in srgb, CanvasText 66%, transparent);
  font-size: 11px;
  font-weight: 650;
  margin-bottom: 5px;
}

.settings-input {
  width: 100%;
  height: 34px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  color: CanvasText;
  padding: 6px 8px;
  outline: none;
}

.settings-popover > .settings-input {
  margin-bottom: 12px;
}

.settings-input-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: center;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
  overflow: hidden;
}

.settings-input-wrap .settings-input {
  border: 0;
  border-radius: 0;
  background: transparent;
}

.settings-eye-button {
  width: 34px;
  height: 34px;
  border: 0;
  border-left: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.settings-input:focus {
  border-color: #2563eb;
}

.settings-input-wrap:focus-within {
  border-color: #2563eb;
}

.settings-help {
  margin-top: 8px;
  color: color-mix(in srgb, CanvasText 62%, transparent);
  font-size: 11px;
  line-height: 1.45;
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.settings-button {
  min-height: 30px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
  background: color-mix(in srgb, Canvas 90%, CanvasText 10%);
  color: CanvasText;
  cursor: pointer;
  padding: 5px 10px;
}

.settings-button:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.primary-button {
  border-color: color-mix(in srgb, #2563eb 65%, CanvasText 10%);
  background: #2563eb;
  color: white;
}

.danger-button {
  color: #ef4444;
}

.meter-bottom {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  color: color-mix(in srgb, CanvasText 66%, transparent);
  font-size: 11px;
}

.badge {
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, CanvasText 13%, transparent);
  padding: 1px 6px;
  background: color-mix(in srgb, Canvas 88%, CanvasText 12%);
}

.empty,
.error {
  padding: 12px 0;
  color: color-mix(in srgb, CanvasText 72%, transparent);
}

.error {
  color: #ef4444;
}

/* Cold blue capsule shell. Keeps the widget DOM stable while replacing the visual skin. */
:host {
  color-scheme: light;
  --rb-ink: #253244;
  --rb-ink-soft: #405063;
  --rb-blue: #25364d;
  --rb-blue-deep: #1d2b3f;
  --rb-blue-soft: #3f5874;
  --rb-blue-pale: #8fa8c4;
  --rb-paper: #fbf5eb;
  --rb-paper-soft: #f4ebdd;
  --rb-paper-warm: #fffaf1;
  --rb-brown: #70675d;
  --rb-brown-soft: #b7aa99;
  --rb-line: rgba(111, 101, 89, 0.38);
  --rb-line-strong: rgba(35, 50, 70, 0.72);
  --rb-mustard: #d4a644;
  --rb-mustard-deep: #b98225;
  --rb-red: #b85a4a;
  --rb-shadow: 0 18px 42px rgba(25, 34, 46, 0.24);
  --rb-soft-shadow: 0 9px 22px rgba(37, 45, 56, 0.16);
  --rb-inner: inset 0 0 0 1px rgba(255, 255, 255, 0.76);
  color: var(--rb-ink);
}

.panel,
.gpt-panel,
.settings-popover {
  border: 1px solid var(--rb-line);
  background:
    linear-gradient(180deg, rgba(255, 252, 246, 0.98), rgba(246, 238, 225, 0.96)),
    repeating-linear-gradient(90deg, rgba(63, 88, 116, 0.03) 0 1px, transparent 1px 28px);
  color: var(--rb-ink);
  box-shadow: var(--rb-shadow), var(--rb-inner);
}

.panel,
.gpt-panel {
  position: relative;
  overflow: hidden;
}

.panel,
.gpt-panel {
  border-radius: 18px;
}

.panel {
  width: min(314px, calc(100vw - 24px));
  padding-bottom: 18px;
}

.gpt-panel {
  width: min(390px, calc(100vw - 16px));
  height: min(552px, calc(100vh - 16px));
  min-height: 380px;
}

.settings-popover {
  border-radius: 16px;
  padding: 0 12px 12px;
}

.panel::before,
.gpt-panel::before,
.settings-popover::before {
  content: "";
  display: block;
  height: 4px;
  background: linear-gradient(90deg, transparent, rgba(143, 168, 196, 0.7), rgba(212, 166, 68, 0.78), rgba(143, 168, 196, 0.7), transparent);
}

.panel::after,
.gpt-panel::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 20px;
  border-top: 1px solid rgba(255, 250, 241, 0.24);
  background:
    radial-gradient(circle at 22px 50%, var(--rb-mustard) 0 5px, transparent 6px),
    radial-gradient(circle at 46px 50%, #f0d78a 0 4px, transparent 5px),
    radial-gradient(circle at 70px 50%, var(--rb-blue-pale) 0 4px, transparent 5px),
    linear-gradient(180deg, var(--rb-blue), var(--rb-blue-deep));
  pointer-events: none;
  z-index: 0;
}
.header,
.meta,
.model-meta,
.content,
.gpt-content,
.vine-divider,
.settings-header,
.settings-check,
.settings-label,
.settings-input-wrap,
.settings-help,
.settings-actions,
.meter,
.meter-section {
  position: relative;
  z-index: 1;
}

.header {
  min-height: 52px;
  padding: 10px 12px 9px;
  border-bottom-color: rgba(112, 103, 93, 0.22);
  background:
    linear-gradient(180deg, rgba(255, 250, 241, 0.9), rgba(244, 235, 221, 0.72)),
    linear-gradient(90deg, rgba(63, 88, 116, 0.12), transparent 52%, rgba(212, 166, 68, 0.12));
}

.header::after {
  content: "";
  position: absolute;
  right: 14px;
  bottom: -1px;
  left: 14px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(112, 103, 93, 0.58), rgba(212, 166, 68, 0.56), transparent);
}

.title,
.gpt-title,
.settings-title,
.meter-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--rb-ink);
  font-weight: 780;
  letter-spacing: 0;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.9);
}

.title::before,
.gpt-title::before,
.settings-title::before,
.meter-section-title::before {
  content: none;
}

.title-text,
.section-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-icon,
.section-title-icon,
.inline-icon,
.section-badge,
.progress-leaf,
.chip-icon,
.vine-divider-image,
.corner,
.card-corner {
  display: block;
  object-fit: contain;
  user-select: none;
  -webkit-user-select: none;
}

.title-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  filter: drop-shadow(0 2px 4px rgba(31, 43, 59, 0.18));
}

.gpt-title .title-icon {
  width: 25px;
  height: 25px;
  flex-basis: 25px;
}

.settings-title .title-icon {
  width: 20px;
  height: 20px;
  flex-basis: 20px;
}
.gpt-alerts,
.meta,
.model-meta,
.meter-bottom,
.settings-help {
  color: var(--rb-brown);
}

.gpt-alerts {
  padding: 3px 8px;
  border: 1px solid rgba(112, 103, 93, 0.28);
  border-radius: 999px;
  background: rgba(255, 250, 241, 0.7);
  font-size: 11px;
  box-shadow: var(--rb-inner);
}

.icon-button,
.settings-button {
  border: 1px solid rgba(112, 103, 93, 0.38);
  background: linear-gradient(145deg, rgba(255, 250, 241, 0.98), rgba(239, 230, 215, 0.9));
  color: var(--rb-blue);
  box-shadow: 0 2px 8px rgba(38, 48, 62, 0.13), var(--rb-inner);
}

.icon-button {
  width: 28px;
  height: 28px;
  border-radius: 10px;
}

.icon-button:hover,
.settings-button:hover {
  border-color: rgba(63, 88, 116, 0.62);
  background: linear-gradient(145deg, #fffdf7, #e9edf1);
  transform: translateY(-1px);
}

.icon-button:active,
.settings-button:active {
  transform: translateY(0);
  box-shadow: inset 0 2px 5px rgba(38, 48, 62, 0.16);
}

.icon-button:disabled,
.settings-button:disabled {
  color: rgba(64, 80, 99, 0.44);
  box-shadow: none;
}

.primary-button {
  border-color: rgba(37, 54, 77, 0.72);
  background: linear-gradient(145deg, var(--rb-blue-soft), var(--rb-blue));
  color: var(--rb-paper-warm);
}

.danger-button,
.error,
.error-text {
  color: var(--rb-red);
}

.collapsed,
.gpt-restore-chip {
  position: relative;
  width: min(172px, calc(100vw - 14px));
  min-width: 160px;
  height: 44px;
  min-height: 44px;
  grid-template-columns: 78px 7px minmax(0, 1fr);
  gap: 3px;
  align-items: center;
  overflow: visible;
  border: 1.5px solid var(--rb-line-strong);
  border-radius: 999px;
  background:
    linear-gradient(90deg, var(--rb-blue) 0 46px, transparent 46px),
    linear-gradient(180deg, var(--rb-paper-warm), var(--rb-paper-soft));
  color: var(--rb-ink);
  box-shadow: var(--rb-soft-shadow), var(--rb-inner);
  padding: 0 7px 0 6px;
}

.collapsed::before,
.gpt-restore-chip::before {
  content: "";
  position: absolute;
  top: 5px;
  bottom: 5px;
  left: 5px;
  width: 36px;
  border-radius: 999px 7px 7px 999px;
  background: linear-gradient(145deg, #344963, var(--rb-blue-deep));
  box-shadow:
    inset 0 0 0 1px rgba(255, 249, 237, 0.28),
    inset -8px 0 14px rgba(8, 17, 30, 0.18);
  pointer-events: none;
}

.collapsed::after,
.gpt-restore-chip::after {
  content: "";
  position: absolute;
  top: 8px;
  left: 11px;
  z-index: 1;
  width: 30px;
  height: 28px;
  border-radius: 999px;
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpolygon fill='%23fffaf1' points='8,0 10.3,5.3 16,6 11.7,9.8 12.9,16 8,12.8 3.1,16 4.3,9.8 0,6 5.7,5.3'/%3E%3C/svg%3E") 3px 18px / 9px 9px no-repeat,
    radial-gradient(circle at 8px 7px, var(--rb-paper-warm) 0 4px, transparent 5px),
    radial-gradient(circle at 19px 20px, var(--rb-mustard) 0 3px, transparent 4px),
    radial-gradient(circle at 27px 8px, #c5cbd0 0 3px, transparent 4px);
  pointer-events: none;
}

.collapsed:hover,
.gpt-restore-chip:hover {
  border-color: rgba(35, 50, 70, 0.86);
  background:
    linear-gradient(90deg, #2d405a 0 46px, transparent 46px),
    linear-gradient(180deg, #fffdf7, #f1e9db);
  transform: translateY(-1px);
}

.chip-icon {
  position: absolute;
  top: 50%;
  left: 32px;
  z-index: 2;
  width: 14px;
  height: 14px;
  opacity: 0;
  transform: translateY(-50%);
  filter: drop-shadow(0 1px 2px rgba(10, 18, 30, 0.34));
}

.status-dot {
  position: relative;
  z-index: 3;
  grid-column: 2;
  justify-self: center;
  width: 7px;
  height: 7px;
  box-shadow: 0 0 0 1.5px rgba(255, 250, 241, 0.88);
}

.status-ok {
  background: var(--rb-blue-soft);
}

.status-partial {
  background: var(--rb-mustard);
}

.status-error {
  background: var(--rb-red);
}

.collapsed-main {
  position: relative;
  z-index: 2;
  display: grid;
  grid-column: 3;
  grid-template-columns: minmax(0, 1fr) 1px auto;
  column-gap: 4px;
  align-items: center;
  min-width: 0;
  padding-left: 0;
}

.collapsed-main::before {
  content: "";
  grid-column: 2;
  grid-row: 1;
  position: relative;
  z-index: 3;
  width: 1px;
  height: 22px;
  background: rgba(125, 114, 99, 0.34);
}

.platform {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  color: var(--rb-ink-soft);
  overflow: hidden;
  font-size: 10px;
  font-weight: 760;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.primary {
  grid-column: 3;
  grid-row: 1;
  position: relative;
  z-index: 4;
  color: var(--rb-ink);
  font-size: 11px;
  font-weight: 780;
  line-height: 1;
  padding-left: 5px;
  background: linear-gradient(90deg, rgba(255, 250, 241, 0.08), var(--rb-paper-warm) 7px);
  text-align: right;
}

.platform-overflow .platform {
  position: absolute;
  left: -42px;
  right: 46px;
  z-index: 1;
  box-sizing: border-box;
  padding-left: 14px;
}

.platform-overflow .platform::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 0;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--rb-blue-soft);
  box-shadow: 0 0 0 1.5px rgba(255, 250, 241, 0.88);
  transform: translateY(-50%);
}

.platform-overflow .status-dot {
  opacity: 0;
}

.platform-overflow .status-partial + .collapsed-main .platform::before {
  background: var(--rb-mustard);
}

.platform-overflow .status-error + .collapsed-main .platform::before {
  background: var(--rb-red);
}

.capsule-mascot {
  position: absolute;
  left: 72px;
  bottom: -22px;
  z-index: 5;
  width: 166px;
  height: auto;
  max-width: none;
  object-fit: contain;
  object-position: center bottom;
  pointer-events: none;
  transform: translateX(-50%);
  filter: drop-shadow(0 6px 9px rgba(24, 33, 44, 0.24));
}

.meta,
.gpt-panel > .meta,
.model-meta {
  border-color: rgba(112, 103, 93, 0.2);
  background: rgba(255, 250, 241, 0.58);
}

.meta {
  padding: 8px 12px;
  font-size: 11px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.inline-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
}

.vine-divider {
  height: 16px;
  margin: 0 12px 2px;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.panel .vine-divider {
  height: 12px;
  margin-inline: 10px;
}

.vine-divider-image {
  width: 100%;
  height: 100%;
  opacity: 0.68;
}

.content {
  padding: 6px 10px 20px;
}

.gpt-content {
  padding: 0 10px 28px;
  background:
    radial-gradient(circle at 50% 0%, rgba(143, 168, 196, 0.2), transparent 34%),
    linear-gradient(180deg, rgba(255, 250, 241, 0.58), rgba(246, 238, 225, 0.62));
  scrollbar-width: thin;
  scrollbar-color: rgba(63, 88, 116, 0.32) transparent;
}

.gpt-content::-webkit-scrollbar,
.gpt-content:hover::-webkit-scrollbar,
.gpt-content:focus-within::-webkit-scrollbar {
  width: 6px;
}

.gpt-content::-webkit-scrollbar-thumb {
  background: rgba(63, 88, 116, 0.32);
}

.panel-corners,
.card-corners {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.corner {
  position: absolute;
  width: 34px;
  height: 34px;
  opacity: 0.48;
}

.compact-corners .corner {
  width: 26px;
  height: 26px;
  opacity: 0.34;
}

.corner-top-left {
  top: 3px;
  left: 3px;
}

.corner-top-right {
  top: 3px;
  right: 3px;
}

.corner-bottom-left {
  bottom: 21px;
  left: 3px;
}

.corner-bottom-right {
  right: 3px;
  bottom: 21px;
}

.meter-section {
  margin-top: 9px;
  padding: 10px 12px 10px;
  border: 1px solid rgba(112, 103, 93, 0.28);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 253, 247, 0.92), rgba(247, 239, 225, 0.82)),
    radial-gradient(circle at 100% 0%, rgba(143, 168, 196, 0.16), transparent 32%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.62), 0 7px 16px rgba(37, 45, 56, 0.08);
  overflow: hidden;
}

.meter-section::before {
  content: "";
  position: absolute;
  inset: 5px;
  border: 1px solid rgba(112, 103, 93, 0.12);
  border-radius: 8px;
  pointer-events: none;
  z-index: 0;
}

.meter-section::after {
  content: none;
}

.meter-section-title {
  position: relative;
  z-index: 1;
  padding: 1px 30px 7px 0;
  color: var(--rb-ink);
  font-size: 13px;
}

.meter-section-title::after {
  content: "";
  height: 1px;
  min-width: 24px;
  flex: 1 1 auto;
  background: linear-gradient(90deg, rgba(63, 88, 116, 0.35), rgba(212, 166, 68, 0.24), transparent);
}

.section-title-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
}

.section-badge {
  position: absolute;
  top: 9px;
  right: 10px;
  width: 24px;
  height: 24px;
  z-index: 1;
  opacity: 0.9;
  filter: drop-shadow(0 3px 5px rgba(31, 43, 59, 0.16));
}

.shield-badge {
  top: 27px;
  width: 36px;
  height: 36px;
}

.ip-risk-block {
  padding-right: 48px;
}

.card-corners {
  opacity: 0.34;
}

.card-corner {
  position: absolute;
  width: 18px;
  height: 18px;
  opacity: 0.48;
}

.card-corner-top-left {
  top: 3px;
  left: 3px;
}

.card-corner-bottom-right {
  display: none;
}

.meter,
.gpt-content .meter {
  padding: 9px 0;
  border-top-color: rgba(112, 103, 93, 0.18);
  border-radius: 8px;
}

.meter:hover {
  background: rgba(143, 168, 196, 0.12);
}

.meter-label {
  color: var(--rb-ink);
  font-weight: 760;
}

.meter-value {
  color: var(--rb-blue);
  font-weight: 760;
}

.bar {
  position: relative;
  height: 8px;
  margin-top: 8px;
  overflow: visible;
  border: 1px solid rgba(112, 103, 93, 0.2);
  background: linear-gradient(180deg, #e9dfd0, #f6eee2);
  box-shadow: inset 0 1px 2px rgba(54, 72, 94, 0.12);
}

.bar-fill {
  position: relative;
  background: linear-gradient(90deg, var(--rb-blue), var(--rb-blue-soft));
  box-shadow: 0 0 8px rgba(63, 88, 116, 0.24);
}

.bar-fill.remaining-fill {
  background: linear-gradient(90deg, var(--rb-blue-soft), var(--rb-mustard));
}

.bar-fill::after {
  content: none;
}

.progress-leaf {
  position: absolute;
  top: 50%;
  left: clamp(7px, var(--meter-progress), calc(100% - 7px));
  width: 14px;
  height: 14px;
  transform: translate(-50%, -50%);
  filter: drop-shadow(0 1px 2px rgba(31, 43, 59, 0.28));
  pointer-events: none;
}

.badge {
  border-color: rgba(112, 103, 93, 0.28);
  background: linear-gradient(180deg, rgba(255, 250, 241, 0.96), rgba(239, 230, 215, 0.86));
  color: var(--rb-blue);
  box-shadow: var(--rb-inner);
}

.badge::before {
  content: "•";
  margin-right: 4px;
  color: var(--rb-blue-soft);
}

.settings-header {
  padding: 10px 0 9px;
  border-bottom: 1px solid rgba(112, 103, 93, 0.22);
}

.settings-check {
  color: var(--rb-ink);
}

.settings-input-wrap,
.settings-input {
  border-color: rgba(112, 103, 93, 0.34);
  background: rgba(255, 250, 241, 0.86);
  color: var(--rb-ink);
}

.settings-input::placeholder {
  color: rgba(112, 103, 93, 0.62);
}

.settings-input-wrap:focus-within,
.settings-input:focus {
  border-color: rgba(63, 88, 116, 0.76);
}

.settings-eye-button {
  box-shadow: none;
}

.empty {
  color: var(--rb-brown);
}

@media (max-width: 480px) {
  .collapsed,
  .gpt-restore-chip {
    width: min(160px, calc(100vw - 12px));
    min-width: 152px;
    height: 42px;
    min-height: 42px;
    grid-template-columns: 72px 7px minmax(0, 1fr);
    gap: 3px;
    background:
      linear-gradient(90deg, var(--rb-blue) 0 42px, transparent 42px),
      linear-gradient(180deg, var(--rb-paper-warm), var(--rb-paper-soft));
    padding: 0 6px 0 5px;
  }

  .collapsed::before,
  .gpt-restore-chip::before {
    width: 32px;
  }

  .collapsed::after,
  .gpt-restore-chip::after {
    left: 10px;
    transform: scale(0.76);
    transform-origin: left center;
  }

  .collapsed:hover,
  .gpt-restore-chip:hover {
    background:
      linear-gradient(90deg, #2d405a 0 42px, transparent 42px),
      linear-gradient(180deg, #fffdf7, #f1e9db);
  }

  .collapsed-main {
    column-gap: 3px;
  }

  .collapsed-main::before {
    height: 20px;
  }

  .platform {
    font-size: 9px;
  }

  .primary {
    font-size: 10px;
  }

  .platform-overflow .platform {
    left: -36px;
    right: 40px;
    padding-left: 13px;
  }

  .platform-overflow .platform::before {
    width: 6px;
    height: 6px;
  }

  .capsule-mascot {
    left: 66px;
    bottom: -20px;
    width: 154px;
  }

  .gpt-panel {
    width: min(370px, calc(100vw - 12px));
    height: min(536px, calc(100vh - 14px));
  }

  .gpt-alerts {
    display: none;
  }
}

/* Existing theme, with stable controls and viewport-safe content. */
:host { max-width: calc(100% - 16px); transform: none; }
.panel { display: flex; flex-direction: column; max-height: calc(100dvh - 16px); }
.panel { transform: translateY(-50%); }
.panel, .gpt-panel { max-width: 100%; }
.gpt-panel { min-height: 0; height: min(552px, calc(100dvh - 16px)); width: min(390px, calc(100vw - 16px)); }
.header, .meta, .model-meta { flex-shrink: 0; }
.content { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.icon-button { width: 32px; height: 32px; min-width: 32px; min-height: 32px; flex-shrink: 0; }
.icon-button:disabled { opacity: .55; cursor: wait; transform: none; }
button:focus-visible, select:focus-visible { outline: 2px solid var(--rb-blue); outline-offset: 2px; }
.meter-top { align-items: start; gap: 8px; }
.meter-label { min-width: 0; overflow-wrap: anywhere; white-space: normal; font-size: 13px; }
.meter-value { text-align: right; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.meter-bottom { flex-wrap: wrap; gap: 5px 8px; font-size: 12px; }
.badge, .meta, .settings-label, .settings-help, .model-meta { font-size: 12px; }
.settings-popover { max-height: calc(100dvh - 16px); max-width: calc(100% - 16px); overflow-y: auto; width: min(360px, calc(100vw - 16px)); }
.panel { width: min(314px, calc(100vw - 16px)); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
@media (max-width: 520px), (max-height: 600px) {
  :host([data-platform="chatgpt"]) { top: 8px; right: 8px; }
  :host:not([data-platform="chatgpt"]) { right: 8px; }
  .settings-popover { top: 8px; right: 8px; }
}
`;
  const PLATFORM_LABEL = {
    grok: "Grok",
    claude: "Claude",
    chatgpt: "GPT",
    kimi: "Kimi",
    gemini: "Gemini",
    perplexity: "Perplexity"
  };
  const GPT_SECTION_ORDER = [
    "subscription",
    "input",
    "features",
    "windows",
    "codex",
    "other"
  ];
  class UsageWidget {
    constructor(platform2, onRefresh, handlers = {}) {
      this.platform = platform2;
      this.onRefresh = onRefresh;
      this.handlers = handlers;
      this.expanded = false;
      this.hidden = platform2 === "chatgpt";
      this.host.id = "ai-usage-floating-monitor";
      this.host.dataset.platform = platform2;
      const style = document.createElement("style");
      style.textContent = WIDGET_CSS;
      this.shadow.append(style, this.root);
      this.timerId = window.setInterval(() => this.tickTimes(), 1e3);
      this.mountWatchId = window.setInterval(() => this.ensureMounted(), 2e3);
      window.addEventListener("resize", this.onResize);
      this.root.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (this.settingsOpen) this.closeSettings();
        else {
          if (this.platform === "chatgpt") this.hidden = true;
          else this.expanded = false;
          this.render();
        }
      });
    }
    host = document.createElement("div");
    shadow = this.host.attachShadow({ mode: "open" });
    root = document.createElement("div");
    expanded = false;
    hidden = false;
    chipPosition = { edge: "right", offset: 96 };
    loading = false;
    settingsOpen = false;
    renderFrame = 0;
    destroyed = false;
    onResize = () => {
      if (!this.hidden && this.expanded) return;
      const chip = this.root.querySelector(".collapsed,.gpt-restore-chip");
      if (!chip) return;
      const bounds = chip.getBoundingClientRect();
      const vertical = this.chipPosition.edge === "left" || this.chipPosition.edge === "right";
      const maximum = (vertical ? window.innerHeight - bounds.height : window.innerWidth - bounds.width) - 8;
      this.chipPosition.offset = Math.max(8, Math.min(this.chipPosition.offset, maximum));
      this.applyChipPosition();
    };
    snapshot = null;
    backoffUntil = 0;
    languageMode = DEFAULT_LANGUAGE_MODE;
    resolvedLanguage = resolveLanguage(DEFAULT_LANGUAGE_MODE);
    timerId;
    mountWatchId;
    mount() {
      this.ensureMounted();
      this.render();
    }
    destroy() {
      window.clearInterval(this.timerId);
      window.clearInterval(this.mountWatchId);
      this.destroyed = true;
      window.removeEventListener("resize", this.onResize);
      cancelAnimationFrame(this.renderFrame);
      this.host.remove();
    }
    setSnapshot(snapshot) {
      this.snapshot = snapshot;
      this.render();
    }
    setLoading(value) {
      this.loading = value;
      this.render();
    }
    setBackoffUntil(value) {
      this.backoffUntil = value;
      this.render();
    }
    setLanguageMode(value) {
      this.languageMode = value;
      this.resolvedLanguage = resolveLanguage(value);
      this.render();
    }
    text(key2, params) {
      return t(this.resolvedLanguage, key2, params);
    }
    render() {
      if (this.destroyed || this.renderFrame) return;
      this.renderFrame = requestAnimationFrame(() => {
        this.renderFrame = 0;
        if (!this.destroyed) this.renderNow();
      });
    }
    tickTimes() {
      if (document.visibilityState === "hidden" || this.hidden || this.platform !== "chatgpt" && !this.expanded) return;
      for (const node2 of this.root.querySelectorAll("[data-time]")) {
        let value = node2.textContent ?? "";
        if (node2.dataset.time === "updated" && this.snapshot) value = this.text("meta.updatedAt", { age: formatAgeLocalized(this.resolvedLanguage, this.snapshot.updatedAt) });
        if (node2.dataset.time === "checked" && this.snapshot?.checkedAt) value = this.text("meta.checkedAt", { age: formatAgeLocalized(this.resolvedLanguage, this.snapshot.checkedAt) });
        if (node2.dataset.time === "backoff") value = this.text("meta.waitSeconds", { seconds: Math.max(0, Math.ceil(this.backoffRemainingMs() / 1e3)) });
        const meter = this.snapshot?.meters.find((item) => item.key === node2.dataset.meterKey);
        if (meter && node2.dataset.time === "reset") value = this.formatMeterTimePreview(meter);
        if (meter && node2.dataset.time === "badge") value = this.meterBadge(meter);
        if (meter && node2.dataset.time === "subscription") value = formatMeterValueLocalized(this.resolvedLanguage, meter);
        if (node2.textContent !== value) node2.textContent = value;
      }
    }
    renderNow() {
      this.ensureMounted();
      if (this.hidden) {
        this.settingsOpen = false;
        reconcileChildren(this.root, [this.platform === "chatgpt" ? this.renderChatGptRestoreChip() : emptyNode()]);
        return;
      }
      if (this.platform === "chatgpt") {
        if (!this.hidden) {
          this.resetPanelPosition();
        }
        this.replaceRootWith(this.renderChatGptPanel());
        return;
      }
      if (this.expanded) {
        this.resetPanelPosition();
      }
      this.replaceRootWith(this.expanded ? this.renderPanel() : this.renderCollapsed());
    }
    ensureMounted() {
      if (!this.host.isConnected) {
        document.documentElement.append(this.host);
      }
    }
    replaceRootWith(main) {
      if (this.settingsOpen) {
        reconcileChildren(this.root, [main, this.renderSettingsDialog()]);
        return;
      }
      reconcileChildren(this.root, [main]);
    }
    schedulePlatformOverflowCheck(button) {
      const platformLabel = button.querySelector(".platform");
      if (!platformLabel) {
        return;
      }
      requestAnimationFrame(() => {
        if (!button.isConnected) {
          return;
        }
        button.classList.remove("platform-overflow");
        const platformName = platformLabel.textContent?.trim() ?? "";
        const overflows = platformLabel.scrollWidth > platformLabel.clientWidth + 1;
        const shouldSitBehindMascot = overflows || platformName.length >= 6;
        button.classList.toggle("platform-overflow", shouldSitBehindMascot);
      });
    }
    renderChatGptRestoreChip() {
      const button = el("button", "gpt-restore-chip");
      button.dataset.nodeKey = "chip";
      button.type = "button";
      this.applyChipPosition();
      button.setAttribute("aria-label", this.text("action.restoreGptPanel"));
      this.installChipDrag(button, () => {
        this.hidden = false;
        this.expanded = true;
        this.resetPanelPosition();
        this.render();
      });
      button.append(
        decorativeAsset("capsule-mascot.png", "capsule-mascot"),
        decorativeAsset("leaf-emblem.png", "chip-icon"),
        el("span", `status-dot status-${this.snapshot?.status ?? "unknown"}`),
        node("span", "collapsed-main", [
          textEl("span", "platform", "GPT"),
          textEl("span", "primary", this.chatGptPrimaryValue())
        ])
      );
      this.schedulePlatformOverflowCheck(button);
      return button;
    }
    applyChipPosition() {
      const margin = 8;
      this.host.style.top = "";
      this.host.style.right = "";
      this.host.style.bottom = "";
      this.host.style.left = "";
      this.host.style.transform = "none";
      if (this.chipPosition.edge === "left") {
        this.host.style.left = `${margin}px`;
        this.host.style.top = `${this.chipPosition.offset}px`;
        return;
      }
      if (this.chipPosition.edge === "right") {
        this.host.style.right = `${margin}px`;
        this.host.style.top = `${this.chipPosition.offset}px`;
        return;
      }
      if (this.chipPosition.edge === "top") {
        this.host.style.top = `${margin}px`;
        this.host.style.left = `${this.chipPosition.offset}px`;
        return;
      }
      this.host.style.bottom = `${margin}px`;
      this.host.style.left = `${this.chipPosition.offset}px`;
    }
    resetPanelPosition() {
      this.host.style.top = "";
      this.host.style.right = "";
      this.host.style.bottom = "";
      this.host.style.left = "";
      this.host.style.transform = "";
    }
    installChipDrag(button, onActivate) {
      let startX = 0;
      let startY = 0;
      let moved = false;
      let suppressPointerClickUntil = 0;
      const onPointerMove = (event) => {
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        if (!moved && Math.hypot(deltaX, deltaY) < 4) {
          return;
        }
        moved = true;
        this.updateChipPositionFromPoint(event.clientX, event.clientY);
        this.applyChipPosition();
      };
      const onPointerUp = (event) => {
        button.releasePointerCapture(event.pointerId);
        button.removeEventListener("pointermove", onPointerMove);
        button.removeEventListener("pointerup", onPointerUp);
        button.removeEventListener("pointercancel", onPointerUp);
        if (moved) {
          suppressPointerClickUntil = Date.now() + 350;
          event.preventDefault();
        }
      };
      button.addEventListener("click", (event) => {
        if (event.detail > 0 && Date.now() < suppressPointerClickUntil) {
          suppressPointerClickUntil = 0;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        suppressPointerClickUntil = 0;
        onActivate();
      });
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }
        startX = event.clientX;
        startY = event.clientY;
        moved = false;
        button.setPointerCapture(event.pointerId);
        button.addEventListener("pointermove", onPointerMove);
        button.addEventListener("pointerup", onPointerUp);
        button.addEventListener("pointercancel", onPointerUp);
      });
    }
    updateChipPositionFromPoint(clientX, clientY) {
      const margin = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const distances = {
        left: clientX,
        right: viewportWidth - clientX,
        top: clientY,
        bottom: viewportHeight - clientY
      };
      const edge = Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0] ?? "right";
      if (edge === "left" || edge === "right") {
        this.chipPosition = {
          edge,
          offset: clamp(clientY - 24, margin, viewportHeight - 56)
        };
        return;
      }
      this.chipPosition = {
        edge,
        offset: clamp(clientX - 44, margin, viewportWidth - 96)
      };
    }
    renderChatGptPanel() {
      const panel = el("section", "gpt-panel");
      panel.dataset.nodeKey = "panel";
      panel.append(
        panelCorners("panel-corners"),
        this.renderChatGptHeader(),
        this.renderMeta(),
        vineDivider(),
        this.renderChatGptContent()
      );
      return panel;
    }
    renderChatGptHeader() {
      const header = el("div", "header gpt-header");
      const title = titleNode("title gpt-title", this.text("gpt.title"), "clover-medallion.png");
      const right = el("div", "gpt-header-right");
      right.append(
        textEl("span", "gpt-alerts", this.text("gpt.alertCount", { count: this.alertCount() }))
      );
      const actions = el("div", "actions gpt-actions");
      const refresh = this.renderActionButton(
        this.loading ? "..." : "↻",
        this.text("action.refreshUsage"),
        () => this.onRefresh()
      );
      refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
      refresh.setAttribute("aria-busy", String(this.loading));
      const close = this.renderActionButton("×", this.text("action.hidePanel"), () => {
        this.hidden = true;
        this.render();
      });
      actions.append(this.renderSettingsButton(), refresh, close);
      right.append(actions);
      header.append(title, right);
      return header;
    }
    renderChatGptContent() {
      const content = el("div", "content gpt-content");
      if (this.snapshot?.errorMessage) {
        content.append(textEl("div", "error", this.snapshot.meters.length ? this.resolvedLanguage === "zh-CN" ? "部分查询失败，显示上次读数" : "Some queries failed. Showing saved readings." : this.resolvedLanguage === "zh-CN" ? "暂时无法获取额度，请稍后刷新" : "Usage unavailable. Try refreshing later."));
      }
      const meters = this.chatGptMeters();
      if (meters.length === 0) {
        content.append(textEl("div", "empty", this.loading ? this.text("meta.loading") : this.text("usage.empty")));
        return content;
      }
      for (const section of groupChatGptMeters(meters, this.resolvedLanguage)) {
        content.append(this.renderMeterSection(section.label, section.meters, section.key));
      }
      return content;
    }
    closeSettings() {
      this.settingsOpen = false;
      this.render();
      requestAnimationFrame(() => this.root.querySelector('[data-action="settings"]')?.focus());
    }
    renderSettingsDialog() {
      const panel = el("section", "settings-popover");
      panel.dataset.nodeKey = "settings";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", this.text("settings.title"));
      const header = el("div", "settings-header");
      header.append(
        titleNode("settings-title", this.text("settings.title"), "clover-medallion.png"),
        this.renderActionButton("×", this.text("action.closeSettings"), () => this.closeSettings())
      );
      const select = document.createElement("select");
      select.className = "settings-input";
      select.dataset.nodeKey = "language";
      select.setAttribute("aria-label", this.text("language.label"));
      for (const [value, label] of [["auto", "language.auto"], ["zh-CN", "language.zhCN"], ["en", "language.en"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = this.text(label);
        select.append(option);
      }
      select.value = this.languageMode;
      select.addEventListener("change", () => {
        const mode = languageModeFromValue(select.value);
        this.setLanguageMode(mode);
        this.handlers.onLanguageModeSave?.(mode);
      });
      panel.append(header, textEl("label", "settings-label", this.text("language.label")), select);
      return panel;
    }
    renderMeterSection(label, meters, groupKey) {
      const section = el("section", "meter-section");
      section.dataset.nodeKey = `section:${groupKey}`;
      section.append(cardCorners(), sectionTitle(label, "leaf-small.png"));
      for (const meter of meters) {
        section.append(this.renderMeter(meter));
      }
      return section;
    }
    renderActionButton(text, label, onClick) {
      const button = textEl("button", "icon-button", text);
      button.type = "button";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.addEventListener("click", onClick);
      return button;
    }
    renderSettingsButton() {
      const button = this.renderActionButton("⚙", this.text("action.settings"), () => {
        this.settingsOpen = !this.settingsOpen;
        this.render();
      });
      button.dataset.action = "settings";
      return button;
    }
    renderCollapsed() {
      const button = el("button", "collapsed");
      button.dataset.nodeKey = "chip";
      button.type = "button";
      button.setAttribute(
        "aria-label",
        this.text("action.openUsage", { platform: PLATFORM_LABEL[this.platform] })
      );
      this.applyChipPosition();
      this.installChipDrag(button, () => {
        this.expanded = true;
        this.render();
      });
      button.append(
        decorativeAsset("capsule-mascot.png", "capsule-mascot"),
        decorativeAsset(platformTitleAsset(this.platform), "chip-icon"),
        el("span", `status-dot status-${this.snapshot?.status ?? "unknown"}`),
        node("span", "collapsed-main", [
          textEl("span", "platform", PLATFORM_LABEL[this.platform]),
          textEl("span", "primary", this.collapsedPrimaryValue())
        ])
      );
      this.schedulePlatformOverflowCheck(button);
      return button;
    }
    renderPanel() {
      const panel = el("section", "panel");
      panel.dataset.nodeKey = "panel";
      panel.append(panelCorners("panel-corners compact-corners"), this.renderHeader(), this.renderMeta(), vineDivider());
      if (this.platform === "grok") {
        const modelMeta = this.renderGrokModelMeta();
        if (modelMeta) {
          panel.append(modelMeta);
        }
      }
      panel.append(this.renderContent());
      return panel;
    }
    renderHeader() {
      const header = el("div", "header");
      const title = titleNode(
        "title",
        this.text("usage.title", { platform: PLATFORM_LABEL[this.platform] }),
        platformTitleAsset(this.platform)
      );
      const actions = el("div", "actions");
      const refresh = textEl("button", "icon-button", this.loading ? "..." : "↻");
      refresh.type = "button";
      refresh.setAttribute("aria-label", this.text("action.refreshUsage"));
      refresh.title = this.text("action.refreshUsage");
      refresh.disabled = this.loading || this.backoffRemainingMs() > 0;
      refresh.addEventListener("click", this.onRefresh);
      const close = textEl("button", "icon-button", "×");
      close.type = "button";
      close.setAttribute("aria-label", this.text("action.collapseWidget"));
      close.title = this.text("action.collapseWidget");
      close.addEventListener("click", () => {
        this.expanded = false;
        this.render();
      });
      actions.append(this.renderSettingsButton(), refresh, close);
      header.append(title, actions);
      return header;
    }
    renderMeta() {
      const meta = el("div", "meta");
      const updated = this.snapshot ? this.text("meta.updatedAt", {
        age: formatAgeLocalized(this.resolvedLanguage, this.snapshot.updatedAt)
      }) : this.text("meta.neverUpdated");
      const right = this.backoffRemainingMs() > 0 ? this.text("meta.waitSeconds", {
        seconds: Math.ceil(this.backoffRemainingMs() / 1e3)
      }) : this.platform === "chatgpt" && this.snapshot?.checkedAt ? this.text("meta.checkedAt", {
        age: formatAgeLocalized(this.resolvedLanguage, this.snapshot.checkedAt)
      }) : this.snapshot?.cacheAgeMs !== void 0 ? this.text("meta.cacheSeconds", {
        seconds: Math.floor(this.snapshot.cacheAgeMs / 1e3)
      }) : this.loading ? this.text("meta.loading") : "";
      const updatedNode = textEl("span", "", updated);
      updatedNode.dataset.time = "updated";
      const rightNode = textEl("span", "", right);
      rightNode.dataset.time = this.backoffRemainingMs() > 0 ? "backoff" : this.snapshot?.checkedAt ? "checked" : "cache";
      const leftWrap = el("span", "meta-item");
      leftWrap.append(decorativeAsset("leaf-small.png", "inline-icon"), updatedNode);
      const rightWrap = el("span", "meta-item");
      rightWrap.append(rightNode);
      meta.append(leftWrap, rightWrap);
      return meta;
    }
    renderGrokModelMeta() {
      const summary = this.grokModelSummary();
      if (!summary) {
        return null;
      }
      const meta = el("div", "model-meta");
      const value = textEl("span", "model-value", summary);
      value.title = summary;
      meta.append(textEl("span", "model-label", this.text("model.label")), value);
      return meta;
    }
    renderContent() {
      const content = el("div", "content");
      if (this.snapshot?.errorMessage) {
        content.append(textEl("div", "error", this.snapshot.errorMessage));
      }
      const meters = (this.snapshot?.meters ?? []).filter(hasMeaningfulValue);
      if (meters.length === 0) {
        content.append(textEl("div", "empty", this.loading ? this.text("meta.loading") : this.text("usage.empty")));
        return content;
      }
      if (this.platform === "grok" && this.appendGrokCreditsContent(content, meters)) {
        return content;
      }
      for (const meter of meters) {
        content.append(this.renderMeter(meter));
      }
      return content;
    }
    appendGrokCreditsContent(content, meters) {
      const total = meters.find((meter) => meter.rawKind === "grokCreditsConfig:total");
      const products = meters.filter(isGrokCreditsProductMeter).sort(grokCreditsProductCompare);
      if (!total && products.length === 0) {
        return false;
      }
      if (total) {
        content.append(this.renderGrokCreditsMeter(total, products));
      } else {
        for (const product of products) {
          content.append(this.renderMeter(product));
        }
      }
      for (const meter of meters) {
        if (meter !== total && !isGrokCreditsProductMeter(meter)) {
          content.append(this.renderMeter(meter));
        }
      }
      return true;
    }
    renderGrokCreditsMeter(total, products) {
      const row = el("div", "meter grok-credits-meter");
      row.dataset.nodeKey = `meter:${total.key}`;
      const top = el("div", "meter-top");
      top.append(
        textEl(
          "div",
          "meter-label",
          formatMeterLabelLocalized(this.resolvedLanguage, total)
        ),
        textEl("div", "meter-value", this.formatUsedPercentValue(total))
      );
      const progress = usedMeterProgress(total);
      const bar = el("div", "bar grok-stack-bar");
      const stack = el("div", "grok-stack-fill");
      const visibleProducts = products.filter((product) => usedMeterProgress(product) > 0);
      if (visibleProducts.length > 0) {
        visibleProducts.forEach((product, index) => {
          const segment = el("span", "grok-stack-segment");
          const value = usedMeterProgress(product);
          segment.style.width = `${value}%`;
          segment.style.background = grokContributionColor(index);
          segment.title = `${formatMeterLabelLocalized(
            this.resolvedLanguage,
            product
          )} ${this.formatUsedPercentValue(product)}`;
          stack.append(segment);
        });
      } else {
        const segment = el("span", "grok-stack-segment");
        segment.style.width = `${progress}%`;
        segment.style.background = grokContributionColor(0);
        stack.append(segment);
      }
      bar.style.setProperty("--meter-progress", `${progress}%`);
      bar.append(stack, decorativeAsset("leaf-small.png", "progress-leaf"));
      const details = el("div", "grok-contribution-list");
      products.forEach((product, index) => {
        const item = el("span", "grok-contribution");
        const dot = el("span", "grok-contribution-dot");
        dot.style.background = grokContributionColor(index);
        item.append(
          dot,
          textEl(
            "span",
            "grok-contribution-label",
            formatMeterLabelLocalized(this.resolvedLanguage, product)
          ),
          textEl("span", "grok-contribution-value", this.formatUsedPercentValue(product))
        );
        details.append(item);
      });
      row.append(top, bar);
      if (products.length > 0) {
        row.append(details);
      }
      row.append(this.renderMeterBottom(total));
      return row;
    }
    renderMeter(meter) {
      const row = el("div", "meter");
      row.dataset.nodeKey = `meter:${meter.key}`;
      const top = el("div", "meter-top");
      top.append(
        textEl(
          "div",
          "meter-label",
          formatMeterLabelLocalized(this.resolvedLanguage, meter)
        ),
        textEl(
          "div",
          "meter-value",
          formatMeterValueLocalized(this.resolvedLanguage, meter)
        )
      );
      const progress = meterProgress(meter);
      const bar = el("div", "bar");
      const fill = el("div", "bar-fill");
      if (typeof meter.remainingPercent === "number") {
        fill.classList.add("remaining-fill");
      }
      fill.style.width = `${progress}%`;
      bar.style.setProperty("--meter-progress", `${progress}%`);
      bar.append(fill, decorativeAsset("leaf-small.png", "progress-leaf"));
      if (meter.rawKind === "chatgpt.subscription") {
        const value = top.querySelector(".meter-value");
        if (value) {
          value.dataset.time = "subscription";
          value.dataset.meterKey = meter.key;
        }
      }
      const label = top.querySelector(".meter-label");
      if (label) label.title = label.textContent ?? "";
      row.append(top);
      if (progress !== null) row.append(bar);
      row.append(this.renderMeterBottom(meter));
      return row;
    }
    meterBadge(meter) {
      const source = formatSourceLabelLocalized(this.resolvedLanguage, meter.source);
      const uncalibrated = meter.quotaState === "unknown" ? this.resolvedLanguage === "zh-CN" ? "未校准" : "Uncalibrated" : formatConfidenceLabelLocalized(this.resolvedLanguage, meter.confidence);
      const age = meter.observedAt ? formatAgeLocalized(this.resolvedLanguage, meter.observedAt) : "";
      const stale = this.platform === "chatgpt" && meter.observedAt && Date.now() - meter.observedAt > STALE_METER_MS ? this.resolvedLanguage === "zh-CN" ? " · 数据较旧" : " · Stale" : "";
      return `${source} · ${uncalibrated}${age ? ` · ${age}` : ""}${stale}`;
    }
    renderMeterBottom(meter) {
      const bottom = el("div", "meter-bottom");
      const badge = textEl("span", "badge", this.meterBadge(meter));
      badge.dataset.time = "badge";
      badge.dataset.meterKey = meter.key;
      const reset = textEl("span", "", this.formatMeterTimePreview(meter));
      reset.dataset.time = "reset";
      reset.dataset.meterKey = meter.key;
      bottom.append(badge, reset);
      return bottom;
    }
    formatMeterTimePreview(meter) {
      if (meter.unit === "bytes" && typeof meter.used === "number" && typeof meter.total === "number") {
        const fmt = (n) => (n / 1073741824).toLocaleString(this.resolvedLanguage, { maximumFractionDigits: 2 });
        return this.resolvedLanguage === "zh-CN" ? `已用 ${fmt(meter.used)} / 共 ${fmt(meter.total)} GiB` : `Used ${fmt(meter.used)} / ${fmt(meter.total)} GiB`;
      }
      if (meter.quotaState === "unknown") return "";
      if (meter.rawKind === "chatgpt.subscription") {
        return formatSubscriptionExpiryLocalized(this.resolvedLanguage, meter);
      }
      return formatResetLocalized(this.resolvedLanguage, meter);
    }
    formatUsedPercentValue(meter) {
      if (typeof meter.usedPercent === "number") {
        return this.text("meter.usedPercent", {
          percent: Math.round(meter.usedPercent)
        });
      }
      return formatMeterValueLocalized(this.resolvedLanguage, meter);
    }
    primaryValue() {
      const meters = this.snapshot?.meters ?? [];
      const byRemaining = meters.filter((meter) => typeof meter.remaining === "number").sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0))[0];
      if (byRemaining?.remaining !== void 0 && byRemaining.remaining !== null) {
        return `${byRemaining.remaining}`;
      }
      const byRemainingPercent = meters.filter((meter) => typeof meter.remainingPercent === "number").sort((a, b) => (a.remainingPercent ?? 0) - (b.remainingPercent ?? 0))[0];
      if (byRemainingPercent?.remainingPercent !== void 0 && byRemainingPercent.remainingPercent !== null) {
        return this.text("meter.remainingPercent", {
          percent: Math.round(byRemainingPercent.remainingPercent)
        });
      }
      const byPercent = meters.find((meter) => typeof meter.usedPercent === "number");
      if (byPercent?.usedPercent !== void 0 && byPercent.usedPercent !== null) {
        return `${Math.round(byPercent.usedPercent)}%`;
      }
      return "?";
    }
    collapsedPrimaryValue() {
      if (this.platform === "grok") {
        return this.grokPrimaryValue();
      }
      return this.primaryValue();
    }
    alertCount() {
      return this.chatGptMeters().filter(isAlertMeter).length;
    }
    chatGptMeters() {
      const meters = [...this.snapshot?.meters ?? []].filter((meter) => hasMeaningfulValue(meter) && !isChatPassPath(meter.key));
      return meters.sort((a, b) => chatGptMeterPriority(a) - chatGptMeterPriority(b));
    }
    chatGptPrimaryValue() {
      const meters = this.chatGptMeters();
      const primary = chatGptPrimaryMeter(meters);
      return primary ? formatMeterValueLocalized(this.resolvedLanguage, primary) : "?";
    }
    backoffRemainingMs() {
      return Math.max(0, this.backoffUntil - Date.now());
    }
    grokModelSummary() {
      const values = unique(
        (this.snapshot?.meters ?? []).map((meter) => modelSummaryFromMeter(meter)).filter((value) => Boolean(value))
      );
      return values.join(", ");
    }
    grokPrimaryValue() {
      const meter = this.grokPrimaryMeter();
      if (!meter) {
        return this.primaryValue();
      }
      if (meter.rawKind?.startsWith("grokCreditsConfig:")) {
        return this.formatUsedPercentValue(meter);
      }
      return formatMeterValueLocalized(this.resolvedLanguage, meter);
    }
    grokPrimaryMeter() {
      const meters = [...this.snapshot?.meters ?? []];
      return meters.sort(
        (a, b) => grokMeterPriority(a) - grokMeterPriority(b) || (b.observedAt ?? 0) - (a.observedAt ?? 0)
      )[0] ?? null;
    }
  }
  function usedMeterProgress(meter) {
    if (typeof meter.usedPercent === "number") {
      return clampPercent$1(meter.usedPercent);
    }
    return meterProgress(meter) ?? 0;
  }
  function clampPercent$1(value) {
    return Math.max(0, Math.min(100, value));
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function chatGptMeterPriority(meter) {
    const key2 = meter.key.toLowerCase();
    const label = meter.label.toLowerCase();
    if (key2.startsWith("limits_progress:file_upload")) {
      return 10;
    }
    if (key2.startsWith("limits_progress:") || key2.startsWith("blocked_features:") || meter.rawKind === "limits_progress" || meter.rawKind === "blocked_features") {
      return 20;
    }
    if (label.includes("primary window") || label.includes("5-hour window")) {
      return 40;
    }
    if (label.includes("weekly window")) {
      return 41;
    }
    if (label.includes("credits")) {
      return 42;
    }
    if (key2.includes("codex") || meter.rawKind === "codex.settings.usage") {
      return 50;
    }
    return 80;
  }
  function groupChatGptMeters(meters, language) {
    const groups = {
      subscription: [],
      input: [],
      features: [],
      windows: [],
      codex: [],
      other: []
    };
    for (const meter of meters) {
      groups[chatGptMeterSection(meter)].push(meter);
    }
    return GPT_SECTION_ORDER.map((key2) => ({
      key: key2,
      label: formatGptSectionLabelLocalized(language, key2),
      meters: groups[key2]
    })).filter((section) => section.meters.length > 0);
  }
  function chatGptMeterSection(meter) {
    const key2 = meter.key.toLowerCase();
    const rawKind = meter.rawKind?.toLowerCase() ?? "";
    const label = meter.label.toLowerCase();
    if (rawKind === "chatgpt.library_storage") return "input";
    if (rawKind === "chatgpt.reset_credits") return "codex";
    if (rawKind === "chatgpt.subscription") {
      return "subscription";
    }
    if (key2.includes("codex") || rawKind === "codex.settings.usage" || rawKind.includes("codex") || rawKind === "credits" || key2 === "wham:credits") {
      return "codex";
    }
    if (key2.startsWith("wham:") || key2.startsWith("tasks:") || rawKind.includes("rate_limit") || rawKind.includes("window")) {
      return "windows";
    }
    if (rawKind === "limits_progress" || rawKind === "blocked_features" || key2.startsWith("limits_progress:") || key2.startsWith("blocked_features:")) {
      return isInputOrAttachmentMeter(key2, label) ? "input" : "features";
    }
    return "other";
  }
  function isInputOrAttachmentMeter(key2, label) {
    return key2.includes("file_upload") || key2.includes("paste_text") || key2.includes("dictation") || key2.includes("upload") || label.includes("file upload") || label.includes("paste text") || label.includes("dictation");
  }
  function grokMeterPriority(meter) {
    if (meter.rawKind === "grokCreditsConfig:total") {
      return 10;
    }
    if (meter.rawKind?.startsWith("grokCreditsConfig:product:")) {
      return 20;
    }
    if (meter.rawKind === "queries") {
      return 40;
    }
    if (meter.rawKind === "highEffortRateLimits") {
      return 50;
    }
    if (meter.rawKind === "lowEffortRateLimits") {
      return 60;
    }
    if (meter.rawKind === "tokens") {
      return 70;
    }
    return 80;
  }
  function isGrokCreditsProductMeter(meter) {
    return Boolean(meter.rawKind?.startsWith("grokCreditsConfig:product:"));
  }
  function grokCreditsProductCompare(a, b) {
    return grokCreditsProductPriority(a) - grokCreditsProductPriority(b);
  }
  function grokCreditsProductPriority(meter) {
    const productId = Number(meter.rawKind?.match(/product:(\d+)/)?.[1] ?? 0);
    const priority = {
      5: 10,
      4: 20,
      1: 30,
      2: 40
    };
    return priority[productId] ?? 90;
  }
  function grokContributionColor(index) {
    return [
      "var(--rb-blue)",
      "var(--rb-blue-soft)",
      "#9fb9e8",
      "#c4d2ef",
      "var(--rb-mustard)"
    ][index % 5];
  }
  function modelSummaryFromMeter(meter) {
    if (!meter.modelName) {
      return null;
    }
    if (meter.requestKind && meter.requestKind !== "DEFAULT") {
      return `${meter.modelName} · ${meter.requestKind}`;
    }
    return meter.modelName;
  }
  function assetUrl(name) {
    const path = `assets/little-chihiro/${name}`;
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(path);
    }
    return path;
  }
  function decorativeAsset(name, className) {
    const image = document.createElement("img");
    image.className = className;
    image.src = assetUrl(name);
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    image.setAttribute("aria-hidden", "true");
    return image;
  }
  function titleNode(className, label, assetName) {
    const title = el("div", className);
    title.append(
      decorativeAsset(assetName, "title-icon"),
      textEl("span", "title-text", label)
    );
    return title;
  }
  function sectionTitle(label, assetName) {
    const title = el("div", "meter-section-title");
    title.append(
      decorativeAsset(assetName, "section-title-icon"),
      textEl("span", "section-title-text", label)
    );
    return title;
  }
  function panelCorners(className) {
    const frame = el("div", className);
    frame.append(
      decorativeAsset("corner-top-left.png", "corner corner-top-left"),
      decorativeAsset("corner-top-right.png", "corner corner-top-right"),
      decorativeAsset("corner-bottom-left.png", "corner corner-bottom-left"),
      decorativeAsset("corner-bottom-right.png", "corner corner-bottom-right")
    );
    frame.setAttribute("aria-hidden", "true");
    return frame;
  }
  function cardCorners() {
    const frame = el("div", "card-corners");
    frame.append(
      decorativeAsset("corner-top-left.png", "card-corner card-corner-top-left"),
      decorativeAsset("corner-bottom-right.png", "card-corner card-corner-bottom-right")
    );
    frame.setAttribute("aria-hidden", "true");
    return frame;
  }
  function vineDivider() {
    const divider = el("div", "vine-divider");
    divider.append(decorativeAsset("divider-vine.png", "vine-divider-image"));
    divider.setAttribute("aria-hidden", "true");
    return divider;
  }
  function platformTitleAsset(platform2) {
    if (platform2 === "chatgpt") {
      return "clover-medallion.png";
    }
    if (platform2 === "claude") {
      return "leaf-emblem.png";
    }
    if (platform2 === "kimi") {
      return "leaf-emblem.png";
    }
    if (platform2 === "gemini") {
      return "gem-square.png";
    }
    if (platform2 === "perplexity") {
      return "gem-square.png";
    }
    return "leaf-small.png";
  }
  function unique(values) {
    return Array.from(new Set(values));
  }
  function el(tagName, className) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    return element;
  }
  function textEl(tagName, className, text) {
    const element = el(tagName, className);
    element.textContent = text;
    return element;
  }
  function node(tagName, className, children) {
    const element = el(tagName, className);
    element.append(...children);
    return element;
  }
  function emptyNode() {
    return document.createElement("span");
  }
  function detectPlatform(location) {
    const hostname = location.hostname.toLowerCase();
    if (hostname === "grok.com" || hostname.endsWith(".grok.com")) {
      return "grok";
    }
    if (hostname === "claude.ai" || hostname.endsWith(".claude.ai")) {
      return "claude";
    }
    if (hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com")) {
      return "chatgpt";
    }
    if (hostname === "gemini.google.com") {
      return "gemini";
    }
    if (hostname === "www.kimi.com" || hostname === "kimi.com") {
      return "kimi";
    }
    if (hostname === "www.perplexity.ai" || hostname === "perplexity.ai") {
      return "perplexity";
    }
    return null;
  }
  function usageErrorFromBridge(response) {
    const status = response.error?.status;
    if (status === 401 || status === 403) {
      return {
        code: "UNAUTHORIZED",
        message: "未授权或当前页面无法读取",
        status
      };
    }
    if (status === 429) {
      return {
        code: "RATE_LIMITED",
        message: "接口限流，稍后手动刷新",
        status
      };
    }
    if (typeof status === "number" && status >= 500) {
      return {
        code: "NETWORK_ERROR",
        message: "平台接口暂时不可用",
        status
      };
    }
    return {
      code: "UNKNOWN",
      message: response.error?.message ?? "Unknown usage fetch error",
      status
    };
  }
  function formatUsageError(error, endpoint) {
    const prefix = endpoint ? `${endpoint}: ` : "";
    const status = error.status ? `${error.status} ` : "";
    return `${prefix}${status}${error.message}`;
  }
  const FRIENDLY_LABELS = {
    five_hour: "5h",
    seven_day: "7d all models",
    seven_day_sonnet: "7d Sonnet",
    seven_day_opus: "7d Opus",
    seven_day_omelette: "7d Design / Omelette",
    extra_usage: "Extra Usage"
  };
  function extractClaudeOrgId(json) {
    const root = asRecord(json);
    const candidates = Array.isArray(json) ? json : root ? asArray(root.organizations) : [];
    for (const item of candidates) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const uuid = getString(record, "uuid");
      const id = getString(record, "id");
      if (uuid) {
        return uuid;
      }
      if (id) {
        return id;
      }
    }
    return null;
  }
  function isUsageLike(record) {
    return "utilization" in record || "used_percentage" in record || "used_credits" in record || "monthly_limit" in record;
  }
  function normalizeUsageObject(key2, record, source) {
    if (!isUsageLike(record)) {
      return null;
    }
    const utilization = getNumber(record, "utilization") ?? getNumber(record, "used_percentage");
    const usedPercent = percentFromRatioOrPercent(utilization);
    const resetAt = getString(record, "resets_at");
    const total = getNumber(record, "monthly_limit");
    const used = getNumber(record, "used_credits");
    const remaining = total !== null && used !== null ? Math.max(0, total - used) : null;
    const isEnabled = asBoolean(record.is_enabled);
    const hasAnyValue = usedPercent !== null || resetAt !== null || total !== null || used !== null || isEnabled !== null;
    if (!hasAnyValue) {
      return null;
    }
    return {
      key: key2,
      label: FRIENDLY_LABELS[key2] ?? titleFromKey(key2),
      remaining,
      total,
      used,
      usedPercent,
      resetAt,
      source,
      confidence: usedPercent !== null && resetAt !== null ? "high" : usedPercent !== null || total !== null || used !== null ? "medium" : "low",
      rawKind: key2
    };
  }
  function normalizeClaudeUsage(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return [];
    }
    const meters = [];
    for (const [key2, value] of Object.entries(root)) {
      const record = asRecord(value);
      if (!record) {
        continue;
      }
      const meter = normalizeUsageObject(key2, record, source);
      if (meter) {
        meters.push(meter);
      }
    }
    return meters;
  }
  function responseFailure$3(response) {
    return formatUsageError(
      usageErrorFromBridge(response),
      response.endpointKey ?? "claude"
    );
  }
  async function fetchClaudeUsage(fetcher) {
    const organizations = await fetcher("claude:organizations");
    if (!organizations.ok) {
      return {
        platform: "claude",
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: "error",
        errorMessage: responseFailure$3(organizations),
        debug: {
          endpoint: "claude:organizations",
          parser: "claude.organizations"
        }
      };
    }
    const orgId = extractClaudeOrgId(organizations.json);
    if (!orgId) {
      return {
        platform: "claude",
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: "error",
        errorMessage: "No Claude organization id found",
        debug: {
          endpoint: "claude:organizations",
          parser: "claude.organizations"
        }
      };
    }
    const usage = await fetcher("claude:usage", { orgId });
    if (!usage.ok) {
      return {
        platform: "claude",
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: "error",
        errorMessage: responseFailure$3(usage),
        debug: {
          endpoint: "claude:usage",
          parser: "claude.usage"
        }
      };
    }
    const meters = normalizeClaudeUsage(usage.json, "api");
    return {
      platform: "claude",
      meters,
      source: meters.length > 0 ? "api" : "unknown",
      updatedAt: Date.now(),
      status: meters.length > 0 ? "ok" : "unknown",
      debug: {
        endpoint: "claude:usage",
        parser: "claude.usage"
      }
    };
  }
  const GEMINI_ENDPOINT_KEY = "gemini:usageBatchExecute";
  const GEMINI_USAGE_RPC_ID = "jSf9Qc";
  function parseGeminiBatchExecuteFrames(text) {
    const withoutXssi = text.startsWith(")]}'") ? text.slice(4) : text;
    const frames = [];
    for (const line of withoutXssi.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^\d+$/.test(trimmed)) {
        continue;
      }
      frames.push(JSON.parse(trimmed));
    }
    return frames;
  }
  function normalizeGeminiUsageText(text, source = "api") {
    let frames;
    try {
      frames = parseGeminiBatchExecuteFrames(text);
    } catch {
      return {
        meters: [],
        errorMessage: "Gemini batchexecute 响应结构变化"
      };
    }
    const errorStatus = findGeminiErrorStatus(frames);
    if (errorStatus !== null) {
      return {
        meters: [],
        errorStatus,
        errorMessage: `Gemini usage RPC failed (${errorStatus})`
      };
    }
    const payloadString = findWrbPayloadString(frames);
    if (!payloadString) {
      return {
        meters: [],
        errorMessage: "Gemini usage payload missing"
      };
    }
    let payload;
    try {
      payload = JSON.parse(payloadString);
    } catch {
      return {
        meters: [],
        errorMessage: "Gemini usage payload parse failed"
      };
    }
    const values = asArray(payload);
    const payloadStatus = asNumber(values[0]) ?? void 0;
    const buckets = asArray(values[1]);
    const meters = buckets.map((bucket) => normalizeGeminiBucket(bucket, source)).filter((meter) => meter !== null);
    return {
      meters,
      payloadStatus,
      errorMessage: meters.length === 0 ? "Gemini usage buckets missing" : void 0
    };
  }
  async function fetchGeminiUsage(fetcher) {
    const response = await fetcher(GEMINI_ENDPOINT_KEY);
    if (!response.ok) {
      const missingReplayParams = response.error?.message === "Missing Gemini usage replay parameters";
      return {
        platform: "gemini",
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: missingReplayParams ? "unknown" : "error",
        errorMessage: missingReplayParams ? "等待 Gemini 页面用量参数" : responseFailure$2(response),
        debug: {
          endpoint: GEMINI_ENDPOINT_KEY,
          parser: "gemini.batchexecute"
        }
      };
    }
    if (typeof response.text !== "string") {
      return {
        platform: "gemini",
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: "error",
        errorMessage: "Gemini usage response text missing",
        debug: {
          endpoint: GEMINI_ENDPOINT_KEY,
          parser: "gemini.batchexecute"
        }
      };
    }
    const parsed = normalizeGeminiUsageText(response.text, "api");
    return {
      platform: "gemini",
      meters: parsed.meters,
      source: parsed.meters.length > 0 ? "api" : "unknown",
      updatedAt: Date.now(),
      status: parsed.meters.length > 0 ? "ok" : "error",
      errorMessage: parsed.errorMessage,
      debug: {
        endpoint: GEMINI_ENDPOINT_KEY,
        parser: parsed.payloadStatus !== void 0 ? `gemini.status=${parsed.payloadStatus}` : "gemini.batchexecute"
      }
    };
  }
  function normalizeGeminiBucket(value, source) {
    const bucket = asArray(value);
    const remaining = asNumber(bucket[0]);
    const ratio = asNumber(bucket[1]);
    const type = asNumber(bucket[2]);
    const resetAt = resetAtFromBucket(bucket[3]);
    if (remaining === null || ratio === null || type === null) {
      return null;
    }
    const usedPercent = percentFromRatioOrPercent(ratio);
    const remainingPercent = usedPercent === null ? null : clampPercent(100 - usedPercent);
    const total = ratio >= 0 && ratio < 1 ? Math.round(remaining / (1 - ratio)) : null;
    const label = labelForBucketType(type);
    return {
      key: keyForBucketType(type),
      label,
      remaining,
      total,
      used: total !== null ? Math.max(0, Math.round(total - remaining)) : null,
      usedPercent,
      remainingPercent,
      resetAt,
      windowSeconds: windowSecondsForBucketType(type),
      source,
      confidence: resetAt !== null ? "high" : "medium",
      rawKind: `type:${type}`
    };
  }
  function resetAtFromBucket(value) {
    const timestamp = asArray(asArray(value)[0]);
    const sec = asNumber(timestamp[0]);
    const nano = asNumber(timestamp[1]) ?? 0;
    if (sec === null) {
      return null;
    }
    return Math.round((sec + nano / 1e9) * 1e3);
  }
  function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
  }
  function labelForBucketType(type) {
    if (type === 1) {
      return "Gemini 5h";
    }
    if (type === 2) {
      return "Gemini weekly";
    }
    return `Gemini bucket ${type}`;
  }
  function keyForBucketType(type) {
    if (type === 1) {
      return "gemini:5h";
    }
    if (type === 2) {
      return "gemini:weekly";
    }
    return `gemini:type-${type}`;
  }
  function windowSecondsForBucketType(type) {
    if (type === 1) {
      return 5 * 60 * 60;
    }
    if (type === 2) {
      return 7 * 24 * 60 * 60;
    }
    return null;
  }
  function findWrbPayloadString(value) {
    if (Array.isArray(value)) {
      if (value[0] === "wrb.fr" && value[1] === GEMINI_USAGE_RPC_ID && typeof value[2] === "string") {
        return value[2];
      }
      for (const item of value) {
        const found = findWrbPayloadString(item);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }
  function findGeminiErrorStatus(value) {
    if (Array.isArray(value)) {
      if (value[0] === "er") {
        return asNumber(value[5]);
      }
      for (const item of value) {
        const found = findGeminiErrorStatus(item);
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  }
  function responseFailure$2(response) {
    return formatUsageError(
      usageErrorFromBridge(response),
      response.endpointKey ?? "gemini"
    );
  }
  const GROK_ENDPOINT_KEY = "grok:credits-config";
  const GRPC_WEB_DATA_FRAME = 0;
  const USAGE_PERIOD_LABELS = {
    1: "monthly",
    2: "weekly"
  };
  const PRODUCT_LABELS = {
    1: "Grok Build",
    2: "API",
    4: "Chat",
    5: "Imagine",
    6: "Build",
    7: "Voice",
    8: "API"
  };
  function normalizeGrokCreditsConfig(base64Text, options = {}) {
    const config = parseGrokCreditsConfig(base64Text);
    if (!config) {
      return [];
    }
    const source = options.source ?? "api";
    const resetAt = config.currentPeriod?.end ?? null;
    const period = config.currentPeriod?.type ?? "current";
    const meters = [];
    const validProductUsage = config.productUsage.filter(
      (item) => Number.isFinite(item.usagePercent)
    );
    if (config.creditUsagePercent !== null || validProductUsage.length > 0) {
      const rawUsedPercent = validProductUsage.length > 0 ? validProductUsage.reduce((sum, item) => sum + item.usagePercent, 0) : config.creditUsagePercent ?? 0;
      const usedPercent = percentFromGrokPercent(rawUsedPercent);
      meters.push({
        key: `grok:${period}:total`,
        label: `${titleCase(period)} Grok limit`,
        usedPercent,
        resetAt,
        source,
        confidence: resetAt ? "high" : "medium",
        rawKind: "grokCreditsConfig:total"
      });
    }
    for (const item of config.productUsage) {
      const label = PRODUCT_LABELS[item.product] ?? `Product ${item.product}`;
      const usedPercent = percentFromGrokPercent(item.usagePercent);
      if (usedPercent === null) {
        continue;
      }
      meters.push({
        key: `grok:${period}:${label.toLowerCase().replace(/\s+/g, "-")}`,
        label,
        usedPercent,
        resetAt,
        source,
        confidence: resetAt ? "high" : "medium",
        rawKind: `grokCreditsConfig:product:${item.product}`
      });
    }
    return meters;
  }
  function responseFailure$1(response) {
    return formatUsageError(
      usageErrorFromBridge(response),
      response.endpointKey ?? "grok"
    );
  }
  async function fetchGrokUsage(fetcher) {
    const response = await fetcher(GROK_ENDPOINT_KEY);
    const meters = response.ok ? normalizeGrokCreditsConfig(response.text, { source: "api" }) : [];
    const failure = response.ok ? void 0 : responseFailure$1(response);
    return {
      platform: "grok",
      meters,
      source: meters.length > 0 ? "api" : "unknown",
      updatedAt: Date.now(),
      status: meters.length > 0 ? "ok" : failure ? "error" : "unknown",
      errorMessage: failure,
      debug: {
        endpoint: GROK_ENDPOINT_KEY,
        parser: "grok.creditsConfig.grpcWeb"
      }
    };
  }
  function parseGrokCreditsConfig(base64Text) {
    if (!base64Text) {
      return null;
    }
    let message;
    try {
      message = firstGrpcWebMessage(base64ToBytes(base64Text));
    } catch {
      return null;
    }
    if (!message) {
      return null;
    }
    const rootConfig = fields(message).find(
      (field) => field.field === 1 && field.wireType === 2
    );
    if (!rootConfig?.bytes) {
      return null;
    }
    let creditUsagePercent = null;
    let currentPeriod = null;
    const productUsage = [];
    for (const field of fields(rootConfig.bytes)) {
      if (field.field === 1 && field.wireType === 5) {
        creditUsagePercent = finiteNumber(field.float);
      } else if (field.field === 7 && field.wireType === 2 && field.bytes) {
        const item = parseProductUsage(field.bytes);
        if (item) {
          productUsage.push(item);
        }
      } else if (field.field === 8 && field.wireType === 2 && field.bytes) {
        currentPeriod = parseCurrentPeriod(field.bytes);
      }
    }
    if (creditUsagePercent === null && productUsage.length === 0) {
      return null;
    }
    return {
      creditUsagePercent,
      currentPeriod,
      productUsage
    };
  }
  function parseProductUsage(bytes) {
    let product = null;
    let usagePercent = null;
    for (const field of fields(bytes)) {
      if (field.field === 1 && field.wireType === 0 && field.varint !== void 0) {
        product = Number(field.varint);
      } else if (field.field === 2 && field.wireType === 5) {
        usagePercent = finiteNumber(field.float);
      }
    }
    if (product === null || usagePercent === null) {
      return null;
    }
    return { product, usagePercent };
  }
  function parseCurrentPeriod(bytes) {
    let type = "unspecified";
    let start2 = null;
    let end = null;
    for (const field of fields(bytes)) {
      if (field.field === 1 && field.wireType === 0 && field.varint !== void 0) {
        type = USAGE_PERIOD_LABELS[Number(field.varint)] ?? "unspecified";
      } else if (field.field === 2 && field.wireType === 2 && field.bytes) {
        start2 = parseTimestamp(field.bytes);
      } else if (field.field === 3 && field.wireType === 2 && field.bytes) {
        end = parseTimestamp(field.bytes);
      }
    }
    return { type, start: start2, end };
  }
  function parseTimestamp(bytes) {
    let seconds = null;
    let nanos = 0;
    for (const field of fields(bytes)) {
      if (field.field === 1 && field.wireType === 0 && field.varint !== void 0) {
        seconds = field.varint;
      } else if (field.field === 2 && field.wireType === 0 && field.varint !== void 0) {
        nanos = Number(field.varint);
      }
    }
    if (seconds === null) {
      return null;
    }
    const millis = Number(seconds) * 1e3 + Math.floor(nanos / 1e6);
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  function firstGrpcWebMessage(bytes) {
    let offset = 0;
    while (offset + 5 <= bytes.length) {
      const flag = bytes[offset];
      const length = readUint32Be(bytes, offset + 1);
      const start2 = offset + 5;
      const end = start2 + length;
      if (end > bytes.length) {
        return null;
      }
      if (flag === GRPC_WEB_DATA_FRAME) {
        return bytes.slice(start2, end);
      }
      offset = end;
    }
    return null;
  }
  function fields(bytes) {
    const result = [];
    let offset = 0;
    while (offset < bytes.length) {
      const key2 = readVarint(bytes, offset);
      if (!key2) {
        break;
      }
      offset = key2.offset;
      const field = Number(key2.value >> 3n);
      const wireType = Number(key2.value & 7n);
      if (field <= 0) {
        break;
      }
      if (wireType === 0) {
        const value = readVarint(bytes, offset);
        if (!value) {
          break;
        }
        offset = value.offset;
        result.push({ field, wireType, varint: value.value });
      } else if (wireType === 2) {
        const length = readVarint(bytes, offset);
        if (!length) {
          break;
        }
        offset = length.offset;
        const end = offset + Number(length.value);
        if (end > bytes.length) {
          break;
        }
        result.push({ field, wireType, bytes: bytes.slice(offset, end) });
        offset = end;
      } else if (wireType === 5) {
        if (offset + 4 > bytes.length) {
          break;
        }
        result.push({
          field,
          wireType,
          float: new DataView(
            bytes.buffer,
            bytes.byteOffset + offset,
            4
          ).getFloat32(0, true)
        });
        offset += 4;
      } else {
        break;
      }
    }
    return result;
  }
  function readVarint(bytes, offset) {
    let value = 0n;
    let shift = 0n;
    let cursor = offset;
    while (cursor < bytes.length) {
      const byte = BigInt(bytes[cursor]);
      cursor += 1;
      value |= (byte & 0x7fn) << shift;
      if ((byte & 0x80n) === 0n) {
        return { value, offset: cursor };
      }
      shift += 7n;
      if (shift > 63n) {
        return null;
      }
    }
    return null;
  }
  function readUint32Be(bytes, offset) {
    return bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
  }
  function base64ToBytes(value) {
    const binary = atob(value.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function percentFromGrokPercent(value) {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.min(100, value));
  }
  function titleCase(value) {
    return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
  }
  const FEATURE_LABELS = {
    FEATURE_OMNI: "Credit"
  };
  function parseDateToTimestamp(value) {
    const str = typeof value === "string" ? value : null;
    if (!str) {
      return null;
    }
    const date = new Date(str);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.getTime();
  }
  function normalizeKimiUsage(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return [];
    }
    const balances = asArray(root.balances);
    const subscription = asRecord(root.subscription);
    const meters = [];
    let planTitle = null;
    if (subscription) {
      const goods = getRecord(subscription, "goods");
      planTitle = goods ? getString(goods, "title") : null;
    }
    for (const item of balances) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const feature = getString(record, "feature") ?? "unknown";
      const usedRatio = getNumber(record, "amountUsedRatio");
      const expireTime = parseDateToTimestamp(record.expireTime);
      if (usedRatio === null) {
        continue;
      }
      const usedPercent = usedRatio >= 0 && usedRatio <= 1 ? usedRatio * 100 : usedRatio;
      const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
      meters.push({
        key: feature.toLowerCase().replace(/^feature_/, ""),
        label: planTitle ?? FEATURE_LABELS[feature] ?? feature,
        usedPercent,
        remainingPercent,
        resetAt: expireTime,
        source,
        confidence: "high",
        rawKind: feature
      });
    }
    return meters;
  }
  async function fetchKimiUsage() {
    return {
      platform: "kimi",
      meters: [],
      source: "unknown",
      updatedAt: Date.now(),
      status: "unknown"
    };
  }
  const PERPLEXITY_ENDPOINT_KEY = "perplexity:rateLimitAll";
  const FIELD_METERS = [
    {
      field: "remaining_pro",
      key: "perplexity:pro",
      label: "Pro"
    },
    {
      field: "remaining_research",
      key: "perplexity:research",
      label: "Deep Research"
    },
    {
      field: "remaining_labs",
      key: "perplexity:labs",
      label: "Labs"
    },
    {
      field: "remaining_agentic_research",
      key: "perplexity:agentic-research",
      label: "Agentic Research"
    },
    {
      field: "free_queries",
      key: "perplexity:free-queries",
      label: "Free queries"
    }
  ];
  function normalizePerplexityRateLimit(json, source = "api") {
    const root = asRecord(json);
    if (!root) {
      return [];
    }
    const meters = FIELD_METERS.flatMap((definition) => {
      const remaining = getNumber(root, definition.field);
      return remaining === null ? [] : [
        makeRemainingMeter({
          key: definition.key,
          label: definition.label,
          remaining,
          source,
          rawKind: definition.field
        })
      ];
    });
    meters.push(...normalizeModelSpecificLimits(root.model_specific_limits, source));
    return meters;
  }
  async function fetchPerplexityUsage(fetcher) {
    const response = await fetcher(PERPLEXITY_ENDPOINT_KEY);
    if (!response.ok) {
      return {
        platform: "perplexity",
        meters: [],
        source: "unknown",
        updatedAt: Date.now(),
        status: "error",
        errorMessage: responseFailure(response),
        debug: {
          endpoint: PERPLEXITY_ENDPOINT_KEY,
          parser: "perplexity.rateLimitAll"
        }
      };
    }
    const meters = normalizePerplexityRateLimit(response.json, "api");
    return {
      platform: "perplexity",
      meters,
      source: meters.length > 0 ? "api" : "unknown",
      updatedAt: Date.now(),
      status: meters.length > 0 ? "ok" : "error",
      errorMessage: meters.length > 0 ? void 0 : "Perplexity rate-limit fields missing",
      debug: {
        endpoint: PERPLEXITY_ENDPOINT_KEY,
        parser: "perplexity.rateLimitAll"
      }
    };
  }
  function normalizeModelSpecificLimits(value, source) {
    const limits = asRecord(value);
    if (!limits) {
      return [];
    }
    const meters = [];
    for (const [modelName, rawLimit] of Object.entries(limits)) {
      const limit = asRecord(rawLimit);
      if (!limit) {
        continue;
      }
      const remaining = getNumber(limit, "remaining") ?? getNumber(limit, "remaining_queries") ?? getNumber(limit, "remainingQueries");
      const total = getNumber(limit, "limit") ?? getNumber(limit, "total") ?? getNumber(limit, "total_queries") ?? getNumber(limit, "totalQueries");
      if (remaining === null) {
        continue;
      }
      meters.push(
        makeRemainingMeter({
          key: `perplexity:model:${modelName}`,
          label: `${titleFromKey(modelName)} model limit`,
          modelName,
          remaining,
          total,
          source,
          rawKind: `model_specific_limits.${modelName}`
        })
      );
    }
    return meters;
  }
  function makeRemainingMeter(args) {
    const total = args.total ?? null;
    const used = args.remaining !== null && total !== null ? Math.max(0, total - args.remaining) : null;
    const usedPercent = used !== null && total !== null && total > 0 ? used / total * 100 : null;
    const remainingPercent = args.remaining !== null && total !== null && total > 0 ? Math.max(0, Math.min(100, args.remaining / total * 100)) : null;
    return {
      key: args.key,
      label: args.label,
      modelName: args.modelName,
      remaining: args.remaining,
      total,
      used,
      usedPercent,
      remainingPercent,
      source: args.source,
      confidence: total !== null ? "high" : "medium",
      rawKind: args.rawKind
    };
  }
  function responseFailure(response) {
    return formatUsageError(
      usageErrorFromBridge(response),
      response.endpointKey ?? "perplexity"
    );
  }
  function fetchPlatformUsage(platform2, fetcher) {
    if (platform2 === "grok") {
      return fetchGrokUsage(fetcher);
    }
    if (platform2 === "claude") {
      return fetchClaudeUsage(fetcher);
    }
    if (platform2 === "kimi") {
      return fetchKimiUsage();
    }
    if (platform2 === "gemini") {
      return fetchGeminiUsage(fetcher);
    }
    if (platform2 === "perplexity") {
      return fetchPerplexityUsage(fetcher);
    }
    return fetchChatGptUsage(fetcher);
  }
  function normalizeInterceptedUsage(args) {
    const meters = normalizeInterceptedMeters(args);
    return {
      platform: args.platform,
      meters,
      source: meters.length > 0 ? "intercepted" : "unknown",
      updatedAt: args.ts,
      status: meters.length > 0 ? "ok" : "unknown",
      debug: {
        endpoint: args.url,
        parser: `${args.platform}.intercepted`
      }
    };
  }
  function normalizeInterceptedMeters(args) {
    if (args.platform === "grok") {
      return normalizeGrokCreditsConfig(args.text, { source: "intercepted" });
    }
    if (args.platform === "claude") {
      return normalizeClaudeUsage(args.json, "intercepted");
    }
    if (args.platform === "kimi") {
      return normalizeKimiUsage(args.json, "intercepted");
    }
    if (args.platform === "gemini") {
      return typeof args.text === "string" ? normalizeGeminiUsageText(args.text, "intercepted").meters : [];
    }
    if (args.platform === "perplexity") {
      return normalizePerplexityRateLimit(args.json, "intercepted");
    }
    return normalizeChatGptIntercepted(args.url, args.json);
  }
  const LANGUAGE_SETTINGS_KEY = "aiUsage:language";
  async function getLanguageMode() {
    const items = await storageGet(LANGUAGE_SETTINGS_KEY);
    return languageModeFromStorageValue(items[LANGUAGE_SETTINGS_KEY]);
  }
  async function saveLanguageMode(mode) {
    const next = languageModeFromValue(mode);
    await storageSet({ [LANGUAGE_SETTINGS_KEY]: next });
    return next;
  }
  function languageModeFromStorageValue(value) {
    return languageModeFromValue(value);
  }
  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (items) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(items);
      });
    });
  }
  function storageSet(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }
  function isDebugEnabled() {
    try {
      return globalThis.localStorage?.getItem("aiUsageDebug") === "1";
    } catch {
      return false;
    }
  }
  function debugLog(message, details) {
    if (!isDebugEnabled()) {
      return;
    }
    if (details === void 0) {
      console.debug(`[ai-usage] ${message}`);
      return;
    }
    console.debug(`[ai-usage] ${message}`, details);
  }
  const platform = detectPlatform(window.location);
  if (platform && shouldStartOnThisFrame(platform) && !window.__AI_USAGE_FLOATING_MONITOR_CONTENT__) {
    window.__AI_USAGE_FLOATING_MONITOR_CONTENT__ = true;
    void start(platform);
  }
  function shouldStartOnThisFrame(platformId) {
    if (window.top === window) {
      return true;
    }
    if (platformId !== "perplexity") {
      return false;
    }
    return window.innerWidth >= 640 && window.innerHeight >= 480;
  }
  async function start(platformId) {
    let widget;
    const bridge = new BridgeClient();
    let currentSnapshot = null;
    let refreshing = false;
    let chatGptController;
    let pendingEstimatorRefresh = 0;
    const saveLanguage = async (mode) => {
      widget.setLanguageMode(await saveLanguageMode(mode));
    };
    widget = new UsageWidget(
      platformId,
      () => {
        void refreshUsage({ force: true });
      },
      {
        onLanguageModeSave: (mode) => {
          void saveLanguage(mode).catch((error) => {
            debugLog("failed to save language settings", error);
          });
        }
      }
    );
    widget.mount();
    widget.setLanguageMode(await getLanguageMode());
    const applySnapshot = async (snapshot) => {
      const shouldReplace = platformId === "grok" && snapshot.source === "intercepted";
      const previous = shouldReplace ? null : currentSnapshot;
      const merged = mergeUsageSnapshots(previous, snapshot);
      currentSnapshot = merged;
      widget.setSnapshot(currentSnapshot);
      await setCachedSnapshot(currentSnapshot);
    };
    const refreshUsage = async (options) => {
      if (chatGptController) {
        await chatGptController.refresh(options.force ? "manual" : "poll");
        return;
      }
      if (refreshing) {
        return;
      }
      const now = Date.now();
      const backoffUntil = await getBackoffUntil(platformId);
      widget.setBackoffUntil(backoffUntil);
      if (backoffUntil > now) {
        return;
      }
      const cached2 = await getCachedSnapshot(platformId);
      if (!options.force && cached2 && now - (cached2.checkedAt ?? cached2.updatedAt) < CACHE_TTL_MS) {
        currentSnapshot = cached2;
        widget.setSnapshot(cached2);
        return;
      }
      const lastRefreshAt = await getLastRefreshAt(platformId);
      if (lastRefreshAt > 0 && now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) {
        if (cached2) {
          currentSnapshot = cached2;
          widget.setSnapshot(cached2);
        }
        return;
      }
      refreshing = true;
      widget.setLoading(true);
      await setLastRefreshAt(platformId, now);
      try {
        const snapshot = await withEstimateFallback(platformId, await fetchPlatformUsage(platformId, (key2, payload) => bridge.fetchUsage(platformId, key2, payload)));
        await applySnapshot(snapshot);
        await updateFailureState(
          platformId,
          snapshot,
          widget
        );
      } catch (error) {
        const snapshot = await withEstimateFallback(platformId, {
          platform: platformId,
          meters: [],
          source: "unknown",
          updatedAt: Date.now(),
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Unknown usage refresh error"
        });
        await applySnapshot(snapshot);
        await updateFailureState(platformId, snapshot, widget);
      } finally {
        refreshing = false;
        widget.setLoading(false);
      }
    };
    if (platformId === "chatgpt") {
      chatGptController = new ChatGptUsageController({
        fetcher: (key2) => bridge.fetchUsage(platformId, key2),
        onSnapshot: (snapshot) => {
          currentSnapshot = snapshot;
          widget.setSnapshot(snapshot);
        },
        onLoading: (loading) => widget.setLoading(loading),
        readCache: (scope) => getCachedSnapshot("chatgpt", scope),
        writeCache: setCachedSnapshot
      });
      bridge.onContextChanged(() => {
        chatGptController?.reset();
        void chatGptController?.refresh("startup");
      });
    }
    const cached = await getCachedSnapshot(platformId);
    if (cached) {
      currentSnapshot = cached;
      widget.setSnapshot(cached);
    }
    widget.setBackoffUntil(platformId === "chatgpt" ? 0 : await getBackoffUntil(platformId));
    const onStorageChanged = (changes, areaName) => {
      if (areaName !== "local") {
        return;
      }
      const languageChange = changes[LANGUAGE_SETTINGS_KEY];
      if (languageChange) {
        widget.setLanguageMode(
          languageModeFromStorageValue(languageChange.newValue)
        );
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    bridge.onIntercepted((message) => {
      if (message.platform !== platformId) {
        return;
      }
      if (chatGptController && message.endpointKey) {
        void chatGptController.acceptIntercept(message.endpointKey, message.json, message.ts, message.requestStartedAt, message.scopeKey);
        return;
      }
      const snapshot = normalizeInterceptedUsage({
        platform: platformId,
        url: message.url,
        json: message.json,
        text: message.text,
        ts: message.ts,
        endpointKey: message.endpointKey
      });
      if (snapshot.meters.length === 0) {
        return;
      }
      void applySnapshot(snapshot).catch((error) => {
        debugLog("failed to cache intercepted usage", error);
      });
    });
    const stopEstimator = installSendEstimator(platformId, (snapshot) => {
      if (platformId !== "chatgpt" && (!currentSnapshot || currentSnapshot.meters.length === 0)) {
        currentSnapshot = snapshot;
        widget.setSnapshot(snapshot);
      }
      window.clearTimeout(pendingEstimatorRefresh);
      pendingEstimatorRefresh = window.setTimeout(() => {
        if (chatGptController) void chatGptController.refresh("operation");
        else void refreshUsage({ force: false });
      }, 1500);
    }, { recordCounts: platformId !== "chatgpt" });
    try {
      await injectMainWorld();
      await bridge.enableIntercept(platformId);
    } catch (error) {
      debugLog("main world bridge injection failed", error);
    }
    await refreshUsage({ force: false });
    const stopUsagePolling = platformId === "chatgpt" ? startVisibleUsagePolling({
      isVisible: () => document.visibilityState === "visible",
      onVisibilityChange: (callback) => {
        document.addEventListener("visibilitychange", callback);
        return () => document.removeEventListener("visibilitychange", callback);
      },
      setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
      clearInterval: (id) => window.clearInterval(id),
      refresh: () => {
        void refreshUsage({ force: false });
      }
    }) : null;
    window.addEventListener("pagehide", (event) => {
      if (event.persisted) return;
      stopEstimator();
      widget.destroy();
      stopUsagePolling?.();
      chatGptController?.destroy();
      bridge.destroy();
      window.clearTimeout(pendingEstimatorRefresh);
      chrome.storage.onChanged.removeListener(onStorageChanged);
    });
  }
  async function injectMainWorld() {
    const response = await new Promise(
      (resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "AI_USAGE_INJECT_MAIN_WORLD" },
          (value) => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve(value ?? { ok: false, error: "No injection response" });
          }
        );
      }
    );
    if (!response.ok) {
      throw new Error(response.error ?? "Injection failed");
    }
  }
  async function withEstimateFallback(platform2, snapshot) {
    if (snapshot.meters.length > 0 && snapshot.status !== "error") {
      return snapshot;
    }
    const estimate = await getEstimateSnapshot(platform2);
    if (!estimate) {
      return snapshot;
    }
    return {
      ...estimate,
      status: snapshot.status === "error" ? "partial" : estimate.status,
      errorMessage: snapshot.errorMessage ?? estimate.errorMessage,
      updatedAt: Math.max(snapshot.updatedAt, estimate.updatedAt)
    };
  }
  async function updateFailureState(platform2, snapshot, widget, retryableEndpointFailure = false) {
    if (snapshot.status !== "error" && !retryableEndpointFailure) {
      await setFailureCount(platform2, 0);
      await setBackoffUntil(platform2, 0);
      widget.setBackoffUntil(0);
      return;
    }
    const failures = await getFailureCount(platform2);
    const nextFailures = failures + 1;
    const step = FAILED_BACKOFF_STEPS_MS[Math.min(nextFailures - 1, FAILED_BACKOFF_STEPS_MS.length - 1)];
    const backoffUntil = Date.now() + step;
    await setFailureCount(platform2, nextFailures);
    await setBackoffUntil(platform2, backoffUntil);
    widget.setBackoffUntil(backoffUntil);
  }
})();
