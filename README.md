# tinymd

一个安静的 Markdown 工作空间。基于 **Electron 44** + **Tiptap 3**（含官方 `@tiptap/markdown`）构建，遵循苹果设计语言：大量留白、细腻的字排、克制的色彩。

![技术栈](assets/image20260924201526303.svg) ![tiptap](assets/image20260924201526349.svg)

## 功能

- **两种打开方式**：启动即欢迎页，可「打开文件夹」进入工作空间，也可直接打开单个 Markdown 文件（单文件模式：侧栏只保留大纲）；两者都进「最近打开」列表（最多记 5 条、默认露 2 条，其余在列表内滚动，不会把上方内容顶出窗口）。
- **文档目录树**：左侧递归展示当前文件夹内的文件夹与 Markdown 文件，自动监听磁盘变化并刷新。
- **文档大纲**：侧栏「文件 / 大纲」标签切换；大纲列出当前文档的标题层级，点击跳转到对应位置。
- **可拖拽边栏**：侧栏右缘可拖动调整宽度（180–520px），自动记忆。
- **主题切换**：在设置中心选择跟随系统 / 亮色 / 中性 / 暗色四档并自动记忆，默认使用中性主题。
- **所见即所得编辑**：Tiptap v3，支持标题、列表、任务列表、引用、代码块（含语言）、表格、图片、链接；输入 `# `、`- `、`> ` 等 Markdown 前缀自动转换格式。
- **纯文本模式**：可在顶栏切换到 Markdown 源文本编辑；切回所见即所得模式时，以当前纯文本重新加载整篇文档，避免两种视图状态不一致。
- **斜杠命令菜单**：在空行或词首输入 `/` 呼出插入菜单，支持标题、列表、任务、引用、代码块、表格、分割线、图片；继续输入可按名称 / 拼音缩写过滤（如 `/bg` → 表格），`↑↓` 选择、`Enter` 确认、`Esc` 关闭。代码块内不触发。
- **Markdown 双向转换**：使用官方 `@tiptap/markdown`（marked 内核）解析与序列化，保存时最大限度保留源文件语法（如 ```` ```js ```` 语言标记）。
- **自动保存**：停止输入约 0.6s 后自动写盘，`Ctrl/Cmd+S` 可立即保存；窗口关闭前兜底同步保存。
- **图片原样本地存储**：粘贴 / 拖入 / 按钮插入图片时，原始二进制直接写入本地；Markdown 或富文本中的网络图片也会自动下载并替换为本地相对路径，不转 base64。可在图片设置中选择存储目录并调整网络图片大小上限（默认 30 MB）。
- **拖拽 / 右键打开 md**：把 `.md` 拖到窗口任意位置即可打开（欢迎页整页都是拖放区，仅顶部 38px 留给拖窗）；在资源管理器中右键 / 双击 Markdown 用「tinymd」打开，会以单文件模式载入该文件（开发模式可传参模拟，打包版依赖 `fileAssociations` 注册）。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl/Cmd + O` | 打开文件夹 |
| `Ctrl/Cmd + N` | 新建文件 |
| `Ctrl/Cmd + S` | 保存 |
| `Ctrl/Cmd + \` | 切换边栏 |
| `Ctrl/Cmd + Shift + W` | 关闭工作空间 |
| `Ctrl/Cmd + Z` / `Shift + Z` | 撤销 / 重做 |
| `Ctrl/Cmd + 1~6` | 标题（Tiptap 内置） |
| `Ctrl/Cmd + B` / `I` | 加粗 / 斜体 |

## 开发

```bash
npm install        # 安装依赖（若 electron 二进制未下载：cd node_modules/electron && node install.js）
npm run dev        # Vite 开发服务器 + Electron（带 HMR）
```

## 打包

```bash
npm run dist:win   # Windows NSIS 安装包（x64）
npm run dist:mac   # macOS dmg（需在 macOS 上执行）
npm run dist       # 按 electron-builder.yml 默认平台打包
```

产物输出到 `release/`：`tinymd-<版本>-setup.exe`（NSIS 安装包）、`tinymd-<版本>-<架构>.dmg`（macOS 磁盘映像），以及 `win-unpacked/` 免安装版。

已配置 `.md` / `.markdown` 的 `fileAssociations`，打包安装后可在资源管理器双击 / 右键用「tinymd」打开。

> 上面三条命令已内置国内镜像（`ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`）。
> 镜像刻意写在 npm 脚本而不是 `electron-builder.yml` 里：`@electron/get` 读取镜像的顺序是「环境变量 > 配置文件」，写进配置文件会连 CI 也一起走国内源，而 GitHub 的 runner 在海外。

## 发布

推一个 tag 就会自动出 Windows + macOS 安装包并创建 Release：

```bash
# 1. 改 package.json 里的 version（如 0.1.0 -> 0.2.0）
# 2. 提交后打 tag 并推送
git tag v0.2.0 && git push github v0.2.0
```

产出的 Release 附件：

| 平台 | 附件 |
| --- | --- |
| Windows | `tinymd-<版本>-setup.exe`（NSIS 安装包）、`tinymd-<版本>-win-unpacked-x64.zip`（免安装版）、`latest.yml` |
| macOS | `tinymd-<版本>-universal.dmg`（一个 dmg 同时含 arm64 与 x64） |

工作流（`.github/workflows/release.yml`）分三个 job：`windows-latest` 与 `macos-latest` 各自打包并上传 artifact，最后一个 `publish` job 汇总两边的产物、用 `gh release` 统一创建 Release（不并发生成，也不会被两个平台互相覆盖）。

需要重跑时，在 Actions 页面对该 run 点 **Re-run all jobs**；用 **Run workflow** 手动触发时，请把 ref 选成对应的 tag（发布步骤带 `--verify-tag`，tag 不存在会直接报错而不是静默发错版本）。

> 构建步骤里 `--publish never` 不能省。electron-builder 在 CI 环境下检测到 tag 会把发布模式隐式切成 `onTag`，再依据 `package.json` 的 `repository` 字段推断出 GitHub provider，接着因为拿不到 `GH_TOKEN` / `GITHUB_TOKEN` 而报错 —— 表面现象是「打包步骤莫名其妙失败」。发布统一交给 `gh release`，所以显式关掉它的自动发布。

> **macOS 包未签名、未公证**。仓库里没有 Apple 开发者证书，CI 用 `CSC_IDENTITY_AUTO_DISCOVERY=false` 跳过签名，所以首次打开会提示「无法验证开发者」或「已损坏」。放行方式：右键 App 选「打开」，或执行
> `xattr -dr com.apple.quarantine /Applications/tinymd.app`。
> 想彻底解决需要配置 Apple Developer ID 证书并走 notarize，那是另一套流程。

### 前置检查

- 仓库 **Settings → Actions → General → Workflow permissions** 需要是 **Read and write permissions**，否则 `gh release` 会因 `GITHUB_TOKEN` 只读而 403（工作流里已声明 `permissions: contents: write`，但仓库设置为只读时无法提权）。
- CI 里不跑 `npm run build:icon`：`build/icon.png`、`build/icon.ico` 已提交入库，且与 `icon-candidate-25.*` 内容一致，直接在打包时复用。改图标后记得本地重跑 `npm run build:icon 25` 再提交。

## 设计说明

- 系统字体栈（SF Pro / 苹方 / 雅黑），自动跟随系统深浅色。
- Windows 使用 `titleBarOverlay`、macOS 使用 `hiddenInset`，自绘极简顶栏（可拖拽）。
- 图片经自定义 `app-file://` 协议读取，仅允许访问已打开的工作空间目录，以及单文件模式下文件所在的那个目录。
- 单文件模式不把所在文件夹当工作空间：主进程只为当前打开的那一个 Markdown（及其同目录下的其它 `.md`，用于相对链接跳转）开放读写，其它路径一律拒绝。
- 删除操作移入系统废纸篓（可恢复），不做不可逆删除。

## 目录结构

```
├── main.js               # Electron 主进程：窗口/菜单/IPC/协议/文件监听
├── preload.cjs           # contextBridge 渲染层 API
├── src/renderer/         # 渲染层（Vite + TypeScript）
│   ├── main.ts           # 应用状态与编排（欢迎页/工作区/保存/菜单）
│   ├── editor.ts         # Tiptap 编辑器（扩展、图片本地化、命令）
│   ├── slash.ts          # 斜杠 / 命令菜单（过滤、键盘导航、定位）
│   ├── util.ts           # 通用工具与 window.api 类型声明
│   ├── tree.ts           # 文件目录树组件
│   └── style.css         # 苹果风格样式
├── sample-workspace/     # 示例工作空间（可直接打开体验）
├── .github/workflows/    # CI：打 tag 自动构建 Win/macOS 安装包并发布 Release
└── electron-builder.yml  # 打包配置（含 md 文件关联）
```
