import { defineConfig } from "vite";
export default defineConfig({
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/embed.tsx",
      name: "LeverAcc",
      formats: ["es", "iife"],
      fileName: (format) => (format === "es" ? "embed.js" : "widget.js"),
    },
    target: "es2022",
    minify: "esbuild",
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
