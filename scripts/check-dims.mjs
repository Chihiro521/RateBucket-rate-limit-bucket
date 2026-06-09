import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sizes = [16, 32, 48, 128];

for (const s of sizes) {
  const name = `${s}x${s}.png`;
  const meta = await sharp(path.join(root, "icon", name)).metadata();
  console.log(`${name}: ${meta.width}x${meta.height}, ${meta.format}`);
}
