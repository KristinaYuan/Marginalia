# Marginalia

一个跨浏览器、本地优先的网页高亮与批注工具。选中文字即可高亮、贴便利贴、写笔记，并在统一的 Library 里管理所有内容——像在纸质书上批注一样自然。

- **单个 UserScript**：全部逻辑内联在一个 `.user.js` 文件里，无后端、无账号、无 API Key、无第三方依赖。
- **本地优先**：数据保存在浏览器本地（Tampermonkey 存储，带 `localStorage` 回退）。
- **跨浏览器**：通过 Tampermonkey / 兼容的 userscript 管理器，同一份脚本运行于 Safari / Chrome / Firefox / Edge。

---

## 1. 安装

### 第一步：安装 userscript 管理器

任选其一（只需一个）：

| 浏览器 | 推荐管理器 |
|---|---|
| Chrome / Edge | [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/) |
| Firefox | [Tampermonkey](https://www.tampermonkey.net/) / Violentmonkey / Greasemonkey |
| Safari | Tampermonkey（Safari 版）或开源免费的 [Userscripts](https://github.com/quoid/userscripts) |

> 建议优先用 Tampermonkey / Violentmonkey：它们提供完整的 `GM_*` 存储/菜单/剪贴板 API；部分精简管理器缺少这些 API 时会自动回退到 `localStorage`（数据按域名隔离，不建议作为日常使用）。

### 第二步：安装脚本（任选其一）

**方式 A —— 一键安装（推荐）**

1. 在本仓库页面点开 `marginalia.user.js` 文件，再点右上角 **Raw**（或直接打开它的 raw 链接），Tampermonkey 会识别并弹出安装确认页；
2. 点 **Install / 安装** 即可。

**方式 B —— 手动粘贴**

1. 点击管理器图标 → **Create a new script / 新建脚本**（或进入 Dashboard → `+`）；
2. 删除模板自带的示例代码；
3. 把 `marginalia.user.js` 的**全部内容粘贴进去**；
4. 保存（`Ctrl/Cmd + S`）。

### 第三步：验证

刷新任意网页，右下角出现一个圆形 **M** 按钮，点击即可打开 Library，说明安装成功。

> 提示：脚本用 `@match *://*/*` 匹配所有 http/https 页面。若只想在部分站点启用，可在管理器的脚本设置里调整 `@match`。

### 从源码构建

源码按模块拆分在 `src/` 下（便于维护），安装产物是合并后的单个文件。构建零依赖：

```bash
node build.js
```

会把 `src/*.js`（按文件名顺序）拼接到 `marginalia.user.js`。`src/00-meta.js` 里的 UserScript 元数据头会保持在文件第一行，符合 Tampermonkey 的解析要求。

---

## 2. 架构与存储模型

### 分层

| 层 | 文件（src/） | 职责 |
|---|---|---|
| 兼容层 | `03-compat.js` | 存储 / 菜单 / 剪贴板 / 样式注入的抽象，全部特性探测 + 优雅回退 |
| 数据模型 | `01-constants.js` | Article / Highlight / Note / Tag 结构、调色板、样式 |
| 存储层 | `04-storage.js` | 持久化与 CRUD、URL 归一化、标签 |
| 批注引擎 | `05-anchors.js`, `06-highlights.js` | 文本锚点、DOM 包裹、锚点恢复、重叠检测 |
| UI 层 | `07-notes.js`, `08-ui.js`, `09-toolbar.js`, `10-contextmenu.js`, `11-library.js`, `12-importexport.js`, `13-modal.js`, `14-settings.js` | 便利贴、选区工具栏、右键菜单、Library、导入导出、设置 |
| 装配 | `15-navigation.js`, `16-events.js`, `17-styles.js`, `18-boot.js` | SPA 侦测、事件、样式表、启动 |

### 存储

- 主数据存于单一键 `marginalia.data.v1`，设置存于 `marginalia.settings.v1`，用 `GM_getValue` / `GM_setValue`（回退到 `localStorage`）。
- **注意**：`localStorage` 回退是**按域名隔离**的（各站点数据不互通）；仅在缺少 GM 存储 API 的管理器上才会启用，属于降级方案。请优先使用 Tampermonkey / Violentmonkey。

### 数据模型（JSON）

- **Article**：`id`（随机但持久）、`url`（归一化后）、`title`、`domain`、`favicon`、`createdAt/updatedAt`、`articleNote`、`favorite`、`visibilitySettings`。
- **Highlight**：`id`、`articleId`、`url`、`title`、`text`、`style`（marker/underline/wavy/dotted）、`color`（五色之一）、`note`、`tags[]`、`favorite`、`createdAt/updatedAt`、`anchor`、`notePosition`。
- **Note**：内嵌于 Highlight（`note`）或 Article（`articleNote`），含 `text`、`color`、`mode`（anchored/floating）、`x/y`、`collapsed`。
- **Tag**：`id`、`name`、`createdAt`。
- **文本锚点**：不依赖 DOM 路径，而是存 `exact`（原文）+ `prefix`/`suffix`（上下文，已做空白归一化）+ `offset`（辅助）。重访时先在页面上定位原文，多处命中则用上下文消歧；无法可靠定位时标记为 **unresolved**，绝不误挂到别处。

### 样式隔离

- UI 外壳（工具栏、Library、右键菜单、悬浮按钮）放在 **Shadow DOM** 里，网站样式无法污染它。
- 高亮 span 与便利贴留在主 DOM（因为它们要锚定到真实内容 / 文档坐标），用 `marginalia-` 前缀命名并带样式重置。

---

## 3. 使用指南

### 高亮

1. 在页面上**选中一段文字**，旁边会浮出工具栏。
2. 工具栏左侧是 5 个颜色圆点，右侧是 4 种样式（Marker 荧光笔 / Underline 下划线 / Wavy 波浪线 / Dotted 点线，按钮上的 "A" 即实时预览）。
3. 先点颜色、再点样式，即可生成高亮。生成后可继续点颜色或样式实时换色/换样式。
4. **重叠处理**：若新选区与已有高亮重叠，会弹出对话框，可选「修改已有批注」「另建独立批注」「取消」，绝不静默覆盖。
5. **点击某个已有高亮**会弹出管理条：换色、换样式、加笔记、收藏、删除。

### 便利贴

- 工具栏点 **✎**：为选区创建带笔记的高亮，并立即打开一张便利贴。
- **右键页面空白处 → "Add Page Note"**：创建独立于高亮的页面笔记（默认在页面右上角）。
- 便利贴可**拖动**（拖顶部标题条）、**折叠**（▾，折叠成小图标）、**换色**（⋯ 菜单）、**切换锚定/悬浮**定位模式、**删除**。
- 与高亮关联的便利贴，菜单里有 "Go to highlight" 可跳回原文。

### Library

点右下角 **M** 按钮（或 userscript 菜单命令 "Marginalia: Open Library"）打开侧栏：

- 视图：**All Highlights / Articles / Highlights / Notes / Favorites / Tags**。
- 顶部**搜索框**可搜高亮文本、笔记、文章标题、标签。
- 卡片可**展开**看详情并编辑笔记、添加标签（输入回车，自动补全已有标签）、收藏、删除。
- 点 **Open in page** 会在新标签页打开原文并滚动到对应位置、高亮闪烁提示。
- 标签视图里可**重命名 / 删除**标签；点击任意标签会筛选出对应高亮。

### 数据备份 / 恢复

- Library 底部 **Export ▾**：导出 **JSON**（完整备份）、**Markdown**（按文章分组，适合 Obsidian）、**CSV**（Excel/分析）、**HTML**（可离线浏览的归档）。
- **Import**：选择 `.json` 备份，可选 **Replace All**（整体覆盖，需确认）或 **Merge**（按稳定 ID 合并；同 ID 冲突时跳过并提示，不静默覆盖）。

### Clean View / 主题 / 可见性

- **Clean View**：隐藏所有高亮样式、便利贴、选区工具栏（数据保留，只隐藏样式，不改动页面内容）。切换方式：Library 顶部的 ◐ 按钮、快捷键 **`Alt+Shift+M`**（可在设置里改）、或 userscript 菜单命令。
- **可见性独立开关**：Settings → Visibility 可分别控制高亮 / 便利贴 / 工具栏，且按文章记忆。
- **主题**：Settings → Theme 支持 System / Light / Dark（仅影响 Marginalia 自身 UI，不改网站外观）。

### 右键菜单与原生菜单

- 自定义右键菜单只有两项：**Add Page Note**、**Open Library**，尽量不干扰原网页。
- 需要原生右键菜单时：**按住 `Alt`（可在设置里改）再右键**，即放行原生菜单。

---

## 4. 兼容性与已知限制

> 说明：本项目在此开发环境中未能在真实浏览器上逐一真机验证，以下基于标准 API 与各管理器文档给出兼容性说明；代码已做特性探测与回退。

| 浏览器 | 管理器 | 状态 |
|---|---|---|
| Chrome / Edge | Tampermonkey, Violentmonkey | 完整支持（GM 存储/菜单/剪贴板） |
| Firefox | Tampermonkey, Violentmonkey | 完整支持；Greasemonkey 缺少部分 GM API，会走回退 |
| Safari | Tampermonkey, Userscripts | 支持；`GM_registerMenuCommand` 等可能缺失，菜单命令回退为页内按钮 |

已知限制 / 取舍：

- **`@noframes`**：脚本不注入 iframe（避免重复初始化和跨 frame 干扰）；iframe 内的内容暂不支持批注。
- **动态加载内容**：SPA 已做 URL 侦测 + 加载后重试；极端动态 / 无限滚动页面，部分锚点可能暂时标记为 unresolved，刷新或重访可恢复。
- **URL 归一化**：去除 `utm_*`、`fbclid` 等追踪参数并丢弃 hash，用于合并重复文章；不会过度合并真正不同的页面。
- **性能**：文本索引在需要时（选词 / 渲染）才构建，不常驻扫描；用 `MutationObserver` 刻意避免，以降低长页面开销。
- **深色主题下便利贴**：便利贴始终为浅色纸张配深色文字，保证对比度（与系统主题解耦）。

未来改进方向：iframe 支持、更精细的无限滚动重锚、`::highlight` CSS API（跨浏览器普及后）替代 DOM 包裹、自动化端到端测试。

---

## 5. 开发

```bash
# 源码在 src/，按文件名顺序合并
node build.js          # 生成 marginalia.user.js
node --check marginalia.user.js   # 语法校验
```

修改源码后重新执行 `node build.js` 即可。提交时同时提交 `src/` 与合并产物 `marginalia.user.js`。
