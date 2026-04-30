import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "chrome116"
  },
  test: {
    environment: "node"
  }
});
