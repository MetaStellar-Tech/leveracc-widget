import { defineConfig } from "vite";
export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        wallets: "src/wallets.ts",
        "wallets-react": "src/wallets-react.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    },
    target: "es2022",
  },
});
