# 下载助手设计系统

## 文字层级（V1.2）

| Token | 色值 | 用途 |
|------|------|------|
| `--text-primary` | `#18181B` | 产品/视频/Section 标题、普通按钮字 |
| `--text-secondary` | `#52525B` | 作者、未选中选项、Footer、邮箱 |
| `--text-muted` | `#71717A` | 播放量/时间、预计大小、版本号 |

品牌色仅用于选中、主 CTA、Hover/焦点与少量装饰。

## 权威源

| 资源 | 路径 | 说明 |
|------|------|------|
| 平台品牌色 | `shared-download-kit/themes.json` | 平台颜色与基础中性色 |
| 固定主题 | `D:\插件\主题\主题.json` | 三套完整主题的权威 JSON；由 `sync_brand.py` 生成扩展 token |
| 图标原图 | `shared-download-kit/brand-assets/{platform}.png` | 保留原始输入，勿直接当运行时图标 |
| 处理后主图 | `shared-download-kit/brand-assets/processed/{platform}.png` | 仅移除外围白/黑底 |
| 共用样式 | `shared-download-kit/shared/design-system.css` | 视觉规则 + 由 sync 注入的主题变量 |

微博、小红书本次未接入；其主题仍可在 kit popup 中保留独立色值。

## 日常更新流程

1. 改平台品牌色：编辑 `themes.json`；改固定主题：编辑 `D:\插件\主题\主题.json`
2. 换图标：覆盖 `brand-assets/{platform}.png`（核对图案，不要只看哈希）
3. 同步：

```bash
python shared-download-kit/scripts/sync_brand.py --platform bilibili --platform douyin
python shared-download-kit/scripts/sync_brand.py --check --platform bilibili --platform douyin
# 默认仅 bilibili + douyin；YouTube 需显式 --platform youtube
# 只更新共享 kit 的 CSS/主题 JSON，不触碰现有扩展：
python shared-download-kit/scripts/sync_brand.py --kit-only
```

同步会：
- 生成去外底主图与 16/32/48/128、store 图标
- 把带主题变量的 `design-system.css` 复制到各扩展 `shared/`
- 清除历史 `BEGIN SHARED DOWNLOAD BRAND` 覆盖块

也可在各扩展内执行 `python scripts/gen_icons.py`（统一读 kit brand-assets）。

## 主题挂载

- 工具栏 Popup：`body[data-theme="…"]`
- 页面面板：`#bili-dl-panel` / `#yt-dl-panel` / `.dl-kit` 自身带 `data-theme`
- **不要**给宿主网页 `body` 设主题

加载顺序（V1）：`panel.css`（如有）→ `content.css` / `popup.css` → `design-system.css`（最后收敛视觉）

详见 `docs/UI_BASELINE_V1.md`。

## 历史资源

- `youtube-downloader/assets/icon-brand.png`：旧版红灰对切开，**不是**当前定稿，勿被生成脚本读取
- `youtube-downloader/assets/icon-source.blackbg.png`：旧黑底稿
- `bilibili-downloader/assets/icon-iters/*`：迭代草稿，商店截图同理不作为运行时源

## 新平台

```bash
python shared-download-kit/scripts/new_platform.py --id example --title "示例下载助手" --match "https://example.com/*" --theme default
```

未知 `--theme` 会直接报错，不会留下 `{{THEME}}` 占位符。
