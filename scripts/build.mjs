import { mkdir, rm, copyFile, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const entries = [
  {
    entry: path.join(root, "src", "content", "content.ts"),
    fileName: "content.js",
    name: "AiUsageFloatingMonitorContent"
  },
  {
    entry: path.join(root, "src", "background", "serviceWorker.ts"),
    fileName: "serviceWorker.js",
    name: "AiUsageFloatingMonitorServiceWorker"
  },
  {
    entry: path.join(root, "src", "injected", "mainWorldBridge.ts"),
    fileName: "mainWorldBridge.js",
    name: "AiUsageFloatingMonitorBridge"
  }
];

await rm(dist, { recursive: true, force: true });

for (const item of entries) {
  await build({
    root,
    configFile: false,
    publicDir: false,
    build: {
      outDir: dist,
      emptyOutDir: false,
      sourcemap: false,
      minify: false,
      target: "chrome116",
      lib: {
        entry: item.entry,
        formats: ["iife"],
        name: item.name,
        fileName: () => item.fileName
      }
    }
  });
}

await copyFile(path.join(root, "manifest.json"), path.join(dist, "manifest.json"));

const chihiroAssetSource = path.join(root, "assets", "little-chihiro");
const chihiroAssetDist = path.join(dist, "assets", "little-chihiro");
const chihiroAssetFiles = [
  "capsule-mascot.png",
  "clover-medallion.png",
  "corner-bottom-left.png",
  "corner-bottom-right.png",
  "corner-top-left.png",
  "corner-top-right.png",
  "corners.png",
  "crest-wide.png",
  "divider-vine.png",
  "gem-square.png",
  "leaf-emblem.png",
  "leaf-small.png",
  "mascot.png",
  "shield.png",
  "vine-wallpaper.png"
];
await mkdir(chihiroAssetDist, { recursive: true });
for (const fileName of chihiroAssetFiles) {
  await copyFile(
    path.join(chihiroAssetSource, fileName),
    path.join(chihiroAssetDist, fileName)
  );
}

await cp(path.join(root, "icon"), path.join(dist, "icon"), { recursive: true, force: true });
await cp(path.join(root, "_locales"), path.join(dist, "_locales"), { recursive: true, force: true });
