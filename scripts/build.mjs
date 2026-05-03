import { rm, copyFile, mkdir } from "node:fs/promises";
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
await mkdir(dist, { recursive: true });

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
await copyFile(path.join(root, "src", "art assets", "nihida.webp"), path.join(dist, "nihida.webp"));
