# 独立 npm 包集成示例

[English](README.md) | **简体中文**

独立 Vite 项目，仅从 `@leveracc/widget` 和 `@leveracc/widget/embed` 导入组件，不引用仓库源码、dist、共享样式或 workspace link。

## 安装本地包

在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm example:npm:setup
pnpm example:npm
```

打开 http://localhost:5174。可切换 React／embed、四套主题和语言。未连接钱包时即可预览主题；进行业务操作前需应用目标网络中已注册的项目 ID，并连接宿主钱包。示例默认测试网。

`example:npm:setup` 自动构建并打包组件，用 npm 安装 `.tgz` 和示例依赖。修改组件后再次执行并重启示例服务，以刷新 Vite 依赖预构建缓存。安装依赖需要网络，无需 npm 发布权限。

仅生成包使用 `pnpm publish:local` 或 `pnpm pack:local`：

- `artifacts/leveracc-widget-<version>.tgz`：按版本分发。
- `artifacts/leveracc-widget-local.tgz`：同一内容的固定文件名，供本例依赖使用。

也可以分步运行：

```sh
pnpm publish:local
cd examples/npm
npm install ../../artifacts/leveracc-widget-local.tgz
npm run dev
```

类型检查与构建：根目录运行 `pnpm example:npm:build`，或本目录运行 `npm run build`。

自动化验证：先运行 `pnpm example:npm:setup`，再运行 `pnpm example:npm:test`，验证安装包的 React／embed、四套主题和语言切换。首次运行需 `pnpm exec playwright install chromium`。

## 安装 registry 版本

将本目录复制到独立项目后，将 `package.json` 中的本地文件依赖替换为实际已发布版本：

```sh
npm install @leveracc/widget@<实际已发布版本>
npm run dev
```

无需修改源码导入。生产项目可把浏览器钱包连接函数替换为自己的钱包 SDK。embed 演示挂载、更新和销毁生命周期，普通 JavaScript／Vue 使用同一 API。

切换 React／embed 会重新挂载预览；在当前入口内切换主题或语言仅更新配置。
