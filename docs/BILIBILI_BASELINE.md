# 下载类模板：B站基线

更新日期：2026-09-27。参照 bilibili-downloader 当前源码，提取公共交互与设置。更新目标是 shared-download-kit 和新扩展生成器；现有扩展不会自动更新。

## 分层

- runtime/dom：跨浏览器 API、纯文本 DOM 与链接校验。
- theme/settings：本机主题同步、版本化文件名设置、校验、预览与文件名清理。
- panel：悬浮入口、标题栏、内容滚动、信息子页、键盘与焦点。
- shell：公告、合作、评分、设置、任务适配与诊断的组合入口。
- 平台 content/background：识别、取流、下载、取消与成功确认。公共壳不承担这些能力。

## 视觉与交互

408px 面板、52px 标题栏、30px 图标；主文字/次文字/辅助文字使用公共 token。平台主题控制选择、按钮、hover 和 focus。加载顺序为 panel.css → design-system.css，popup.css → design-system.css。

设置、公告、任务与诊断在面板内子页打开。Esc 从子页返回下载，再次 Esc 关闭；关闭后焦点返回悬浮入口。长正文在内容区滚动。任务中心只在提供任务适配器时显示，空任务显示明确空态。

## 设置契约

```js
await shell.settings.ready;
const name = shell.settings.filename({ title, author, id, index, partTitle, quality }, 'mp4');
```

字段支持 `{title}`、`{author}`、`{id}`、`{index}`、`{partTitle}`、`{quality}`、`{format}`、`{date}`。模板拒绝路径字符、未知变量与不完整括号；元数据清理 Windows 非法字符和保留文件名。默认 `{title}`，存储 key 按扩展 id 隔离。下载引擎在每次开始任务前读取当前设置。

## 平台任务适配

```js
const shell = DownloaderKit.shell.mount({
  // 其余 title/theme/远程配置参数参照 template/content/content.js
  tasks: {
    list: async () => [{ id: 'job-1', title: '视频标题', state: '下载中', actions: ['cancel'] }],
    cancel: id => platform.cancel(id)
    // 支持时再提供 pause/resume/retry，并在对应任务 actions 中声明。
  },
  diagnostics: () => '平台识别与下载状态摘要'
});
```

动作完成后重新读取任务；失败显示错误。`shell.noteSuccess()` 只在浏览器确认完整保存后调用。诊断回调应提供可分享的状态摘要，移除签名 URL、Cookie 和用户隐私。

远程配置默认地址为 `http://124.222.62.190:8081/api/config/{id}`，由后台固定白名单请求，保留缓存与内置回退。新扩展需在配置中心注册自己的 id。

## 验证

```powershell
python -m unittest discover -s test -p test_generation.py
node test/shell-browser.mjs
```

生成测试使用临时目录，校验两端 manifest、脚本语法、资源引用、主题加载顺序及拒绝覆盖已有目录；浏览器测试验证设置、非法输入、任务取消、Esc、尺寸和销毁清理。这些验证不代表实际平台媒体下载已验收。
