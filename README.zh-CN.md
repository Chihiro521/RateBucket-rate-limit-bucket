# RateBucket

[English README](README.md)

RateBucket 是一个本地优先的 Chrome 扩展，用来查看 Grok、Claude 和 ChatGPT 的用量与速率限制信号。它会在支持的网站中注入一个紧凑的浮动组件，让你直接看到额度窗口、重置时间、用量 meter 和平台特定的限制信息。

本项目是独立的个人工具，不隶属于 OpenAI、Anthropic、xAI、Google 或 proxycheck.io。

## 项目状态

RateBucket 目前适合从源码本地安装使用，尚未发布到 Chrome Web Store。

如果要公开上架，还需要准备商店可用的图标、截图、托管隐私政策、最终商店文案，并确认打包的视觉资源具有清晰的可复用权利。

## 它能做什么

- 在支持的 AI 网页应用上显示浮动用量组件。
- 支持紧凑折叠 chip 和展开详情面板。
- 通过平台专用 normalizer 跟踪 Grok、Claude 和 ChatGPT 的用量信号。
- 以 meter 为粒度合并兼容快照，让 ChatGPT 多个端点的数据可以一起展示。
- 保存短期本地缓存和退避状态，避免频繁失败刷新。
- 在平台缺少可靠额度数据时提供本地估算计数。
- 提供可选 IP 信誉检测面板，只有用户主动配置 proxycheck.io 时才启用。

## 支持的平台

| 平台 | 支持的 URL | 主要数据来源 |
| --- | --- | --- |
| Grok | `https://grok.com/*` | `/rest/rate-limits` |
| Claude | `https://claude.ai/*` | `/api/organizations`、`/api/organizations/{orgId}/usage` |
| ChatGPT | `https://chatgpt.com/*` | `/backend-api/conversation/init`、`/backend-api/wham/usage`、`/backend-api/wham/tasks/rate_limit`、`/codex/settings/usage` |

扩展也会观察页面自身对允许列表内用量端点的 fetch 响应。被观察到的响应会经过和主动刷新相同的 normalizer。

## 工作方式

RateBucket 是一个 Manifest V3 扩展：

- `content.js` 在支持的网站中运行，并负责浮动 UI。
- `mainWorldBridge.js` 在页面主世界中运行，用于在必要时观察平台 fetch 行为。
- `serviceWorker.js` 处理后台任务，例如可选 IP 信誉检测刷新。
- 平台解析器会把原始端点结构标准化为共享的 usage snapshot。
- `chrome.storage.local` 保存标准化快照、本地估算计数、重试状态和可选 IP 风险设置。

项目本身不使用自有外部后端。

## 视觉设计

当前 UI 使用紧凑的植物系绿金视觉主题，并包含装饰性 PNG 素材。如果要发布到 Chrome Web Store，或单独复用这些素材，请先确认视觉资源的权属/授权，或者替换为完全自有的品牌素材。

## 第三方知识产权说明

RateBucket 是独立项目，不隶属于 miHoYo、HoYoverse、Cognosphere 或任何相关权利方，也未获得其背书、赞助或官方认可。所有商标、角色指涉、版权和视觉 IP 均归各自权利人所有。

如果你是相关权利人，并认为本仓库中的任何视觉素材、命名或展示方式侵犯了你的权利，请通过 GitHub Issue 或 `1139524867@qq.com` 联系我。我会及时审核并移除或替换有争议的内容。

## 从源码安装

安装依赖：

```bash
npm install
```

构建扩展：

```bash
npm run build
```

在 Chrome 中加载：

1. 打开 `chrome://extensions`。
2. 启用“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择生成的 `dist/` 目录。

## 开发

运行测试：

```bash
npm test
```

构建生产文件：

```bash
npm run build
```

项目使用 TypeScript、Vite 和 Vitest。仓库没有单独的 formatter 或 linter 命令，修改时请保持和附近代码一致的风格。

## 仓库结构

```text
src/background/   扩展 service worker
src/content/      浮动组件、样式、bridge client、估算器和页面探测
src/injected/     主世界 bridge 代码
src/platforms/    平台检测、端点逻辑、normalizer、合并类型
src/storage/      chrome.storage.local 辅助函数
src/utils/        共享工具
tests/            Vitest 单元测试
scripts/          构建脚本
dist/             生成的扩展产物
```

`dist/` 由 `npm run build` 生成。

## 隐私与安全边界

RateBucket 尽量保持本地运行：

- 不保存 cookie。
- 不保存平台 token。
- 不读取 Authorization header。
- 不读取或保存聊天内容。
- 不包含分析或遥测。
- 不申请 `cookies`、`webRequest`、`tabs` 或 `activeTab` 权限。
- 只在 `chrome.storage.local` 中保存标准化用量数据、本地计数、重试元数据和可选 IP 风险设置。

扩展只请求 Grok、Claude、ChatGPT 和可选 IP 信誉服务的 host access。

## 可选 IP 信誉检测

IP 信誉检测默认关闭。用户主动启用并提供 proxycheck.io API 密钥后，扩展会：

- 将 API 密钥保存到 `chrome.storage.local`；
- 通过 `https://api64.ipify.org/?format=json` 获取当前公网 IP；
- 使用 `vpn=1` 和 `risk=1` 查询 `https://proxycheck.io/v2/{ip}`；
- 只在本地保存标准化后的风险结果。

扩展不会保存历史 IP 地址。

## 调试日志

调试日志默认关闭。可以在支持的网站中执行：

```js
localStorage.setItem("aiUsageDebug", "1");
```

关闭调试日志：

```js
localStorage.removeItem("aiUsageDebug");
```

即使开启调试日志，原始端点响应也不会被持久化保存。

## Chrome Web Store 状态

RateBucket 目前以源码安装方式分发。Chrome Web Store 版本会在公开商店材料和政策文档准备完成后再提交。

提交前还需要准备：

- 扩展图标，包括 128x128 PNG 图标；
- 商店截图和宣传图；
- 与扩展真实行为一致的托管隐私政策；
- 对 `storage`、`scripting` 和 host permissions 的清晰权限说明；
- 明确说明单一用途的最终商店文案；
- 权属或授权清晰的视觉资源。

在此之前，请使用上面的源码安装流程。

## 已知限制

- 支持的平台使用内部网页 API，这些 API 可能随时变化。
- ChatGPT 的用量字段预计最不稳定。
- Claude 和 Grok 的响应结构也可能变化。
- 估算模式只统计当前浏览器里的本地行为，不是权威额度数据。
- 当前扩展不面向多账号、团队套餐、企业套餐或跨设备同步。

## 许可证

RateBucket 使用 MIT License 发布，见 [LICENSE](LICENSE)。

当前打包的视觉资源是现有项目包的一部分。如果要发布到 Chrome Web Store，或单独复用这些资源，请先确认权属/授权，或者替换为完全自有的品牌素材。

## 鸣谢

感谢我的四位非正式老师兼协作者：

- Claude，常驻哲学顾问。
- GPT，最务实的结对编程伙伴。
- Grok，小道消息来源。
- Gemini，偶尔点亮灵感，虽然经常像是在打酱油。

这个项目由人类完成，中间借了很多场对话的力。
