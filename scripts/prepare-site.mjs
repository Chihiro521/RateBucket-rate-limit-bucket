import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = path.join(root, ".site-public");
const artRoot = path.join(publicRoot, "assets", "little-chihiro");
const artwork = [
  "mascot.png", "capsule-mascot.png", "clover-medallion.png",
  "corner-bottom-left.png", "corner-bottom-right.png",
  "corner-top-left.png", "corner-top-right.png", "divider-vine.png",
  "gem-square.png", "leaf-emblem.png", "leaf-small.png", "shield.png"
];

await mkdir(artRoot, { recursive: true });
for (const filename of artwork) {
  await copyFile(path.join(root, "assets", "little-chihiro", filename), path.join(artRoot, filename));
}
// Remove the retired website-only FAQ image from earlier local preparations.
await rm(path.join(publicRoot, "assets", "rabbit.png"), { force: true });
const siteAssets = {
  illustrations: ["hero-usage.png", "capsule-peek.png", "install-extension.png"],
  logos: ["chatgpt.svg", "claude.svg", "grok.svg", "gemini.svg", "kimi.png", "perplexity.svg", "muse.svg"]
};
for (const [directory, filenames] of Object.entries(siteAssets)) {
  const destination = path.join(publicRoot, "assets", directory);
  await mkdir(destination, { recursive: true });
  for (const filename of filenames) {
    await copyFile(path.join(root, "site", "artwork", directory, filename), path.join(destination, filename));
  }
}
await copyFile(path.join(root, "icon", "128x128.png"), path.join(publicRoot, "brand-icon.png"));
await copyFile(path.join(root, "privacy-policy.html"), path.join(publicRoot, "privacy-policy.html"));
console.log("Prepared website artwork and privacy policy.");
