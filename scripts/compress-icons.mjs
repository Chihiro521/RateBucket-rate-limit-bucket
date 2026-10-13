import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "chrome-webstore-archive", "icon", "母版");
const outDir = path.join(root, "icon");

const sizes = [16, 32, 48, 128];

await mkdir(outDir, { recursive: true });

for (const size of sizes) {
  const input = path.join(sourceDir, `${size}x${size}.png`);
  const output = path.join(outDir, `${size}x${size}.png`);

  await sharp(input)
    .resize(size, size, { kernel: "lanczos3" })
    .png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
    .toFile(output);

  console.log(`  ${size}x${size}.png  →  icon/${size}x${size}.png`);
}

console.log("Done.");
