(function boot() {
  const shell = DownloaderKit.shell.mount({
    title: '{{TITLE}}',
    idPrefix: '{{ID_PREFIX}}',
    theme: '{{THEME}}',
    themeKey: '{{THEME_STORAGE_KEY}}',
    settingsKey: '{{ID_PREFIX}}Settings_v1',
    configUrl: '{{CONFIG_URL}}',
    messageType: '{{MESSAGE_PREFIX}}_FETCH_JSON',
    cacheKey: '{{ID_PREFIX}}RemoteContent_v1',
    ratingKey: '{{ID_PREFIX}}StoreRating_v1',
    footer: {
      faqUrl: '{{FAQ_URL}}',
      privacyUrl: '{{PRIVACY_URL}}',
      email: 'hangdudu0@agent.qq.com',
      subject: '{{TITLE}}反馈'
    },
    defaults: {
      notice: {
        enabled: true,
        title: '公告',
        pinned: ['仅保存当前页面中你可正常访问的内容。'],
        recent: [],
        knownIssues: [],
        roadmap: { feedback: [], upcoming: [], planned: [] }
      },
      coop: {
        enabled: true,
        title: '开发合作',
        body: '接浏览器插件定制开发。\n邮箱：hangdudu0@agent.qq.com'
      },
      rating: { enabled: false, url: '', edge: '', chrome: '', firefox: '', minSuccess: 3 }
    },
    messages: {
      openPanel: '{{MESSAGE_PREFIX}}_OPEN_PANEL',
      openSheet: '{{MESSAGE_PREFIX}}_OPEN_SHEET'
    }
  });

  const EXT = DownloaderKit.runtime.getApi();
  EXT.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== '{{MESSAGE_PREFIX}}_GET_INFO') return undefined;
    respond({ ok: true, data: { info: { title: '{{TITLE}}', sub: '在此接入平台识别结果' } } });
    return undefined;
  });

  // 平台功能写在这里：往 shell.home 里插入自己的识别/下载 UI。
  // 保存成功后调用 shell.noteSuccess()，以便配置站打开评分时出现入口。
  // 调试：shell.debug.log(...)；python scripts/pack.py 后整块调试区不会挂载。
  const hint = document.createElement('p');
  hint.textContent = '等待平台识别结果。公共设置、主题、公告和诊断已就绪。';
  hint.style.cssText = 'margin:0;font-size:13px;line-height:1.55;color:inherit;';
  shell.home.appendChild(hint);
  shell.debug.log('面板已就绪');
  // 下载前：await shell.settings.ready;
  // const name = shell.settings.filename({ title, author, id, quality, index }, 'mp4');
  // 平台可通过 mount({ tasks: { list, pause, resume, cancel, retry } }) 接入任务中心。
  // list 返回 [{ id, title, state, actions: ['cancel'] }]，仅显示实际支持的操作。
})();
