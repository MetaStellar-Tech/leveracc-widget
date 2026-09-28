import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [join(root, "scripts/pack-local.mjs")], {
  cwd: root,
  stdio: "inherit",
});
// Explicit install refreshes the same-version archive and lock integrity.
execFileSync(
  "npm",
  [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "../../artifacts/leveracc-widget-local.tgz",
  ],
  { cwd: join(root, "examples/npm"), stdio: "inherit" },
);
console.log("Installed the local package. Run: pnpm example:npm");
