// Read-only visual harness: render the dapp's actual components with deterministic data.
// The reference checkout is never modified and is not a production dependency.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const widget = process.cwd(),
  reference = path.resolve(widget, "../leveracc-dapp");
const req = createRequire(path.join(reference, "package.json"));
const viteReq = createRequire(
  createRequire(path.join(widget, "package.json")).resolve("vite/package.json"),
);
const { build } = viteReq("esbuild");
const postcss = viteReq("postcss"),
  tailwind = req("@tailwindcss/postcss");
const out = path.join(widget, ".cache/ui-reference");
await fs.mkdir(out, { recursive: true });
const stub = path.join(widget, "tests/visual-reference/stubs.tsx.fixture");
const mocked = [
  "use-gas-balance-warning",
  "account-creation-gas",
  "onboarding-overlay",
  "use-arbitrum-gas-top-up",
  "arbitrum-gas-top-up",
  "use-core-account-gas",
  "use-cctp-deposit",
  "use-hyperliquid-core-to-evm-transfer",
  "use-hyperliquid-spot-usdc-balance",
  "use-account-token-balance",
  "use-arbitrum-usdc-balance",
];
await build({
  entryPoints: [path.join(widget, "tests/visual-reference/main.tsx.fixture")],
  outfile: path.join(out, "main.js"),
  loader: { ".fixture": "tsx" },
  bundle: true,
  format: "esm",
  jsx: "automatic",
  nodePaths: [path.join(reference, "node_modules")],
  alias: {
    "@": reference,
    react: path.join(widget, "node_modules/react"),
    "react-dom": path.join(widget, "node_modules/react-dom"),
  },
  plugins: [
    {
      name: "reference-data",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (
            mocked.some((name) => args.path.endsWith("/" + name)) ||
            [
              "@/config",
              "wagmi",
              "next-intl",
              "@/providers/auth-provider",
            ].includes(args.path)
          )
            return { path: stub };
        });
      },
    },
  ],
});
const css = await fs.readFile(path.join(reference, "app/globals.css"), "utf8");
const result = await postcss([tailwind({ base: reference })]).process(
  css + `\n@source "${reference}/components";\n@source "${reference}/app";`,
  { from: path.join(reference, "app/globals.css") },
);
await fs.writeFile(path.join(out, "style.css"), result.css);
await fs.copyFile(
  path.join(
    reference,
    "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  ),
  path.join(out, "geist.woff2"),
);
await fs.copyFile(
  path.join(
    reference,
    "node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
  ),
  path.join(out, "geist-mono.woff2"),
);
await fs.writeFile(
  path.join(out, "index.html"),
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><style>@font-face{font-family:'Geist Mono Variable';src:url(geist-mono.woff2);font-weight:100 900}@font-face{font-family:'Geist Variable';src:url(geist.woff2);font-weight:100 900}body{font-family:'Geist Variable',sans-serif;background:#080b0d}</style></head><body><div id="root"></div><script type="module" src="main.js"></script></body></html>`,
);
console.log(out);
