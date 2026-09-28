const EXT = typeof browser !== 'undefined' ? browser : chrome;
const VERSION = EXT.runtime.getManifest().version;
const CONFIG = globalThis.DOWNLOADER_POPUP_CONFIG || {};
const $ = (id) => document.getElementById(id);
const themeController = globalThis.DownloaderKit?.theme?.createController({
  storageKey: CONFIG.themeKey,
  fallbackTheme: CONFIG.theme,
  initialTheme: CONFIG.initialTheme
});
themeController?.attach(document.body);

$('app-version').textContent = 'v' + VERSION;
if (CONFIG.title) $('app-title').textContent = CONFIG.title;

function formatCurrentSite(url) {
  if (!url) return '当前页面：—';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '当前页面：' + parsed.protocol.replace(':', '');
    }
    let path = parsed.pathname;
    if (path.length > 24) path = path.slice(0, 24) + '…';
    return '当前页面：' + parsed.hostname + (path && path !== '/' ? path : '');
  } catch (_) {
    return '当前页面：未知';
  }
}

function showState(name) {
  ['state-loading', 'state-ready', 'state-empty', 'state-error'].forEach((id) => {
    $(id).classList.toggle('hidden', id !== name);
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label || '超时')), ms))
  ]);
}

function fillList(parent, items, className) {
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
  if (empty.detect) $('empty-detect').textContent = empty.detect;
  if (empty.title) $('empty-title').textContent = empty.title;
  if (empty.lead) $('empty-lead').textContent = empty.lead;
  fillList($('empty-steps'), empty.steps || [
    '打开对应网站的内容页，按 F5 刷新',
    '点击页面右下角图标打开面板',
    '在面板里完成保存'
  ], 'popup-step');
  fillList($('empty-tags'), empty.tags || [], 'popup-feature-tag');
  if (CONFIG.faqUrl) $('empty-faq').href = CONFIG.faqUrl;
  if (CONFIG.privacyUrl) $('empty-privacy').href = CONFIG.privacyUrl;
  const go = $('btn-go-site');
  if (empty.homeUrl) {
    go.href = empty.homeUrl;
    go.textContent = empty.homeLabel || '打开网站';
    go.classList.remove('hidden');
  } else {
    go.classList.add('hidden');
  }
  if (CONFIG.error?.title) $('error-title').textContent = CONFIG.error.title;
  if (CONFIG.error?.hint) $('error-hint').textContent = CONFIG.error.hint;
}

function renderReady(info) {
  if (typeof CONFIG.renderReady === 'function') {
    CONFIG.renderReady(info, {
      title: $('item-title'),
      author: $('item-author'),
      sub: $('item-sub'),
      cover: $('item-cover'),
      coverPh: $('item-cover-ph'),
      extra: $('ready-extra'),
      tips: $('ready-tips')
    });
    return;
  }
  $('item-title').textContent = info.title || CONFIG.title || '当前内容';
  const authorEl = $('item-author');
  if (info.author) {
    authorEl.textContent = info.author;
    authorEl.classList.remove('hidden');
  } else {
    authorEl.classList.add('hidden');
  }
  $('item-sub').textContent = info.sub || '';
  const cover = $('item-cover');
  const coverPh = $('item-cover-ph');
  if (info.cover && /^https:\/\//i.test(info.cover)) {
    cover.src = info.cover;
    cover.onload = () => {
      cover.classList.remove('hidden');
      coverPh.classList.add('hidden');
    };
    cover.onerror = () => {
      cover.classList.add('hidden');
      coverPh.classList.remove('hidden');
    };
  } else {
    cover.classList.add('hidden');
    coverPh.classList.remove('hidden');
  }
  fillList($('ready-tips'), CONFIG.readyTips || [
    '实际保存请点页面右下角图标打开的面板',
    '安装后请先 F5 刷新当前内容页'
  ]);
}

function isSiteUrl(url) {
  return CONFIG.isSiteUrl ? CONFIG.isSiteUrl(url) : Boolean(url);
}

function isContentUrl(url) {
  return CONFIG.isContentUrl ? CONFIG.isContentUrl(url) : isSiteUrl(url);
}

async function init() {
  applyEmptyCopy();
  showState('state-loading');
  const [tab] = await EXT.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !isSiteUrl(tab.url)) {
    $('empty-current-site').textContent = formatCurrentSite(tab?.url);
    showState('state-empty');
    return;
  }

  const tabId = tab.id;
  try {
    const resp = await withTimeout(
      EXT.tabs.sendMessage(tabId, { type: CONFIG.getInfoType || 'DOWNLOADER_GET_INFO' }),
      8000,
      '识别超时'
    );
    if (resp?.ok && resp.data?.info) {
      renderReady(resp.data.info);
      showState('state-ready');
    } else if (isContentUrl(tab.url)) {
      throw new Error(resp?.error || '无法读取页面，请先 F5');
    } else {
      $('empty-current-site').textContent = formatCurrentSite(tab.url);
      showState('state-empty');
    }
  } catch (err) {
    if (!isContentUrl(tab.url)) {
      $('empty-current-site').textContent = formatCurrentSite(tab.url);
      showState('state-empty');
    } else {
      $('error-text').textContent = err.message || '加载失败';
      showState('state-error');
    }
  }

  $('btn-open-panel')?.addEventListener('click', async () => {
    try {
      await EXT.tabs.sendMessage(tabId, { type: CONFIG.openPanelType || 'DOWNLOADER_OPEN_PANEL' });
      window.close();
    } catch (_) {
      $('error-text').textContent = '无法打开面板，请刷新页面';
      showState('state-error');
    }
  });

  $('btn-retry')?.addEventListener('click', async () => {
    if (!tabId) return;
    try {
      await EXT.tabs.reload(tabId);
      window.close();
    } catch (_) {
      $('error-text').textContent = '无法刷新页面，请手动 F5';
      showState('state-error');
    }
  });
}

init();
