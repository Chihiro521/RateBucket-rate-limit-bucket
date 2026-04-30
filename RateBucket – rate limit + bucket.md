可以，下面这份你可以**整段直接丢给 Codex**。

我按“让 Codex 直接建一个可运行的 MV3 浏览器扩展”的格式写。Codex CLI 官方说明它能在选定目录里读代码、改代码、运行命令，也支持直接带初始 prompt 启动，所以这份就是按工程执行型 prompt 写的。([OpenAI开发者][1])

另外接口部分我会写成“候选接口 + 必须实测 + 容错解析”，别让 Codex 写死。Grok 已有同类扩展公开说明会根据 Grok 页面 rate limit 请求更新；Claude 的 web usage endpoint 公开资料显示是 `/api/organizations/{orgId}/usage`；ChatGPT 的 Deep Research 用量官方确认有产品内计数器，但内部接口字段要按实测返回做兼容。([GitHub][2])

---

````md
你是一个资深 Chrome Extension / TypeScript 工程师。请在当前仓库中实现一个 Manifest V3 浏览器扩展，项目名暂定为 `ai-usage-floating-monitor`。

目标：在 Grok、Claude、ChatGPT 三个平台网页内注入一个页面悬浮 widget，用于显示当前登录用户的 AI 用量 / 配额状态。第一版是个人自用 MVP，不追求长期稳定，不上架 Chrome Web Store，不做多账号，不做跨设备同步，不做历史曲线。

请直接实现，不要只给建议。除非当前仓库结构完全无法判断，否则不要反复问我确认。可以做合理工程假设，并在 README 里写明。

========================
一、核心产品目标
========================

实现一个浏览器扩展：

- 仅在以下域名注入：
  - https://grok.com/*
  - https://claude.ai/*
  - https://chatgpt.com/*
- UI 是 content script 注入的页面悬浮 widget。
- 不是浏览器工具栏 popup。
- widget 默认折叠为页面右侧的小浮标。
- 点击后展开详细卡片。
- 支持手动刷新。
- 支持显示：
  - 准确值
  - 估算值
  - 未知
- 每条用量数据必须标注来源：
  - api
  - intercepted
  - estimate
  - unknown
- 每条用量数据必须标注更新时间。
- 所有接口失败时，UI 不能崩溃，必须优雅显示“未知”。

第一版不要做：
- 不做历史曲线。
- 不做趋势分析。
- 不做用量预警。
- 不做多账号。
- 不做跨设备同步。
- 不做团队版 / 企业版特殊适配。
- 不做自动发消息。
- 不做绕过限制。
- 不做高频轮询。
- 不读取、不保存聊天正文。
- 不读取、不保存 cookie。
- 不读取、不保存 Authorization header。
- 不把任何数据上传到第三方服务。
- 不做 telemetry。
- 不请求不必要的权限。

========================
二、技术栈要求
========================

请使用：

- Manifest V3
- TypeScript
- Vite 或等价轻量构建工具
- 原生 DOM + Shadow DOM，不要引入 React/Vue，除非当前仓库已经用了它们
- chrome.storage.local
- Vitest 或等价测试框架，用于测试数据 normalizer

建议目录结构：

src/
  background/
    serviceWorker.ts
  content/
    content.ts
    widget.ts
    styles.ts
  injected/
    mainWorldBridge.ts
  platforms/
    types.ts
    detect.ts
    grok.ts
    claude.ts
    chatgpt.ts
  storage/
    cache.ts
  utils/
    time.ts
    logger.ts
    safeJson.ts
tests/
  grok.normalizer.test.ts
  claude.normalizer.test.ts
  chatgpt.normalizer.test.ts
manifest.json
package.json
vite.config.ts
tsconfig.json
README.md

如果当前仓库已有结构，请尽量融入现有结构，不要硬重建。

========================
三、Manifest 要求
========================

manifest.json 必须是 Manifest V3。

权限只允许最小化：

permissions:
- storage
- scripting

host_permissions:
- https://grok.com/*
- https://claude.ai/*
- https://chatgpt.com/*

content_scripts:
- matches 上面三个域名
- js 指向构建后的 content script
- run_at: document_idle

background:
- service_worker 指向构建后的 service worker

不要添加 tabs、cookies、webRequest、webRequestBlocking、activeTab，除非你能在代码注释和 README 中证明必须使用。第一版原则上不需要这些权限。

========================
四、整体架构
========================

采用三层：

1. Isolated content script
   - 渲染 widget
   - 管理 UI 状态
   - 读写 chrome.storage.local
   - 和 service worker 通信
   - 接收 main-world bridge 传回来的 JSON
   - 不直接接触 token/cookie/header

2. Main world injected bridge
   - 运行在页面 MAIN world
   - 只负责两件事：
     a. 对 allowlist 中的 usage/rate-limit endpoint 发起低频 fetch
     b. 可选：patch window.fetch，捕获页面自己请求过的 usage/rate-limit 响应
   - 只能返回 JSON body
   - 不能返回 request headers
   - 不能返回 response headers
   - 不能返回 cookie
   - 不能读取聊天输入框内容
   - 不能上传任何数据

3. Service worker
   - 在 content script 请求时，把 mainWorldBridge 注入 MAIN world
   - 不做后台轮询
   - 不做长期任务
   - 不主动唤醒刷新

mainWorldBridge 注入方式：

- content script 启动后发送 message 给 service worker：
  `{ type: "AI_USAGE_INJECT_MAIN_WORLD" }`
- service worker 使用 `chrome.scripting.executeScript`：
  - target: sender.tab.id
  - files: ["injected/mainWorldBridge.js"]
  - world: "MAIN"
- 如果当前构建工具不支持该路径，调整输出结构，但 README 要写清楚。

========================
五、统一数据模型
========================

请定义统一类型：

```ts
export type PlatformId = "grok" | "claude" | "chatgpt";

export type UsageSource = "api" | "intercepted" | "estimate" | "unknown";

export type Confidence = "high" | "medium" | "low";

export type UsageMeter = {
  key: string;
  label: string;

  remaining?: number | null;
  total?: number | null;
  used?: number | null;
  usedPercent?: number | null;

  resetAt?: string | number | null;
  resetAfterSeconds?: number | null;
  windowSeconds?: number | null;

  source: UsageSource;
  confidence: Confidence;

  rawKind?: string;
};

export type UsageSnapshot = {
  platform: PlatformId;
  meters: UsageMeter[];

  source: UsageSource;
  updatedAt: number;
  cacheAgeMs?: number;

  status: "ok" | "partial" | "unknown" | "error";
  errorMessage?: string;

  debug?: {
    endpoint?: string;
    parser?: string;
  };
};
````

不要把完整 raw response 默认存入 storage。开发调试可以在内存里 console.debug，但必须默认关闭。可以通过 localStorage flag 开启：

```ts
localStorage.setItem("aiUsageDebug", "1")
```

========================
六、刷新策略
======

必须实现节流和缓存：

常量建议：

```ts
const CACHE_TTL_MS = 60_000;
const MIN_REFRESH_INTERVAL_MS = 30_000;
const FAILED_BACKOFF_STEPS_MS = [60_000, 120_000, 300_000];
```

刷新触发：

* 页面加载后刷新一次。
* 用户点击 widget 内刷新按钮时刷新。
* 如果捕获到页面自己请求了相关 usage endpoint，则更新缓存。
* 可选：检测到用户发送消息后，延迟 1500ms 刷新一次，但必须遵守 MIN_REFRESH_INTERVAL_MS。

不要实现 5 秒一次、10 秒一次这种高频轮询。

失败策略：

* 401 / 403：显示“未授权或当前页面无法读取”。
* 429：显示“接口限流，稍后手动刷新”，并进入退避。
* 5xx：显示“平台接口暂时不可用”。
* JSON 解析失败：显示“响应结构变化”。
* 任意单个平台失败不能影响其他平台代码。

========================
七、平台检测
======

实现：

```ts
export function detectPlatform(location: Location): PlatformId | null
```

规则：

* hostname === "grok.com" 或子域名以 ".grok.com" 结尾 => grok
* hostname === "claude.ai" 或子域名以 ".claude.ai" 结尾 => claude
* hostname === "chatgpt.com" 或子域名以 ".chatgpt.com" 结尾 => chatgpt
* 其他返回 null

只在 platform 非 null 时渲染 widget。

========================
八、Main World Bridge 协议
======================

content script 和 mainWorldBridge 之间使用 window.postMessage。

消息必须带固定 source：

```ts
const SOURCE = "ai-usage-floating-monitor";
```

请求格式：

```ts
type BridgeRequest = {
  source: "ai-usage-floating-monitor";
  direction: "content-to-main";
  requestId: string;
  action: "fetchUsage" | "enableIntercept";
  platform: "grok" | "claude" | "chatgpt";
  payload?: unknown;
};
```

响应格式：

```ts
type BridgeResponse = {
  source: "ai-usage-floating-monitor";
  direction: "main-to-content";
  requestId: string;
  ok: boolean;
  platform: "grok" | "claude" | "chatgpt";
  endpointKey?: string;
  json?: unknown;
  error?: {
    status?: number;
    message: string;
  };
};
```

安全要求：

* mainWorldBridge 必须校验 event.source === window。
* mainWorldBridge 必须校验 event.origin === window.location.origin。
* 只允许访问 allowlist 中的 endpoint。
* endpoint 不允许由 content script 任意传完整 URL。
* content script 只能传 platform 和 endpointKey。
* mainWorldBridge 内部根据 platform + endpointKey 映射真实 URL。
* 不允许请求任意 URL。

========================
九、接口 allowlist
==============

请实现 endpoint allowlist。

注意：以下都是候选接口，字段可能变化。代码必须容错，不要写死全部字段都存在。

---

## Grok

候选 endpoint：

```txt
POST https://grok.com/rest/rate-limits
```

请求 body 候选：

```json
{
  "requestKind": "DEFAULT",
  "modelName": "grok-3"
}
```

也支持尝试：

```json
{
  "requestKind": "DEFAULT",
  "modelName": "grok-4-heavy"
}
```

实现要求：

* 不要假设所有 modelName 都可用。
* 用常量数组配置候选模型。
* 每个模型请求失败时不要中断全部 Grok snapshot。
* 至少支持 normal 和 heavy 两类展示。
* 如果响应里有 lowEffortRateLimits / highEffortRateLimits，也要解析。

候选字段：

```ts
remainingQueries
totalQueries
remainingTokens
totalTokens
windowSizeSeconds
lowEffortRateLimits.remainingQueries
lowEffortRateLimits.waitTimeSeconds
highEffortRateLimits.remainingQueries
highEffortRateLimits.waitTimeSeconds
highEffortRateLimits.cost
```

normalizer 逻辑：

* 如果有 remainingQueries / totalQueries，展示为 query limit。
* 如果有 remainingTokens / totalTokens，展示为 token limit。
* 如果有 lowEffortRateLimits，展示 Low / Fast / Normal。
* 如果有 highEffortRateLimits，展示 High / Thinking / Expert。
* resetAt 如果没有，使用 windowSizeSeconds 推出 approximate resetAfterSeconds。
* confidence:

  * 直接字段 remaining/total => high
  * 推导 resetAfterSeconds => medium
  * 字段缺失 => low

---

## Claude

候选 endpoint 1：

```txt
GET https://claude.ai/api/organizations
```

候选 endpoint 2：

```txt
GET https://claude.ai/api/organizations/{orgId}/usage
```

实现流程：

1. fetch organizations
2. 从返回中找 org uuid
3. fetch usage
4. parse usage

organization 返回兼容：

```ts
Array<{ uuid?: string; id?: string }>
```

也要兼容：

```ts
{
  organizations: Array<{ uuid?: string; id?: string }>
}
```

usage 候选字段：

```ts
five_hour.utilization
five_hour.resets_at
seven_day.utilization
seven_day.resets_at
seven_day_sonnet.utilization
seven_day_sonnet.resets_at
seven_day_opus.utilization
seven_day_opus.resets_at
seven_day_omelette.utilization
seven_day_omelette.resets_at
extra_usage.is_enabled
extra_usage.monthly_limit
extra_usage.used_credits
extra_usage.utilization
extra_usage.currency
```

normalizer 逻辑：

* 遍历 usage response 的所有 key。
* 如果 value 是 object 且含 utilization 或 used_percentage，就生成 UsageMeter。
* label 做友好显示：

  * five_hour => "5h"
  * seven_day => "7d all models"
  * seven_day_sonnet => "7d Sonnet"
  * seven_day_opus => "7d Opus"
  * seven_day_omelette => "7d Design / Omelette"
* 不认识的 key 也不要丢，转换成普通 label。
* utilization 是已用百分比，放入 usedPercent。
* resets_at 放入 resetAt。
* extra_usage 如果存在，展示为单独 meter。
* confidence:

  * utilization + resets_at => high
  * only utilization => medium
  * fallback => low

---

## ChatGPT

候选 endpoint A：

```txt
POST https://chatgpt.com/backend-api/conversation/init
```

候选 endpoint B：

```txt
GET https://chatgpt.com/backend-api/wham/usage
```

候选 endpoint C，低优先级，可选：

```txt
GET https://chatgpt.com/backend-api/wham/tasks/rate_limit
```

conversation/init 请求 body：

```json
{}
```

注意：

* conversation/init 可能需要页面内部状态。
* 如果主动 fetch 401/403，不要硬扒 token。
* 改用 intercept 页面已有请求。
* 如果主动 fetch 成功，解析 limits_progress。

conversation/init 候选字段：

```ts
limits_progress[].feature_name
limits_progress[].remaining
limits_progress[].reset_after
model_limits
default_model_slug
blocked_features
```

normalizer 逻辑：

* limits_progress 每一项生成一个 UsageMeter。
* feature_name 做友好 label：

  * deep_research => "Deep Research"
  * image_gen => "Image Generation"
  * file_upload => "File Upload"
  * odyssey => "Odyssey"
  * 其他 key 转成 title case
* remaining 放入 remaining。
* reset_after 放入 resetAt。
* default_model_slug 可作为 debug 信息展示在展开卡片底部，但不是 meter。
* blocked_features 如果非空，在 UI 显示“部分功能被限制”。

wham/usage 候选字段：

```ts
plan_type
rate_limit.allowed
rate_limit.limit_reached
rate_limit.primary_window.used_percent
rate_limit.primary_window.reset_at
rate_limit.primary_window.limit_window_seconds
rate_limit.secondary_window.used_percent
rate_limit.secondary_window.reset_at
rate_limit.secondary_window.limit_window_seconds
code_review_rate_limit.primary_window.used_percent
code_review_rate_limit.primary_window.reset_at
credits.has_credits
credits.unlimited
credits.balance
```

normalizer 逻辑：

* primary_window 展示为 "Primary window"
* secondary_window 展示为 "Weekly window"
* code_review_rate_limit 展示为 "Code Review"
* reset_at 如果是 Unix seconds，保留 number，并在 UI 中格式化。
* plan_type 只作为字符串展示，不要写死枚举。
* 未知 plan_type 不能导致 crash。
* credits 如果存在，展示 balance；如果 unlimited 为 true，显示 unlimited。

ChatGPT 重要限制：

* 不要尝试读取 localStorage/sessionStorage 中的 token。
* 不要尝试读取 Authorization header。
* 不要尝试调用登录、refresh token、session endpoint。
* 不要模拟用户发消息。
* 不要发送聊天内容。
* 只能读 usage/rate-limit 相关 endpoint。

========================
十、Fetch Intercept
=================

mainWorldBridge 可以 patch window.fetch，但必须非常克制。

只允许检查 URL 是否包含以下片段：

```ts
const INTERCEPT_PATTERNS = [
  "/rest/rate-limits",
  "/api/organizations/",
  "/usage",
  "/backend-api/conversation/init",
  "/backend-api/wham/usage",
  "/backend-api/wham/tasks/rate_limit"
];
```

更严谨地说：

* Grok：只接受 origin [https://grok.com](https://grok.com) 且 pathname === "/rest/rate-limits"
* Claude：只接受 origin [https://claude.ai](https://claude.ai) 且 pathname 匹配 `/api/organizations/.../usage`
* ChatGPT：只接受 origin [https://chatgpt.com](https://chatgpt.com) 且 pathname 是 allowlist

patch 方式：

```ts
const originalFetch = window.fetch;

window.fetch = async function patchedFetch(input, init) {
  const response = await originalFetch.apply(this, arguments);

  try {
    const url = typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : "";

    if (isAllowedUsageUrl(url)) {
      response.clone().json().then((json) => {
        window.postMessage({
          source: "ai-usage-floating-monitor",
          direction: "main-to-content",
          kind: "interceptedUsage",
          url: sanitizeUrl(url),
          json,
          ts: Date.now()
        }, window.location.origin);
      }).catch(() => {});
    }
  } catch {
    // never break host page
  }

  return response;
};
```

要求：

* patch 失败不能影响宿主页面。
* response 必须 clone。
* 不要消费原 response。
* 不要 intercept 所有请求体。
* 不要读取 request body。
* 不要读取 prompt 内容。
* 不要打印完整聊天请求。
* interceptedUsage 也要走 normalizer。
* 同一页面不要重复 patch，多次注入要幂等。

可选：XHR intercept 先不做。如果做，也必须只读 allowlist URL 的 JSON response。

========================
十一、UI 要求
========

widget 由 content script 渲染，必须使用 Shadow DOM。

UI 形态：

折叠态：

* 固定在页面右侧中部。
* 小圆角按钮。
* 显示平台名缩写：

  * Grok
  * Claude
  * GPT
* 显示一个最重要的数字：

  * 优先 remaining 最小且非 null 的 meter
  * 其次 usedPercent
  * 否则显示 "?"
* 显示状态点：

  * ok
  * partial
  * unknown
  * error

展开态：

* 卡片宽度 320px 左右。
* 顶部显示平台名。
* 右上角关闭按钮。
* 显示 refresh 按钮。
* 显示 updatedAt，例如 “updated 23s ago”。
* 显示 cache 状态。
* 每个 meter 一行：

  * label
  * remaining / total 或 usedPercent
  * progress bar
  * source badge
  * reset countdown
* 如果 status 是 error，显示 errorMessage。
* 如果没有 meter，显示 “No usage data available yet”。

样式要求：

* Shadow DOM 内部 CSS。
* 不污染页面 CSS。
* 不依赖宿主页面字体。
* z-index 足够高，但不要离谱，建议 2147483000 以下。
* 支持深色/浅色自适应。
* 不要挡住页面主要输入框；默认放右侧中部。
* 用户可拖动位置是加分项，但第一版非必须。

交互要求：

* 点击折叠态展开。
* 点击关闭折叠。
* 点击刷新触发 refreshUsage({ force: true })。
* 刷新中显示 loading。
* 429 或退避中禁用刷新按钮，并显示剩余等待时间。
* 键盘可访问：button 要有 aria-label。

========================
十二、缓存
=====

使用 chrome.storage.local。

key 格式：

```ts
aiUsage:{platform}:snapshot
aiUsage:{platform}:lastRefreshAt
aiUsage:{platform}:backoffUntil
aiUsage:widget:position
```

不要存：

* cookie
* token
* authorization header
* 聊天内容
* full request body
* full response headers

snapshot 中可以存 UsageSnapshot，但不要存完整 raw JSON。debug 模式下也不要持久化 raw。

========================
十三、本地估算 fallback
================

第一版可以做轻量估算，但不要过度复杂。

估算目标：

* 如果接口完全拿不到，可以显示“估算值”。
* 只统计当前设备、当前浏览器、当前平台。
* 不保证准确。

估算方式：

* 监听用户发送行为，但不读取文本内容。
* 可以监听 form submit 或发送按钮 click。
* 每次发送后给本地计数 +1。
* 按平台维护：

  * sentCount
  * firstSentAt
  * lastSentAt
* 如果没有已知 total，不要假装知道 total。
* UI 显示：

  * “Sent locally: N”
  * source: estimate
  * confidence: low

禁止：

* 不读取输入框 value。
* 不保存 prompt。
* 不根据文本长度估 token。
* 不模拟 tokenization。
* 不写死平台官方套餐限额，除非 README 标明“用户可手动配置”。

========================
十四、错误处理
=======

实现统一错误类型：

```ts
type UsageError = {
  code:
    | "UNAUTHORIZED"
    | "RATE_LIMITED"
    | "NETWORK_ERROR"
    | "PARSER_ERROR"
    | "ENDPOINT_CHANGED"
    | "UNKNOWN";
  message: string;
  status?: number;
};
```

所有平台 adapter 返回：

```ts
Promise<UsageSnapshot>
```

不要 throw 到 UI 顶层导致 widget 崩溃。adapter 内部可以 throw，但 content 层必须 catch 并转换成 error snapshot。

========================
十五、测试要求
=======

写 normalizer 单元测试。

至少覆盖：

Grok:

* remainingQueries / totalQueries
* lowEffortRateLimits
* highEffortRateLimits
* 字段缺失
* 请求失败部分成功

Claude:

* five_hour + seven_day
* seven_day_sonnet
* unknown utilization key
* extra_usage
* null fields

ChatGPT:

* limits_progress deep_research
* limits_progress image_gen
* wham primary_window
* wham secondary_window
* unknown plan_type
* blocked_features
* 字段缺失

测试不需要真实访问网络。使用 mock JSON。

========================
十六、README 要求
============

README.md 必须包含：

1. 项目说明
2. 安装依赖
3. 构建命令
4. Chrome 加载方式：

   * chrome://extensions
   * 开启 Developer mode
   * Load unpacked
   * 选择 dist 目录
5. 支持的平台
6. 数据来源说明
7. 安全边界：

   * 不保存 cookie/token
   * 不上传数据
   * 不读取聊天内容
   * 只在目标域名运行
8. 已知限制：

   * 内部接口可能变化
   * ChatGPT 字段最不稳定
   * Claude/Grok 也可能变更
   * 估算值不精确
9. 调试方式：

   * localStorage.setItem("aiUsageDebug", "1")
10. 手动测试步骤：

* 登录 Grok，打开页面，看 widget
* 登录 Claude，打开页面，看 widget
* 登录 ChatGPT，打开页面，看 widget
* 点击刷新
* 断网/失败情况下 UI 不崩

========================
十七、实现顺序
=======

请按这个顺序实现：

1. 初始化 TypeScript + Vite + MV3 构建。
2. 写 manifest.json。
3. 写 platform detect。
4. 写统一 UsageSnapshot 类型。
5. 写 Shadow DOM widget。
6. 写 chrome.storage.local cache。
7. 写 service worker 注入 mainWorldBridge。
8. 写 mainWorldBridge 的 postMessage 协议和 allowlist fetch。
9. 写 Grok adapter + normalizer。
10. 写 Claude adapter + normalizer。
11. 写 ChatGPT adapter + normalizer。
12. 写 fetch intercept。
13. 写 refresh throttling/backoff。
14. 写 tests。
15. 写 README。
16. 运行 build 和 test，修掉 TypeScript 错误。

========================
十八、代码质量要求
=========

* TypeScript strict 尽量开启。
* 不要用 any，除非解析未知 JSON 时必要。
* 对 unknown JSON 写 type guard / safe getter。
* 不要让平台字段变化导致 crash。
* 所有 DOM 节点创建走 createElement，避免直接拼接不可信 HTML。
* 不使用 dangerouslySetInnerHTML。
* 所有 postMessage 都要校验 source/direction/origin。
* 所有 endpoint 都必须在 allowlist 里。
* 所有网络请求都要有超时，建议 AbortController 10 秒。
* 所有失败要有 UI 状态。

========================
十九、验收标准
=======

最终完成后，必须满足：

* `npm install` 能安装依赖。
* `npm run build` 能生成 dist。
* `npm test` 能跑 normalizer 测试。
* Chrome Load unpacked dist 后能加载扩展。
* 在 grok.com / claude.ai / chatgpt.com 会出现悬浮 widget。
* 其他网页不会出现 widget。
* 点击 widget 能展开。
* 点击刷新会尝试获取当前平台用量。
* 接口失败时显示 unknown/error，不崩。
* 不申请 cookies/webRequest 权限。
* 不保存 token/cookie/header/chat content。
* README 写清楚限制。

========================
二十、最后输出
=======

完成后请在回复里给出：

1. 修改/新增的文件列表。
2. 运行过的命令。
3. build/test 是否通过。
4. 如何手动加载扩展。
5. 三个平台分别如何验证。
6. 目前你发现的限制或 TODO。

现在请开始实现。

````

---

我建议你第一次丢给 Codex 就用这版，不要再拆小任务。  
它如果一次性写炸了，再追一条：

```md
请先不要继续加功能。现在只修复 TypeScript/build/test 错误，保持功能范围不变。不要新增权限，不要引入 React，不要改动安全边界。修完后重新运行 npm run build 和 npm test，并汇报结果。
````

这个后续补刀很有用，不然 Codex 有时候会一边修 bug 一边疯狂加戏。

[1]: https://developers.openai.com/codex/cli?utm_source=chatgpt.com "Codex CLI"
[2]: https://github.com/Superamaja/grok-limit-ui-extension?utm_source=chatgpt.com "Superamaja/grok-limit-ui-extension"