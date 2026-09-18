# tinymd

一个安静的 Markdown 工作空间。基于 **Electron 44** + **Tiptap 3**（含官方 `@tiptap/markdown`）构建，遵循苹果设计语言：大量留白、细腻的字排、克制的色彩。

![技术栈](https://img.shields.io/badge/Electron-44-47848F) ![tiptap](https://img.shields.io/badge/Tiptap-3-blue)

## 功能

- **工作空间优先**：启动即「打开文件夹」，只有打开目录（工作空间）才能进入编辑器；支持最近打开列表。
- **文档目录树**：左侧递归展示当前文件夹内的文件夹与 Markdown 文件，自动监听磁盘变化并刷新。
- **文档大纲**：侧栏「文件 / 大纲」标签切换；大纲列出当前文档的标题层级，点击跳转到对应位置。
- **可拖拽边栏**：侧栏右缘可拖动调整宽度（180–520px），自动记忆。
- **主题切换**：在设置中心选择跟随系统 / 亮色 / 中性 / 暗色四档并自动记忆。
- **所见即所得编辑**：Tiptap v3，支持标题、列表、任务列表、引用、代码块（含语言）、表格、图片、链接；输入 `# `、`- `、`> ` 等 Markdown 前缀自动转换格式。
- **斜杠命令菜单**：在空行或词首输入 `/` 呼出插入菜单，支持标题、列表、任务、引用、代码块、表格、分割线、图片；继续输入可按名称 / 拼音缩写过滤（如 `/bg` → 表格），`↑↓` 选择、`Enter` 确认、`Esc` 关闭。代码块内不触发。
- **Markdown 双向转换**：使用官方 `@tiptap/markdown`（marked 内核）解析与序列化，保存时最大限度保留源文件语法（如 ```` ```js ```` 语言标记）。
- **自动保存**：停止输入约 0.6s 后自动写盘，`Ctrl/Cmd+S` 可立即保存；窗口关闭前兜底同步保存。
- **图片原样本地存储**：粘贴 / 拖入 / 按钮插入图片时，原始二进制直接写入本地，文档中以相对路径引用，不转 base64。可在顶部图片设置中选择当前文件同级 `assets/`、指定目录或每个文档独立的 `assets.文档名/`。
- **右键打开 md**：在资源管理器中右键 Markdown 文件用「tinymd」打开，会自动打开其所在文件夹并定位到该文件（开发模式可传参模拟，打包版依赖 `fileAssociations` 注册）。

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
npm run dist:win   # 打 Windows NSIS 安装包（vite build + electron-builder --win，已内置国内镜像）
npm run dist       # 按 electron-builder.yml 默认平台打包
```

产物输出到 `release/`（或自定义目录）：`tinymd Setup <版本>.exe` 安装包 + `win-unpacked/` 免安装版。

已配置 `.md` / `.markdown` 的 `fileAssociations`，打包安装后可在资源管理器双击 / 右键用「tinymd」打开。

## 设计说明

- 系统字体栈（SF Pro / 苹方 / 雅黑），自动跟随系统深浅色。
- Windows 使用 `titleBarOverlay`、macOS 使用 `hiddenInset`，自绘极简顶栏（可拖拽）。
- 图片经自定义 `app-file://` 协议读取，仅允许访问已打开的工作空间目录。
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
└── electron-builder.yml  # 打包配置（含 md 文件关联）
```
