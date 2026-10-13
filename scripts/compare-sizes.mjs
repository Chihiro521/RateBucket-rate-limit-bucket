import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sizes = [16, 32, 48, 128];

console.log("Size    Before     After      Ratio");
console.log("----    ------     -----      -----");
for (const s of sizes) {
  const name = `${s}x${s}.png`;
  const before = statSync(path.join(root, "chrome-webstore-archive", "icon", "母版", name)).size;
  const after = statSync(path.join(root, "icon", name)).size;
  const ratio = ((after / before) * 100).toFixed(1);
  console.log(
    `${name.padEnd(7)} ${String(Math.round(before / 1024)).padStart(5)}KB  →  ${String(Math.round(after / 1024)).padStart(5)}KB   ${ratio}%`
  );
}
