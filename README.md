# TikTok 视频下载助手

TikTok Downloader 是一款本地优先的浏览器扩展，用于识别用户当前可正常访问的 TikTok 公开视频，并由用户主动保存视频、独立音频资源或封面。

## 支持范围

- TikTok 公开视频详情页与正在播放的首页/推荐流视频：显示标题、创作者、视频 ID、时长、封面与页面实际提供的媒体资源。
- 创作者主页：滚动页面触发 TikTok 自己的加载流程，持续收集公开作品；支持暂停、继续、搜索、状态/日期筛选、多选和加入队列。
- 下载任务：本地持久化任务，最多同时下载 1–3 项；支持暂停、继续、取消、重试和批量操作。
- 下载历史：本地搜索、时间筛选、查看状态与重新打开视频页。
- 设置与外观：文件名模板及预览、资源选择偏好、并发数、历史/重复项/创作者文件夹偏好，以及与工具栏弹窗同步的主题。

扩展只显示实际识别到的资源和尺寸。它不绕过登录、地区、付费、DRM、私密权限或其他访问控制。

## 运行

在 Edge 或 Chrome 的扩展管理页打开开发者模式，选择“加载解压缩的扩展”，并选择本目录。安装或更新后刷新 TikTok 标签页。

## 测试

Windows：`npm.cmd test`。该命令运行公共生成与主题同步测试、面板浏览器测试、TikTok 页面解析测试和下载队列状态测试。

## 目录

- manifest.json：Chromium 扩展入口。
- manifest.firefox.json：Firefox 包装入口。
- content/page-agent.js：读取 TikTok 页面公开数据，不发起网络请求。
- content/content.js：页面面板、创作者扫描、设置与历史界面。
- background.js：持久化下载队列、原生下载控制和历史。
- shared/：公共面板、主题、设置、公告、评分与诊断功能。
- popup/：工具栏弹窗和最近下载历史。

任务、历史、设置和扫描清单保存在扩展本地存储。扩展不会把视频、账号信息、浏览记录或下载历史发送给开发者。

## 打包

Chromium ZIP：python scripts/pack.py

Firefox XPI：python scripts/pack_firefox.py

- 常见问题：https://snowflake-hangdudu.github.io/tiktok-downloader/faq.html
- 隐私政策：https://snowflake-hangdudu.github.io/tiktok-downloader/

