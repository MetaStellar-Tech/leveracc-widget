import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishNpm } from "./publish-npm.mjs";

function fixture(version = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "leveracc-publish-test-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "@leveracc/widget", version }),
  );
  const archive = join(root, "artifacts", `leveracc-widget-${version}.tgz`);
  const calls = [];
  return {
    root,
    archive,
    calls,
    run(command, args, options) {
      calls.push({ command, args, options });
      if (args[0] === "run") {
        mkdirSync(join(root, "artifacts"));
        writeFileSync(archive, "validated archive fixture");
      }
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
for (const [version, tag] of [
  ["0.1.0", "latest"],
  ["0.2.0-beta.1", "next"],
]) {
  for (const dryRun of [false, true]) {
    test(`${version} ${dryRun ? "dry-run" : "publish"} uses checked archive and ${tag}`, () => {
      const f = fixture(version);
      try {
        publishNpm({
          root: f.root,
          args: dryRun ? ["--dry-run"] : [],
          run: f.run,
        });
        assert.deepEqual(
          f.calls.map((call) => call.args),
          [
            ["run", "release:check"],
            [
              "publish",
              f.archive,
              "--registry",
              "https://registry.npmjs.org/",
              "--access",
              "public",
              "--tag",
              tag,
              ...(dryRun ? ["--dry-run"] : []),
            ],
          ],
        );
        for (const call of f.calls) {
          assert.equal(call.command, "npm");
          assert.equal(call.options.cwd, f.root);
        }
      } finally {
        f.cleanup();
      }
    });
  }
}
test("failed checks never publish even with an old archive", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "artifacts"));
    writeFileSync(f.archive, "stale");
    let calls = 0;
    assert.throws(
      () =>
        publishNpm({
          root: f.root,
          args: [],
          run() {
            calls++;
            throw new Error("check failed");
          },
        }),
      /check failed/,
    );
    assert.equal(calls, 1);
  } finally {
    f.cleanup();
  }
});
test("rejects unsupported flags and versions before executing commands", () => {
  const f = fixture("invalid");
  try {
    assert.throws(
      () => publishNpm({ root: f.root, args: ["--unknown"], run: f.run }),
      /Usage/,
    );
    assert.throws(
      () => publishNpm({ root: f.root, args: [], run: f.run }),
      /Unsupported release version/,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.cleanup();
  }
});
test("missing archive stops publication", () => {
  const f = fixture();
  try {
    let calls = 0;
    assert.throws(
      () =>
        publishNpm({
          root: f.root,
          args: [],
          run() {
            calls++;
          },
        }),
      /Verified archive not found/,
    );
    assert.equal(calls, 1);
  } finally {
    f.cleanup();
  }
});

for (const version of ["0.1.0", "0.2.0-beta.1"]) {
  for (const tag of ["beta", "latest", "next", "alpha"]) {
    for (const equalSyntax of [false, true]) {
      for (const dryRun of [false, true]) {
        test(`${version} overrides tag with ${tag}, equals=${equalSyntax}, dry-run=${dryRun}`, () => {
          const f = fixture(version);
          try {
            const args = [
              "--",
              ...(equalSyntax ? [`--tag=${tag}`] : ["--tag", tag]),
            ];
            if (dryRun) args.push("--dry-run");
            publishNpm({ root: f.root, args, run: f.run });
            assert.deepEqual(
              f.calls.map((call) => call.args),
              [
                ["run", "release:check"],
                [
                  "publish",
                  f.archive,
                  "--registry",
                  "https://registry.npmjs.org/",
                  "--access",
                  "public",
                  "--tag",
                  tag,
                  ...(dryRun ? ["--dry-run"] : []),
                ],
              ],
            );
          } finally {
            f.cleanup();
          }
        });
      }
    }
  }
}
for (const args of [
  ["--tag"],
  ["--tag", ""],
  ["--tag="],
  ["--tag=   "],
  ["--tag", "--dry-run"],
  ["--tag", "--"],
  ["--tag=--dry-run"],
  ["--tag", "beta", "--tag=alpha"],
  ["--tag=beta", "--tag", "beta"],
  ["--dry-run", "--dry-run"],
  ["--unknown"],
  ["beta"],
]) {
  test(`rejects invalid arguments ${JSON.stringify(args)} before checks`, () => {
    const f = fixture();
    try {
      assert.throws(
        () => publishNpm({ root: f.root, args, run: f.run }),
        /Usage/,
      );
      assert.equal(f.calls.length, 0);
    } finally {
      f.cleanup();
    }
  });
}
