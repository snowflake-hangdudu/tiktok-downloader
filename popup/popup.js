const EXT = typeof browser !== 'undefined' ? browser : chrome;
const VERSION = EXT.runtime.getManifest().version;
const CONFIG = globalThis.DOWNLOADER_POPUP_CONFIG || {};
const POPUP_INFO_KEY = 'tiktok-dl-popup-info-v1';
const $ = (id) => document.getElementById(id);
function t(key, values) {
  return globalThis.DownloaderKit?.i18n?.t?.(key, values) || key;
}

const themeController = globalThis.DownloaderKit?.theme?.createController({
  storageKey: CONFIG.themeKey,
  fallbackTheme: CONFIG.theme,
  initialTheme: CONFIG.initialTheme
});
themeController?.attach(document.body);

$('app-version').textContent = 'v' + VERSION;

function formatCurrentSite(url) {
  const prefix = t('currentPage');
  if (!url) return prefix + '—';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return prefix + parsed.protocol.replace(':', '');
    }
    let path = parsed.pathname;
    if (path.length > 24) path = path.slice(0, 24) + '…';
    return prefix + parsed.hostname + (path && path !== '/' ? path : '');
  } catch (_) {
    return prefix + t('unknownPage');
  }
}

function showState(name) {
  ['state-loading', 'state-ready', 'state-empty', 'state-error'].forEach((id) => {
    const node = $(id);
    if (node) node.classList.toggle('hidden', id !== name);
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(label || t('timeout'))), ms))
  ]);
}

function fillList(parent, items, className) {
  if (!parent) return;
  parent.replaceChildren();
  (items || []).forEach((text) => {
    const node = document.createElement(className === 'popup-step' ? 'div' : (parent.tagName === 'UL' ? 'li' : 'span'));
    if (className === 'popup-step') {
      node.className = 'popup-step';
      const num = document.createElement('span');
      num.className = 'popup-step-num';
      num.textContent = String(parent.children.length + 1);
      const label = document.createElement('span');
      label.className = 'popup-step-text';
      label.textContent = text;
      node.append(num, label);
    } else {
      node.className = className || '';
      node.textContent = text;
    }
    parent.appendChild(node);
  });
}

function applyEmptyCopy() {
  const empty = CONFIG.empty || {};
  const detect = $('empty-detect');
  const title = $('empty-title');
  const lead = $('empty-lead');
  if (detect) detect.textContent = t('emptyDetect');
  if (title) title.textContent = t('emptyTitle');
  if (lead) lead.textContent = t('emptyLead');
  fillList($('empty-steps'), [t('stepOpen'), t('stepPreview'), t('stepPanel')], 'popup-step');
  fillList($('empty-tags'), [t('tagVideo'), t('tagAudio'), t('tagCover'), t('tagCreator')], 'popup-feature-tag');
  const go = $('btn-go-site');
  if (go && empty.homeUrl) {
    go.href = empty.homeUrl;
    go.textContent = t('openTikTok');
    go.classList.remove('hidden');
  } else if (go) {
    go.classList.add('hidden');
  }
  const errorTitle = $('error-title');
  const errorHint = $('error-hint');
  const retry = $('btn-retry');
  if (errorTitle) errorTitle.textContent = t('errorTitle');
  if (errorHint) errorHint.textContent = t('errorHint');
  if (retry) retry.textContent = t('retry');
}

function renderReady(info) {
  if (typeof CONFIG.renderReady === 'function') {
    CONFIG.renderReady(info, {
      title: $('item-title'),
      author: $('item-author'),
      sub: $('item-sub'),
      cover: $('item-cover'),
      coverPh: $('item-cover-ph'),
      qualities: $('quality-tags')
    });
    return;
  }
  $('item-title').textContent = info.title || CONFIG.title || t('currentContent');
}

function isSiteUrl(url) {
  return CONFIG.isSiteUrl ? CONFIG.isSiteUrl(url) : Boolean(url);
}

function isContentUrl(url) {
  return CONFIG.isContentUrl ? CONFIG.isContentUrl(url) : isSiteUrl(url);
}

function sameTikTokHost(left, right) {
  try {
    return new URL(left).hostname.replace(/^www\./i, '').toLowerCase()
      === new URL(right).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return false;
  }
}

function usableInfo(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.title || value.filename || value.quality || (Array.isArray(value.qualities) && value.qualities.length)) return value;
  return null;
}

async function readCachedInfo(tabUrl) {
  try {
    const stored = await EXT.storage.local.get(POPUP_INFO_KEY);
    const cached = stored?.[POPUP_INFO_KEY];
    if (!cached?.info || !cached.tabUrl || !sameTikTokHost(cached.tabUrl, tabUrl)) return null;
    if (Date.now() - Number(cached.at || 0) > 5 * 60 * 1000) return null;
    return usableInfo(cached.info);
  } catch (_) {
    return null;
  }
}

function sendTabMessage(tabId, message, timeoutMs) {
  const send = () => {
    try {
      const result = EXT.tabs.sendMessage(tabId, message, { frameId: 0 });
      if (result && typeof result.then === 'function') return result;
    } catch (_) {}
    return new Promise((resolve, reject) => {
      try {
        EXT.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
          const err = EXT.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  };
  return withTimeout(send(), timeoutMs || 800, t('errorRead'));
}

async function readSharedInfo(tabId) {
  try {
    const resp = await withTimeout(EXT.runtime.sendMessage({ type: 'TIKTOK_DL_READ_PAGE_INFO', tabId }), 600, t('errorRead'));
    return usableInfo(resp?.info);
  } catch (_) {
    return null;
  }
}

async function readPanelDom(tabId) {
  if (!EXT.scripting?.executeScript) return null;
  const run = (target) => EXT.scripting.executeScript({
    target,
    func: () => {
      const root = document.getElementById('tiktok-dl-root');
      if (!root) return null;
      const raw = root.getAttribute('data-popup-info');
      if (raw) {
        try { return JSON.parse(raw); } catch (_) {}
      }
      const title = root.querySelector('.tk-dl-video-title')?.textContent?.trim() || '';
      const author = root.querySelector('.tk-dl-video-author:not(.hidden)')?.textContent?.trim() || '';
      const filename = root.querySelector('.tk-dl-filename-preview-name')?.textContent?.trim() || '';
      const quality = root.querySelector('.tk-dl-quality-pills .tk-dl-pill.active')?.textContent?.trim() || '';
      const qualities = [...root.querySelectorAll('.tk-dl-quality-pills .tk-dl-pill:not(.disabled):not(.loading)')]
        .map((node) => node.textContent.trim())
        .filter(Boolean);
      const cover = root.querySelector('.tk-dl-cover')?.currentSrc || root.querySelector('.tk-dl-cover')?.src || '';
      if (!filename && !quality && !title) return null;
      return {
        mode: 'video',
        title: title || filename,
        author,
        cover,
        filename,
        quality,
        qualities,
        sub: root.querySelector('.tk-dl-video-sub')?.textContent?.trim() || ''
      };
    }
  });
  try {
    const first = await withTimeout(run({ tabId, frameIds: [0] }), 700, t('errorRead'));
    const info = usableInfo(first?.[0]?.result);
    if (info) return info;
  } catch (_) {}
  try {
    const next = await withTimeout(run({ tabId }), 700, t('errorRead'));
    return usableInfo(next?.[0]?.result);
  } catch (_) {
    return null;
  }
}

async function init() {
  try {
    await Promise.race([
      globalThis.DownloaderKit?.i18n?.ready || Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 250))
    ]);
    globalThis.DownloaderKit?.i18n?.apply(document);
  } catch (_) {}
  try { applyEmptyCopy(); } catch (_) {}
  showState('state-loading');

  let tab;
  try {
    [tab] = await EXT.tabs.query({ active: true, currentWindow: true });
  } catch (_) {}
  if (!tab?.url || !isSiteUrl(tab.url)) {
    const site = $('empty-current-site');
    if (site) site.textContent = formatCurrentSite(tab?.url);
    showState('state-empty');
    return;
  }

  const tabId = tab.id;
  let info = null;
  const consider = (next) => {
    const usable = usableInfo(next);
    if (!usable) return false;
    info = { ...(info || {}), ...usable };
    try { renderReady(info); } catch (_) {}
    showState('state-ready');
    return true;
  };

  const sources = [
    readCachedInfo(tab.url),
    readSharedInfo(tabId),
    readPanelDom(tabId),
    sendTabMessage(tabId, { type: CONFIG.getInfoType || 'DOWNLOADER_GET_INFO' }, 800)
      .then((resp) => resp?.ok ? resp.data?.info : null)
      .catch(() => null)
  ];
  sources.forEach((source) => {
    Promise.resolve(source).then(consider).catch(() => {});
  });
  await Promise.allSettled(sources.map((source) => Promise.resolve(source).then(consider)));

  if (!info) {
    if (!isContentUrl(tab.url)) {
      const site = $('empty-current-site');
      if (site) site.textContent = formatCurrentSite(tab.url);
      showState('state-empty');
    } else {
      const errorText = $('error-text');
      if (errorText) errorText.textContent = t('errorRead');
      showState('state-error');
    }
  }

  $('btn-open-panel')?.addEventListener('click', async () => {
    try {
      await sendTabMessage(tabId, { type: CONFIG.openPanelType || 'DOWNLOADER_OPEN_PANEL' }, 1200);
      window.close();
    } catch (_) {
      const errorText = $('error-text');
      if (errorText) errorText.textContent = t('panelFail');
      showState('state-error');
    }
  });

  $('btn-retry')?.addEventListener('click', async () => {
    if (!tabId) return;
    try {
      await EXT.tabs.reload(tabId);
      window.close();
    } catch (_) {
      const errorText = $('error-text');
      if (errorText) errorText.textContent = t('refreshFail');
      showState('state-error');
    }
  });
}

init().catch(() => {
  const errorText = $('error-text');
  if (errorText) errorText.textContent = t('errorRead');
  showState('state-error');
});
