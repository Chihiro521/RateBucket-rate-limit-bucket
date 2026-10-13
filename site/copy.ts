export type SiteLanguage = "zh-CN" | "en";

const zh = {
  skip: "跳到正文", navLabel: "主导航", navDemo: "试试看", navFeatures: "为什么用它", navInstall: "安装", languageLabel: "页面语言",
  pageTitle: "RateBucket · AI 用量与重置，随时看一眼", pageDescription: "在 ChatGPT、Claude、Grok 等七个平台的页面中查看 AI 用量、剩余额度与重置时间。RateBucket 是免费的开源浏览器扩展。",
  heroEyebrow: "AI 用量监控 · 浏览器扩展", heroTitle1: "AI 用量与重置，", heroTitle2: "随时看一眼。",
  heroDescription: "还剩多少额度，多久恢复？RateBucket 把平台提供的用量与重置时间放在当前页面，展开就能看，收起也不占地方。",
  installChrome: "添加到 Chrome", tryDemo: "先体验一下", heroDetails: "开源免费", heroDetails2: "在你熟悉的 AI 页面里",
  mascotAlt: "小千寻坐在浏览器窗口上，用平板查看用量，旁边是额度表与时钟", sample: "示例数据", remaining: "剩余额度", heroReset: "2 小时 36 分钟后重置", artCaption: "用量、余量、重置时间，一眼可见。",
  platformRibbon: "支持七个平台，在各自的页面中查看用量", demoEyebrow: "交互演示", demoTitle1: "先点点看，", demoTitle2: "再决定安装。",
  brandDisclaimer: "各平台名称与标识归各自权利人所有，仅用于说明兼容性。RateBucket 是独立开源项目，与上述平台无隶属、合作或背书关系。",
  trademarkNotice: "本页涉及的第三方商标和标识归各自权利人所有。Gemini 是 Google LLC 的商标。项目的 MIT 许可证不授予第三方商标或标识的使用权。",
  demoIntro: "这是正在运行的真实扩展组件。换个平台，展开面板，或者把小胶囊拖到你喜欢的位置。",
  platformCount: "个平台，一眼清楚", demoTip: "点右上角的 × 收起，再拖动小胶囊。每个平台都有自己的额度表达方式。",
  platformTabsLabel: "选择演示平台", iframeTitle: "RateBucket 交互演示", demoError: "演示暂时没有加载成功。", reloadDemo: "重新加载演示",
  toggleDemo: "展开 / 收起", refreshDemo: "刷新示例", resetDemo: "重新开始", demoReady: "可以自由体验", demoRefreshed: "示例读数已更新", demoLoading: "正在加载演示…",
  demoDisclaimer: "演示使用固定示例读数，供你体验界面；实际额度以各平台返回的信息为准。",
  featuresEyebrow: "用量信息，随手可查", featuresTitle1: "还能用多少，", featuresTitle2: "什么时候重置。",
  featuresIntro: "次数、百分比、共享额度池和倒计时，按平台实际提供的信息展示。查看用量后，继续当前的对话和创作。",
  featureQuotaTitle: "剩下多少，抬眼就知道", featureQuotaDescription: "次数、百分比、共享额度池——把不同平台的用量信息，变成容易读懂的小面板。",
  featureTimeTitle: "离重置还有多久", featureTimeDescription: "当平台提供重置时间时，直接看到倒计时。什么时候再来，不用自己掐着时间算。",
  featureSmallTitle: "展开查看，收起成胶囊", featureSmallDescription: "想看时展开，专注时收起。把胶囊拖到顺手的位置，在你原本的 AI 页面里继续工作。",
  localTitle: "简单，也轻盈。", localDescription: "用量读数保存在浏览器本地。无需额外账号，没有项目自建后台，也没有广告或遥测。", privacyLink: "了解数据处理",
  installEyebrow: "添加到浏览器", installTitle1: "打开 AI 页面，", installTitle2: "用量就在旁边。", installDescription: "安装扩展后，打开已登录的支持网站，即可使用用量悬浮窗。无需额外注册账号。", browserNote: "面向桌面 Chrome / Chromium 浏览器",
  manualTitle: "也可以从 GitHub 安装", manualDescription: "喜欢自己动手？下载扩展包，解压后加载即可。", downloadRelease: "下载最新 Release",
  installStep1: "下载 Release 中的 ZIP，并解压到一个固定目录。", installStep2a: "打开", installStep2b: "，开启「开发者模式」。", installStep3: "点击「加载已解压的扩展程序」，选择解压后的目录。",
  copyAddress: "复制扩展管理地址", copied: "地址已复制", copyFailed: "请手动复制 chrome://extensions",
  faqEyebrow: "常见问题", faqTitle: "你可能想知道", faqIntro: "安装与用量显示的几个常见问题。",
  faq1Title: "需要登录另一个账号吗？", faq1Answer: "不需要。安装后，在已经登录的支持网站上使用即可。RateBucket 没有单独的账号系统。",
  faq2Title: "每个平台都能看到精确剩余次数吗？", faq2Answer: "显示内容取决于平台提供的信息：有的提供次数，有的提供百分比或共享额度池。部分信息属于本地估算或未校准读数，组件会标明来源与状态。",
  faq3Title: "暂时看不到额度，怎么办？", faq3Answer: "先确认已登录平台，再尝试组件的刷新按钮。平台接口可能变化；如果问题持续，可以在 GitHub 提交问题，附上平台名称和组件提示。",
  faq4Title: "可以在手机或其他浏览器上使用吗？", faq4Answer: "目前主要在桌面 Chrome / Chromium 浏览器上验证。官网可以用手机浏览，扩展本身尚未正式支持手机、Firefox 或 Safari。",
  faq5Title: "它是各家 AI 平台的官方扩展吗？", faq5Answer: "RateBucket 是独立的开源项目，与所支持的 AI 平台没有隶属或官方合作关系。代码采用 MIT 许可证，欢迎通过 GitHub 了解和参与。",
  footerMotto: "AI 用量，随时可查。", backTop: "回到顶部", footerMade: "· 开源浏览器扩展", changelog: "更新记录", privacy: "隐私政策",
  mockEyebrow: "给今天留一点好奇", mockTitle: "今天，想探索什么？", mockPrompt: "帮我想一个有趣的新点子…", mockHint: "RateBucket 就在你身边 →",
  platformChatgpt: "查看用量窗口、深度研究、文件空间与订阅倒计时。可获取的额度按类别放在同一个面板里。",
  platformClaude: "五小时与每周用量窗口各自显示，让短期节奏和长期余量一眼清楚。",
  platformGrok: "一个共享的额度池，分段展示 Imagine、Chat、Grok Build 与 API 的使用贡献。",
  platformGemini: "查看五小时和每周额度窗口；有次数就显示次数，有重置时间就显示倒计时。",
  platformKimi: "以订阅额度的已用与剩余百分比，呈现当前用量，以及额度的到期时间。",
  platformPerplexity: "查看 Pro、Deep Research 和 Labs 的剩余次数。平台未提供的上限与重置时间保持未知。",
  platformMuse: "每周额度与额外用量分开呈现。额外余额保留平台文本，并显示不会过期。"
} as const;

export type CopyKey = keyof typeof zh;

const en: Record<CopyKey, string> = {
  skip: "Skip to content", navLabel: "Main navigation", navDemo: "Try it", navFeatures: "Why RateBucket", navInstall: "Install", languageLabel: "Page language",
  pageTitle: "RateBucket · AI usage and resets, at a glance", pageDescription: "See AI usage, remaining limits, and reset times inside ChatGPT, Claude, Grok, and four more platforms. RateBucket is a free, open-source browser extension.",
  heroEyebrow: "AI USAGE MONITOR · BROWSER EXTENSION", heroTitle1: "AI usage.", heroTitle2: "At a glance.",
  heroDescription: "How much is left? When does it reset? RateBucket puts the usage information your platform provides right on the page. Open the panel to check, then tuck it away.",
  installChrome: "Add to Chrome", tryDemo: "Take a little look", heroDetails: "Free & open source", heroDetails2: "Right inside your AI pages",
  mascotAlt: "Little Chihiro sits on a browser window checking usage on a tablet, beside a quota gauge and clock", sample: "Sample data", remaining: "remaining", heroReset: "Resets in 2h 36m", artCaption: "Usage, remaining limits, and reset times.",
  platformRibbon: "Seven platforms. Usage, right on each page.", demoEyebrow: "INTERACTIVE DEMO", demoTitle1: "Try the widget.", demoTitle2: "Then decide.",
  brandDisclaimer: "Platform names and logos belong to their respective owners and are shown only to identify compatibility. RateBucket is an independent open-source project and is not affiliated with, partnered with, or endorsed by these platforms.",
  trademarkNotice: "Third-party trademarks and logos on this page belong to their respective owners. Gemini is a trademark of Google LLC. The project's MIT license grants no rights to third-party trademarks or logos.",
  demoIntro: "This is the real extension widget, running here. Pick a platform, open the panel, or drag the little capsule somewhere that feels right.",
  platformCount: "platforms, at a glance", demoTip: "Use × to tuck the panel away, then drag the capsule. Each platform has its own way of showing usage.",
  platformTabsLabel: "Choose a demo platform", iframeTitle: "Interactive RateBucket demo", demoError: "The demo hasn't loaded yet.", reloadDemo: "Reload demo",
  toggleDemo: "Open / close", refreshDemo: "Refresh sample", resetDemo: "Start again", demoReady: "Make yourself at home", demoRefreshed: "Sample readings updated", demoLoading: "Loading the demo…",
  demoDisclaimer: "Fixed sample readings let you explore the interface. Your actual limits depend on the information each platform provides.",
  featuresEyebrow: "USAGE INFORMATION WITHIN REACH", featuresTitle1: "What's left.", featuresTitle2: "When it resets.",
  featuresIntro: "Counts, percentages, shared buckets, and countdowns, based on what each platform provides. Check your usage, then get back to the conversation.",
  featureQuotaTitle: "Your usage, at a glance", featureQuotaDescription: "Counts, percentages, shared credit buckets. Different platforms' usage signals, in one easy-to-read little panel.",
  featureTimeTitle: "Know when to come back", featureTimeDescription: "When a platform provides a reset time, see a live countdown. Spend less time working out when to try again.",
  featureSmallTitle: "A panel when you need it", featureSmallDescription: "Open it when you need it. Tuck it away when you don't. Drag the capsule where you like, and keep working on your usual AI page.",
  localTitle: "Simple, and light on its feet. ", localDescription: "Usage readings stay in your browser. No extra account, project-owned backend, ads, or telemetry.", privacyLink: "About your data",
  installEyebrow: "ADD IT TO YOUR BROWSER", installTitle1: "Open your AI page.", installTitle2: "Keep usage in view.", installDescription: "Install the extension, then visit a supported site where you're already signed in. Your floating usage panel will appear. No extra account needed.", browserNote: "For desktop Chrome / Chromium browsers",
  manualTitle: "Prefer to install from GitHub?", manualDescription: "Download the extension, unzip it, and load it into your browser.", downloadRelease: "Get the latest release",
  installStep1: "Download the release ZIP and extract it to a permanent folder.", installStep2a: "Open", installStep2b: " and turn on Developer mode.", installStep3: "Click Load unpacked and select the extracted extension folder.",
  copyAddress: "Copy the extensions page address", copied: "Address copied", copyFailed: "Please copy chrome://extensions manually",
  faqEyebrow: "FAQ", faqTitle: "Good questions.", faqIntro: "Common questions about installation and usage readings.",
  faq1Title: "Do I need another account?", faq1Answer: "No. Once installed, use it on supported sites where you're already signed in. RateBucket has no separate account system.",
  faq2Title: "Does every platform show an exact count?", faq2Answer: "It depends on what each platform provides: counts, percentages, or shared credit buckets. Some readings are local estimates or uncalibrated values; the widget labels their source and status.",
  faq3Title: "What if I can't see my usage?", faq3Answer: "Check that you're signed in, then try the widget's refresh button. Platform interfaces can change. If the issue persists, open a GitHub issue with the platform name and the widget's message.",
  faq4Title: "Can I use it on mobile or other browsers?", faq4Answer: "The extension is primarily verified on desktop Chrome / Chromium. This website works on mobile; the extension does not yet officially support mobile, Firefox, or Safari.",
  faq5Title: "Is this an official AI platform extension?", faq5Answer: "RateBucket is an independent open-source project, with no affiliation or official partnership with the supported platforms. Its code is MIT licensed. Explore or contribute on GitHub.",
  footerMotto: "AI usage, always within reach.", backTop: "Back to top", footerMade: "· Open-source browser extension", changelog: "Changelog", privacy: "Privacy policy",
  mockEyebrow: "A LITTLE ROOM FOR CURIOSITY", mockTitle: "Where shall we wander today?", mockPrompt: "Help me dream up something new…", mockHint: "Your little companion is right here →",
  platformChatgpt: "Explore usage windows, Deep Research, file storage, and a subscription countdown. Available readings are grouped in one panel.",
  platformClaude: "Five-hour and weekly usage windows are shown separately, so your short-term pace and longer-term room are easy to see.",
  platformGrok: "One shared credit bucket, with segments showing the contributions of Imagine, Chat, Grok Build, and API usage.",
  platformGemini: "See five-hour and weekly usage windows. Available counts and reset times appear together.",
  platformKimi: "Used and remaining subscription percentages show where you stand, alongside the credit expiry time.",
  platformPerplexity: "See remaining Pro, Deep Research, and Labs queries. Missing totals and reset times stay unknown.",
  platformMuse: "Weekly usage and additional balance stay separate. Extra balance retains platform text and shows that it never expires."
};

export const copy: Record<SiteLanguage, Record<CopyKey, string>> = { "zh-CN": zh, en };

export function initialLanguage(browserLanguages: readonly string[], saved: string | null): SiteLanguage {
  if (saved === "zh-CN" || saved === "en") return saved;
  return browserLanguages[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function isSiteLanguage(value: unknown): value is SiteLanguage {
  return value === "zh-CN" || value === "en";
}
