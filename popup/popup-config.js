window.DOWNLOADER_POPUP_CONFIG = {
  title: 'TikTok 视频下载助手',
  theme: 'tiktok',
  initialTheme: 'tokyo-love',
  themeKey: 'tiktok-dl-theme-v1',
  getInfoType: 'TIKTOK_DL_GET_INFO',
  openPanelType: 'TIKTOK_DL_OPEN_PANEL',
  faqUrl: 'https://snowflake-hangdudu.github.io/tiktok-downloader/faq.html',
  privacyUrl: 'https://snowflake-hangdudu.github.io/tiktok-downloader/',
  isSiteUrl(value) {
    try { return /(^|\.)tiktok\.com$/i.test(new URL(value).hostname); }
    catch (_) { return false; }
  },
  isContentUrl(value) {
    try {
      const path = new URL(value).pathname;
      return /^\/@[^/]+\/video\/\d+/i.test(path) || /^\/@[^/]+\/?$/i.test(path);
    } catch (_) { return false; }
  },
  renderReady(info, elements) {
    elements.title.textContent = info.title || 'TikTok 内容';
    elements.author.textContent = info.author || '';
    elements.author.classList.toggle('hidden', !info.author);
    elements.sub.textContent = info.sub || '';
    if (info.cover && /^https:\/\//i.test(info.cover)) {
      elements.cover.src = info.cover;
      elements.cover.referrerPolicy = 'no-referrer';
      elements.cover.onload = () => {
        elements.cover.classList.remove('hidden');
        elements.coverPh.classList.add('hidden');
      };
      elements.cover.onerror = () => {
        elements.cover.classList.add('hidden');
        elements.coverPh.classList.remove('hidden');
      };
    } else {
      elements.cover.classList.add('hidden');
      elements.coverPh.classList.remove('hidden');
    }
    elements.extra.replaceChildren();
    const tag = document.createElement('span');
    tag.className = 'popup-feature-tag';
    tag.textContent = info.mode === 'creator' ? '创作者管理' : ('可用视频资源 ' + (info.resourceCount || 0));
    elements.extra.appendChild(tag);
    const open = document.getElementById('btn-open-panel');
    if (open) open.textContent = info.mode === 'creator' ? '打开创作者管理面板' : '打开下载面板';
    const tips = info.mode === 'creator'
      ? ['扫描公开作品并选择视频加入下载队列', '批量任务按设置中的并发数执行', '已下载视频可自动跳过']
      : ['视频、音频和封面只显示页面实际识别到的资源', '可在面板中管理队列、下载历史、文件名和主题', '下载仅在你主动操作后开始'];
    elements.tips.replaceChildren();
    tips.forEach((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      elements.tips.appendChild(item);
    });
  },
  readyTips: [
    '下载仅在你主动操作后开始',
    '打开页面面板管理下载队列、设置和主题'
  ],
  empty: {
    detect: '当前不是支持的下载页面',
    title: '请打开 TikTok 视频或创作者主页',
    lead: '在公开视频详情页可下载当前视频、音频和封面；创作者主页可扫描公开作品。',
    homeUrl: 'https://www.tiktok.com/',
    homeLabel: '打开 TikTok',
    steps: [
      '进入公开视频详情页或创作者主页',
      '点扩展图标预览识别状态',
      '在页面悬浮面板选择下载内容'
    ],
    tags: ['视频', '音频', '封面', '创作者扫描']
  },
  error: {
    title: '暂时无法读取 TikTok 页面信息',
    hint: '请刷新 TikTok 页面后，再点击扩展图标重试。'
  }
};
