# npm 发布流程

[English](RELEASING.md) | **简体中文**

包名为 `@leveracc/widget`，默认公开发布到 npm。仓库提供 CI、压缩包消费验证和 tag 发布工作流；创建 GitHub `v*` tag 会触发真实发布。本次新增流程本身不会发布任何版本。

普通 CI 仅手动触发，不在 push 或 PR 更新时自动运行。需要验证时，在 GitHub Actions 中选择 `CI` → `Run workflow`，选择待验证分支后运行；本地也可执行 `pnpm release:check`。发布 `v*` tag 时，发布工作流仍会自动执行完整检查，通过后才发布 npm 包。

## 首次配置（维护者）

1. 确认有 npm `@leveracc` scope 的发布权限，且包名可用。确认项目代码的分发许可；仓库目前没有声明项目 LICENSE，不应把字体／图标的许可当成项目许可。
2. 把仓库推送到实际 GitHub 仓库，并在 `package.json` 中填写真实的 `repository`（例如 `{ "type": "git", "url": "git+https://github.com/OWNER/REPO.git" }`）。当前仓库没有 remote，不能预填仓库地址。来源证明需要正确的仓库信息。
3. 本地使用 Node.js 24 和 `pnpm@11.22.0`：`npm install -g pnpm@11.22.0`，然后 `pnpm install --frozen-lockfile`。npm CLI 应至少为 11.5.1。
4. 首次包尚不存在时，用具有发布权限的账号完成下面的手动首次发布，然后在 npm 包 Settings 中配置 Trusted Publisher：GitHub Actions、真实 owner/repository、工作流文件名 **`publish.yml`**、environment **`npm`**，允许发布动作。
5. GitHub 创建 `npm` Environment，按团队需要设置审核人与 tag 限制。workflow 使用 OIDC `id-token: write`，无需保存长期 `NPM_TOKEN`。

参考 [npm Trusted Publishing 官方文档](https://docs.npmjs.com/trusted-publishers/)。GitHub 托管 runner 配合可信发布会自动生成来源证明；请检查 npm 对仓库可见性等限制的最新要求。

## 本地发布命令（不上传 registry）

```sh
pnpm publish:local
# 等价：pnpm pack:local / npm run publish:local
pnpm example:npm:setup   # 重新打包 + npm 安装本地包和示例依赖
pnpm example:npm         # 启动独立示例，端口 5174
pnpm example:npm:build   # 类型检查并构建独立示例
```

本地发布自动构建最新产物，输出 `artifacts/leveracc-widget-<version>.tgz` 并复制为 `artifacts/leveracc-widget-local.tgz`。不调用 `npm publish`，不需要登录，不改版本或创建 Git tag。

安装示例依赖需要网络。修改组件后再次运行 `example:npm:setup`，随后重启示例开发服务；显式安装压缩包会更新同版本包内容。快速试装不能替代正式发布前的 `release:check`。

## 发布前验证与本地试装

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm release:check
```

`release:check` 执行单元测试、类型检查、库和示例构建、浏览器测试，最后运行 `test:package`。后者通过 `npm pack` 触发 `prepack` 重新构建，验证所有导出文件和第三方许可，在临时目录中真实安装压缩包及 React 18，再运行 TypeScript（包含声明文件检查）和 Vite 消费构建。仓库自身测试使用 React 19。该步骤需要 npm 网络访问，不会发布，也不会连接钱包。

产物为 `artifacts/leveracc-widget-<version>.tgz`。可在独立业务项目验证：

```sh
npm install /absolute/path/to/artifacts/leveracc-widget-0.1.0.tgz
```

`pnpm pack` / `npm pack` 都会先构建，避免打包旧 dist。不要在正式流程使用 `--ignore-scripts` 跳过 prepack。安装包只有 dist、文档和包元数据；构建不依赖相邻协议仓库。

## 本机编译并发布到 npm 官方仓库

```sh
npm login --registry=https://registry.npmjs.org/
pnpm publish:npm:dry-run
pnpm publish:npm
# 等价：npm run publish:npm
```

两个命令都先执行完整 `release:check`（发布脚本测试、单元测试、类型检查、库与示例构建、浏览器测试、安装包消费验证）。只有检查成功才调用 `npm publish artifacts/leveracc-widget-<version>.tgz`，显式指定官方 registry 和 `--access public`。`publish:npm:dry-run` 最后增加 `--dry-run`，不上传；需要网络安装验证依赖。首次运行浏览器测试需 `pnpm exec playwright install chromium`。

命令使用 `package.json` 当前版本：正式版本发布到 `latest`，带预发布后缀的版本发布到 `next`。不自动修改版本、不创建或推送 Git tag。已发布版本需先升级再执行；按 npm 提示完成双因素验证，账号需有 `@leveracc` 发布权限。检查或上传失败时命令以非零状态退出。

可直接指定 npm 标签，覆盖默认的稳定版 `latest` / 预发布版 `next`：

```sh
pnpm publish:npm --tag beta
pnpm publish:npm --tag latest
pnpm publish:npm:dry-run --tag alpha
npm run publish:npm -- --tag beta
```

也支持 `--tag=beta`，可与 `--dry-run` 组合。缺失或空标签、重复参数及未知参数会在发布检查前报错。标签的 npm 合法性由 npm 校验。GitHub 自动发布仍按版本选择标签。

`publish:local` 仍仅生成本地文件；`publish:npm` 会真实上传。需要单独验证命令流程可运行 `pnpm test:release`，测试使用模拟命令，不访问 registry。

## 首次手动发布

完成仓库地址和许可确认，运行上面的完整检查后：

```sh
npm login
npm whoami
npm publish artifacts/leveracc-widget-0.1.0.tgz --access public --tag latest
```

替换为实际版本文件名，按 npm 提示完成双因素验证。预发布默认使用 `--tag next`，也可显式选择其他 npm 标签。这是对已验证压缩包的真实发布；不要用 `npm publish .` 替代。首次手动发布完成后，不要再推送同版本 tag 触发重复发布。

## 后续稳定版与预发布

在准备发布的分支中更新版本并检查变更：

```sh
npm version patch --no-git-tag-version
pnpm install --lockfile-only
# 如需预发布：npm version 0.2.0-beta.1 --no-git-tag-version
pnpm release:check
```

提交版本、lockfile 和发布说明并合并到发布分支，然后对对应提交创建 tag：

```sh
git tag v0.1.1
git push origin v0.1.1
```

tag 必须精确等于 `v` + package.json 版本，否则发布在安装前失败。正式版本发到 `latest`，带 `-beta.1` 等后缀的版本发到 `next`。workflow 重新执行完整检查，直接发布检查过的 `.tgz`。推送 tag 前确认对应版本提交已在远端发布分支。

发布后执行 `npm view @leveracc/widget version dist-tags`，并在第三方项目安装确切版本验证。GitHub Release 可补充变更说明，但不是发布触发器。

## 失败与修复

- CI／消费检查失败：修复并重新验证，不跳过检查。
- tag 不匹配：为正确版本创建正确 tag；不要覆盖已发布版本的 tag。
- OIDC 失败：核对 npm 的 owner、repository、`publish.yml`、`npm` environment、允许的发布动作及 npm 版本。
- 版本已存在：npm 版本不可覆盖；先用 `npm view @leveracc/widget@<version> version` 确认是否已成功，修复需升级版本。
- 错误版本上线：发布修复版本；必要时使用 `npm deprecate @leveracc/widget@<version> "原因与替代版本"`。不要把 unpublish 当常规回滚。
