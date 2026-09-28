import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "artifacts"), { recursive: true });
// npm pack runs prepack, which builds fresh library output.
execFileSync("npm", ["pack", "--pack-destination", "artifacts"], {
  cwd: root,
  stdio: "inherit",
});
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const archive = join(
  root,
  "artifacts",
  `${pkg.name.replace(/^@/, "").replaceAll("/", "-")}-${pkg.version}.tgz`,
);
const localArchive = join(root, "artifacts", "leveracc-widget-local.tgz");
copyFileSync(archive, localArchive);
console.log(
  `Local package: ${archive}\nExample package: ${localArchive}\nNo registry publication was performed.`,
);
