# Standalone npm package integration example

**English** | [简体中文](README.zh-CN.md)

A standalone Vite project that imports components only from `@leveracc/widget` and `@leveracc/widget/embed`. It does not reference repository source, dist, shared styles, or workspace links.

## Install the local package

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm example:npm:setup
pnpm example:npm
```

Open http://localhost:5174. You can switch between React / embed, four themes, and languages. Preview themes without connecting a wallet; before performing operations, apply a registered project ID for the target network and connect the host wallet. The example defaults to testnet.

`example:npm:setup` automatically builds and packages the widget, then uses npm to install the `.tgz` and example dependencies. After modifying the widget, run it again and restart the example server to refresh Vite's dependency pre-bundling cache. Installing dependencies requires network access but no npm publishing permissions.

To generate the package only, use `pnpm publish:local` or `pnpm pack:local`:

- `artifacts/leveracc-widget-<version>.tgz`: for distribution by version.
- `artifacts/leveracc-widget-local.tgz`: the same contents under a fixed filename, used by this example's dependency.

You can also run the steps separately:

```sh
pnpm publish:local
cd examples/npm
npm install ../../artifacts/leveracc-widget-local.tgz
npm run dev
```

Type checking and build: run `pnpm example:npm:build` from the repository root, or `npm run build` from this directory.

Automated verification: run `pnpm example:npm:setup`, then `pnpm example:npm:test` to verify React / embed, all four themes, and language switching against the installed package. The first run requires `pnpm exec playwright install chromium`.

## Install a registry version

After copying this directory into a standalone project, replace the local file dependency in `package.json` with an actual published version:

```sh
npm install @leveracc/widget@<published-version>
npm run dev
```

No source imports need to change. Production projects can replace the browser wallet connection function with their own wallet SDK. The embed example demonstrates the mount, update, and destroy lifecycle; plain JavaScript / Vue use the same API.

Switching between React / embed remounts the preview. Switching themes or languages within the current entry point only updates configuration.
