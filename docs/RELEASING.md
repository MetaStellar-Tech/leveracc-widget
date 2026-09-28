# npm release process

**English** | [简体中文](RELEASING.zh-CN.md)

The package is named `@leveracc/widget` and is published publicly to npm by default. The repository provides CI, package archive consumption checks, and a tag-based release workflow. Creating a GitHub `v*` tag triggers a real release; adding the workflow itself does not publish a version.

Regular CI is triggered manually only; it does not run automatically on pushes or PR updates. To validate a branch, select `CI` → `Run workflow` in GitHub Actions, choose the branch, and run it. Locally, you can run `pnpm release:check`. Publishing a `v*` tag still automatically runs the complete release checks, and the npm package is published only if they pass.

## Initial setup for maintainers

1. Confirm that you have publishing permissions for the npm `@leveracc` scope and that the package name is available. Confirm the distribution license for the project code; the repository currently does not declare a project LICENSE. Font / icon licenses are not the project license.
2. Push the repository to its actual GitHub repository and set the real `repository` in `package.json` (for example, `{ "type": "git", "url": "git+https://github.com/OWNER/REPO.git" }`). The repository currently has no remote, so a repository URL cannot be prefilled. Provenance requires correct repository information.
3. Use Node.js 24 and `pnpm@11.22.0` locally: run `npm install -g pnpm@11.22.0`, then `pnpm install --frozen-lockfile`. The npm CLI must be at least 11.5.1.
4. If the package does not exist yet, complete the first manual release below using an account with publishing permissions. Then configure a Trusted Publisher in the npm package Settings: GitHub Actions, the actual owner/repository, workflow filename **`publish.yml`**, and environment **`npm`**, with publishing allowed.
5. Create an `npm` Environment in GitHub and configure reviewers and tag restrictions as your team requires. The workflow uses OIDC `id-token: write`; no long-lived `NPM_TOKEN` is required.

See the [official npm Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/). Trusted publishing on GitHub-hosted runners generates provenance automatically; check npm's latest requirements for repository visibility and other restrictions.

## Local packaging commands (no registry upload)

```sh
pnpm publish:local
# Equivalent: pnpm pack:local / npm run publish:local
pnpm example:npm:setup   # Repack and install the local package and example dependencies with npm
pnpm example:npm         # Start the standalone example on port 5174
pnpm example:npm:build   # Type-check and build the standalone example
```

Local packaging automatically builds fresh outputs, writes `artifacts/leveracc-widget-<version>.tgz`, and copies it to `artifacts/leveracc-widget-local.tgz`. It does not call `npm publish`, require login, change the version, or create Git tags.

Installing example dependencies requires network access. After modifying the widget, run `example:npm:setup` again and restart the example development server. Explicitly installing the archive refreshes package contents even at the same version. A quick installation check does not replace `release:check` before a release.

## Pre-release verification and local installation

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm release:check
```

`release:check` runs unit tests, type checking, library and example builds, browser tests, and finally `test:package`. The latter uses `npm pack` to trigger a fresh `prepack` build, verifies all exported files and third-party licenses, installs the archive and React 18 in a temporary directory, then runs TypeScript (including declaration file checking) and a Vite consumer build. The repository's own tests use React 19. This step requires npm network access; it does not publish or connect a wallet.

The output is `artifacts/leveracc-widget-<version>.tgz`. Validate it in a standalone application:

```sh
npm install /absolute/path/to/artifacts/leveracc-widget-0.1.0.tgz
```

Both `pnpm pack` and `npm pack` build first to avoid packaging stale dist files. Do not use `--ignore-scripts` to skip prepack in the actual release process. The package contains only dist, documentation, and package metadata; building does not depend on the adjacent protocol repository.

## Build locally and publish to the official npm registry

```sh
npm login --registry=https://registry.npmjs.org/
pnpm publish:npm:dry-run
pnpm publish:npm
# Equivalent: npm run publish:npm
```

Both commands first run the complete `release:check` (release script tests, unit tests, type checking, library and example builds, browser tests, and package consumption checks). Only after the checks pass do they call `npm publish artifacts/leveracc-widget-<version>.tgz`, explicitly selecting the official registry and `--access public`. `publish:npm:dry-run` adds `--dry-run` to the final command and does not upload; network access is needed to install verification dependencies. Before the first browser test run, execute `pnpm exec playwright install chromium`.

The commands use the current version in `package.json`: stable versions go to `latest`, and versions with a prerelease suffix go to `next`. They do not automatically change versions or create / push Git tags. Bump an already published version before running again, complete two-factor authentication as prompted by npm, and use an account with `@leveracc` publishing permissions. Failed checks or uploads exit with a nonzero status.

Specify an npm tag directly to override the defaults of `latest` for stable releases and `next` for prereleases:

```sh
pnpm publish:npm --tag beta
pnpm publish:npm --tag latest
pnpm publish:npm:dry-run --tag alpha
npm run publish:npm -- --tag beta
```

`--tag=beta` is also supported and can be combined with `--dry-run`. Missing or empty tags, duplicate options, and unknown arguments fail before release checks. npm validates tag eligibility. GitHub automatic publishing still selects the tag from the version.

`publish:local` still generates local files only; `publish:npm` performs a real upload. To verify the command flow separately, run `pnpm test:release`; these tests use mocked commands and do not access the registry.

## First manual release

After confirming the repository URL and license and completing the full checks above:

```sh
npm login
npm whoami
npm publish artifacts/leveracc-widget-0.1.0.tgz --access public --tag latest
```

Replace the archive filename with the actual version and complete two-factor authentication as prompted by npm. For prereleases, use `--tag next` by default or explicitly select another npm tag. This publishes the verified archive for real; do not substitute `npm publish .`. After the first manual release, do not push a tag for the same version and trigger a duplicate release.

## Subsequent stable releases and prereleases

Update the version and review changes on the branch being prepared for release:

```sh
npm version patch --no-git-tag-version
pnpm install --lockfile-only
# For a prerelease: npm version 0.2.0-beta.1 --no-git-tag-version
pnpm release:check
```

Commit the version, lockfile, and release notes, merge into the release branch, then tag the corresponding commit:

```sh
git tag v0.1.1
git push origin v0.1.1
```

The tag must exactly equal `v` + the package.json version; otherwise, the release fails before installation. Stable versions go to `latest`; versions with suffixes such as `-beta.1` go to `next`. The workflow reruns the full checks and publishes the verified `.tgz` directly. Before pushing a tag, confirm that its version commit is already on the remote release branch.

After publishing, run `npm view @leveracc/widget version dist-tags` and install the exact version in a third-party project to verify it. A GitHub Release can provide release notes but does not trigger publishing.

## Failures and fixes

- CI / consumer checks fail: fix the issue and verify again; do not skip checks.
- Tag mismatch: create the correct tag for the correct version; do not overwrite tags for published versions.
- OIDC fails: check npm's owner, repository, `publish.yml`, `npm` environment, allowed publishing actions, and npm version.
- Version already exists: npm versions cannot be overwritten. First use `npm view @leveracc/widget@<version> version` to check whether publication already succeeded; fixes require a version bump.
- A bad version is live: publish a fixed version. If needed, use `npm deprecate @leveracc/widget@<version> "Reason and replacement version"`. Do not use unpublish as a routine rollback.
