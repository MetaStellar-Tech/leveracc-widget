import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const run = (command, args, cwd = process.cwd()) => {
  const env = { ...process.env };
  if (args.includes("--ignore-scripts")) {
    // npm run exports user allow-scripts config into the environment. New npm
    // rejects that CLI-scoped setting for project installs, even with scripts
    // disabled. Keep --ignore-scripts and let npm read its normal config files.
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === "npm_config_allow_scripts") delete env[key];
    }
  }
  return execFileSync(command, args, { cwd, env, stdio: "inherit" });
};
mkdirSync("artifacts", { recursive: true });
// prepack builds fresh output. Publish this exact archive after verification.
run("npm", ["pack", "--pack-destination", "artifacts"]);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const archive = resolve(
  "artifacts",
  `${pkg.name.replace(/^@/, "").replaceAll("/", "-")}-${pkg.version}.tgz`,
);
const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
  .trim()
  .split("\n");
for (const entry of Object.values(pkg.exports)) {
  for (const target of typeof entry === "string"
    ? [entry]
    : Object.values(entry)) {
    assert(
      files.includes(`package/${target.replace(/^\.\//, "")}`),
      `Missing export: ${target}`,
    );
  }
}
assert(files.includes("package/docs/licenses/GEIST.txt"));
assert(files.includes("package/docs/licenses/WEB3ICONS.txt"));
assert(
  !files.some((file) => /\/node_modules\/|\/\.env|\/tests\//.test(file)),
  "Unexpected private/development files",
);
const consumer = mkdtempSync(join(tmpdir(), "leveracc-consumer-"));
try {
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      archive,
      "react@18.3.1",
      "react-dom@18.3.1",
      "@types/react@18",
      "@types/react-dom@18",
      "typescript@5.9.3",
      "vite@7",
    ],
    consumer,
  );
  writeFileSync(
    join(consumer, "index.html"),
    '<div id="app"></div><script type="module" src="/main.tsx"></script>',
  );
  writeFileSync(
    join(consumer, "main.tsx"),
    `
import { createRoot } from 'react-dom/client';
import { LeverAccWidget, type WidgetConfig } from '@leveracc/widget';
import { mountLeverAccWidget } from '@leveracc/widget/embed';
import { walletFromViem, walletFromWagmi } from '@leveracc/widget/wallets';
import { useWidgetWallet, usePrivyWidgetWallet } from '@leveracc/widget/wallets/react';
const config: WidgetConfig = { projectId: '0x' + '1'.repeat(64) as \`0x\${string}\`, network: 'testnet' };
createRoot(document.getElementById('app')!).render(<LeverAccWidget config={config} />);
Object.assign(window, { mountLeverAccWidget, walletFromViem, walletFromWagmi, useWidgetWallet, usePrivyWidgetWallet });
`,
  );
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: false,
        noEmit: true,
      },
      include: ["main.tsx"],
    }),
  );
  run(
    process.execPath,
    [join(consumer, "node_modules/typescript/bin/tsc")],
    consumer,
  );
  run(
    process.execPath,
    [join(consumer, "node_modules/vite/bin/vite.js"), "build"],
    consumer,
  );
  console.log(`Package consumer checks passed: ${archive}`);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
