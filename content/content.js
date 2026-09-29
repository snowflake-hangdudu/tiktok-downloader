(function bootTikTokDownloader() {
  'use strict';

  const EXT = DownloaderKit.runtime.getApi();
  const PREFS_KEY = 'tiktok-dl-settings-v1';
  const CREATOR_KEY = 'tiktok-dl-creators-v1';
  const CREATOR_CACHE_LIMIT = 3;
  const VIDEO_CACHE_KEY = 'tiktok-dl-videos-v1';
  const VIDEO_CACHE_LIMIT = 10;
  const DEFAULT_PREFS = {
    defaultQuality: 'highest',
    defaultFormat: 'mp4',
    maxConcurrentDownloads: 1,
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
  let historySearch = '';
  let historyRange = 'all';
  let route = location.href;
  let taskRefreshTimer = 0;
  let completionRefreshTimer = 0;
  let pageAgentVersion = 0;
  let settingsBody = null;

    const shell = DownloaderKit.shell.mount({
    title: 'TikTok Downloader',
    idPrefix: 'tiktok-dl',
    theme: 'tiktok',
    initialTheme: 'default',
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
      subject: 'TikTok Downloader feedback'
    },
    onFillSettings: fillSettingsSheet,
    onFeedback: copyFeedbackEmail,
    defaults: {
      notice: {
        enabled: false,
        title: 'Notice',
        pinned: ['Only save public TikTok content you can access and are allowed to keep.'],
        recent: ['Failed downloads retry a backup address. Audio is hidden when no separate track is found.'],
        knownIssues: ['Some video URLs return no permission. The extension switches to a backup address and retries.'],
        roadmap: {
          feedback: ['If something fails, tap Feedback, copy the email, and include the video link and a screenshot.'],
          upcoming: [],
          planned: []
        }
      },
      coop: {
        enabled: true,
        title: 'Custom plugin work',
        body: 'Custom browser extension development.\n\nContact QQ: 748604487\nEmail: hangdudu0@agent.qq.com\nPlease mention “plugin development” and a short description of the request.'
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
    <div class="tk-dl-mode-tabs hidden" role="tablist" data-i18n-aria="modeLabel" aria-label="Download mode">
      <button type="button" data-mode="video" class="active" role="tab" aria-selected="true" data-i18n="singleVideo">Video</button>
      <button type="button" data-mode="creator" role="tab" aria-selected="false" data-i18n="creator">Creator</button>
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
          <button type="button" class="tk-dl-cover-download" disabled data-i18n="coverDownload">Save cover</button>
        </div>
        <div class="tk-dl-video-side">
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
          <div class="tk-dl-options-row">
            <div class="tk-dl-section tk-dl-quality-section">
              <div class="tk-dl-section-head">
                <span data-i18n="quality">Quality</span>
              </div>
              <div class="tk-dl-quality-pills"><span class="tk-dl-pill loading" data-i18n="loading">Loading</span></div>
            </div>
            <div class="tk-dl-format-row tk-dl-section">
              <div class="tk-dl-section-head tk-dl-format-label" data-i18n="format">Format</div>
              <div class="tk-dl-format-pills">
                <button type="button" class="tk-dl-pill active" data-format="mp4" aria-pressed="true" data-i18n="mp4">MP4 video</button>
                <button type="button" class="tk-dl-pill hidden" data-format="m4a" aria-pressed="false" data-i18n="m4a">M4A audio</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p class="tk-dl-filename-preview" aria-live="polite" data-i18n="filenamePending">The filename appears after the video is recognized</p>
      <div class="tk-dl-estimate hidden">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
        <span class="tk-dl-estimate-text" data-i18n="estimateEmpty">Estimated size —</span>
      </div>
      <button type="button" class="tk-dl-btn tk-dl-start" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
        <span class="tk-dl-start-label" data-i18n="startDownload">Start download</span>
      </button>
      <details class="tk-dl-debug">
        <summary data-i18n="debugLog">Debug log</summary>
        <div class="tk-dl-debug-actions">
          <button type="button" class="tk-dl-debug-copy" data-i18n="copyLog">Copy log</button>
          <button type="button" class="tk-dl-debug-clear" data-i18n="clearLog">Clear</button>
        </div>
        <pre class="tk-dl-debug-log" data-i18n="waitingDownload">Waiting for a download…</pre>
      </details>
    </div>
    <div class="tk-dl-creator-body hidden"></div>
    <div class="tk-dl-job-panel hidden">
      <div class="tk-dl-job-list"></div>
      <div class="tk-dl-job-panel-queue hidden">
        <button type="button" class="tk-dl-action-btn" data-bulk="pause-all" data-i18n="pauseAll">Pause all</button>
        <button type="button" class="tk-dl-action-btn danger" data-bulk="cancel-all" data-i18n="cancelAll">Cancel all</button>
      </div>
      <p class="tk-dl-job-more hidden"></p>
    </div>
    <div class="tk-status" hidden role="status"></div>
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
      refreshJobPanel().catch(() => {});
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
      bulkTask(button.dataset.bulk).then(() => refreshJobPanel()).catch((error) => setStatus(error.message, 'error'));
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

  const modeStatus = { video: null, creator: null };

  function paintStatus() {
    if (!appStatus) return;
    const note = modeStatus[currentQueue()];
    appStatus.replaceChildren();
    if (!note) {
      appStatus.hidden = true;
      delete appStatus.dataset.kind;
      return;
    }
    appStatus.hidden = false;
    appStatus.dataset.kind = note.kind || 'info';
    if (note.message) appStatus.appendChild(document.createTextNode(note.message));
    if (note.kind === 'success') {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'tk-status-action';
      action.textContent = t('viewDownloads');
      action.addEventListener('click', () => { openBrowserDownloads(); });
      appStatus.appendChild(action);
    }
  }

  function setStatus(message, kind) {
    const queue = currentQueue();
    clearTimeout(setStatus.timer);
    if (kind === 'success') modeStatus[queue] = { kind: 'success' };
    else if (message) modeStatus[queue] = { kind: kind || 'info', message: String(message) };
    else modeStatus[queue] = null;
    paintStatus();
    if (kind === 'success' || !message) return;
    setStatus.timer = setTimeout(() => {
      if (modeStatus[queue]?.message === String(message)) modeStatus[queue] = null;
      paintStatus();
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
    const queue = taskQueue(task);
    const id = String(task?.id || '');
    if (!id || showSavedStatus.lastId === id) return;
    showSavedStatus.lastId = id;
    modeStatus[queue] = { kind: 'success' };
    paintStatus();
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
      maxConcurrentDownloads: 1,
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

  function taskQueue(task) {
    return task?.queue === 'creator' ? 'creator' : 'video';
  }

  function currentQueue() {
    return activeMode === 'creator' ? 'creator' : 'video';
  }

  async function bulkTask(action) {
    return send('TIKTOK_DL_QUEUE_BULK', { action, queue: currentQueue() });
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
    if (host === 'tiktok.com' || /^(www|m|vm|vt)\.tiktok\.com$/.test(host)) return '';
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

  function hasDownloadableVideo(video) {
    const downloadable = mediaResources(video, 'video').some((item) => resourceSourceRank(item) >= 3);
    if (!downloadable) return false;
    if (Number(video.pinIndex) >= 0 && video.detailResolved !== true) return false;
    return true;
  }

  function chromePlan(resource) {
    const preferred = (Array.isArray(resource?.downloadUrls) ? resource.downloadUrls : [])
      .map(safeMediaUrl).filter(Boolean);
    if (preferred.length) {
      const backups = [...new Set([...preferred.slice(1), ...(Array.isArray(resource?.backupUrls) ? resource.backupUrls : [])
        .map(safeMediaUrl).filter(Boolean)])].filter((url) => url !== preferred[0]);
      return { url: preferred[0], backups };
    }
    const url = safeMediaUrl(resource?.url);
    const backups = (Array.isArray(resource?.backupUrls) ? resource.backupUrls : [])
      .map(safeMediaUrl).filter((candidate) => candidate && candidate !== url);
    return { url, backups };
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
        if (creatorTitleLooksBad(raw)) {
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
      const plan = chromePlan(resource);
      url = plan.url;
      backupUrls = plan.backups;
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
      queue: 'video',
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
    const tasks = [];
    let missing = 0;
    creatorVideos.forEach((video, id) => {
      if (!selectedIds.has(id)) return;
      const resource = pickResource(video, mediaResources(video, 'video'));
      const plan = chromePlan(resource);
      const url = plan.url;
      if (!resource || !url || !hasDownloadableVideo(video)) { missing += 1; return; }
      tasks.push({
        id: 'tt-' + id + '-video-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        videoId: id,
        creatorId: video.authorId || creator?.id || '',
        author: video.author || creator?.displayName || creator?.username || '',
        title: creatorVideoTitle(video),
        publishTime: video.publishTime || '',
        pageUrl: video.pageUrl,
        url,
        backupUrls: plan.backups,
        type: 'video',
        quality: displayQuality(resource.quality),
        format: 'mp4',
        filename: '',
        coverUrl: safeHttpUrl(video.cover),
        queue: 'creator',
        validateMedia: Number(video.pinIndex) >= 0,
        recordHistory: prefs.recordHistory,
        forceDuplicate: true
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
    if (missing) notes.push(t('missingResource', { count: missing }));
    if (result.duplicateCount) notes.push(t('alreadyInQueueCount', { count: result.duplicateCount }));
    if (result.invalidCount) notes.push(t('invalidDownloadCount', { count: result.invalidCount }));
    if (result.skipped && !result.duplicateCount && !result.invalidCount) notes.push(t('queueDeduped', { count: result.skipped }));
    setStatus(notes.join(' · ') || t('noNewTasks'), result.added ? 'info' : 'warn');
    if (result.added) {
      selectedIds.clear();
      renderCreatorRows();
      refreshJobPanel().catch(() => {});
    }
  }

  function creatorUsername() {
    const fromState = String(snapshot.creator?.username || creator?.username || '').trim().replace(/^@/, '');
    if (fromState) return fromState;
    const path = String(location.pathname || '');
    const match = path.match(/^\/@([^/]+)/i);
    if (match) {
      try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
    }
    const pageUrl = String(currentVideo()?.pageUrl || '');
    const fromVideo = pageUrl.match(/\/@([^/]+)/i);
    if (fromVideo) {
      try { return decodeURIComponent(fromVideo[1]); } catch (_) { return fromVideo[1]; }
    }
    return '';
  }

  function creatorProfileUrl(username) {
    const name = String(username || creatorUsername()).replace(/^@/, '').trim();
    return name ? (location.origin + '/@' + encodeURIComponent(name)) : '';
  }

  function openCreatorProfile(event) {
    const href = creatorProfileUrl();
    if (!href) return;
    if (event) event.preventDefault();
    location.assign(href);
  }

  function videoPageCreatorAvailable() {
    return snapshot.kind === 'video' && Boolean(creatorUsername());
  }

  function syncModeTabs() {
    const showCreator = creatorPageAvailable() || videoPageCreatorAvailable();
    modeTabsEl.classList.toggle('hidden', !showCreator);
    if (!showCreator && activeMode === 'creator') activeMode = 'video';
    modeTabsEl.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === activeMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    videoBodyEl.classList.toggle('hidden', activeMode !== 'video');
    creatorBodyEl.classList.toggle('hidden', activeMode !== 'creator');
    paintStatus();
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
      if (authorEl) { authorEl.replaceChildren(); authorEl.classList.add('hidden'); }
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
      authorEl.replaceChildren();
      if (authorLooksBad) {
        authorEl.classList.add('hidden');
      } else {
        node(authorEl, 'span', 'tk-dl-author-label', t('authorLabel') + ' · ');
        const href = creatorProfileUrl();
        const nameNode = node(authorEl, href ? 'a' : 'span', 'tk-dl-author-link', authorName);
        if (href) nameNode.href = href;
        authorEl.classList.remove('hidden');
      }
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
    const scope = currentQueue();
    const active = (Array.isArray(listed) ? listed : []).filter((task) => ['waiting', 'downloading', 'paused'].includes(task.status) && taskQueue(task) === scope);
    const justFinished = (Array.isArray(listed) ? listed : []).filter((task) => shownJobIds.has(task.id) && task.status === 'completed' && taskQueue(task) === scope);
    if (justFinished.length) showSavedStatus(justFinished[0]);
    const current = active.find((task) => task.status === 'downloading')
      || active.find((task) => task.status === 'waiting')
      || active[0];
    const tasks = current ? [current] : [];
    const shouldShow = tasks.length > 0;
    jobPanelEl.classList.toggle('hidden', !shouldShow);
    ui.classList.toggle('is-queue', shouldShow);
    if (!shouldShow) {
      jobListEl.replaceChildren();
      jobPanelEl.querySelector('.tk-dl-job-panel-queue')?.classList.add('hidden');
      jobPanelEl.querySelector('.tk-dl-job-more')?.classList.add('hidden');
      shownJobIds = new Set();
      clearTimeout(jobWatchTimer);
      return;
    }
    const more = jobPanelEl.querySelector('.tk-dl-job-more');
    if (more) {
      const extra = Math.max(0, active.length - tasks.length);
      more.classList.toggle('hidden', extra < 1);
      more.textContent = extra ? t('queueMore', { count: active.length }) : '';
    }
    const queueActions = jobPanelEl.querySelector('.tk-dl-job-panel-queue');
    queueActions?.classList.toggle('hidden', active.length < 1);
    const pauseAllBtn = queueActions?.querySelector('[data-bulk="pause-all"], [data-bulk="resume-all"]');
    if (pauseAllBtn) {
      const runnable = active.some((task) => task.status === 'downloading' || task.status === 'waiting');
      pauseAllBtn.dataset.bulk = runnable ? 'pause-all' : 'resume-all';
      pauseAllBtn.textContent = runnable ? t('pauseAll') : t('resumeAll');
    }
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
      creatorListCount = null;
      creatorResourceHint = null;
      creatorSelectionStatus = null;
      creatorBodyEl.replaceChildren();
      renderCreatorView(creatorBodyEl);
      refreshJobPanel().catch(() => {});
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
      cover: video.cover || '',
      pinIndex: Number.isFinite(Number(video.pinIndex)) ? Number(video.pinIndex) : -1
    };
  }

  function trimCreatorCache() {
    const ranked = Object.entries(creatorSaved).sort((a, b) => {
      const left = Number(a[1]?.touchedAt) || Number(a[1]?.lastScanAt) || 0;
      const right = Number(b[1]?.touchedAt) || Number(b[1]?.lastScanAt) || 0;
      return right - left;
    });
    ranked.slice(CREATOR_CACHE_LIMIT).forEach(([key]) => { delete creatorSaved[key]; });
  }

  function persistCreatorVideos() {
    clearTimeout(collectionSaveTimer);
    collectionSaveTimer = setTimeout(async () => {
      if (!creatorKey || creatorPersistenceBlocked || snapshot.kind !== 'creator') return;
      creatorSaved[creatorKey] = {
        creator: creator,
        lastScanAt,
        touchedAt: Date.now(),
        scanState: scanState === 'scanning' ? 'paused' : scanState,
        videos: [...creatorVideos.values()].slice(0, 5000).map(storedVideo)
      };
      trimCreatorCache();
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
    resourceResolveAt.clear();
    selectedIds.clear();
    const stored = await DownloaderKit.runtime.storageGet([CREATOR_KEY], EXT).catch(() => ({}));
    creatorSaved = stored?.[CREATOR_KEY] && typeof stored[CREATOR_KEY] === 'object' ? stored[CREATOR_KEY] : {};
    const entry = creatorSaved[key] && typeof creatorSaved[key] === 'object' ? creatorSaved[key] : null;
    if (snapshot.kind === 'creator') {
      creatorSaved[key] = {
        ...(entry || {}),
        creator: nextCreator || entry?.creator || null,
        touchedAt: Date.now(),
        videos: Array.isArray(entry?.videos) ? entry.videos : []
      };
      trimCreatorCache();
      await DownloaderKit.runtime.storageSet({ [CREATOR_KEY]: creatorSaved }, EXT).catch(() => {});
    }
    const saved = creatorSaved[key];
    if (Array.isArray(saved?.videos)) {
      saved.videos.forEach((video) => {
        if (video?.id) creatorVideos.set(String(video.id), { ...video, resources: [] });
      });
    }
    lastScanAt = Number(saved?.lastScanAt) || 0;
    scanState = saved?.scanState === 'paused' ? 'paused' : 'idle';
    updateCreatorStats();
    if (activeMode === 'creator') renderCreatorRows();
  }

  let videoInfoCache = [];
  let videoCacheTimer = 0;
  function videoCacheRecord(video) {
    return {
      id: String(video.id),
      pageUrl: video.pageUrl || '',
      title: video.title || '',
      description: video.description || '',
      author: video.author || '',
      authorId: video.authorId || '',
      duration: Number(video.duration) || 0,
      publishTime: video.publishTime || '',
      cover: video.cover || ''
    };
  }

  function rememberVideoInfo(video) {
    if (!video?.id || !/^\d+$/.test(String(video.id))) return;
    const record = videoCacheRecord(video);
    videoInfoCache = [record, ...videoInfoCache.filter((item) => item.id !== record.id)].slice(0, VIDEO_CACHE_LIMIT);
    clearTimeout(videoCacheTimer);
    videoCacheTimer = setTimeout(() => {
      DownloaderKit.runtime.storageSet({ [VIDEO_CACHE_KEY]: videoInfoCache }, EXT).catch(() => {});
    }, 200);
  }

  async function loadVideoInfoCache() {
    const stored = await DownloaderKit.runtime.storageGet([VIDEO_CACHE_KEY], EXT).catch(() => ({}));
    const list = Array.isArray(stored?.[VIDEO_CACHE_KEY]) ? stored[VIDEO_CACHE_KEY] : [];
    videoInfoCache = list.filter((item) => item?.id).slice(0, VIDEO_CACHE_LIMIT);
    if (!videoInfoCache.length) return;
    window.postMessage({
      source: 'tiktok-downloader-content',
      type: 'RESTORE_VIDEOS',
      videos: videoInfoCache
    }, location.origin);
  }

  function mergeCreatorVideos(videos) {
    let changed = false;
    (Array.isArray(videos) ? videos : []).forEach((video) => {
      if (!video?.id || !/^\d+$/.test(String(video.id))) return;
      const id = String(video.id);
      const previous = creatorVideos.get(id) || {};
      const title = !creatorTitleLooksBad(video.title) ? String(video.title)
        : !creatorTitleLooksBad(previous.title) ? String(previous.title) : '';
      const description = !creatorTitleLooksBad(video.description) ? String(video.description)
        : !creatorTitleLooksBad(previous.description) ? String(previous.description) : '';
      const resources = Array.isArray(video.resources) && video.resources.length ? video.resources : (previous.resources || []);
      const pinIndex = Number.isFinite(Number(video.pinIndex)) ? Number(video.pinIndex) : previous.pinIndex;
      const merged = {
        ...previous,
        ...video,
        id,
        title: title || description,
        description,
        resources,
        pinIndex,
        detailResolved: video.detailResolved === true || previous.detailResolved === true
      };
      if (JSON.stringify(merged) !== JSON.stringify(previous)) changed = true;
      creatorVideos.set(id, merged);
    });
    if (changed) {
      updateCreatorStats();
      persistCreatorVideos();
      if (activeMode === 'creator') queueCreatorRender();
    }
  }

  function creatorTitleLooksBad(value) {
    const title = String(value || '').trim();
    if (!title) return true;
    if (/^\d+(?:[.,]\d+)?\s*(?:[KMB]|万|亿)?$/i.test(title)) return true;
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
      if (/^(已置顶|置顶|pinned|固定|고정됨|고정)$/i.test(line)) continue;
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

  function videoCard(anchor) {
    let card = anchor;
    let node = anchor.parentElement;
    for (let i = 0; i < 8 && node; i += 1) {
      const ids = new Set();
      node.querySelectorAll('a[href*="/video/"]').forEach((link) => {
        const id = (link.getAttribute('href') || '').match(/\/video\/(\d+)/);
        if (id) ids.add(id[1]);
      });
      if (ids.size > 1) break;
      card = node;
      node = node.parentElement;
    }
    return card;
  }

  function cardLooksPinned(card) {
    if (!card?.querySelectorAll) return false;
    for (const label of card.querySelectorAll('span, div, p')) {
      const value = (label.textContent || '').replace(/\s+/g, '');
      if (!value || value.length > 12) continue;
      if (/(已置顶|^置顶$|^pinned$|^固定$|고정)/i.test(value)) return true;
    }
    return false;
  }

  function scanDomCreatorVideos() {
    if (!creatorPageAvailable()) return;
    const found = [];
    const seen = new Set();
    let pinIndex = 0;
    document.querySelectorAll('a[href*="/video/"]').forEach((anchor) => {
      let url;
      try { url = new URL(anchor.href, location.href); } catch (_) { return; }
      const match = url.pathname.match(/\/@([^/]+)\/video\/(\d+)/i);
      if (!match || anchor.closest('#tiktok-dl-root, #tiktok-dl-panel, .dl-kit')) return;
      const id = match[2];
      if (seen.has(id)) return;
      seen.add(id);
      const existing = creatorVideos.get(id);
      const card = videoCard(anchor);
      const image = anchor.querySelector('img') || card.querySelector('img');
      const picked = pickCreatorDomTitle(anchor, card, image);
      const rawTitle = picked || existing?.title || existing?.description || '';
      const title = creatorTitleLooksBad(rawTitle) && !creatorTitleLooksBad(existing?.title)
        ? String(existing.title).slice(0, 500)
        : String(rawTitle).slice(0, 500);
      const creatorMatch = url.pathname.match(/^\/@([^/]+)/);
      const pinned = cardLooksPinned(card) || cardLooksPinned(anchor);
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
      if (pinned) {
        item.pinIndex = pinIndex;
        pinIndex += 1;
      }
      found.push(item);
    });
    if (found.length) mergeCreatorVideos(found);
  }

  const resourceResolveAt = new Set();
  let resourceResolveEpoch = 0;
  let resourceResolveBusy = false;
  let lastPendingResources = 0;
  function syncResourceHint(pending) {
    lastPendingResources = pending;
    if (!creatorResourceHint) return;
    const show = resourceResolveBusy && pending > 0;
    creatorResourceHint.classList.toggle('hidden', !show);
    creatorResourceHint.textContent = show ? t('resourcePending', { count: pending }) : '';
  }
  function requestMissingResources() {
    if (!creatorPageAvailable()) return;
    const missing = [];
    creatorVideos.forEach((video, id) => {
      if (hasDownloadableVideo(video) && (!creatorTitleLooksBad(video.title) || video.detailResolved === true)) return;
      const pageUrl = video.pageUrl || ('https://www.tiktok.com/@' + encodeURIComponent(creator?.username || '') + '/video/' + id);
      if (!pageUrl) return;
      if (resourceResolveAt.has(id)) return;
      resourceResolveAt.add(id);
      missing.push({ id, pageUrl });
    });
    if (!missing.length) return;
    resourceResolveEpoch += 1;
    resourceResolveBusy = true;
    syncResourceHint(lastPendingResources);
    const epoch = resourceResolveEpoch;
    for (let index = 0; index < missing.length; index += 30) {
      window.postMessage({
        source: 'tiktok-downloader-content',
        type: 'RESOLVE_VIDEOS',
        epoch,
        videos: missing.slice(index, index + 30)
      }, location.origin);
    }
  }

  function refreshCreatorAvatar() {
    if (activeMode !== 'creator') return;
    const url = safeHttpUrl(creator?.avatar) || pageProfileAvatar();
    if (!url) return;
    const placeholder = creatorBodyEl?.querySelector('.tk-avatar-placeholder');
    const current = creatorBodyEl?.querySelector('img.tk-avatar');
    if (current) {
      if (current.src !== url) current.src = url;
      return;
    }
    if (!placeholder) return;
    const image = document.createElement('img');
    image.className = 'tk-avatar';
    image.alt = '';
    image.addEventListener('error', () => {
      const fallback = pageProfileAvatar();
      if (fallback && image.src !== fallback) {
        image.src = fallback;
        return;
      }
      image.remove();
      placeholder.classList.remove('hidden');
    });
    image.src = url;
    placeholder.classList.add('hidden');
    placeholder.after(image);
  }

  function pageProfileAvatar() {
    const marked = document.querySelector('[data-e2e="user-avatar"] img, [data-e2e="user-avatar"]');
    const markedImage = marked?.tagName === 'IMG' ? marked : marked?.querySelector('img');
    const markedUrl = safeHttpUrl(markedImage?.currentSrc || markedImage?.src);
    if (markedUrl) return markedUrl;
    for (const image of document.querySelectorAll('img')) {
      if (image.closest('#tiktok-dl-root, a[href*="/video/"]')) continue;
      const src = safeHttpUrl(image.currentSrc || image.src);
      if (!src || !/tiktokcdn|byteimg|muscdn|ibyteimg|ttwstatic/i.test(src)) continue;
      const width = image.naturalWidth || image.width || 0;
      const height = image.naturalHeight || image.height || 0;
      if (width >= 48 && height >= 48 && Math.abs(width - height) <= Math.max(width, height) * 0.4) return src;
    }
    return '';
  }

  function renderCreatorGate(parent) {
    const profile = creator || snapshot.creator || null;
    const username = creatorUsername();
    const href = creatorProfileUrl(username);
    const card = node(parent, 'section', 'tk-empty-card tk-creator-gate');
    const displayName = String(profile?.displayName || username || '').trim();
    node(card, 'strong', '', t('creatorGateTitle'));
    node(card, 'p', '', username
      ? t('creatorGateDetail')
      : t('notCreatorPageDetail'));
    if (username) {
      node(card, 'p', 'tk-creator-gate-handle', displayName && displayName.toLowerCase() !== username.toLowerCase()
        ? displayName + ' · @' + username
        : '@' + username);
    }
    if (href) button(card, t('openCreatorPage'), 'tk-button tk-primary', openCreatorProfile);
  }

  function renderCreatorView(parent) {
    const profile = creator || snapshot.creator || null;
    if (profile && creatorCollectionId(profile) !== creatorKey) loadCreatorVideos(profile).catch(() => {});
    if (!creatorPageAvailable()) {
      renderCreatorGate(parent);
      return;
    }

    const summary = node(parent, 'section', 'tk-creator-summary');
    const main = node(summary, 'div', 'tk-creator-main');
    const avatarUrl = safeHttpUrl(profile?.avatar) || pageProfileAvatar();
    const avatarPh = node(main, 'div', 'tk-avatar tk-avatar-placeholder' + (avatarUrl ? ' hidden' : ''), (profile?.username || 'T').slice(0, 1).toUpperCase());
    if (avatarUrl) {
      const avatar = node(main, 'img', 'tk-avatar');
      avatar.alt = '';
      const fallback = pageProfileAvatar();
      avatar.addEventListener('error', () => {
        if (fallback && avatar.src !== fallback) {
          avatar.src = fallback;
          return;
        }
        avatar.remove();
        avatarPh.classList.remove('hidden');
      });
      avatar.src = avatarUrl;
    }
    const identity = node(main, 'div', 'tk-creator-identity');
    const username = String(profile?.username || '').trim();
    const displayName = String(profile?.displayName || '').trim();
    const normalizedDisplay = displayName.replace(/^@/, '').toLowerCase();
    const sameIdentity = username && displayName && normalizedDisplay === username.toLowerCase();
    if (sameIdentity) node(identity, 'strong', '', '@' + username);
    else {
      node(identity, 'strong', '', displayName || username || 'TikTok Creator');
      if (username) node(identity, 'span', 'tk-creator-handle', '@' + username);
    }
    creatorStats = node(identity, 'span', 'tk-count');
    const scanButton = button(summary, t('scanAll'), 'tk-button tk-primary tk-scan-btn');
    scanButton.addEventListener('click', () => {
      if (scanState === 'paused') resumeCreatorScan();
      else startCreatorScan().catch((error) => {
        scanState = 'failed';
        persistCreatorVideos();
        updateCreatorStats();
        setStatus(t('scanFailed', { error: error.message }), 'error');
      });
    });
    creatorScanButtons = { scanButton, summary };
    updateCreatorStats();
    const toolbar = node(parent, 'div', 'tk-list-toolbar');
    creatorListCount = node(toolbar, 'span', 'tk-list-count', '');
    creatorResourceHint = node(parent, 'p', 'tk-resource-hint hidden', '');
    const actions = node(toolbar, 'div', 'tk-list-actions');
    button(actions, t('selectAllShort'), 'tk-mini-button', () => {
      visibleCreatorVideos().forEach((video) => selectedIds.add(video.id));
      renderCreatorRows();
    });
    button(actions, t('selectNewShort'), 'tk-mini-button', async () => {
      const [history, queued] = await Promise.all([getHistory().catch(() => []), getTasks().catch(() => [])]);
      const done = completedCreatorVideos(history, queued);
      visibleCreatorVideos().forEach((video) => { if (!done.has(video.id)) selectedIds.add(video.id); });
      renderCreatorRows();
    });
    button(actions, t('clearShort'), 'tk-mini-button', () => { selectedIds.clear(); renderCreatorRows(); });
    creatorRows = node(parent, 'div', 'tk-creator-list');
    const selectionBar = node(parent, 'div', 'tk-selection-bar');
    creatorSelectionStatus = node(selectionBar, 'span', '', t('selectedCount', { count: 0 }));
    const addSelected = button(selectionBar, t('addToQueue'), 'tk-button tk-primary');
    addSelected.addEventListener('click', () => enqueueCreatorSelection().catch((error) => setStatus(error.message, 'error')));
    renderCreatorRows();
    updateScanButtons();
    requestMissingResources();
  }

  let creatorScanButtons = null;
  let creatorListCount = null;
  let creatorResourceHint = null;
  function creatorCountText(total) {
    return total > 0 || creatorVideos.size > 0
      ? t('listVideoCount', { count: total }) : t('notScanned').replace(/^\s*·\s*/, '');
  }

  function updateCreatorStats() {
    const total = [...creatorVideos.values()].filter((video) => mediaResources(video, 'video').length > 0).length;
    if (creatorStats) {
      creatorStats.textContent = total > 0 || creatorVideos.size > 0
        ? t('creatorStatsShort', { state: scanStateLabel(scanState), count: total })
        : scanStateLabel(scanState) + ' · ' + t('notScanned').replace(/^\s*·\s*/, '');
    }
    if (creatorListCount) creatorListCount.textContent = creatorCountText(total);
    updateScanButtons();
  }

  function scanUsesPrimaryButton() {
    return creatorVideos.size === 0 && scanState !== 'scanning' && scanState !== 'paused';
  }

  function updateScanButtons() {
    const scanButton = creatorScanButtons?.scanButton;
    if (!scanButton) return;
    const primary = scanUsesPrimaryButton();
    creatorScanButtons.summary?.classList.toggle('is-primary', primary);
    const active = scanState === 'scanning';
    scanButton.disabled = active;
    if (active) scanButton.textContent = t('scanScanning');
    else if (scanState === 'paused') scanButton.textContent = t('continueScan');
    else if (primary) scanButton.textContent = t('scanAll');
    else scanButton.textContent = t('rescan');
  }

  async function startCreatorScan() {
    if (!creatorPageAvailable()) throw new Error(t('openCreatorFirst'));
    if (creatorCollectionId(snapshot.creator) !== creatorKey) await loadCreatorVideos(snapshot.creator);
    creatorPersistenceBlocked = false;
    creatorDataCleared = false;
    scanStopRequested = false;
    scanPaused = false;
    scanState = 'scanning';
    resourceResolveAt.clear();
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
      if (scanState === 'completed') requestMissingResources();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
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

  let scanPromise = null;
  const startScan = startCreatorScan;
  startCreatorScan = async function wrappedStartCreatorScan() {
    if (scanPromise) return scanPromise;
    scanPromise = startScan();
    try { return await scanPromise; }
    finally { scanPromise = null; }
  };

  let visibleVideosCache = [];
  function visibleCreatorVideos() { return visibleVideosCache; }

  let creatorRenderTimer = 0;
  function queueCreatorRender() {
    clearTimeout(creatorRenderTimer);
    creatorRenderTimer = setTimeout(renderCreatorRows, 200);
  }

  let creatorRenderVersion = 0;
  function latestCreatorVideoTasks(history, queued) {
    const latest = new Map();
    [...history, ...queued].filter((item) => item.type === 'video' && item.videoId).forEach((item) => {
      const previous = latest.get(item.videoId);
      const time = Number(item.updatedAt || item.time || item.createdAt || 0);
      const previousTime = Number(previous?.updatedAt || previous?.time || previous?.createdAt || 0);
      if (!previous || time >= previousTime) latest.set(item.videoId, item);
    });
    return latest;
  }

  function completedCreatorVideos(history, queued) {
    return new Set([...latestCreatorVideoTasks(history, queued)]
      .filter(([, item]) => item.status === 'completed').map(([videoId]) => videoId));
  }

  function renderCreatorRows() {
    if (!creatorRows) return;
    const version = ++creatorRenderVersion;
    Promise.all([getHistory().catch(() => []), getTasks().catch(() => [])]).then(([history, queued]) => {
      if (!creatorRows?.isConnected || version !== creatorRenderVersion) return;
      const latestByVideo = latestCreatorVideoTasks(history, queued);
      const all = [...creatorVideos.values()].sort((a, b) => {
        const pa = Number(a.pinIndex);
        const pb = Number(b.pinIndex);
        const aPinned = Number.isFinite(pa) && pa >= 0;
        const bPinned = Number.isFinite(pb) && pb >= 0;
        if (aPinned && bPinned && pa !== pb) return pa - pb;
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        const da = new Date(a.publishTime || 0).getTime() || 0;
        const db = new Date(b.publishTime || 0).getTime() || 0;
        return db - da;
      });
      const visible = all.filter((video) => mediaResources(video, 'video').length > 0);
      const availableIds = new Set(visible.map((video) => video.id));
      selectedIds.forEach((id) => { if (!availableIds.has(id)) selectedIds.delete(id); });
      visibleVideosCache = visible;
      if (creatorStats) {
        creatorStats.textContent = visible.length > 0 || all.length > 0
          ? t('creatorStatsShort', { state: scanStateLabel(scanState), count: visible.length })
          : scanStateLabel(scanState) + ' · ' + t('notScanned');
      }
      creatorRows.replaceChildren();
      const pendingResources = all.filter((video) => !hasDownloadableVideo(video)).length;
      syncResourceHint(pendingResources);
      if (!visible.length) {
        node(creatorRows, 'p', 'tk-empty-inline', all.length ? t('noDownloadableVideos') : t('scanToSee'));
      }
      visible.forEach((video) => {
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
        const coverSlot = node(row, 'div', 'tk-creator-cover-slot');
        const coverUrl = safeHttpUrl(video.cover);
        const coverPh = node(coverSlot, 'div', 'tk-creator-cover tk-creator-cover-ph' + (coverUrl ? ' hidden' : ''));
        if (coverUrl) {
          const image = node(coverSlot, 'img', 'tk-creator-cover');
          image.alt = '';
          image.loading = 'lazy';
          image.referrerPolicy = 'no-referrer';
          image.addEventListener('error', () => {
            image.remove();
            coverPh.classList.remove('hidden');
          }, { once: true });
          image.src = coverUrl;
        }
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
        const latest = latestByVideo.get(video.id);
        const activeStatus = latest && ['waiting', 'downloading', 'paused'].includes(latest.status) ? latest.status : '';
        const latestFailed = latest?.status === 'failed';
        const downloaded = latest?.status === 'completed';
        const canSave = hasDownloadableVideo(video);
        const pillKind = activeStatus ? 'pending' : latestFailed ? 'failed' : downloaded ? 'done' : canSave ? 'ready' : 'pending';
        const pillText = activeStatus ? taskStatusLabel({ status: activeStatus })
          : latestFailed ? t('statusFailed')
            : downloaded ? t('statusDownloaded')
              : canSave ? t('canDownload') : t('waitResource');
        node(footer, 'span', 'tk-status-pill ' + pillKind, pillText);
      });
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
      ['en', t('english')],
      ['zh-CN', t('chinese')]
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      languageSelect.appendChild(option);
    });
    languageSelect.value = DownloaderKit.i18n?.language?.() || 'en';
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
      rememberVideoInfo(item);
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
    else if (activeMode === 'creator') {
      updateCreatorStats();
      refreshCreatorAvatar();
      requestMissingResources();
    }
    publishPopupInfo();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source === SOURCE && event.data?.type === 'SNAPSHOT') {
      pageAgentVersion = Number(event.data.version) || 0;
      onPageSnapshot(event.data.payload).catch((error) => console.error('[TikTokDL] snapshot failed', error));
    }
    if (event.data?.source === SOURCE && event.data?.type === 'RESOLVE_IDLE') {
      if (Number(event.data.epoch) !== resourceResolveEpoch) return;
      resourceResolveBusy = false;
      syncResourceHint(lastPendingResources);
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
        refreshJobPanel().catch(() => {});
        if (activeMode === 'creator' && kind !== 'progress') renderCreatorRows();
      }, kind === 'progress' ? 900 : 350);
      return false;
    }
    return undefined;
  });

  let completionNotesReady = false;
  async function refreshCompletionNotes() {
    const [history, queued] = await Promise.all([getHistory().catch(() => []), getTasks().catch(() => [])]);
    const completedItems = [...queued, ...history].filter((item) => item.status === 'completed');
    const completed = new Set(completedItems.map((item) => item.id));
    if (completionNotesReady) {
      const fresh = completedItems.find((item) => !knownCompletedIds.has(item.id) && taskQueue(item) === currentQueue());
      if (fresh) {
        shell.noteSuccess();
        showSavedStatus(fresh);
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
  loadVideoInfoCache().catch(() => {});
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
