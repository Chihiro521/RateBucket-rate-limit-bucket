import { mkdir, rm, copyFile } from "node:fs/promises";
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

const nahidaAssetSource = path.join(root, "assets", "nahida");
const nahidaAssetDist = path.join(dist, "assets", "nahida");
const nahidaAssetFiles = [
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
await mkdir(nahidaAssetDist, { recursive: true });
for (const fileName of nahidaAssetFiles) {
  await copyFile(
    path.join(nahidaAssetSource, fileName),
    path.join(nahidaAssetDist, fileName)
  );
}
