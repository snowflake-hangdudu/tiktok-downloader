function t(key, values) {
  return globalThis.DownloaderKit?.i18n?.t?.(key, values) || key;
}

window.DOWNLOADER_POPUP_CONFIG = {
  title: 'TikTok Downloader',
  theme: 'tiktok',
  initialTheme: 'default',
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
    elements.title.textContent = info.title || 'TikTok';
    const authorName = String(info.author || '').replace(/^(?:作者|Author)\s*·\s*/i, '').trim();
    elements.author.textContent = authorName;
    elements.author.dataset.prefix = authorName ? t('authorLabel') + ' · ' : '';
    elements.author.classList.toggle('hidden', !authorName);
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
    const tags = elements.qualities;
    if (tags) {
      tags.replaceChildren();
      const labels = Array.isArray(info.qualities) && info.qualities.length
        ? info.qualities
        : (info.quality ? [info.quality] : []);
      if (labels.length) {
        labels.forEach((label, index) => {
          const tag = document.createElement('span');
          tag.className = 'popup-q-tag' + (index === 0 ? ' best' : '');
          tag.textContent = label;
          tags.appendChild(tag);
        });
      } else {
        const tag = document.createElement('span');
        tag.className = 'popup-q-tag';
        tag.textContent = info.mode === 'creator' ? t('creatorManage') : t('noQuality');
        tags.appendChild(tag);
      }
    }
    const open = document.getElementById('btn-open-panel');
    const openLabel = open?.querySelector('[data-i18n="openPanel"]') || open;
    if (openLabel) openLabel.textContent = info.mode === 'creator' ? t('openCreatorPanel') : t('openPanel');
    if (open) open.disabled = false;
  },
  readyTips: [
    'Nothing downloads until you start it',
    'Use the page panel for the queue, history, filename, and theme'
  ],
  empty: {
    detect: 'This page cannot be saved',
    title: 'Open a TikTok video or creator page',
    lead: 'A public video page can save the video, audio, and cover. A creator page can scan public posts.',
    homeUrl: 'https://www.tiktok.com/',
    homeLabel: 'Open TikTok',
    steps: [],
    tags: []
  },
  error: {
    title: 'Can’t read this TikTok page yet',
    hint: 'Refresh the TikTok page, then click the extension icon again.'
  }
};
