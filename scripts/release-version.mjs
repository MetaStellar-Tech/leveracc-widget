import { readFileSync, appendFileSync } from "node:fs";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
  throw new Error(`Unsupported release version: ${version}`);
}
if (process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error(`Release tag must exactly match package.json: v${version}`);
}
const tag = version.includes("-") ? "next" : "latest";
appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`);
console.log(`Publishing ${version} to ${tag}`);
