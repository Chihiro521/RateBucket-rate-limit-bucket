# RateBucket

[English README](README.md)

RateBucket 是一个 Manifest V3 Chrome 扩展，会在 Grok、Claude 和 ChatGPT 页面注入紧凑的浮动用量组件，用来查看当前用量、额度、重置窗口和速率限制信号。它定位为个人自用的监控工具，数据来自各平台网页自身可访问的用量或限流端点。

本项目不隶属于 OpenAI、Anthropic、xAI 或 proxycheck.io。

## 功能

- 支持 Grok、Claude 和 ChatGPT 的浮动用量组件。
- 支持折叠、展开和拖拽紧凑 chip。
- 以 meter 为粒度合并快照，ChatGPT 的多个用量来源可以同时展示。
- 对缺少可靠额度接口的行为提供本地估算计数。
- 可选 ChatGPT sentinel 信息和可选 IP 信誉检测面板。
- 无遥测；项目本身不提供外部后端。

## 支持的网站

- `https://grok.com/*`
- `https://claude.ai/*`
- `https://chatgpt.com/*`

扩展的 content script 只声明在这些站点运行。

## 数据来源

扩展只访问白名单内的用量或限流端点：

- Grok：`/rest/rate-limits`
- Claude：`/api/organizations`，然后访问 `/api/organizations/{orgId}/usage`
- ChatGPT：`/backend-api/conversation/init`、`/backend-api/wham/usage`、`/backend-api/wham/tasks/rate_limit` 和 `/codex/settings/usage`

扩展也会观察页面自身对这些用量端点的 fetch 响应。被观察到的响应会经过和主动刷新相同的 normalizer 处理。

对于 ChatGPT Codex 用量，如果当前页面无法直接请求，扩展可能会短暂加载同源的 Codex analytics 路由到隐藏 iframe 中，并观察该页面自身发出的用量响应。

## 可选 IP 风险检测

IP 风险检测默认关闭。用户主动启用后，它会：

- 将 proxycheck.io API 密钥保存到 `chrome.storage.local`；
- 通过 `https://api64.ipify.org/?format=json` 临时获取当前公网 IP；
- 使用 `vpn=1` 和 `risk=1` 查询 `https://proxycheck.io/v2/{ip}`；
- 只在本地保存标准化后的风险结果。

扩展不会保存历史 IP 地址。

## 安全边界

- 不保存 cookie。
- 不保存平台 token。
- 不读取 Authorization header。
- 不读取或保存聊天内容。
- 不包含分析或遥测。
- 不申请 `cookies`、`webRequest`、`tabs` 或 `activeTab` 权限。
- 只在 `chrome.storage.local` 中保存标准化用量快照、本地估算计数、可选 proxycheck.io 设置和可选标准化 IP 风险状态。

## 安装

```bash
npm install
```

## 构建

```bash
npm run build
```

构建产物会写入 `dist/`。

## 在 Chrome 中加载

1. 打开 `chrome://extensions`。
2. 启用开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择生成的 `dist/` 目录。

## 开发

```bash
npm test
npm run build
```

项目使用 TypeScript、Vite 和 Vitest。仓库没有单独的 lint 或 formatter 脚本，修改时请保持和附近代码一致的风格。

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

## 手动验证

1. 登录 Grok 并打开 `https://grok.com`。
2. 确认组件会显示，并且可以展开、折叠、拖拽和刷新。
3. 在 `https://claude.ai` 上重复验证。
4. 在 `https://chatgpt.com` 上重复验证。
5. 断开网络或模拟端点失败，确认 UI 会显示未知/错误状态且不会崩溃。
6. 打开无关网站，确认不会出现组件。

## 已知限制

- 支持的平台使用内部网页 API，这些 API 可能随时变化。
- ChatGPT 的用量字段预计最不稳定。
- Claude 和 Grok 的用量响应结构也可能变化。
- 估算模式只统计当前浏览器里的本地发送行为，不是权威额度数据。
- 当前扩展不面向多账号、团队套餐、企业套餐、跨设备同步或 Chrome Web Store 发布。 
