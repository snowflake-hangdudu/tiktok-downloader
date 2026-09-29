(function bootTikTokDownloader() {
  'use strict';

  const EXT = DownloaderKit.runtime.getApi();
  const PREFS_KEY = 'tiktok-dl-settings-v1';
  const CREATOR_KEY = 'tiktok-dl-creators-v1';
  const DEFAULT_PREFS = {
    defaultQuality: 'highest',
    defaultFormat: 'mp4',
    maxConcurrentDownloads: 2,
    filenameTemplate: '{title} - {author}',
    skipDownloaded: true,
    recordHistory: true,
    showFloatingButton: true,
    creatorFolders: false
  };
  const SOURCE = 'tiktok-downloader-page-agent';
  if (document.getElementById('tiktok-dl-root')) return;

  let snapshot = { kind: 'unsupported', url: location.href };
  let prefs = { ...DEFAULT_PREFS };
  let activeMode = 'video';
  let selectedFormat = 'mp4';
  let creator = null;
  let creatorVideos = new Map();
  let creatorSaved = {};
  let creatorKey = '';
  let creatorPersistenceBlocked = false;
  let creatorDataCleared = false;
  let scanState = 'idle';
  let scanStopRequested = false;
  let scanPaused = false;
  let lastScanAt = 0;
  let selectedIds = new Set();
  let knownCompletedIds = new Set();
  let selectedResources = new Map();
  let collectionSaveTimer = 0;
  let taskPage = 0;
  let appStatus = null;
  let creatorRows = null;
  let creatorStats = null;
  let creatorSelectionStatus = null;
  let creatorSearch = '';
  let creatorStatusFilter = 'all';
  let creatorDateFilter = 'all';
  let historySearch = '';
  let historyRange = 'all';
  let route = location.href;
  let taskRefreshTimer = 0;
  let completionRefreshTimer = 0;
  let pageAgentVersion = 0;
  let settingsBody = null;

  const shell = DownloaderKit.shell.mount({
    title: 'TikTok 下载助手',
    idPrefix: 'tiktok-dl',
    theme: 'tiktok',
    initialTheme: 'tokyo-love',
    themeKey: 'tiktok-dl-theme-v1',
    settingsKey: 'tiktok-dl-filename-v1',
    showDebug: false,
    configUrl: 'http://124.222.62.190:8081/api/config/tiktok',
    messageType: 'TIKTOK_DL_FETCH_JSON',
    cacheKey: 'tiktok-dl-remote-v1',
    ratingKey: 'tiktok-dl-rating-v1',
    footer: {
      variant: 'actions',
      showHelpLinks: false,
      showSettings: true,
      showNotice: false,
      showDiagnostics: false,
      faqUrl: 'https://snowflake-hangdudu.github.io/tiktok-downloader/faq.html',
      privacyUrl: 'https://snowflake-hangdudu.github.io/tiktok-downloader/',
      email: 'hangdudu0@agent.qq.com',
      subject: 'TikTok 下载助手反馈'
    },
    onFillSettings: fillSettingsSheet,
    onFeedback: copyFeedbackEmail,
    defaults: {
      notice: {
        enabled: false,
        title: '公告',
        pinned: ['仅保存你在 TikTok 页面中可正常访问、且有权保存的公开内容。'],
        recent: ['下载失败会自动更换备用地址。没有独立音频时，不显示音频选项。'],
        knownIssues: ['部分视频地址会返回没有权限，扩展会自动改用备用地址后再下载。'],
        roadmap: {
          feedback: ['遇到问题请点底部「反馈」，复制邮箱后附上视频链接和截图。'],
          upcoming: [],
          planned: []
        }
      },
      coop: {
        enabled: true,
        title: '开发合作',
        body: '接浏览器插件定制开发。\n\n有合作意向请联系 QQ：748604487\n邮箱：hangdudu0@agent.qq.com\n请备注「插件开发」，并简单说明需求。'
      },
      rating: { enabled: false, url: '', edge: '', chrome: '', firefox: '', minSuccess: 3 }
    },
    messages: {
      openPanel: 'TIKTOK_DL_OPEN_PANEL',
      openSheet: 'TIKTOK_DL_OPEN_SHEET'
    }
  });

  const ui = document.createElement('div');
  ui.className = 'tk-dl';
  ui.innerHTML = `
    <div class="tk-dl-mode-tabs hidden" role="tablist" data-i18n-aria="modeLabel" aria-label="下载模式">
      <button type="button" data-mode="video" class="active" role="tab" aria-selected="true" data-i18n="singleVideo">单视频</button>
      <button type="button" data-mode="creator" role="tab" aria-selected="false" data-i18n="creator">创作者</button>
    </div>
    <div class="tk-dl-video-body">
      <div class="tk-dl-video-card is-loading">
        <div class="tk-dl-cover-column">
          <div class="tk-dl-cover-wrap">
            <div class="tk-dl-sk-cover"></div>
            <img class="tk-dl-cover hidden" alt="">
            <div class="tk-dl-cover-ph hidden">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
          <button type="button" class="tk-dl-cover-download" disabled data-i18n="coverDownload">下载封面</button>
        </div>
        <div class="tk-dl-video-meta">
          <div class="tk-dl-video-sk">
            <span class="tk-dl-sk-line"></span>
            <span class="tk-dl-sk-line short"></span>
            <span class="tk-dl-sk-line shorter"></span>
          </div>
          <div class="tk-dl-video-content hidden">
            <div class="tk-dl-video-title"></div>
            <div class="tk-dl-video-author hidden"></div>
            <div class="tk-dl-video-sub"></div>
          </div>
        </div>
      </div>
      <div class="tk-dl-options-row">
        <div class="tk-dl-section tk-dl-quality-section">
          <div class="tk-dl-section-head">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
            <span data-i18n="quality">清晰度</span>
          </div>
          <div class="tk-dl-quality-pills"><span class="tk-dl-pill loading" data-i18n="loading">加载中</span></div>
        </div>
        <div class="tk-dl-format-row tk-dl-section">
          <div class="tk-dl-section-head tk-dl-format-label" data-i18n="format">格式</div>
          <div class="tk-dl-format-pills">
            <button type="button" class="tk-dl-pill active" data-format="mp4" aria-pressed="true" data-i18n="mp4">MP4 视频</button>
            <button type="button" class="tk-dl-pill hidden" data-format="m4a" aria-pressed="false" data-i18n="m4a">M4A 音频</button>
          </div>
        </div>
      </div>
      <p class="tk-dl-filename-preview" aria-live="polite" data-i18n="filenamePending">文件名预览会在识别视频后显示</p>
      <div class="tk-dl-estimate hidden">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
        <span class="tk-dl-estimate-text" data-i18n="estimateEmpty">预计大小 —</span>
      </div>
      <button type="button" class="tk-dl-btn tk-dl-start" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
        <span class="tk-dl-start-label" data-i18n="startDownload">开始下载</span>
      </button>
      <div class="tk-dl-job-panel hidden">
        <div class="tk-dl-job-list"></div>
        <div class="tk-dl-job-panel-queue hidden">
          <button type="button" class="tk-dl-action-btn" data-bulk="pause-all" data-i18n="pauseAll">暂停全部</button>
          <button type="button" class="tk-dl-action-btn danger" data-bulk="cancel-waiting" data-i18n="cancelWaiting">取消等待</button>
        </div>
      </div>
      <div class="tk-status" hidden role="status"></div>
      <details class="tk-dl-debug">
        <summary data-i18n="debugLog">调试日志</summary>
        <div class="tk-dl-debug-actions">
          <button type="button" class="tk-dl-debug-copy" data-i18n="copyLog">复制日志</button>
          <button type="button" class="tk-dl-debug-clear" data-i18n="clearLog">清空</button>
        </div>
        <pre class="tk-dl-debug-log" data-i18n="waitingDownload">等待下载操作…</pre>
      </details>
    </div>
    <div class="tk-dl-creator-body hidden"></div>
  `;
  shell.home.appendChild(ui);

  const modeTabsEl = ui.querySelector('.tk-dl-mode-tabs');
  const videoBodyEl = ui.querySelector('.tk-dl-video-body');
  const creatorBodyEl = ui.querySelector('.tk-dl-creator-body');
  const cardEl = ui.querySelector('.tk-dl-video-card');
  const coverSkEl = ui.querySelector('.tk-dl-sk-cover');
  const coverImgEl = ui.querySelector('.tk-dl-cover');
  const coverPhEl = ui.querySelector('.tk-dl-cover-ph');
  const coverBtnEl = ui.querySelector('.tk-dl-cover-download');
  const videoSkEl = ui.querySelector('.tk-dl-video-sk');
  const videoContentEl = ui.querySelector('.tk-dl-video-content');
  const titleEl = ui.querySelector('.tk-dl-video-title');
  const authorEl = ui.querySelector('.tk-dl-video-author');
  const subEl = ui.querySelector('.tk-dl-video-sub');
  const pillsEl = ui.querySelector('.tk-dl-quality-pills');
  const qualitySectionEl = pillsEl?.closest('.tk-dl-section');
  const formatPillsEl = ui.querySelector('.tk-dl-format-pills');
  const filenamePreviewEl = ui.querySelector('.tk-dl-filename-preview');
  const estimateEl = ui.querySelector('.tk-dl-estimate');
  const estimateTextEl = ui.querySelector('.tk-dl-estimate-text');
  const startBtnEl = ui.querySelector('.tk-dl-start');
  const startLabelEl = ui.querySelector('.tk-dl-start-label');
  const jobPanelEl = ui.querySelector('.tk-dl-job-panel');
  const jobListEl = ui.querySelector('.tk-dl-job-list');
  appStatus = ui.querySelector('.tk-status');
  if (appStatus) {
    appStatus.setAttribute('role', 'status');
  }
  modeTabsEl.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      activeMode = button.dataset.mode || 'video';
      if (activeMode === 'creator' && snapshot.kind === 'creator') scanDomCreatorVideos();
      syncModeTabs();
      renderView();
    });
  });
  coverBtnEl?.addEventListener('click', () => {
    const video = currentVideo();
    if (!video) return;
    enqueue(video, 'cover', null).catch((error) => setStatus(error.message, 'error'));
  });
  formatPillsEl?.querySelectorAll('[data-format]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      selectedFormat = button.dataset.format === 'm4a' ? 'm4a' : 'mp4';
      syncFormatPills();
      updateVideoDownloadState();
    });
  });
  startBtnEl?.addEventListener('click', () => {
    const video = currentVideo();
    if (!video) return;
    if (selectedFormat === 'm4a') {
      const audio = mediaResources(video, 'audio');
      const resource = pickResource(video, audio);
      enqueue(video, 'audio', resource).catch((error) => setStatus(error.message, 'error'));
      return;
    }
    const videos = mediaResources(video, 'video');
    const resource = videos.find((item) => item.url === selectedResources.get(video.id)) || pickResource(video, videos);
    enqueue(video, 'video', resource).catch((error) => setStatus(error.message, 'error'));
  });
  jobPanelEl?.querySelectorAll('[data-bulk]').forEach((button) => {
    button.addEventListener('click', () => {
      queueBulk(button.dataset.bulk).then(() => refreshJobPanel()).catch((error) => setStatus(error.message, 'error'));
    });
  });
  function node(parent, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (parent) parent.appendChild(element);
    return element;
  }

  function button(parent, label, className, onClick) {
    const result = node(parent, 'button', className || 'tk-button', label);
    result.type = 'button';
    if (onClick) result.addEventListener('click', onClick);
    return result;
  }

  function labelField(parent, title, control) {
    const label = node(parent, 'label', 'tk-field');
    node(label, 'span', 'tk-field-label', title);
    label.appendChild(control);
    return label;
  }

  function openBrowserDownloads() {
    return send('TIKTOK_DL_OPEN_DOWNLOADS').catch(() => null);
  }

  function setStatus(message, kind) {
    if (!appStatus) return;
    clearTimeout(setStatus.timer);
    appStatus.replaceChildren();
    appStatus.dataset.kind = kind || 'info';
    appStatus.hidden = !message;
    if (!message) return;
    appStatus.appendChild(document.createTextNode(String(message)));
    if (kind === 'success') {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'tk-status-action';
      action.textContent = t('viewDownloads');
      action.addEventListener('click', () => { openBrowserDownloads(); });
      appStatus.appendChild(action);
      return;
    }
    setStatus.timer = setTimeout(() => {
      if (appStatus) appStatus.hidden = true;
    }, 5000);
  }

  function displayLabelForTask(task) {
    const filename = String(task?.filename || '').split(/[/\\]/).pop().trim();
    let title = String(task?.title || '').trim();
    if (/TikTok\s*下载助手|TikTok Downloader|开始下载|Start download|清晰度|Quality|保存为|Save as|查看浏览器下载记录|View browser downloads/.test(title)) title = '';
    if (/\b\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}\b/.test(title)) title = '';
    const letters = title.replace(/\s+/g, '');
    const masked = (letters.match(/x/gi) || []).length;
    if (letters.length >= 4 && masked / letters.length >= 0.7) title = '';
    const pick = filename || title || t('tiktokVideo');
    return pick.length > 72 ? pick.slice(0, 69) + '…' : pick;
  }

  function showSavedStatus(task) {
    const id = String(task?.id || '');
    if (!id || showSavedStatus.lastId === id) return;
    showSavedStatus.lastId = id;
    const label = task?.type === 'audio' ? 'M4A' : task?.type === 'cover' ? t('coverType') : 'MP4';
    setStatus(t('savedFile', { label, name: displayLabelForTask(task) }), 'success');
  }

  function setFabVisible(visible) {
    const fab = document.getElementById('tiktok-dl-toggle');
    if (fab) fab.hidden = !visible;
  }

  function normalizePrefs(value) {
    const source = value && typeof value === 'object' ? value : {};
    const parallel = Number.parseInt(source.maxConcurrentDownloads, 10);
    return {
      ...DEFAULT_PREFS,
      ...source,
      maxConcurrentDownloads: [1, 2, 3].includes(parallel) ? parallel : 2,
      defaultQuality: source.defaultQuality === 'source' ? 'source' : 'highest',
      defaultFormat: 'mp4',
      skipDownloaded: source.skipDownloaded !== false,
      recordHistory: source.recordHistory !== false,
      showFloatingButton: source.showFloatingButton !== false,
      creatorFolders: source.creatorFolders === true
    };
  }

  async function loadPrefs() {
    const values = await DownloaderKit.runtime.storageGet([PREFS_KEY], EXT).catch(() => ({}));
    prefs = normalizePrefs(values?.[PREFS_KEY]);
    setFabVisible(prefs.showFloatingButton);
    return prefs;
  }

  async function savePrefs(next) {
    prefs = normalizePrefs({ ...prefs, ...next });
    await DownloaderKit.runtime.storageSet({ [PREFS_KEY]: prefs }, EXT);
    setFabVisible(prefs.showFloatingButton);
    return prefs;
  }

  async function send(type, extra) {
    const result = await DownloaderKit.runtime.sendMessage({ type, ...(extra || {}) }, EXT);
    if (result?.ok === false) throw new Error(result.error || t('actionFailed'));
    return result || {};
  }

  async function getTasks() {
    const result = await send('TIKTOK_DL_QUEUE_LIST');
    return Array.isArray(result.tasks) ? result.tasks : [];
  }

  async function getHistory() {
    const result = await send('TIKTOK_DL_HISTORY_LIST');
    return Array.isArray(result.history) ? result.history : [];
  }

  async function controlTask(id, action) {
    return send('TIKTOK_DL_QUEUE_CONTROL', { id, action });
  }

  async function bulkTask(action) {
    return send('TIKTOK_DL_QUEUE_BULK', { action });
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''), location.href);
      return url.protocol === 'https:' ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function safeMediaUrl(value) {
    const href = safeHttpUrl(value);
    if (!href) return '';
    const host = new URL(href).hostname.toLowerCase();
    return /(^|\.)(tiktok\.com|tiktokv\.com|tiktokcdn\.com|tiktokcdn-us\.com|byteoversea\.com|ibytedtos\.com|ttwstatic\.com|muscdn\.com|byteimg\.com|bytecdn\.cn)$/.test(host) ? href : '';
  }

  function currentVideo() {
    return snapshot.kind === 'video' && snapshot.video ? snapshot.video : null;
  }

  function formatDuration(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleDateString();
  }

  function formatPublishTime(value) {
    const date = new Date(value);
    const time = date.getTime();
    if (!Number.isFinite(time)) return '';
    const minutes = Math.floor(Math.max(0, Date.now() - time) / 60000);
    if (minutes < 1) return t('justNow');
    if (minutes < 60) return t('minutesAgo', { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('hoursAgo', { n: hours });
    const days = Math.floor(hours / 24);
    if (days < 30) return t('daysAgo', { n: days });
    const months = Math.floor(days / 30);
    if (months < 12) return t('monthsAgo', { n: months });
    return t('yearsAgo', { n: Math.floor(months / 12) });
  }

  function formatBytes(value) {
    const n = Number(value) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function isValidAudioResource(resource, video) {
    if (!resource?.url || resource.type !== 'audio') return false;
    const mime = String(resource.mime || '').toLowerCase();
    if (!/^audio\//.test(mime)) return false;
    const videoUrls = new Set(
      mediaResources(video, 'video', false).flatMap((item) => [item.url, ...(item.backupUrls || [])])
    );
    if (videoUrls.has(resource.url)) return false;
    const audioSize = Number(resource.sizeBytes) || Number(resource.estimatedBytes) || 0;
    if (audioSize < 16 * 1024) return false;
    const maxVideoSize = mediaResources(video, 'video', false)
      .reduce((max, item) => Math.max(max, Number(item.sizeBytes) || Number(item.estimatedBytes) || 0), 0);
    if (maxVideoSize > 0 && audioSize >= maxVideoSize * 0.45) return false;
    return true;
  }

  function audioExtension(resource) {
    const mime = String(resource?.mime || '').toLowerCase();
    const format = String(resource?.format || '').toLowerCase();
    if (/mpeg|mp3/.test(mime) || format === 'mp3') return 'mp3';
    if (/aac/.test(mime) || format === 'aac') return 'aac';
    return 'm4a';
  }

  function mediaResources(video, type, validateAudio = true) {
    const list = Array.isArray(video?.resources)
      ? video.resources.filter((item) => item?.type === type && safeMediaUrl(item.url))
      : [];
    if (type === 'audio' && validateAudio) return list.filter((item) => isValidAudioResource(item, video));
    return list;
  }

  function displayQuality(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === '原始资源' || raw === 'Original') return t('originalQuality');
    return raw;
  }

  function resourceLabel(resource) {
    const codec = String(resource?.codec || '');
    const codecLabel = /265|hevc/i.test(codec) ? 'HEVC' : /264|avc/i.test(codec) ? 'H.264' : '';
    return [displayQuality(resource?.quality), codecLabel].filter(Boolean).join(' · ');
  }

  const debugLines = [];
  const debugLogEl = ui.querySelector('.tk-dl-debug-log');
  function panelDebug(message) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    debugLines.push('[' + time + '] ' + message);
    if (debugLines.length > 80) debugLines.shift();
    if (debugLogEl) debugLogEl.textContent = debugLines.join('\n');
    console.log('[TikTokDL]', message);
  }
  ui.querySelector('.tk-dl-debug-copy')?.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = debugLines.join('\n') || t('noLogs');
    try {
      await navigator.clipboard.writeText(text);
      panelDebug(t('logCopied'));
    } catch (error) {
      panelDebug(t('copyFailed', { error: error?.message || error }));
    }
  });
  ui.querySelector('.tk-dl-debug-clear')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    debugLines.length = 0;
    if (debugLogEl) debugLogEl.textContent = t('logCleared');
  });

  function qualityPillLabel(resource) {
    const width = Number(resource?.width) || 0;
    const height = Number(resource?.height) || 0;
    const codec = String(resource?.codec || '');
    const codecLabel = /265|hevc|hvc/i.test(codec) ? 'HEVC' : /264|avc/i.test(codec) ? 'H.264' : '';
    const resolution = width && height ? Math.min(width, height) : height || width;
    const base = resolution ? resolution + 'P' : '';
    return [base, codecLabel].filter(Boolean).join(' ') || t('videoWord');
  }

  function resourceSourceRank(resource) {
    const source = String(resource?.source || '');
    if (source === '页面下载') return 4;
    if (source === '画质档位') return 3;
    if (source === '页面播放') return 1;
    return 2;
  }

  function pickResource(video, list) {
    if (!list.length) return null;
    const selected = selectedResources.get(video.id);
    if (selected && list.some((item) => item.url === selected)) return list.find((item) => item.url === selected);
    if (prefs.defaultQuality === 'source') return list[0];
    return [...list].sort((a, b) => {
      const rankDiff = resourceSourceRank(b) - resourceSourceRank(a);
      if (rankDiff) return rankDiff;
      const sizeDiff = (Number(b.sizeBytes) || Number(b.estimatedBytes) || 0) - (Number(a.sizeBytes) || Number(a.estimatedBytes) || 0);
      if (sizeDiff) return sizeDiff;
      const pixelsA = (Number(a.width) || 0) * (Number(a.height) || 0);
      const pixelsB = (Number(b.width) || 0) * (Number(b.height) || 0);
      return pixelsB - pixelsA || (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
    })[0];
  }

  function imageExtension(url) {
    try {
      const match = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
      if (match && ['jpg', 'jpeg', 'png', 'webp'].includes(match[1].toLowerCase())) return match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    } catch (_) {}
    return 'jpg';
  }

  function creatorFolderName(value) {
    return String(value || 'TikTok').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || 'TikTok';
  }

  async function taskFilename(video, quality, format) {
    await shell.settings?.ready;
    const meta = {
      title: (() => {
        const raw = String(video.title || '').trim();
        if (!raw || /TikTok\s*下载助手|TikTok Downloader|开始下载|Start download|清晰度|Quality|保存为|Save as/.test(raw) || /\b\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}\b/.test(raw)) {
          return video.author || video.authorId || 'TikTok video';
        }
        const letters = raw.replace(/\s+/g, '');
        const masked = (letters.match(/x/gi) || []).length;
        if (letters.length >= 4 && masked / letters.length >= 0.7) return video.author || video.authorId || 'TikTok video';
        return raw;
      })(),
      author: (() => {
        const raw = String(video.author || video.authorId || 'TikTok').trim();
        return /^x{3,}$/i.test(raw) ? 'TikTok' : raw;
      })(),
      id: video.id || '',
      video_id: video.id || '',
      date: (video.publishTime || new Date().toISOString()).slice(0, 10),
      quality: displayQuality(quality),
      resolution: displayQuality(quality)
    };
    let name = shell.settings?.filename(meta, format) || ('TikTok - ' + meta.title + '.' + format);
    if (prefs.creatorFolders && video.author) name = 'TikTok Downloads/' + creatorFolderName(video.author) + '/' + name;
    return name;
  }

  async function isSuccessfulDuplicate(video, type) {
    const history = await getHistory().catch(() => []);
    return history.find((item) => item.status === 'completed' && item.videoId === video.id && item.type === type) || null;
  }

  async function enqueue(video, type, resource, options) {
    const opts = options || {};
    if (!video?.id) throw new Error(t('noVideoId'));
    let url = '';
    let backupUrls = [];
    let quality = '';
    let format = '';
    if (type === 'cover') {
      url = safeMediaUrl(video.cover);
      format = imageExtension(url);
      quality = t('coverType');
    } else {
      if (type === 'audio' && !isValidAudioResource(resource, video)) {
        throw new Error(t('noSeparateAudio'));
      }
      url = safeMediaUrl(resource?.url);
      backupUrls = (Array.isArray(resource?.backupUrls) ? resource.backupUrls : [])
        .map(safeMediaUrl).filter((candidate) => candidate && candidate !== url);
      quality = resource?.quality || t('originalQuality');
      format = type === 'video' ? 'mp4' : audioExtension(resource);
    }
    if (!url) throw new Error(type === 'cover' ? t('noCover') : t('noResource'));

    const duplicate = await isSuccessfulDuplicate(video, type);
    if (duplicate && opts.batch && prefs.skipDownloaded) return { skipped: true };
    const forceDuplicate = Boolean(duplicate);

    let filename = await taskFilename(video, quality, format);
    if (format && !filename.toLowerCase().endsWith('.' + String(format).toLowerCase())) {
      filename = filename.replace(/\.[a-z0-9]{1,8}$/i, '') + '.' + format;
    }
    const task = {
      id: 'tt-' + video.id + '-' + type + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      videoId: video.id,
      creatorId: video.authorId || creator?.id || '',
      author: video.author || creator?.displayName || creator?.username || '',
      title: video.title || 'TikTok video',
      publishTime: video.publishTime || '',
      pageUrl: video.pageUrl || location.href,
      url,
      backupUrls,
      type,
      quality,
      format,
      filename,
      coverUrl: safeHttpUrl(video.cover),
      recordHistory: prefs.recordHistory,
      forceDuplicate
    };
    const result = await send('TIKTOK_DL_QUEUE_ADD', { tasks: [task] });
    if (result.added) {
      setStatus('', '');
      showSavedStatus.lastId = '';
      refreshJobPanel().catch(() => {});
      return { added: true };
    }
    if (result.skipped) {
      setStatus(t('alreadyQueued'), 'warn');
      return { skipped: true };
    }
    throw new Error(t('noQueue'));
  }

  async function enqueueCreatorSelection() {
    const history = await getHistory().catch(() => []);
    const done = new Set(history.filter((item) => item.status === 'completed' && item.type === 'video').map((item) => item.videoId));
    const tasks = [];
    let missing = 0;
    let already = 0;
    creatorVideos.forEach((video, id) => {
      if (!selectedIds.has(id)) return;
      if (prefs.skipDownloaded && done.has(id)) { already += 1; return; }
      const resource = pickResource(video, mediaResources(video, 'video'));
      if (!resource) { missing += 1; return; }
      tasks.push({
        id: 'tt-' + id + '-video-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        videoId: id,
        creatorId: video.authorId || creator?.id || '',
        author: video.author || creator?.displayName || creator?.username || '',
        title: video.title || 'TikTok video',
        publishTime: video.publishTime || '',
        pageUrl: video.pageUrl,
        url: resource.url,
        backupUrls: (Array.isArray(resource.backupUrls) ? resource.backupUrls : []).map(safeMediaUrl).filter(Boolean),
        type: 'video',
        quality: displayQuality(resource.quality),
        format: 'mp4',
        filename: '',
        coverUrl: safeHttpUrl(video.cover),
        recordHistory: prefs.recordHistory,
        forceDuplicate: !prefs.skipDownloaded && done.has(id)
      });
    });
    for (const task of tasks) task.filename = await taskFilename(creatorVideos.get(task.videoId), task.quality, 'mp4');
    if (!tasks.length) {
      setStatus(missing ? t('noSelectedResource') : t('noSelectedVideos'), 'warn');
      return;
    }
    const result = await send('TIKTOK_DL_QUEUE_ADD', { tasks });
    const notes = [];
    if (result.added) notes.push(t('addedTasks', { count: result.added }));
    if (already) notes.push(t('skippedDownloaded', { count: already }));
    if (missing) notes.push(t('missingResource', { count: missing }));
    if (result.skipped) notes.push(t('queueDeduped', { count: result.skipped }));
    setStatus(notes.join(' · ') || t('noNewTasks'), result.added ? 'success' : 'warn');
    if (result.added) {
      selectedIds.clear();
      renderCreatorRows();
    }
  }

  function syncModeTabs() {
    const showCreator = creatorPageAvailable() || snapshot.kind === 'creator';
    modeTabsEl.classList.toggle('hidden', !showCreator);
    if (!showCreator && activeMode === 'creator') activeMode = 'video';
    modeTabsEl.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === activeMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    videoBodyEl.classList.toggle('hidden', activeMode !== 'video');
    creatorBodyEl.classList.toggle('hidden', activeMode !== 'creator');
  }

  function syncFormatPills() {
    const audio = mediaResources(currentVideo(), 'audio');
    const audioBtn = formatPillsEl?.querySelector('[data-format="m4a"]');
    if (audioBtn) {
      const available = audio.length > 0;
      audioBtn.classList.toggle('hidden', !available);
      audioBtn.disabled = !available;
      if (!available && selectedFormat === 'm4a') selectedFormat = 'mp4';
    }
    formatPillsEl?.querySelectorAll('[data-format]').forEach((button) => {
      const active = button.dataset.format === selectedFormat && !button.disabled;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (qualitySectionEl) qualitySectionEl.classList.toggle('hidden', selectedFormat === 'm4a');
  }

  function renderQualityPills(video, list) {
    if (!pillsEl) return;
    pillsEl.replaceChildren();
    if (!list.length) {
      const empty = node(pillsEl, 'span', 'tk-dl-pill disabled', selectedFormat === 'm4a' ? t('noAudio') : t('noQuality'));
      empty.textContent = selectedFormat === 'm4a' ? t('noAudio') : t('noQuality');
      return;
    }
    const preferred = pickResource(video, list);
    if (preferred && !list.some((item) => item.url === selectedResources.get(video.id))) {
      selectedResources.set(video.id, preferred.url);
    }
    list.forEach((resource) => {
      const pill = node(pillsEl, 'button', 'tk-dl-pill', qualityPillLabel(resource, list));
      pill.type = 'button';
      pill.title = resourceLabel(resource);
      const active = resource.url === (selectedResources.get(video.id) || preferred?.url);
      pill.classList.toggle('active', active);
      pill.setAttribute('aria-pressed', String(active));
      pill.addEventListener('click', () => {
        selectedResources.set(video.id, resource.url);
        renderQualityPills(video, list);
        updateVideoDownloadState();
      });
    });
  }

  function updateEstimate(resource) {
    if (!estimateEl || !estimateTextEl) return;
    if (!resource) {
      estimateEl.classList.add('hidden');
      estimateTextEl.textContent = t('estimateEmpty');
      return;
    }
    estimateEl.classList.remove('hidden');
    const sizeLabel = resource.sizeBytes
      ? formatBytes(resource.sizeBytes)
      : (resource.estimatedBytes ? formatBytes(resource.estimatedBytes) : '');
    estimateTextEl.textContent = sizeLabel ? t('estimateAbout', { size: sizeLabel }) : t('estimateUnknown');
  }

  let filenamePreviewToken = 0;

  function updateFilenamePreview(video, resource) {
    if (!filenamePreviewEl || !video) return;
    const format = selectedFormat === 'm4a' ? 'm4a' : 'mp4';
    const quality = displayQuality(resource?.quality);
    const token = ++filenamePreviewToken;
    const videoId = video.id || '';
    filenamePreviewEl.textContent = t('filenameLoading');
    taskFilename(video, quality, format).then((name) => {
      if (token !== filenamePreviewToken || !filenamePreviewEl.isConnected) return;
      if ((currentVideo()?.id || '') !== videoId) return;
      filenamePreviewEl.replaceChildren();
      node(filenamePreviewEl, 'span', 'tk-dl-filename-preview-label', t('saveAs'));
      const nameEl = node(filenamePreviewEl, 'span', 'tk-dl-filename-preview-name', name);
      nameEl.title = name;
      publishPopupInfo();
    }).catch(() => {
      if (token !== filenamePreviewToken || !filenamePreviewEl.isConnected) return;
      filenamePreviewEl.textContent = t('filenameUnavailable');
    });
  }

  function recognitionCopy() {
    if (snapshot.kind === 'creator') return [t('creatorPage'), t('creatorPageDetail')];
    if (snapshot.kind === 'photo' || snapshot.reason === 'photo') return [t('photoPage'), t('photoPageDetail')];
    if (snapshot.reason === 'parse-error') return [t('parseError'), t('parseErrorDetail')];
    if (snapshot.reason === 'no-player') return [t('noPlayer'), t('noPlayerDetail')];
    if (snapshot.reason === 'no-matching-item') return [t('noMatch'), t('noMatchDetail')];
    return [t('waitVideo'), t('waitVideoDetail')];
  }

  function updateVideoDownloadState() {
    const video = currentVideo();
    if (!video) {
      if (pillsEl) {
        pillsEl.replaceChildren();
        node(pillsEl, 'span', 'tk-dl-pill loading', t('loading'));
      }
      syncFormatPills();
      if (startBtnEl) startBtnEl.disabled = true;
      if (estimateEl) estimateEl.classList.add('hidden');
      if (filenamePreviewEl) filenamePreviewEl.textContent = t('filenamePending');
      return;
    }
    const videos = mediaResources(video, 'video');
    const audio = mediaResources(video, 'audio');
    syncFormatPills();
    if (selectedFormat === 'm4a') {
      renderQualityPills(video, audio);
      const resource = pickResource(video, audio);
      updateEstimate(resource);
      updateFilenamePreview(video, resource);
      if (startBtnEl) startBtnEl.disabled = !audio.length;
      if (startLabelEl) startLabelEl.textContent = audio.length ? t('startDownload') : t('noAudio');
      publishPopupInfo();
      return;
    }
    renderQualityPills(video, videos);
    const resourceSummary = videos.length + ' video options; ' + videos.map((item) => ((item.mergedHeights || [item.height]).filter(Boolean).join('/') || '?') + 'P backups ' + ((item.backupUrls || []).length)).join(', ');
    if (resourceSummary !== panelDebug.last) {
      panelDebug.last = resourceSummary;
      panelDebug(resourceSummary);
    }
    const resource = videos.find((item) => item.url === selectedResources.get(video?.id)) || pickResource(video, videos);
    updateEstimate(resource);
    updateFilenamePreview(video, resource);
    if (startBtnEl) startBtnEl.disabled = !videos.length;
    if (startLabelEl) startLabelEl.textContent = videos.length ? t('startDownload') : t('noVideo');
    publishPopupInfo();
  }

  function updateVideoCard() {
    const video = currentVideo();
    if (!cardEl) return;
    if (!video) {
      const [title, detail] = recognitionCopy();
      cardEl.classList.remove('is-loading');
      coverSkEl?.classList.add('hidden');
      coverImgEl?.classList.add('hidden');
      coverPhEl?.classList.remove('hidden');
      videoSkEl?.classList.add('hidden');
      videoContentEl?.classList.remove('hidden');
      if (coverBtnEl) coverBtnEl.disabled = true;
      if (titleEl) titleEl.textContent = title;
      if (authorEl) { authorEl.textContent = ''; authorEl.classList.add('hidden'); }
      if (subEl) subEl.textContent = detail;
      return;
    }
    cardEl.classList.remove('is-loading');
    videoSkEl?.classList.add('hidden');
    videoContentEl?.classList.remove('hidden');
    if (titleEl) {
      const title = String(video.title || '').trim();
      const authorName = video.author || creator?.displayName || creator?.username || '';
      const titleLooksBad = !title
    || /TikTok\s*下载助手|TikTok Downloader|开始下载|Start download|清晰度|Quality|保存为|Save as/.test(title)
        || /\b\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}\b/.test(title)
        || ((title.replace(/\s+/g, '').match(/x/gi) || []).length / Math.max(1, title.replace(/\s+/g, '').length) >= 0.7);
      titleEl.textContent = titleLooksBad ? (authorName ? t('authorVideo', { author: authorName }) : t('tiktokVideo')) : title;
    }
    const authorName = video.author || creator?.displayName || creator?.username || '';
    if (authorEl) {
      const authorLooksBad = !authorName || /^x{3,}$/i.test(authorName);
      authorEl.textContent = authorLooksBad ? '' : t('authorBy', { author: authorName });
      authorEl.classList.toggle('hidden', authorLooksBad);
    }
    const published = formatPublishTime(video.publishTime);
    if (subEl) {
      subEl.textContent = published;
      subEl.title = [video.duration ? formatDuration(video.duration) : '', formatDate(video.publishTime), video.id ? 'ID ' + video.id : ''].filter(Boolean).join(' · ');
    }
    if (cardEl) cardEl.title = [authorName, published, video.id ? 'ID ' + video.id : ''].filter(Boolean).join(' · ');
    const cover = safeHttpUrl(video.cover);
    if (cover && coverImgEl) {
      coverImgEl.src = cover;
      coverImgEl.referrerPolicy = 'no-referrer';
      coverImgEl.onload = () => {
        coverSkEl?.classList.add('hidden');
        coverPhEl?.classList.add('hidden');
        coverImgEl.classList.remove('hidden');
      };
      coverImgEl.onerror = () => {
        coverImgEl.classList.add('hidden');
        coverSkEl?.classList.add('hidden');
        coverPhEl?.classList.remove('hidden');
      };
    } else {
      coverImgEl?.classList.add('hidden');
      coverSkEl?.classList.add('hidden');
      coverPhEl?.classList.remove('hidden');
    }
    if (coverBtnEl) coverBtnEl.disabled = !cover;
  }

  let jobWatchTimer = 0;
  let shownJobIds = new Set();

  function jobProgressSnapshot(task) {
    const received = Number(task.bytesReceived) || 0;
    const total = Number(task.totalBytes) || 0;
    const pct = task.status === 'completed'
      ? 100
      : (total > 0 ? Math.min(100, Math.round(received * 100 / total)) : Math.max(0, Math.min(100, Number(task.progress) || 0)));
    const known = task.status === 'completed' || total > 0 || pct > 0;
    const subText = total > 0
      ? formatBytes(received) + ' / ' + formatBytes(total)
      : (received ? formatBytes(received) : '');
    const quality = task.format === 'm4a' ? t('m4a') : (displayQuality(task.quality) || t('videoWord'));
    return { received, total, pct, known, subText, quality };
  }

  function bindJobActions(row, task) {
    const actions = row.querySelector('.tk-dl-progress-actions');
    if (!actions) return;
    if (actions.dataset.status === task.status) return;
    actions.dataset.status = task.status;
    actions.replaceChildren();
    actions.classList.toggle('hidden', task.status === 'completed');
    if (task.status === 'completed') return;
    taskActions(task).forEach(([action, label]) => {
      if (!['pause', 'resume', 'cancel'].includes(action)) return;
      const actionBtn = button(actions, label, 'tk-dl-action-btn', () => {
        controlTask(task.id, action).then(() => refreshJobPanel()).catch((error) => setStatus(error.message, 'error'));
      });
      if (action === 'cancel') actionBtn.classList.add('danger');
    });
  }

  function createJobRow(task) {
    const snap = jobProgressSnapshot(task);
    const row = document.createElement('div');
    row.className = 'tk-dl-progress';
    row.dataset.jobId = task.id;
    const meta = node(row, 'div', 'tk-dl-progress-meta');
    const title = node(meta, 'span', 'tk-dl-progress-title', task.title || task.filename || t('downloadTask'));
    title.title = task.filename || task.title || '';
    node(meta, 'span', 'tk-dl-progress-q', snap.quality);
    const head = node(row, 'div', 'tk-dl-progress-head');
    node(head, 'span', 'tk-dl-job-phase', taskStatusLabel(task));
    const pctEl = node(head, 'span', 'tk-dl-job-pct', snap.known ? snap.pct + '%' : '');
    pctEl.classList.toggle('hidden', !snap.known);
    const sub = node(row, 'div', 'tk-dl-progress-sub' + (snap.subText ? '' : ' hidden'), snap.subText);
    if (task.filename) sub.title = task.filename;
    const track = node(row, 'div', 'tk-dl-progress-track');
    const bar = node(track, 'div', 'tk-dl-progress-bar' + (snap.known ? '' : ' indeterminate') + (task.status === 'paused' ? ' paused' : ''));
    bar.style.width = (snap.known ? snap.pct : 35) + '%';
    node(row, 'div', 'tk-dl-progress-actions');
    bindJobActions(row, task);
    return row;
  }

  function updateJobRow(row, task) {
    const snap = jobProgressSnapshot(task);
    const title = row.querySelector('.tk-dl-progress-title');
    if (title) {
      const next = task.title || task.filename || t('downloadTask');
      if (title.textContent !== next) title.textContent = next;
      title.title = task.filename || task.title || '';
    }
    const qualityEl = row.querySelector('.tk-dl-progress-q');
    if (qualityEl && qualityEl.textContent !== snap.quality) qualityEl.textContent = snap.quality;
    const phaseEl = row.querySelector('.tk-dl-job-phase');
    const phase = taskStatusLabel(task);
    if (phaseEl && phaseEl.textContent !== phase) phaseEl.textContent = phase;
    const pctEl = row.querySelector('.tk-dl-job-pct');
    if (pctEl) {
      const next = snap.known ? snap.pct + '%' : '';
      if (pctEl.textContent !== next) pctEl.textContent = next;
      pctEl.classList.toggle('hidden', !snap.known);
    }
    const sub = row.querySelector('.tk-dl-progress-sub');
    if (sub) {
      if (sub.textContent !== snap.subText) sub.textContent = snap.subText;
      sub.classList.toggle('hidden', !snap.subText);
      if (task.filename) sub.title = task.filename;
    }
    const bar = row.querySelector('.tk-dl-progress-bar');
    if (bar) {
      bar.classList.toggle('indeterminate', !snap.known);
      bar.classList.toggle('paused', task.status === 'paused');
      const width = (snap.known ? snap.pct : 35) + '%';
      if (bar.style.width !== width) bar.style.width = width;
    }
    bindJobActions(row, task);
  }

  async function refreshJobPanel() {
    if (!jobPanelEl || !jobListEl) return;
    const listed = await getTasks().catch(() => []);
    const active = (Array.isArray(listed) ? listed : []).filter((task) => ['waiting', 'downloading', 'paused'].includes(task.status));
    const justFinished = (Array.isArray(listed) ? listed : []).filter((task) => shownJobIds.has(task.id) && task.status === 'completed');
    if (justFinished.length) showSavedStatus(justFinished[0]);
    const tasks = active.slice(0, 3);
    const visible = !jobPanelEl.classList.contains('hidden');
    const shouldShow = tasks.length > 0;
    if (visible !== shouldShow) jobPanelEl.classList.toggle('hidden', !shouldShow);
    jobPanelEl.querySelector('.tk-dl-job-panel-queue')?.classList.toggle('hidden', active.length < 2);
    shownJobIds = new Set(active.map((task) => task.id));
    clearTimeout(jobWatchTimer);
    if (active.length) jobWatchTimer = setTimeout(() => { refreshJobPanel().catch(() => {}); }, 900);

    const keep = new Set(tasks.map((task) => task.id));
    [...jobListEl.children].forEach((row) => {
      if (!keep.has(row.dataset.jobId)) row.remove();
    });
    tasks.forEach((task) => {
      let row = jobListEl.querySelector('[data-job-id="' + CSS.escape(task.id) + '"]');
      if (!row) {
        row = createJobRow(task);
        jobListEl.appendChild(row);
      } else {
        updateJobRow(row, task);
      }
    });
  }

  function renderVideoView() {
    updateVideoCard();
    updateVideoDownloadState();
    refreshJobPanel().catch(() => {});
  }

  function renderView() {
    syncModeTabs();
    if (activeMode === 'creator') {
      creatorRows = null;
      creatorStats = null;
      creatorSelectionStatus = null;
      creatorBodyEl.replaceChildren();
      renderCreatorView(creatorBodyEl);
      return;
    }
    renderVideoView();
    publishPopupInfo();
  }

  function creatorPageAvailable() {
    return snapshot.kind === 'creator' && Boolean(snapshot.creator?.username);
  }

  function creatorCollectionId(value) {
    const raw = value?.id || value?.username || creator?.id || creator?.username || 'unknown';
    return String(raw).toLowerCase();
  }

  function storedVideo(video) {
    return {
      id: video.id,
      pageUrl: video.pageUrl,
      title: video.title || '',
      description: video.description || '',
      author: video.author || '',
      authorId: video.authorId || '',
      duration: Number(video.duration) || 0,
      publishTime: video.publishTime || '',
      cover: video.cover || ''
    };
  }

  function persistCreatorVideos() {
    clearTimeout(collectionSaveTimer);
    collectionSaveTimer = setTimeout(async () => {
      if (!creatorKey || creatorPersistenceBlocked) return;
      creatorSaved[creatorKey] = {
        creator: creator,
        lastScanAt,
        scanState: scanState === 'scanning' ? 'paused' : scanState,
        videos: [...creatorVideos.values()].slice(0, 5000).map(storedVideo)
      };
      await DownloaderKit.runtime.storageSet({ [CREATOR_KEY]: creatorSaved }, EXT).catch(() => {});
    }, 250);
  }

  async function loadCreatorVideos(nextCreator) {
    const key = creatorCollectionId(nextCreator);
    if (key === creatorKey) return;
    creatorPersistenceBlocked = false;
    creatorDataCleared = false;
    creatorKey = key;
    creatorVideos = new Map();
    selectedIds.clear();
    const stored = await DownloaderKit.runtime.storageGet([CREATOR_KEY], EXT).catch(() => ({}));
    creatorSaved = stored?.[CREATOR_KEY] && typeof stored[CREATOR_KEY] === 'object' ? stored[CREATOR_KEY] : {};
    const entry = creatorSaved[key];
    if (Array.isArray(entry?.videos)) {
      entry.videos.forEach((video) => {
        if (video?.id) creatorVideos.set(String(video.id), { ...video, resources: [] });
      });
    }
    lastScanAt = Number(entry?.lastScanAt) || 0;
    scanState = entry?.scanState === 'paused' ? 'paused' : 'idle';
    updateCreatorStats();
    if (activeMode === 'creator') renderCreatorRows();
  }

  function mergeCreatorVideos(videos) {
    let changed = false;
    (Array.isArray(videos) ? videos : []).forEach((video) => {
      if (!video?.id || !/^\d+$/.test(String(video.id))) return;
      const id = String(video.id);
      const previous = creatorVideos.get(id) || {};
      const resources = Array.isArray(video.resources) && video.resources.length ? video.resources : (previous.resources || []);
      const merged = { ...previous, ...video, id, resources };
      if (JSON.stringify(merged) !== JSON.stringify(previous)) changed = true;
      creatorVideos.set(id, merged);
    });
    if (changed) {
      updateCreatorStats();
      persistCreatorVideos();
      if (activeMode === 'creator') renderCreatorRows();
    }
  }

  function creatorTitleLooksBad(value) {
    const title = String(value || '').trim();
    if (!title) return true;
    if (/^(打开视频页|open video page|watch video|watch now|video)$/i.test(title)) return true;
    if (/TikTok\s*下载助手|TikTok Downloader|开始下载|Start download|清晰度|Quality|保存为|Save as/.test(title)) return true;
    if (/\b\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}\b/.test(title)) return true;
    return ((title.replace(/\s+/g, '').match(/x/gi) || []).length / Math.max(1, title.replace(/\s+/g, '').length) >= 0.7);
  }

  function pickCreatorDomTitle(anchor, card, image) {
    const lines = (card.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.length < 2 || line.length > 300) continue;
      if (creatorTitleLooksBad(line)) continue;
      if (/^\d{1,2}:\d{2}$/.test(line)) continue;
      if (/^@\S+$/.test(line)) continue;
      if (/^\d+$/.test(line)) continue;
      return line.slice(0, 500);
    }
    const aria = anchor.getAttribute('aria-label') || anchor.getAttribute('title') || image?.alt || '';
    return creatorTitleLooksBad(aria) ? '' : String(aria).slice(0, 500);
  }

  function creatorVideoTitle(video) {
    const candidates = [video?.title, video?.description];
    for (const candidate of candidates) {
      const title = String(candidate || '').trim();
      if (!creatorTitleLooksBad(title)) return title;
    }
    return t('tiktokVideoId', { id: video.id });
  }

  function scanDomCreatorVideos() {
    if (!creatorPageAvailable()) return;
    const found = [];
    document.querySelectorAll('a[href*="/video/"]').forEach((anchor) => {
      let url;
      try { url = new URL(anchor.href, location.href); } catch (_) { return; }
      const match = url.pathname.match(/\/@([^/]+)\/video\/(\d+)/i);
      if (!match) return;
      const id = match[2];
      const existing = creatorVideos.get(id);
      let card = anchor;
      for (let i = 0; i < 5 && card.parentElement; i += 1) {
        if ((card.innerText || '').trim().length > (anchor.innerText || '').trim().length + 12) card = card.parentElement;
      }
      const image = anchor.querySelector('img') || card.querySelector('img');
      const picked = pickCreatorDomTitle(anchor, card, image);
      const rawTitle = picked || existing?.title || existing?.description || '';
      const title = creatorTitleLooksBad(rawTitle) && !creatorTitleLooksBad(existing?.title)
        ? String(existing.title).slice(0, 500)
        : String(rawTitle).slice(0, 500);
      const creatorMatch = url.pathname.match(/^\/@([^/]+)/);
      const item = {
        id,
        pageUrl: url.href,
        title,
        description: title,
        author: creator?.displayName || creatorMatch?.[1] || '',
        authorId: creator?.id || '',
        duration: Number(existing?.duration) || 0,
        publishTime: existing?.publishTime || '',
        cover: safeHttpUrl(image?.currentSrc || image?.src || existing?.cover),
        resources: existing?.resources || []
      };
      found.push(item);
    });
    if (found.length) mergeCreatorVideos(found);
  }

  function renderCreatorView(parent) {
    const profile = creator || snapshot.creator || null;
    if (profile && creatorCollectionId(profile) !== creatorKey) loadCreatorVideos(profile).catch(() => {});
    if (!creatorPageAvailable()) {
      const empty = node(parent, 'section', 'tk-empty-card');
      node(empty, 'strong', '', t('notCreatorPage'));
      node(empty, 'p', '', t('notCreatorPageDetail'));
      return;
    }

    const summary = node(parent, 'section', 'tk-creator-summary');
    const avatarUrl = safeHttpUrl(profile?.avatar);
    if (avatarUrl) {
      const avatar = node(summary, 'img', 'tk-avatar');
      avatar.src = avatarUrl;
      avatar.alt = '';
      avatar.referrerPolicy = 'no-referrer';
    } else node(summary, 'div', 'tk-avatar tk-avatar-placeholder', '♪');
    const identity = node(summary, 'div', 'tk-creator-identity');
    node(identity, 'strong', '', profile?.displayName || profile?.username || 'TikTok Creator');
    node(identity, 'span', 'tk-creator-handle', '@' + (profile?.username || ''));
    creatorStats = node(identity, 'span', 'tk-count');
    const scanControls = node(parent, 'div', 'tk-scan-controls');
    const scanButton = button(scanControls, t('scanAll'), 'tk-button tk-primary');
    const pauseButton = button(scanControls, t('pause'), 'tk-button');
    const stopButton = button(scanControls, t('stop'), 'tk-button tk-danger');
    scanButton.addEventListener('click', () => {
      if (scanState === 'paused') resumeCreatorScan();
      else startCreatorScan().catch((error) => {
        scanState = 'failed';
        persistCreatorVideos();
        updateCreatorStats();
        setStatus(t('scanFailed', { error: error.message }), 'error');
      });
    });
    pauseButton.addEventListener('click', () => pauseCreatorScan());
    stopButton.addEventListener('click', () => stopCreatorScan());
    creatorScanButtons = { scanButton, pauseButton, stopButton };
    updateCreatorStats();
    const filters = node(parent, 'div', 'tk-filter-row');
    const search = node(filters, 'input', 'tk-input');
    search.type = 'search';
    search.placeholder = t('searchTitleDesc');
    search.value = creatorSearch;
    search.setAttribute('aria-label', t('searchCreatorVideos'));
    search.addEventListener('input', () => { creatorSearch = search.value; renderCreatorRows(); });
    const statusWrap = node(filters, 'div', 'tk-select-wrap');
    const status = node(statusWrap, 'select', 'tk-select tk-filter');
    status.setAttribute('aria-label', t('filterDownloadStatus'));
    [
      ['all', t('statusAll')],
      ['new', t('statusNew')],
      ['downloaded', t('statusDownloaded')],
      ['failed', t('statusFailed')]
    ].forEach(([value, label]) => {
      const option = node(status, 'option', '', label);
      option.value = value;
    });
    status.value = creatorStatusFilter;
    status.addEventListener('change', () => { creatorStatusFilter = status.value; renderCreatorRows(); });
    const dateWrap = node(filters, 'div', 'tk-select-wrap');
    const date = node(dateWrap, 'select', 'tk-select tk-filter');
    date.setAttribute('aria-label', t('filterPublishTime'));
    [['all', t('timeAll')], ['7', t('time7')], ['30', t('time30')], ['90', t('time90')]].forEach(([value, label]) => {
      const option = node(date, 'option', '', label);
      option.value = value;
    });
    date.value = creatorDateFilter;
    date.addEventListener('change', () => { creatorDateFilter = date.value; renderCreatorRows(); });
    const actions = node(parent, 'div', 'tk-list-actions');
    const selectAll = button(actions, t('selectAllResults'), 'tk-mini-button', () => {
      visibleCreatorVideos().forEach((video) => selectedIds.add(video.id));
      renderCreatorRows();
    });
    const selectNew = button(actions, t('selectUndownloaded'), 'tk-mini-button', async () => {
      const history = await getHistory().catch(() => []);
      const done = new Set(history.filter((item) => item.status === 'completed' && item.type === 'video').map((item) => item.videoId));
      visibleCreatorVideos().forEach((video) => { if (!done.has(video.id)) selectedIds.add(video.id); });
      renderCreatorRows();
    });
    button(actions, t('deselect'), 'tk-mini-button', () => { selectedIds.clear(); renderCreatorRows(); });
    creatorRows = node(parent, 'div', 'tk-creator-list');
    const selectionBar = node(parent, 'div', 'tk-selection-bar');
    creatorSelectionStatus = node(selectionBar, 'span', '', t('selectedCount', { count: 0 }));
    const addSelected = button(selectionBar, t('addToQueue'), 'tk-button tk-primary');
    addSelected.addEventListener('click', () => enqueueCreatorSelection().catch((error) => setStatus(error.message, 'error')));
    renderCreatorRows();
    updateScanButtons();
  }

  let creatorScanButtons = null;
  function updateCreatorStats() {
    if (!creatorStats) return;
    const total = creatorVideos.size;
    creatorStats.textContent = total > 0
      ? t('creatorStatsShort', { state: scanStateLabel(scanState), count: total })
      : scanStateLabel(scanState) + ' · ' + t('notScanned');
    updateScanButtons();
  }

  function updateScanButtons() {
    if (!creatorScanButtons) return;
    const active = scanState === 'scanning';
    creatorScanButtons.scanButton.textContent = scanState === 'paused' ? t('continueScan') : t('scanAll');
    creatorScanButtons.scanButton.disabled = active;
    creatorScanButtons.pauseButton.textContent = scanPaused || scanState === 'paused' ? t('resume') : t('pause');
    creatorScanButtons.pauseButton.disabled = !active && scanState !== 'paused';
    creatorScanButtons.stopButton.disabled = !active && scanState !== 'paused';
  }

  async function startCreatorScan() {
    if (!creatorPageAvailable()) throw new Error(t('openCreatorFirst'));
    if (creatorCollectionId(snapshot.creator) !== creatorKey) await loadCreatorVideos(snapshot.creator);
    creatorPersistenceBlocked = false;
    creatorDataCleared = false;
    scanStopRequested = false;
    scanPaused = false;
    scanState = 'scanning';
    persistCreatorVideos();
    updateCreatorStats();
    scanDomCreatorVideos();
    let stableRounds = 0;
    let previousCount = creatorVideos.size;
    try {
      while (!scanStopRequested) {
        while (scanPaused && !scanStopRequested) await delay(250);
        if (scanStopRequested) break;
        scanDomCreatorVideos();
        const before = creatorVideos.size;
        const bottom = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
        window.scrollTo({ top: bottom, behavior: 'smooth' });
        await delay(1100);
        scanDomCreatorVideos();
        const after = creatorVideos.size;
        if (after > before || after > previousCount) stableRounds = 0;
        else stableRounds += 1;
        previousCount = after;
        updateCreatorStats();
        if (stableRounds >= 7) {
          scanState = 'completed';
          lastScanAt = Date.now();
          break;
        }
      }
      if (scanStopRequested) scanState = creatorDataCleared ? 'idle' : 'paused';
    } catch (error) {
      scanState = 'failed';
      persistCreatorVideos();
      updateCreatorStats();
      throw error;
    } finally {
      scanStopRequested = false;
      scanPaused = false;
      lastScanAt = scanState === 'completed' ? Date.now() : lastScanAt;
      persistCreatorVideos();
      updateCreatorStats();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function pauseCreatorScan() {
    if (scanState === 'paused') { resumeCreatorScan(); return; }
    if (scanState !== 'scanning') return;
    scanPaused = true;
    scanState = 'paused';
    persistCreatorVideos();
    updateCreatorStats();
  }

  function resumeCreatorScan() {
    if (scanState !== 'paused') return;
    scanPaused = false;
    scanState = 'scanning';
    if (!scanPromise) {
      startCreatorScan().catch((error) => setStatus(t('scanFailed', { error: error.message }), 'error'));
      return;
    }
    updateCreatorStats();
  }

  function stopCreatorScan() {
    if (scanState === 'scanning' || scanState === 'paused') {
      scanStopRequested = true;
      scanPaused = false;
      setStatus(t('scanPausedMsg'), 'info');
    }
  }

  let scanPromise = null;
  const startScan = startCreatorScan;
  startCreatorScan = async function wrappedStartCreatorScan() {
    if (scanPromise) return scanPromise;
    scanPromise = startScan();
    try { return await scanPromise; }
    finally { scanPromise = null; }
  };

  function creatorVideoMatches(video, historyDone, historyFailed) {
    const query = creatorSearch.trim().toLowerCase();
    const text = (video.title || video.description || '').toLowerCase();
    if (query && !text.includes(query)) return false;
    const downloaded = historyDone.has(video.id);
    const failed = historyFailed.has(video.id);
    if (creatorStatusFilter === 'new' && downloaded) return false;
    if (creatorStatusFilter === 'downloaded' && !downloaded) return false;
    if (creatorStatusFilter === 'failed' && (!failed || downloaded)) return false;
    if (creatorDateFilter !== 'all') {
      const timestamp = new Date(video.publishTime || 0).getTime();
      if (!timestamp || Date.now() - timestamp > Number(creatorDateFilter) * 86400000) return false;
    }
    return true;
  }

  let visibleVideosCache = [];
  function visibleCreatorVideos() { return visibleVideosCache; }

  function renderCreatorRows() {
    if (!creatorRows) return;
    const historyTask = getHistory().catch(() => []);
    historyTask.then((history) => {
      if (!creatorRows?.isConnected) return;
      const done = new Set(history.filter((item) => item.status === 'completed' && item.type === 'video').map((item) => item.videoId));
      const failed = new Set(history.filter((item) => item.status === 'failed' && item.type === 'video').map((item) => item.videoId));
      const all = [...creatorVideos.values()].sort((a, b) => {
        const da = new Date(a.publishTime || 0).getTime() || 0;
        const db = new Date(b.publishTime || 0).getTime() || 0;
        return db - da;
      });
      const visible = all.filter((video) => creatorVideoMatches(video, done, failed));
      visibleVideosCache = visible;
      if (creatorStats) {
        const downloadedCount = all.filter((video) => done.has(video.id)).length;
        creatorStats.textContent = t('creatorStats', {
          state: scanStateLabel(scanState),
          total: all.length,
          downloaded: downloadedCount,
          added: Math.max(0, all.length - downloadedCount)
        });
      }
      creatorRows.replaceChildren();
      if (!visible.length) {
        node(creatorRows, 'p', 'tk-empty-inline', all.length ? t('noFilterMatch') : t('scanToSee'));
      }
      visible.slice(0, 200).forEach((video) => {
        const row = node(creatorRows, 'article', 'tk-creator-item');
        const check = node(row, 'input', 'tk-checkbox');
        check.type = 'checkbox';
        check.checked = selectedIds.has(video.id);
        check.setAttribute('aria-label', t('selectVideo', { name: video.title || video.id }));
        check.addEventListener('change', () => {
          if (check.checked) selectedIds.add(video.id);
          else selectedIds.delete(video.id);
          updateSelectionLabel();
        });
        const image = node(row, 'img', 'tk-creator-cover');
        image.alt = '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        if (safeHttpUrl(video.cover)) image.src = safeHttpUrl(video.cover);
        const body = node(row, 'div', 'tk-creator-item-body');
        const pageUrl = video.pageUrl || ('https://www.tiktok.com/@' + encodeURIComponent(creator?.username || '') + '/video/' + video.id);
        const titleLink = node(body, 'a', 'tk-creator-item-title tk-link', creatorVideoTitle(video));
        titleLink.href = pageUrl;
        titleLink.target = '_blank';
        titleLink.rel = 'noopener noreferrer';
        titleLink.title = t('openVideoPage');
        const footer = node(body, 'div', 'tk-creator-item-footer');
        const meta = [video.author ? '@' + video.author : '', formatDate(video.publishTime), video.duration ? formatDuration(video.duration) : ''].filter(Boolean).join(' · ');
        node(footer, 'span', 'tk-creator-item-meta', meta || 'ID ' + video.id);
        const downloaded = done.has(video.id);
        const hasResource = mediaResources(video, 'video').length > 0;
        node(footer, 'span', 'tk-status-pill ' + (downloaded ? 'done' : failed.has(video.id) ? 'failed' : hasResource ? 'ready' : 'pending'),
          downloaded ? t('statusDownloaded') : failed.has(video.id) ? t('statusFailed') : hasResource ? t('canDownload') : t('waitResource'));
      });
      if (visible.length > 200) node(creatorRows, 'p', 'tk-muted', t('listTruncated', { count: all.length }));
      updateSelectionLabel();
      updateCreatorStats();
    }).catch(() => {});
  }

  function updateSelectionLabel() {
    if (creatorSelectionStatus) creatorSelectionStatus.textContent = t('selectedCount', { count: selectedIds.size });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function scanStateLabel(state) {
    return ({
      idle: t('scanReady'),
      scanning: t('scanScanning'),
      paused: t('scanPaused'),
      completed: t('scanCompleted'),
      failed: t('scanError')
    })[state] || t('scanReady');
  }

  function taskStatusLabel(task) {
    return ({
      waiting: t('statusWaiting'),
      downloading: t('statusDownloading'),
      paused: t('statusPaused'),
      completed: t('statusCompleted'),
      failed: t('statusFailed'),
      cancelled: t('statusCancelled')
    })[task.status] || task.status || t('statusUnknown');
  }

  function taskActions(task) {
    if (task.status === 'downloading') return [['pause', t('pause')], ['cancel', t('cancel')]];
    if (task.status === 'paused') return [['resume', t('resume')], ['cancel', t('cancel')]];
    if (task.status === 'waiting') return [['cancel', t('cancel')]];
    if (task.status === 'failed' || task.status === 'cancelled') return [['retry', t('retryTask')], ['delete', t('deleteRecord')]];
    if (task.status === 'completed') return [['delete', t('deleteRecord')]];
    return [];
  }

  function renderTaskManager(parent, inSheet) {
    parent.replaceChildren();
    const top = node(parent, 'div', 'tk-task-toolbar');
    const bulk = [
      ['pause-all', t('pauseAll')],
      ['resume-all', t('resumeAll')],
      ['cancel-waiting', t('cancelWaiting')],
      ['retry-failed', t('retryFailed')],
      ['clear-completed', t('clearCompleted')]
    ];
    bulk.forEach(([action, label]) => {
      button(top, label, 'tk-mini-button', async () => {
        try {
          await bulkTask(action);
          renderTaskManager(parent, inSheet);
        } catch (error) { setStatus(error.message, 'error'); }
      });
    });
    const progress = node(parent, 'div', 'tk-task-summary');
    const list = node(parent, 'div', 'tk-task-list');
    const pageControls = node(parent, 'div', 'tk-pagination');
    const status = node(parent, 'p', 'tk-muted');
    status.textContent = t('readingTasks');
    getTasks().then((tasks) => {
      if (!list.isConnected) return;
      const active = tasks.filter((task) => ['waiting', 'downloading', 'paused'].includes(task.status)).length;
      const done = tasks.filter((task) => task.status === 'completed').length;
      const failed = tasks.filter((task) => task.status === 'failed').length;
      progress.textContent = t('queueSummary', { active, done, failed });
      if (active) {
        const banner = node(parent, 'section', 'tk-recovery-banner');
        node(banner, 'strong', '', t('unfinishedTitle'));
        node(banner, 'span', '', t('unfinishedDetail', { done, total: tasks.length, active }));
        const recoveryActions = node(banner, 'div', 'tk-task-actions');
        button(recoveryActions, t('continueDownload'), 'tk-mini-button tk-recovery-primary', async () => {
          await bulkTask('resume-all').catch((error) => setStatus(error.message, 'error'));
          renderTaskManager(parent, inSheet);
        });
        button(recoveryActions, t('abandonUnfinished'), 'tk-mini-button tk-danger-text', async () => {
          if (!window.confirm(t('abandonConfirm'))) return;
          const latest = await getTasks().catch(() => []);
          for (const task of latest) {
            if (['waiting', 'downloading', 'paused'].includes(task.status)) {
              await controlTask(task.id, 'cancel').catch(() => {});
            }
          }
          renderTaskManager(parent, inSheet);
        });
        parent.insertBefore(banner, progress);
      }
      status.textContent = tasks.length ? '' : t('noTasks');
      const ordered = [...tasks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const pageSize = 50;
      const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
      taskPage = Math.min(taskPage, pageCount - 1);
      const shown = ordered.slice(taskPage * pageSize, (taskPage + 1) * pageSize);
      shown.forEach((task) => {
        const row = node(list, 'article', 'tk-task-item');
        const header = node(row, 'div', 'tk-task-item-header');
        node(header, 'strong', 'tk-task-title', task.title || t('tiktokVideo'));
        node(header, 'span', 'tk-status-pill ' + task.status, taskStatusLabel(task));
        const detail = [task.author ? '@' + task.author : '', task.type || 'video', task.quality, task.format?.toUpperCase()].filter(Boolean).join(' · ');
        node(row, 'p', 'tk-task-meta', detail);
        if (task.status === 'downloading' || task.status === 'completed') {
          const bar = node(row, 'div', 'tk-progress');
          const fill = node(bar, 'span', 'tk-progress-fill');
          const percentage = Number(task.progress) || 0;
          fill.style.width = Math.min(100, Math.max(0, percentage)) + '%';
          node(row, 'span', 'tk-progress-label', task.status === 'completed' ? '100%' : (percentage ? percentage + '%' : formatBytes(task.bytesReceived || 0)));
        }
        if (task.error) node(row, 'p', 'tk-task-error', task.error);
        const controls = node(row, 'div', 'tk-task-actions');
        taskActions(task).forEach(([action, label]) => {
          button(controls, label, 'tk-mini-button', async () => {
            try {
              if (action === 'delete') await send('TIKTOK_DL_QUEUE_DELETE', { id: task.id });
              else await controlTask(task.id, action);
              taskPage = Math.floor(taskPage);
              renderTaskManager(parent, inSheet);
            } catch (error) { setStatus(error.message, 'error'); }
          });
        });
      });
      if (pageCount > 1) {
        button(pageControls, t('prevPage'), 'tk-mini-button', () => { taskPage = Math.max(0, taskPage - 1); renderTaskManager(parent, inSheet); }).disabled = taskPage === 0;
        node(pageControls, 'span', 'tk-muted', (taskPage + 1) + ' / ' + pageCount);
        button(pageControls, t('nextPage'), 'tk-mini-button', () => { taskPage = Math.min(pageCount - 1, taskPage + 1); renderTaskManager(parent, inSheet); }).disabled = taskPage + 1 >= pageCount;
      }
    }).catch((error) => { status.textContent = error.message; });
    parent.appendChild(status);
  }

  function fillTasksSheet(body) {
    renderTaskManager(body, true);
  }

  function renderHistoryView(parent) {
    const toolbar = node(parent, 'div', 'tk-history-toolbar');
    const search = node(toolbar, 'input', 'tk-input');
    search.type = 'search';
    search.placeholder = t('searchHistoryPlaceholder');
    search.value = historySearch;
    search.setAttribute('aria-label', t('searchHistoryAria'));
    const range = node(toolbar, 'select', 'tk-select tk-filter');
    [['all', t('timeAll')], ['today', t('timeToday')], ['7', t('time7')], ['30', t('time30')]].forEach(([value, label]) => {
      const option = node(range, 'option', '', label);
      option.value = value;
    });
    range.value = historyRange;
    const clear = button(toolbar, t('historyClear'), 'tk-mini-button tk-danger-text', async () => {
      if (!window.confirm(t('historyClearConfirm'))) return;
      await send('TIKTOK_DL_DATA_CLEAR', { scope: 'history' });
      renderHistoryRows();
      setStatus(t('historyCleared'), 'success');
    });
    const list = node(parent, 'div', 'tk-history-list');
    const summary = node(parent, 'p', 'tk-muted');
    search.addEventListener('input', () => { historySearch = search.value; renderHistoryRows(); });
    range.addEventListener('change', () => { historyRange = range.value; renderHistoryRows(); });
    function renderHistoryRows() {
      list.replaceChildren();
      getHistory().then((history) => {
        const query = historySearch.trim().toLowerCase();
        const filtered = history.filter((item) => {
          const text = [item.title, item.author, item.videoId].join(' ').toLowerCase();
          if (query && !text.includes(query)) return false;
          const time = Number(item.time) || 0;
          if (historyRange === 'today') {
            const date = new Date(time);
            const today = new Date();
            if (date.toDateString() !== today.toDateString()) return false;
          } else if (historyRange !== 'all' && Date.now() - time > Number(historyRange) * 86400000) return false;
          return true;
        });
        summary.textContent = t('historySummary', { shown: Math.min(200, filtered.length), total: filtered.length });
        if (!filtered.length) node(list, 'p', 'tk-empty-inline', t('noHistoryMatch'));
        filtered.slice(0, 200).forEach((item) => {
          const row = node(list, 'article', 'tk-history-item');
          if (safeHttpUrl(item.coverUrl)) {
            const image = node(row, 'img', 'tk-history-cover');
            image.src = safeHttpUrl(item.coverUrl);
            image.alt = '';
            image.loading = 'lazy';
            image.referrerPolicy = 'no-referrer';
          }
          const body = node(row, 'div', 'tk-history-body');
          node(body, 'strong', '', item.title || t('tiktokVideo'));
          node(body, 'span', 'tk-history-meta', (item.author ? '@' + item.author + ' · ' : '') + (item.type || 'video') + ' · ' + formatDate(item.time));
          node(body, 'span', 'tk-status-pill ' + item.status, taskStatusLabel(item));
          const file = node(body, 'span', 'tk-history-file', item.filename || '');
          file.title = item.filename || '';
          if (item.pageUrl) {
            const link = node(body, 'a', 'tk-link', t('reopenVideo'));
            link.href = item.pageUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          }
        });
      }).catch((error) => { summary.textContent = error.message; });
    }
    renderHistoryRows();
  }

  const FILENAME_PRESETS = {
    'title-author': '{title} - {author}',
    'author-title': '{author} - {title}',
    title: '{title}',
    'title-id': '{title} - {id}',
    detailed: '{title} - {author} - {quality}'
  };
  const FILENAME_CHIPS = [
    ['title', 'chipTitle'],
    ['author', 'chipAuthor'],
    ['id', 'chipId'],
    ['quality', 'chipQuality'],
    ['date', 'chipDate']
  ];

  function t(key, values) {
    return DownloaderKit.i18n?.t?.(key, values) || key;
  }

  function applyLanguage() {
    renderView();
    const page = document.getElementById('tiktok-dl-root');
    if (page) DownloaderKit.i18n.apply(page);
    if (settingsBody?.isConnected) {
      const pageTitle = document.getElementById('tiktok-dl-info-title');
      const pageDate = document.getElementById('tiktok-dl-info-date');
      if (pageTitle) pageTitle.textContent = t('settings');
      if (pageDate) {
        pageDate.textContent = t('settingsHint');
        pageDate.hidden = false;
      }
      fillSettingsSheet(settingsBody);
    }
  }

  function themeChoices() {
    const listed = shell.theme?.list?.() || [{ id: 'default', name: t('themeTikTok') }];
    return listed.map((item) => ({
      id: item.id,
      name: item.id === 'default' ? t('themeTikTok') : (DownloaderKit.i18n?.t?.('theme-' + item.id) === 'theme-' + item.id ? item.name : t('theme-' + item.id))
    }));
  }

  function syncThemePicker(themeControl) {
    if (!themeControl) return;
    const currentId = shell.theme?.current?.() || 'default';
    const current = themeChoices().find((item) => item.id === currentId) || themeChoices()[0];
    const currentLabel = themeControl.querySelector('.tk-dl-settings-theme-current-label');
    const currentSwatch = themeControl.querySelector('.tk-dl-settings-theme-current-swatch');
    if (currentLabel) currentLabel.textContent = current?.name || t('themeTikTok');
    if (currentSwatch) currentSwatch.dataset.theme = currentId === 'default' ? 'tiktok' : currentId;
    themeControl.querySelectorAll('[data-theme-option]').forEach((option) => {
      option.setAttribute('aria-selected', String(option.dataset.themeOption === currentId));
    });
  }

  async function copyFeedbackEmail(email, button) {
    const label = button?.querySelector('.dl-kit-feedback-label') || button;
    const original = label?.textContent || t('feedback');
    let copied = false;
    try {
      await navigator.clipboard.writeText(email);
      copied = true;
    } catch (_) { /* fall through to the document copy path */ }
    if (!copied) {
      const input = document.createElement('textarea');
      input.value = email;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
      input.remove();
    }
    if (copied && label) {
      label.textContent = t('copied');
      button.classList.add('is-copied');
      setTimeout(() => {
        if (!button.isConnected) return;
        label.textContent = original;
        button.classList.remove('is-copied');
      }, 1600);
      return;
    }
    const link = document.createElement('a');
    link.href = 'mailto:' + email + '?subject=' + encodeURIComponent(t('feedbackSubject'));
    link.click();
  }

  function fillSettingsSheet(body) {
    settingsBody = body;
    body.replaceChildren();
    const root = document.createElement('div');
    root.className = 'tk-dl-settings';

    const themeRow = document.createElement('div');
    themeRow.className = 'tk-dl-settings-row';
    const themeRowLabel = document.createElement('span');
    themeRowLabel.textContent = t('theme');
    const themeControl = document.createElement('div');
    themeControl.className = 'tk-dl-settings-theme-control';
    const themeTrigger = document.createElement('button');
    themeTrigger.type = 'button';
    themeTrigger.className = 'tk-dl-settings-theme-trigger';
    themeTrigger.setAttribute('aria-label', t('theme'));
    themeTrigger.setAttribute('aria-haspopup', 'listbox');
    themeTrigger.setAttribute('aria-expanded', 'false');
    const currentSwatch = document.createElement('span');
    currentSwatch.className = 'tk-dl-settings-theme-swatch tk-dl-settings-theme-current-swatch';
    currentSwatch.setAttribute('aria-hidden', 'true');
    const currentLabel = document.createElement('span');
    currentLabel.className = 'tk-dl-settings-theme-current-label';
    const chevron = document.createElement('span');
    chevron.className = 'tk-dl-settings-theme-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    themeTrigger.append(currentSwatch, currentLabel, chevron);
    const themeOptions = document.createElement('div');
    themeOptions.className = 'tk-dl-settings-theme-options hidden';
    themeOptions.setAttribute('role', 'listbox');
    function renderThemeOptions() {
      themeOptions.replaceChildren();
      themeChoices().forEach((theme) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'tk-dl-settings-theme-option';
        option.dataset.themeOption = theme.id;
        option.setAttribute('role', 'option');
        const swatch = document.createElement('span');
        swatch.className = 'tk-dl-settings-theme-swatch';
        swatch.dataset.theme = theme.id === 'default' ? 'tiktok' : theme.id;
        swatch.setAttribute('aria-hidden', 'true');
        const optionLabel = document.createElement('span');
        optionLabel.textContent = theme.name;
        option.append(swatch, optionLabel);
        option.addEventListener('click', async () => {
          setThemeMenuOpen(false);
          try {
            await shell.theme.set(theme.id);
            syncThemePicker(themeControl);
            status.textContent = t('themeSaved');
          } catch (error) {
            status.textContent = error?.message || t('themeSaveFailed');
          }
        });
        themeOptions.appendChild(option);
      });
      syncThemePicker(themeControl);
    }
    function setThemeMenuOpen(open) {
      themeOptions.classList.toggle('hidden', !open);
      themeTrigger.setAttribute('aria-expanded', String(open));
      themeControl.classList.toggle('is-open', open);
    }
    renderThemeOptions();
    themeTrigger.addEventListener('click', () => {
      setThemeMenuOpen(themeOptions.classList.contains('hidden'));
    });
    themeControl.append(themeTrigger, themeOptions);
    themeRow.append(themeRowLabel, themeControl);
    root.appendChild(themeRow);

    const languageRow = document.createElement('div');
    languageRow.className = 'tk-dl-settings-row';
    const languageLabel = document.createElement('span');
    languageLabel.textContent = t('language');
    const languageControl = document.createElement('div');
    languageControl.className = 'tk-dl-settings-control';
    const languageWrap = document.createElement('div');
    languageWrap.className = 'tk-dl-settings-select-wrap';
    const languageSelect = document.createElement('select');
    languageSelect.className = 'tk-dl-settings-select';
    languageSelect.setAttribute('aria-label', t('language'));
    [
      ['zh-CN', t('chinese')],
      ['en', t('english')]
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      languageSelect.appendChild(option);
    });
    languageSelect.value = DownloaderKit.i18n?.language?.() || 'zh-CN';
    languageSelect.addEventListener('mousedown', () => setThemeMenuOpen(false));
    languageSelect.addEventListener('change', () => {
      const value = languageSelect.value === 'en' ? 'en' : 'zh-CN';
      DownloaderKit.i18n.save(value).then(() => applyLanguage()).catch(() => {});
    });
    languageWrap.appendChild(languageSelect);
    languageControl.appendChild(languageWrap);
    languageRow.append(languageLabel, languageControl);
    root.appendChild(languageRow);

    const presetRow = document.createElement('div');
    presetRow.className = 'tk-dl-settings-row';
    const presetLabel = document.createElement('span');
    presetLabel.textContent = t('filename');
    const filenameControl = document.createElement('div');
    filenameControl.className = 'tk-dl-settings-control';
    const presetWrap = document.createElement('div');
    presetWrap.className = 'tk-dl-settings-select-wrap';
    const preset = document.createElement('select');
    preset.className = 'tk-dl-settings-select';
    preset.setAttribute('aria-label', t('filenameRule'));
    preset.addEventListener('mousedown', () => setThemeMenuOpen(false));
    [
      ['title-author', t('presetDefault')],
      ['author-title', t('presetAuthorTitle')],
      ['title', t('presetTitle')],
      ['title-id', t('presetTitleId')],
      ['detailed', t('presetDetailed')],
      ['custom', t('presetCustom')]
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      preset.appendChild(option);
    });
    presetWrap.appendChild(preset);
    filenameControl.appendChild(presetWrap);
    presetRow.append(presetLabel, filenameControl);
    root.appendChild(presetRow);

    const customBlock = document.createElement('div');
    customBlock.className = 'tk-dl-settings-custom';
    customBlock.hidden = true;
    const template = document.createElement('input');
    template.type = 'text';
    template.className = 'tk-dl-settings-input';
    template.maxLength = 180;
    template.spellcheck = false;
    template.autocomplete = 'off';
    template.placeholder = '{title} - {author}';
    template.setAttribute('aria-label', t('customTemplate'));
    customBlock.appendChild(template);
    const chips = document.createElement('div');
    chips.className = 'tk-dl-settings-chips';
    FILENAME_CHIPS.forEach(([key, label]) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tk-dl-settings-chip';
      chip.textContent = t(label);
      chip.title = '{' + key + '}';
      chip.addEventListener('click', () => {
        const start = template.selectionStart ?? template.value.length;
        const end = template.selectionEnd ?? start;
        const token = '{' + key + '}';
        template.value = template.value.slice(0, start) + token + template.value.slice(end);
        const pos = start + token.length;
        template.focus();
        template.setSelectionRange(pos, pos);
        syncPresetFromTemplate();
        refreshPreview();
        queueSave();
      });
      chips.appendChild(chip);
    });
    customBlock.appendChild(chips);
    root.appendChild(customBlock);

    const preview = document.createElement('p');
    preview.className = 'tk-dl-settings-preview';
    const error = document.createElement('p');
    error.className = 'tk-dl-settings-error';
    error.hidden = true;
    root.append(preview, error);
    const foot = document.createElement('div');
    foot.className = 'tk-dl-settings-foot';
    const status = document.createElement('span');
    status.className = 'tk-dl-settings-status';
    status.setAttribute('role', 'status');
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'tk-dl-settings-reset';
    reset.textContent = t('resetDefault');
    foot.append(status, reset);
    root.appendChild(foot);
    body.appendChild(root);
    syncThemePicker(themeControl);

    let saveTimer = 0;
    function matchPreset(value) {
      const text = String(value || '').trim();
      for (const [key, tpl] of Object.entries(FILENAME_PRESETS)) {
        if (tpl === text) return key;
      }
      return 'custom';
    }
    function syncCustomVisibility() {
      customBlock.hidden = preset.value !== 'custom';
    }
    function syncPresetFromTemplate() {
      preset.value = matchPreset(template.value.trim());
      syncCustomVisibility();
    }
    function currentTemplate() {
      if (preset.value !== 'custom' && FILENAME_PRESETS[preset.value]) return FILENAME_PRESETS[preset.value];
      return template.value.trim();
    }
    function refreshPreview() {
      try {
        const name = DownloaderKit.settings.filename(currentTemplate(), {
          title: t('sampleTitle'),
          author: t('sampleAuthor'),
          id: '7600000000000000000',
          quality: '1080P'
        }, 'mp4');
        error.hidden = true;
        error.textContent = '';
        preview.textContent = t('preview', { name });
        return currentTemplate();
      } catch (err) {
        error.hidden = false;
        error.textContent = err.message || t('invalidTemplate');
        preview.textContent = t('previewEmpty');
        return false;
      }
    }
    function applyForm(settings) {
      template.value = settings?.filenameTemplate || DEFAULT_PREFS.filenameTemplate;
      preset.value = matchPreset(template.value);
      syncCustomVisibility();
      refreshPreview();
    }
    async function persist(showOk) {
      const nextTemplate = refreshPreview();
      if (!nextTemplate) {
        status.textContent = t('invalidTemplate');
        return;
      }
      try {
        await shell.settings.save(nextTemplate);
        if (activeMode === 'video') updateVideoDownloadState();
        status.textContent = showOk ? t('saved') : '';
      } catch (err) {
        status.textContent = err?.message || t('themeSaveFailed');
      }
    }
    function queueSave() {
      status.textContent = '';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { persist(true); }, 280);
    }
    preset.addEventListener('change', () => {
      if (preset.value !== 'custom' && FILENAME_PRESETS[preset.value]) template.value = FILENAME_PRESETS[preset.value];
      syncCustomVisibility();
      refreshPreview();
      queueSave();
    });
    template.addEventListener('input', () => {
      syncPresetFromTemplate();
      refreshPreview();
      queueSave();
    });
    reset.addEventListener('click', async () => {
      clearTimeout(saveTimer);
      try {
        const saved = await shell.settings.reset();
        applyForm(saved);
        if (activeMode === 'video') updateVideoDownloadState();
        status.textContent = t('restored');
      } catch (err) {
        status.textContent = err?.message || t('restoreFailed');
      }
    });
    shell.settings?.ready?.then(() => applyForm(shell.settings.current())).catch((err) => {
      status.textContent = err?.message || t('loadFailed');
    });
    shell.theme?.ready?.then(() => renderThemeOptions()).catch(() => {});
  }

  document.addEventListener('pointerdown', (event) => {
    const themeControl = document.querySelector('.tk-dl-settings-theme-control');
    if (!themeControl || themeControl.contains(event.target)) return;
    themeControl.querySelector('.tk-dl-settings-theme-options')?.classList.add('hidden');
    themeControl.querySelector('.tk-dl-settings-theme-trigger')?.setAttribute('aria-expanded', 'false');
    themeControl.classList.remove('is-open');
  });

  async function getDiagnostics() {
    const tasks = await getTasks().catch(() => []);
    const history = await getHistory().catch(() => []);
    return {
      page: snapshot.kind,
      reason: snapshot.reason || '',
      activeId: snapshot.activeId || '',
      pageAgentVersion,
      videoId: currentVideo()?.id || '',
      resourceCount: mediaResources(currentVideo(), 'video').length,
      creator: creator?.username || '',
      scanState,
      scannedVideoCount: creatorVideos.size,
      tasks: tasks.length,
      history: history.length,
      settings: prefs
    };
  }

  const POPUP_INFO_KEY = 'tiktok-dl-popup-info-v1';

  function publishPopupInfo() {
    if (window !== window.top) return;
    try {
      const info = popupInfo();
      const pageRoot = document.getElementById('tiktok-dl-root');
      if (pageRoot) {
        if (info) pageRoot.setAttribute('data-popup-info', JSON.stringify(info));
        else pageRoot.removeAttribute('data-popup-info');
      }
      if (!info) return;
      DownloaderKit.runtime.storageSet({
        [POPUP_INFO_KEY]: {
          at: Date.now(),
          tabUrl: location.href,
          info
        }
      }, EXT).catch(() => {});
      EXT.runtime.sendMessage({ type: 'TIKTOK_DL_PAGE_INFO', url: location.href, info }, () => {
        void EXT.runtime.lastError;
      });
    } catch (_) {}
  }

  function popupQualities(video) {
    const available = video ? mediaResources(video, selectedFormat === 'm4a' ? 'audio' : 'video') : [];
    const labels = [];
    const seen = new Set();
    available.forEach((item) => {
      const label = qualityPillLabel(item);
      if (!label || seen.has(label)) return;
      seen.add(label);
      labels.push(label);
    });
    return { available, labels };
  }

  function popupInfo() {
    const filename = filenamePreviewEl?.querySelector('.tk-dl-filename-preview-name')?.textContent?.trim() || '';
    const quality = pillsEl?.querySelector('.tk-dl-pill.active')?.textContent?.trim() || '';
    const formatText = formatPillsEl?.querySelector('.tk-dl-pill.active')?.textContent?.trim() || '';
    const titleText = titleEl?.textContent?.trim() || '';
    const cover = coverImgEl?.currentSrc || coverImgEl?.src || '';
    const placeholder = /等待识别|没有识别|没有对上|解析失败|Waiting for a TikTok|Couldn’t match|Couldn’t parse|No playing video/i.test(titleText);
    const video = currentVideo();
    const rawAuthor = String(video?.author || creator?.displayName || creator?.username || '')
      .replace(/^(?:作者|Author)\s*·\s*/i, '')
      .trim();
    if (filename || quality || (titleText && !placeholder)) {
      const { available, labels } = popupQualities(video);
      const duration = video?.duration ? formatDuration(video.duration) : '';
      const published = video?.publishTime ? formatPublishTime(video.publishTime) : '';
      return {
        mode: snapshot.kind === 'creator' && !filename ? 'creator' : 'video',
        title: titleText || filename || t('tiktokVideo'),
        author: rawAuthor,
        cover: safeHttpUrl(cover) || (video ? safeHttpUrl(video.cover) : ''),
        quality,
        qualities: labels,
        format: formatText,
        filename,
        sub: [duration, published].filter(Boolean).join(' · '),
        resourceCount: available.length,
        id: video?.id || ''
      };
    }
    if (snapshot.kind === 'creator') {
      return {
        mode: 'creator',
        title: snapshot.creator?.displayName || snapshot.creator?.username || 'TikTok Creator',
        author: snapshot.creator?.username || '',
        cover: safeHttpUrl(snapshot.creator?.avatar),
        qualities: [],
        sub: '',
        creatorCount: creatorVideos.size
      };
    }
    return null;
  }

  async function onPageSnapshot(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.url && payload.url !== location.href) return;
    const previousKind = snapshot.kind;
    const previousCreatorKey = creatorKey;
    snapshot = payload;
    if (snapshot.creator) {
      creator = snapshot.creator;
      if (creatorCollectionId(creator) !== previousCreatorKey) await loadCreatorVideos(creator).catch(() => {});
    } else if (snapshot.kind !== 'creator') {
      creator = snapshot.kind === 'video' ? (snapshot.creator || creator) : creator;
    }
    if (snapshot !== payload) return;
    if (snapshot.kind === 'video' && snapshot.video?.id) {
      const item = { ...snapshot.video, author: snapshot.video.author || creator?.displayName || '' };
      mergeCreatorVideos([item]);
    }
    if (snapshot.kind === 'creator' && Array.isArray(snapshot.videos)) mergeCreatorVideos(snapshot.videos);
    if (snapshot.kind === 'creator') scanDomCreatorVideos();
    const recognition = snapshot.kind === 'video' && snapshot.video
      ? 'Recognized video ' + snapshot.video.id
      : 'No video: ' + (snapshot.kind || 'unknown') + (snapshot.reason ? ' / ' + snapshot.reason : '');
    if (panelDebug.lastRecognition !== recognition) {
      panelDebug.lastRecognition = recognition;
      panelDebug(recognition);
    }
    if (previousKind !== snapshot.kind || route !== location.href) {
      route = location.href;
      activeMode = snapshot.kind === 'creator' ? 'creator' : 'video';
      renderView();
    } else if (activeMode === 'video') renderView();
    else if (activeMode === 'creator') updateCreatorStats();
    publishPopupInfo();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source === SOURCE && event.data?.type === 'SNAPSHOT') {
      pageAgentVersion = Number(event.data.version) || 0;
      onPageSnapshot(event.data.payload).catch((error) => console.error('[TikTokDL] snapshot failed', error));
    }
  });
  window.addEventListener('popstate', () => {
    route = location.href;
    window.postMessage({ source: 'tiktok-downloader-content', type: 'GET_SNAPSHOT' }, location.origin);
  });

  EXT.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'TIKTOK_DL_GET_INFO') {
      if (window !== window.top) return undefined;
      const info = popupInfo();
      if (info) publishPopupInfo();
      respond(info ? { ok: true, data: { info } } : { ok: false, error: t('openVideoHint') });
      return false;
    }
    if (window !== window.top) return undefined;
    if (message?.type === 'TIKTOK_DL_OPEN_PANEL') {
      shell.open();
      respond({ ok: true });
      return false;
    }
    if (message?.type === 'TIKTOK_DL_OPEN_CREATOR') {
      activeMode = 'creator';
      renderView();
      shell.open();
      respond({ ok: true });
      return false;
    }
    if (message?.type === 'TIKTOK_DL_DEBUG') {
      const line = message.line || {};
      panelDebug((line.time ? line.time + ' ' : '') + (line.message || '') + (line.extra ? ' ' + line.extra : ''));
      return false;
    }
    if (message?.type === 'TIKTOK_DL_TASKS_CHANGED') {
      const kind = message.kind || 'tasks';
      if (kind === 'terminal' || kind === 'history') {
        clearTimeout(completionRefreshTimer);
        completionRefreshTimer = setTimeout(() => refreshCompletionNotes().catch(() => {}), 150);
      }
      clearTimeout(taskRefreshTimer);
      taskRefreshTimer = setTimeout(() => {
        if (activeMode === 'video') refreshJobPanel().catch(() => {});
        if (activeMode === 'creator' && (kind === 'terminal' || kind === 'history')) renderCreatorRows();
      }, kind === 'progress' ? 900 : 350);
      return false;
    }
    return undefined;
  });

  let completionNotesReady = false;
  async function refreshCompletionNotes() {
    const history = await getHistory().catch(() => []);
    const completedItems = history.filter((item) => item.status === 'completed');
    const completed = new Set(completedItems.map((item) => item.id));
    if (completionNotesReady) {
      const fresh = completedItems.find((item) => !knownCompletedIds.has(item.id));
      if (fresh) {
        shell.noteSuccess();
        if (activeMode === 'video') showSavedStatus(fresh);
      }
    }
    knownCompletedIds = completed;
    completionNotesReady = true;
  }

  EXT.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName === 'local' && Object.prototype.hasOwnProperty.call(changes || {}, CREATOR_KEY) && changes[CREATOR_KEY]?.newValue === undefined) {
      creatorPersistenceBlocked = true;
      creatorDataCleared = true;
      clearTimeout(collectionSaveTimer);
      scanStopRequested = true;
      scanPaused = false;
      scanState = 'idle';
      creatorVideos.clear();
      creatorSaved = {};
      selectedIds.clear();
      lastScanAt = 0;
      updateCreatorStats();
      if (activeMode === 'creator') renderCreatorRows();
    }
    if (areaName === 'local' && changes[PREFS_KEY]) {
      prefs = normalizePrefs(changes[PREFS_KEY].newValue);
      setFabVisible(prefs.showFloatingButton);
      if (activeMode === 'video') renderView();
    }
  });

  function onRoute() {
    if (route === location.href) return;
    route = location.href;
    window.postMessage({ source: 'tiktok-downloader-content', type: 'GET_SNAPSHOT' }, location.origin);
  }
  setInterval(onRoute, 700);

  shell.settings?.ready?.then(() => {
    const current = shell.settings.current();
    const template = String(current?.filenameTemplate || '').trim();
    if (!template || template === '{author} - {title}') {
      shell.settings.save(DEFAULT_PREFS.filenameTemplate).catch(() => {});
    }
  });
  loadPrefs().then(() => renderView()).catch(() => {});
  DownloaderKit.i18n?.ready?.then(() => applyLanguage()).catch(() => {});
  DownloaderKit.i18n?.onChange?.(applyLanguage);
  refreshCompletionNotes().catch(() => {});
  activeMode = /^\/@[^/]+\/video\/\d+/i.test(location.pathname) ? 'video'
    : (/^\/@[^/]+\/?$/i.test(location.pathname) ? 'creator' : 'video');
  renderView();
  window.postMessage({ source: 'tiktok-downloader-content', type: 'GET_SNAPSHOT' }, location.origin);

  const fabPanel = document.getElementById('tiktok-dl-panel');
  const toggleBtn = document.getElementById('tiktok-dl-toggle');
  if (fabPanel && toggleBtn) {
    let toggleDragged = false;
    let dragActive = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragPanelLeft = 0;
    let dragPanelTop = 0;
    let dragMoved = false;
    let dragPointerId = null;
    const FAB_SIZE = 64;
    const FAB_MARGIN = 8;
    const FAB_POS_KEY = 'tiktok-dl-fab-pos-v1';

    function clampFabPos(left, top) {
      const maxL = Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN);
      const maxT = Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - FAB_MARGIN);
      return {
        left: Math.min(Math.max(left, FAB_MARGIN), maxL),
        top: Math.min(Math.max(top, FAB_MARGIN), maxT)
      };
    }

    function applyFabPos(left, top) {
      const pos = clampFabPos(left, top);
      fabPanel.style.left = pos.left + 'px';
      fabPanel.style.top = pos.top + 'px';
      fabPanel.style.right = 'auto';
      fabPanel.style.bottom = 'auto';
      return pos;
    }

    function onFabPointerMove(event) {
      if (!dragActive || event.pointerId !== dragPointerId) return;
      const dx = event.clientX - dragStartX;
      const dy = event.clientY - dragStartY;
      if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 6) {
        dragMoved = true;
        toggleDragged = true;
        toggleBtn.classList.add('dragging');
      }
      if (dragMoved) {
        event.preventDefault();
        applyFabPos(dragPanelLeft + dx, dragPanelTop + dy);
      }
    }

    function onFabPointerUp(event) {
      if (!dragActive || event.pointerId !== dragPointerId) return;
      dragActive = false;
      dragPointerId = null;
      document.removeEventListener('pointermove', onFabPointerMove, true);
      document.removeEventListener('pointerup', onFabPointerUp, true);
      document.removeEventListener('pointercancel', onFabPointerUp, true);
      toggleBtn.classList.remove('dragging');
      fabPanel.style.transition = '';
      if (dragMoved) {
        const rect = fabPanel.getBoundingClientRect();
        const pos = applyFabPos(rect.left, rect.top);
        DownloaderKit.runtime.storageSet({ [FAB_POS_KEY]: pos }, EXT).catch(() => {});
      }
      setTimeout(() => { toggleDragged = false; }, 120);
    }

    toggleBtn.addEventListener('click', (event) => {
      if (!toggleDragged) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    toggleBtn.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      dragActive = true;
      dragMoved = false;
      toggleDragged = false;
      dragPointerId = event.pointerId;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      const rect = fabPanel.getBoundingClientRect();
      dragPanelLeft = rect.right - FAB_SIZE;
      dragPanelTop = rect.bottom - FAB_SIZE;
      if (fabPanel.style.left && fabPanel.style.left !== 'auto') {
        dragPanelLeft = parseFloat(fabPanel.style.left) || dragPanelLeft;
        dragPanelTop = parseFloat(fabPanel.style.top) || dragPanelTop;
      }
      fabPanel.style.transition = 'none';
      applyFabPos(dragPanelLeft, dragPanelTop);
      document.addEventListener('pointermove', onFabPointerMove, true);
      document.addEventListener('pointerup', onFabPointerUp, true);
      document.addEventListener('pointercancel', onFabPointerUp, true);
    });
    toggleBtn.addEventListener('dragstart', (event) => event.preventDefault());

    DownloaderKit.runtime.storageGet([FAB_POS_KEY], EXT).then((data) => {
      const pos = data?.[FAB_POS_KEY];
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) applyFabPos(pos.left, pos.top);
    }).catch(() => {});

    let fabResizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(fabResizeTimer);
      fabResizeTimer = setTimeout(() => {
        const left = parseFloat(fabPanel.style.left);
        const top = parseFloat(fabPanel.style.top);
        if (!Number.isFinite(left) || !Number.isFinite(top)) return;
        const pos = applyFabPos(left, top);
        DownloaderKit.runtime.storageSet({ [FAB_POS_KEY]: pos }, EXT).catch(() => {});
      }, 100);
    });
  }
})();
