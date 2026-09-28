import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    outDir: "examples-dist",
    rollupOptions: {
      input: {
        react: "examples/react/index.html",
        privy: "examples/privy/index.html",
        vanilla: "examples/vanilla/index.html",
      },
    },
  },
});
