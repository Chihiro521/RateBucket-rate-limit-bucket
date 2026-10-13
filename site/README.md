# RateBucket 宣传官网

在仓库根目录运行：

```powershell
npm run site:dev
```

本地预览地址是 `http://127.0.0.1:4173/`。站点跟随浏览器语言，手动选择中文或英文后会记住选择。

生产构建与预览：

```powershell
npm run site:build
npm run site:preview
```

生产文件在 `site-dist/`，与扩展的 `dist/` 分开。相对资源路径支持 GitHub Pages 项目子目录。

官网地址：[RateBucket](https://chihiro521.github.io/RateBucket-rate-limit-bucket/)。GitHub Pages 的发布来源设为 GitHub Actions，`.github/workflows/pages.yml` 在站点或其依赖变更合并到 `master` 后运行测试、构建并发布 `site-dist/`。也可以在 Actions 中手动运行该工作流；正式部署仅允许 `master` 分支。README 继续作为项目文档入口。

`main.ts` 负责官网交互，`copy.ts` 保存双语文案。`demo.html` 在独立 iframe 中运行现有 `UsageWidget`；`demo-data.ts` 提供七个平台的示例 `UsageSnapshot`。演示不调用平台接口。切换平台会销毁旧组件，刷新会切换两组固定读数，重置会恢复初始示例。

`scripts/prepare-site.mjs` 按文件白名单准备组件素材、官网插画、平台标识和隐私政策，写入忽略的 `.site-public/`。新增官网素材时同步维护该名单。站点及示例与正式扩展的版本和构建流程独立。

`artwork/illustrations/` 保存官网专用的三张 ImageGen 插画及提示词，`artwork/logos/README.md` 记录七个平台标识的官网资源来源。构建时复制到公共资源目录的 `assets/` 下，官网素材不替换正式扩展中的角色图片。
