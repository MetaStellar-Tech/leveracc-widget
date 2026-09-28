import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function publishNpm({
  root = projectRoot,
  args = process.argv.slice(2),
  run = execFileSync,
} = {}) {
  const usage = "Usage: pnpm publish:npm [--dry-run] [--tag <name>]";
  let dryRun = false;
  let explicitTag;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--dry-run" && !dryRun) {
      dryRun = true;
    } else if (arg === "--tag" || arg.startsWith("--tag=")) {
      const value = arg === "--tag" ? args[++i] : arg.slice(6);
      if (
        explicitTag !== undefined ||
        !value?.trim() ||
        value.startsWith("-")
      ) {
        throw new Error(usage);
      }
      explicitTag = value;
    } else {
      throw new Error(usage);
    }
  }
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(pkg.version)
  ) {
    throw new Error(`Unsupported release version: ${pkg.version}`);
  }
  const tag = explicitTag ?? (pkg.version.includes("-") ? "next" : "latest");
  const registry = "https://registry.npmjs.org/";
  console.log(
    `${dryRun ? "Dry run" : "Publish"}: ${pkg.name}@${pkg.version} → ${registry} (${tag})`,
  );
  // This builds, tests and validates the exact archive we will publish.
  run("npm", ["run", "release:check"], { cwd: root, stdio: "inherit" });
  const archive = join(
    root,
    "artifacts",
    `${pkg.name.replace(/^@/, "").replaceAll("/", "-")}-${pkg.version}.tgz`,
  );
  if (!existsSync(archive))
    throw new Error(`Verified archive not found: ${archive}`);
  run(
    "npm",
    [
      "publish",
      archive,
      "--registry",
      registry,
      "--access",
      "public",
      "--tag",
      tag,
      ...(dryRun ? ["--dry-run"] : []),
    ],
    { cwd: root, stdio: "inherit" },
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    publishNpm();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
