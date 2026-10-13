import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./site", import.meta.url)),
  base: "./",
  publicDir: fileURLToPath(new URL("./.site-public", import.meta.url)),
  server: { port: 4173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL("./site-dist", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./site/index.html", import.meta.url)),
        demo: fileURLToPath(new URL("./site/demo.html", import.meta.url))
      }
    }
  }
});
