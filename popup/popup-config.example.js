window.DOWNLOADER_POPUP_CONFIG = {
  title: '某某下载助手',
  theme: 'default',
  themeKey: 'downloadKitTheme_v1',
  getInfoType: 'FOO_DL_GET_INFO',
  openPanelType: 'FOO_DL_OPEN_PANEL',
  faqUrl: '../docs/faq.html',
  privacyUrl: '../docs/index.html',
  isSiteUrl(url) {
    return /example\.com/i.test(String(url || ''));
  },
  isContentUrl(url) {
    return /example\.com\/watch/i.test(String(url || ''));
  },
  readyTips: [
    '实际保存请点页面右下角图标打开的面板',
    '安装后请先 F5 刷新当前内容页'
  ],
  empty: {
    detect: '未识别到可保存页面',
    title: '请先打开目标页面',
    lead: '打开对应网站的内容页后按 F5，再点页面右下角图标保存。',
    steps: [
      '打开对应网站的内容页，按 F5 刷新',
      '点击页面右下角图标打开面板',
      '在面板里完成保存'
    ],
    tags: ['图片', '视频'],
    homeUrl: 'https://example.com/',
    homeLabel: '打开网站'
  },
  error: {
    title: '暂时无法读取页面信息',
    hint: '请在内容页按 F5 刷新后，再点击扩展图标。'
  }
};
