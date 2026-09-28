# UI 基线 V1

> **状态：V1 已冻结**（2026-09-10）  
> 预览验收：Playwright Chromium 截图 + 尺寸测量已通过（见 `docs/acceptance/v1/metrics.json`）。  
> B站/抖音**真实宿主页**全状态走查仍待完成（见 §9）。

## 1. Token 与字体层级

### 中性 Token（`themes.json` → `neutral`）

| Token | 值 | 用途 |
|-------|-----|------|
| `--text-primary` | `#18181B` | 产品标题、视频标题、Section 标题 |
| `--text-secondary` | `#52525B` | 作者、未选中选项、Footer、邮箱 |
| `--text-muted` | `#71717A` | 播放量/时间、预计大小、版本号 |
| `--bg` | `#FFFFFF` | 面板背景 |
| `--surface` | `#F7F8FA` | 信息卡、选项默认底 |
| `--surface-hover` | `#F2F4F7` | 浅 Hover |
| `--border` | `#E5E7EB` | 主边框 |
| `--border-soft` | `#EEF0F2` | 弱边框 |
| `--footer-bg` | `#F3F4F6` | Footer 背景 |
| `--footer-text` | `#52525B` | Footer 文字 |

### 圆角

| 场景 | 值 |
|------|-----|
| 小控件（pill、封面按钮、Footer 入口） | `6px` |
| 卡片、主 CTA | `8px` |
| 外层面板 | `10px` |
| 预计大小 | `7px` |

### 间距

基准：`4 / 8 / 12 / 16 / 24px`

### 字体栈

```css
-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif
```

`button` / `input` / `select` 显式 `font-family: inherit`。

### 字号与字重

| 元素 | 规格 |
|------|------|
| 产品标题 | 14px / 600 |
| 视频标题 | 14px / 600，行高 1.45，最多两行 |
| Section 标题（清晰度、格式） | 12px / 600 |
| 选项文字 | 12px / 500，选中 600 |
| 作者 | 12px / 400，`--text-secondary` |
| 统计（播放/时长） | 12px / 400，`--text-muted` |
| Footer 入口 | 11px / 500 |
| 版本号 | 10px / 400，`--text-muted` |
| 主 CTA | 14px / 600 |

禁用态单独定义（`opacity` 仅用于主 CTA `:disabled`），不对父容器整体降透明度。

## 2. 组件尺寸

| 组件 | 规格 |
|------|------|
| 页面面板宽度 | `408px` |
| Header 总高（含 padding、border，`box-sizing: border-box`） | `52px` |
| Header 图标 | `30×30px` |
| 关闭按钮 | `28×28px` |
| 信息卡 | 浅灰底 + 1px 灰边，圆角 8px，内边距 10px |
| 封面 | 约 `96×54px`，圆角 6px，与文字间隔 10px |
| 下载封面按钮 | 高 ~26px，白底灰边，与封面等宽 |
| 选项 pill | 最小高 30px，左右 padding 12px，圆角 6px |
| 模式 Tab | 等宽（`flex:1`），最小高 32px |
| 预计大小 | 最小高 34px，圆角 7px |
| 主下载按钮 | 最小高 44px，圆角 8px |
| Footer 入口 | 最小高 26px |

## 3. 组件状态

| 状态 | 规则 |
|------|------|
| 默认 pill | 浅灰底、`--text-secondary`、1px 灰边 |
| Hover pill | 浅主题底/边框/深主题字；不覆盖 selected/disabled/loading |
| Selected pill | 浅主题底、主题边框、`--brand-strong` 字、字重 600 |
| Disabled pill | `--text-muted`，`opacity: 1` |
| Loading pill | 同 disabled 语义 |
| 主 CTA | 品牌渐变、白字；Hover `opacity: 0.92`；Disabled `opacity: 0.55` |
| 次操作 | 白/浅灰底、灰边、深灰字；Hover 浅主题 |
| Footer | 中性灰底灰字；Hover 才主题色 |
| 焦点 | `outline: 2px solid var(--brand)` |

抖音 Tab 选中：**浅主题底 + 深字 + 主题边框**，不使用大块黑色背景。

## 4. 主题可修改字段

仅改 `themes.json` 中对应平台字段，然后同步：

| 字段 | 说明 |
|------|------|
| `brand` | 主色（边框、装饰、选中边框） |
| `strong` | 选中文字、Hover 深字 |
| `hover` | 交互 Hover |
| `soft` | 选中/Hover 浅底 |
| `border` | 主题边框 |
| `ctaFrom` / `ctaTo` | 主 CTA 渐变 |
| `cyan` / `pink` | 仅抖音 Header 装饰线 |

**B站**：正文/Footer/作者默认中性色；亮蓝用于边框、装饰、CTA。  
**抖音**：白界面；青粉仅 Header 极细线；正文与按钮字无青粉效果。

## 5. 公共样式来源与同步

| 文件 | 角色 |
|------|------|
| `shared-download-kit/themes.json` | 颜色 Token 权威源 |
| `shared-download-kit/shared/design-system.css` | 组件视觉规则（`THEME TOKENS` 段由脚本注入） |
| `shared-download-kit/shared/panel.css` | `.dl-kit` 壳层布局（抖音同步） |
| `shared-download-kit/scripts/sync_brand.py` | 同步脚本 |

### 同步命令（仅 B站 + 抖音）

```bash
cd D:\插件\下载类\shared-download-kit
python scripts/sync_brand.py --platform bilibili --platform douyin
python scripts/sync_brand.py --check --platform bilibili --platform douyin
```

- 不带 `--platform` 时默认 **仅** `bilibili`、`douyin`
- `--check` 只校验，不写文件
- 连续运行两次不应产生 diff
- **不会**更新 YouTube，除非显式 `--platform youtube`

### CSS 加载顺序（扩展内）

```
panel.css（抖音）→ content.css → design-system.css（最后，收敛视觉）
```

## 6. 平台接入

| 平台 | 根节点 | 平台 CSS | 壳层 |
|------|--------|----------|------|
| B站 | `#bili-dl-panel[data-theme="bilibili"]` | `content/content.css` | 内联于 content |
| 抖音 | `.dl-kit[data-theme="douyin"]` | `content/content.css` | `shared/panel.css`（自 kit 同步） |

兼容别名：`--bdl-*` / `--dl-*` 由 `sync_brand.py` 从 `--brand-*` 映射生成。

## 7. 验收截图与已知限制

### 截图位置

`shared-download-kit/docs/acceptance/v1/`

| 文件 | 说明 |
|------|------|
| `bilibili-normal.png` | B站正常态预览 |
| `douyin-normal.png` | 抖音正常态预览（含 Tab、短内容无底部留白） |
| `metrics.json` | Header/面板/CTA 实测尺寸 |

### 生成命令

```bash
cd D:\插件\下载类\shared-download-kit
node scripts/capture_ui_previews.mjs
```

### 已知限制

- 预览 HTML 为静态 DOM，不含真实下载/队列/远程配置数据
- B站列表页、多 P、任务区滚动仅在 `content.css` 保留，未单独出预览图
- Popup 工具栏仅部分 Footer 入口（无页面面板公告/合作时不出假入口）
- 宿主页深浅背景下的对比度需在真实站点抽检

## 8. 冻结规则

- 布局、字体、间距、圆角、组件状态作为 **V1 基线**
- 平台品牌变化 **只改** `themes.json`
- 组件规则 **只在** kit 公共 CSS 修改，扩展内 `design-system.css` / 同步 `panel.css` **勿手改**
- Bug、可读性、无障碍问题允许修复
- 新功能引起的布局变化需单独评审，不随意追加平台特例

## 9. 待验证（真实浏览器）

- [ ] B站视频页 / 列表页实机面板
- [ ] 抖音单视频 / 合集列表实机面板
- [ ] 长标题、长作者、任务列表、错误/加载/禁用全状态
- [ ] 深浅宿主背景下白色 UI 对比度
- [ ] 键盘 Tab 焦点在实机扩展 Shadow/iframe 环境
