(function bootTikTokDownloader() {
  'use strict';

  const EXT = DownloaderKit.runtime.getApi();
  const PREFS_KEY = 'tiktok-dl-settings-v1';
  const CREATOR_KEY = 'tiktok-dl-creators-v1';
  const DEFAULT_PREFS = {
    defaultQuality: 'highest',
    defaultFormat: 'mp4',
    maxConcurrentDownloads: 2,
    filenameTemplate: '{author} - {title}',
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
        enabled: true,
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
    <div class="tk-dl-mode-tabs hidden" role="tablist" aria-label="下载模式">
      <button type="button" data-mode="video" class="active" role="tab" aria-selected="true">单视频</button>
      <button type="button" data-mode="creator" role="tab" aria-selected="false">创作者</button>
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
          <button type="button" class="tk-dl-cover-download" disabled>下载封面</button>
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
      <div class="tk-dl-section">
        <div class="tk-dl-section-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          清晰度
        </div>
        <div class="tk-dl-quality-pills"><span class="tk-dl-pill loading">加载中</span></div>
      </div>
      <div class="tk-dl-format-row tk-dl-section">
        <div class="tk-dl-section-head tk-dl-format-label">格式</div>
        <div class="tk-dl-format-pills">
          <button type="button" class="tk-dl-pill active" data-format="mp4" aria-pressed="true">MP4 视频</button>
          <button type="button" class="tk-dl-pill hidden" data-format="m4a" aria-pressed="false">M4A 音频</button>
        </div>
      </div>
      <p class="tk-dl-filename-preview" aria-live="polite">文件名预览会在识别视频后显示</p>
      <div class="tk-dl-estimate hidden">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
        <span class="tk-dl-estimate-text">预计大小 —</span>
      </div>
      <button type="button" class="tk-dl-btn tk-dl-start" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
        <span class="tk-dl-start-label">开始下载</span>
      </button>
      <div class="tk-dl-job-panel hidden">
        <div class="tk-dl-job-list"></div>
        <div class="tk-dl-job-panel-queue hidden">
          <button type="button" class="tk-dl-action-btn" data-bulk="pause-all">暂停全部</button>
          <button type="button" class="tk-dl-action-btn danger" data-bulk="cancel-waiting">取消等待</button>
        </div>
      </div>
      <details class="tk-dl-debug">
        <summary>调试日志</summary>
        <div class="tk-dl-debug-actions">
          <button type="button" class="tk-dl-debug-copy">复制日志</button>
          <button type="button" class="tk-dl-debug-clear">清空</button>
        </div>
        <pre class="tk-dl-debug-log">等待下载操作…</pre>
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
  appStatus = node(ui, 'div', 'tk-status');
  appStatus.setAttribute('role', 'status');
  appStatus.setAttribute('aria-live', 'polite');

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

  function setStatus(message, kind) {
    if (!appStatus) return;
    appStatus.textContent = message || '';
    appStatus.dataset.kind = kind || 'info';
    appStatus.hidden = !message;
    if (message) {
      clearTimeout(setStatus.timer);
      setStatus.timer = setTimeout(() => {
        if (appStatus) appStatus.hidden = true;
      }, 5000);
    }
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
    if (result?.ok === false) throw new Error(result.error || '操作失败');
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

  function resourceLabel(resource) {
    const codec = String(resource?.codec || '');
    const codecLabel = /265|hevc/i.test(codec) ? 'HEVC' : /264|avc/i.test(codec) ? 'H.264' : '';
    return [resource?.quality || '原始资源', codecLabel || resource?.source || ''].filter(Boolean).join(' · ');
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
    const text = debugLines.join('\n') || '暂无日志';
    try {
      await navigator.clipboard.writeText(text);
      panelDebug('日志已复制');
    } catch (error) {
      panelDebug('复制失败：' + (error?.message || error));
    }
  });
  ui.querySelector('.tk-dl-debug-clear')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    debugLines.length = 0;
    if (debugLogEl) debugLogEl.textContent = '日志已清空';
  });

  function qualityPillLabel(resource) {
    const height = Number(resource?.height) || 0;
    const codec = String(resource?.codec || '');
    const codecLabel = /265|hevc|hvc/i.test(codec) ? 'HEVC' : /264|avc/i.test(codec) ? 'H.264' : '';
    const base = height ? height + 'P' : '';
    return [base, codecLabel].filter(Boolean).join(' ') || '视频';
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
      title: video.title || 'TikTok video',
      author: video.author || video.authorId || 'TikTok',
      id: video.id || '',
      video_id: video.id || '',
      date: (video.publishTime || new Date().toISOString()).slice(0, 10),
      quality: quality || '原始资源',
      resolution: quality || '原始资源'
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
    if (!video?.id) throw new Error('未读取到视频 ID');
    let url = '';
    let backupUrls = [];
    let quality = '';
    let format = '';
    if (type === 'cover') {
      url = safeMediaUrl(video.cover);
      format = imageExtension(url);
      quality = '封面';
    } else {
      if (type === 'audio' && !isValidAudioResource(resource, video)) {
        throw new Error('当前页面没有可单独下载的音频。TikTok 未提供独立音轨时，请下载视频。');
      }
      url = safeMediaUrl(resource?.url);
      backupUrls = (Array.isArray(resource?.backupUrls) ? resource.backupUrls : [])
        .map(safeMediaUrl).filter((candidate) => candidate && candidate !== url);
      quality = resource?.quality || '原始资源';
      format = type === 'video' ? 'mp4' : audioExtension(resource);
    }
    if (!url) throw new Error(type === 'cover' ? '当前视频没有可用封面' : '当前页面没有识别到可下载资源');

    const duplicate = await isSuccessfulDuplicate(video, type);
    let forceDuplicate = false;
    if (duplicate) {
      if (opts.batch && prefs.skipDownloaded) return { skipped: true };
      const date = formatDate(duplicate.time) || '之前';
      if (!window.confirm('该' + (type === 'cover' ? '封面' : '视频') + '已于 ' + date + ' 保存。仍然下载吗？')) return { skipped: true };
      forceDuplicate = true;
    }

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
      setStatus('已加入下载队列：' + filename, 'success');
      refreshJobPanel().catch(() => {});
      return { added: true };
    }
    if (result.skipped) {
      setStatus('该任务已在队列中，或下载地址已失效。请重新打开视频识别后再试。', 'warn');
      return { skipped: true };
    }
    throw new Error('没有任务进入下载队列');
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
        quality: resource.quality || '原始资源',
        format: 'mp4',
        filename: '',
        coverUrl: safeHttpUrl(video.cover),
        recordHistory: prefs.recordHistory,
        forceDuplicate: !prefs.skipDownloaded && done.has(id)
      });
    });
    for (const task of tasks) task.filename = await taskFilename(creatorVideos.get(task.videoId), task.quality, 'mp4');
    if (!tasks.length) {
      setStatus(missing ? '已选视频尚未提供可用资源，请继续扫描或打开视频页识别。' : '没有可加入队列的视频。', 'warn');
      return;
    }
    const result = await send('TIKTOK_DL_QUEUE_ADD', { tasks });
    const notes = [];
    if (result.added) notes.push('已加入 ' + result.added + ' 个任务');
    if (already) notes.push('跳过已下载 ' + already + ' 个');
    if (missing) notes.push('缺少可用资源 ' + missing + ' 个');
    if (result.skipped) notes.push('队列去重 ' + result.skipped + ' 个');
    setStatus(notes.join(' · ') || '没有新增任务', result.added ? 'success' : 'warn');
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
      const empty = node(pillsEl, 'span', 'tk-dl-pill disabled', selectedFormat === 'm4a' ? '无独立音频' : '无可用清晰度');
      empty.textContent = selectedFormat === 'm4a' ? '无独立音频' : '无可用清晰度';
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
      estimateTextEl.textContent = '预计大小 —';
      return;
    }
    estimateEl.classList.remove('hidden');
    const sizeLabel = resource.sizeBytes
      ? formatBytes(resource.sizeBytes)
      : (resource.estimatedBytes ? formatBytes(resource.estimatedBytes) : '');
    estimateTextEl.textContent = sizeLabel ? '预计大小 约 ' + sizeLabel + ' · 仅供参考' : '预计大小 未知 · 仅供参考';
  }

  function updateFilenamePreview(video, resource) {
    if (!filenamePreviewEl || !video) return;
    const format = selectedFormat === 'm4a' ? 'm4a' : 'mp4';
    const quality = resource?.quality || '原始资源';
    filenamePreviewEl.textContent = '文件名预览加载中…';
    taskFilename(video, quality, format).then((name) => {
      if (!filenamePreviewEl.isConnected) return;
      filenamePreviewEl.replaceChildren();
      node(filenamePreviewEl, 'span', 'tk-dl-filename-preview-label', '保存为：');
      const nameEl = node(filenamePreviewEl, 'span', 'tk-dl-filename-preview-name', name);
      nameEl.title = name;
    }).catch(() => {
      if (filenamePreviewEl.isConnected) filenamePreviewEl.textContent = '文件名预览暂不可用';
    });
  }

  function recognitionCopy() {
    if (snapshot.kind === 'creator') return ['当前是创作者主页', '切换到「创作者」扫描公开作品。'];
    if (snapshot.kind === 'photo' || snapshot.reason === 'photo') return ['当前是图文', '图文没有可下载的视频文件。'];
    if (snapshot.reason === 'parse-error') return ['页面解析失败', '刷新这个 TikTok 页面后再打开面板。'];
    if (snapshot.reason === 'no-player') return ['没有识别到正在播放的视频', '打开视频详情页，或等画面开始播放。'];
    if (snapshot.reason === 'no-matching-item') return ['没有对上当前视频', '打开视频详情页后会显示可下载资源。'];
    return ['等待识别 TikTok 视频', '播放或打开视频详情页后，这里会显示可下载资源。'];
  }

  function updateVideoDownloadState() {
    const video = currentVideo();
    if (!video) {
      if (pillsEl) {
        pillsEl.replaceChildren();
        node(pillsEl, 'span', 'tk-dl-pill loading', '加载中');
      }
      syncFormatPills();
      if (startBtnEl) startBtnEl.disabled = true;
      if (estimateEl) estimateEl.classList.add('hidden');
      if (filenamePreviewEl) filenamePreviewEl.textContent = '文件名预览会在识别视频后显示';
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
      if (startLabelEl) startLabelEl.textContent = audio.length ? '开始下载' : '无独立音频';
      return;
    }
    renderQualityPills(video, videos);
    const resourceSummary = '视频选项 ' + videos.length + ' 个；' + videos.map((item) => ((item.mergedHeights || [item.height]).filter(Boolean).join('/') || '?') + 'P 备用' + ((item.backupUrls || []).length)).join('，');
    if (resourceSummary !== panelDebug.last) {
      panelDebug.last = resourceSummary;
      panelDebug(resourceSummary);
    }
    const resource = videos.find((item) => item.url === selectedResources.get(video?.id)) || pickResource(video, videos);
    updateEstimate(resource);
    updateFilenamePreview(video, resource);
    if (startBtnEl) startBtnEl.disabled = !videos.length;
    if (startLabelEl) startLabelEl.textContent = videos.length ? '开始下载' : '无可用视频';
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
    if (titleEl) titleEl.textContent = video.title || 'TikTok 视频';
    const authorName = creator?.username || video.author || '';
    if (authorEl) {
      authorEl.textContent = authorName ? '@' + authorName : '';
      authorEl.classList.toggle('hidden', !authorName);
    }
    const metadata = [];
    if (video.duration) metadata.push(formatDuration(video.duration));
    if (video.publishTime) metadata.push(formatDate(video.publishTime));
    if (subEl) {
      subEl.textContent = metadata.join(' · ');
      subEl.title = video.id ? 'ID ' + video.id : '';
    }
    if (cardEl) cardEl.title = video.id ? 'ID ' + video.id : '';
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

  async function refreshJobPanel() {
    if (!jobPanelEl || !jobListEl) return;
    const listed = await getTasks().catch(() => []);
    const active = (Array.isArray(listed) ? listed : []).filter((task) => ['waiting', 'downloading', 'paused'].includes(task.status));
    const justFinished = (Array.isArray(listed) ? listed : []).filter((task) => shownJobIds.has(task.id) && task.status === 'completed');
    if (justFinished.length) setStatus('下载完成', 'success');
    const tasks = active.length ? active : justFinished.slice(0, 1);
    jobPanelEl.classList.toggle('hidden', !tasks.length);
    jobPanelEl.querySelector('.tk-dl-job-panel-queue')?.classList.toggle('hidden', active.length < 2);
    shownJobIds = new Set(active.map((task) => task.id));
    clearTimeout(jobWatchTimer);
    if (active.length) jobWatchTimer = setTimeout(() => { refreshJobPanel().catch(() => {}); }, 1200);
    else if (justFinished.length) jobWatchTimer = setTimeout(() => { refreshJobPanel().catch(() => {}); }, 2200);
    jobListEl.replaceChildren();
    tasks.slice(0, 3).forEach((task) => {
      const received = Number(task.bytesReceived) || 0;
      const total = Number(task.totalBytes) || 0;
      const pct = task.status === 'completed'
        ? 100
        : (total > 0 ? Math.min(100, Math.round(received * 100 / total)) : Math.max(0, Math.min(100, Number(task.progress) || 0)));
      const known = task.status === 'completed' || total > 0 || pct > 0;
      const row = node(jobListEl, 'div', 'tk-dl-progress');
      const meta = node(row, 'div', 'tk-dl-progress-meta');
      const title = node(meta, 'span', 'tk-dl-progress-title', task.title || task.filename || '下载任务');
      title.title = task.filename || task.title || '';
      const quality = task.format === 'm4a' ? 'M4A 音频' : (task.quality || '视频');
      node(meta, 'span', 'tk-dl-progress-q', quality);
      const head = node(row, 'div', 'tk-dl-progress-head');
      node(head, 'span', 'tk-dl-job-phase', taskStatusLabel(task));
      const pctEl = node(head, 'span', 'tk-dl-job-pct', known ? pct + '%' : '');
      pctEl.classList.toggle('hidden', !known);
      const subText = total > 0
        ? formatBytes(received) + ' / ' + formatBytes(total)
        : (received ? formatBytes(received) : '');
      const sub = node(row, 'div', 'tk-dl-progress-sub' + (subText ? '' : ' hidden'), subText);
      if (task.filename) sub.title = task.filename;
      const track = node(row, 'div', 'tk-dl-progress-track');
      const bar = node(track, 'div', 'tk-dl-progress-bar' + (known ? '' : ' indeterminate') + (task.status === 'paused' ? ' paused' : ''));
      bar.style.width = (known ? pct : 35) + '%';
      const actions = node(row, 'div', 'tk-dl-progress-actions' + (task.status === 'completed' ? ' hidden' : ''));
      if (task.status !== 'completed') taskActions(task).forEach(([action, label]) => {
        if (!['pause', 'resume', 'cancel'].includes(action)) return;
        const actionBtn = button(actions, label, 'tk-dl-action-btn', () => {
          controlTask(task.id, action).then(() => refreshJobPanel()).catch((error) => setStatus(error.message, 'error'));
        });
        if (action === 'cancel') actionBtn.classList.add('danger');
      });
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
      const title = anchor.getAttribute('title') || anchor.getAttribute('aria-label') || image?.alt || (card.innerText || '').trim().split('\n').filter(Boolean)[0] || '';
      const creatorMatch = url.pathname.match(/^\/@([^/]+)/);
      const item = {
        id,
        pageUrl: url.href,
        title: String(title).slice(0, 500),
        description: String(title).slice(0, 500),
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
      node(empty, 'strong', '', '当前页面不是创作者主页');
      node(empty, 'p', '', '打开 TikTok 创作者主页后，可扫描当前账号公开展示的作品。');
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
    node(identity, 'span', '', '@' + (profile?.username || ''));
    creatorStats = node(summary, 'span', 'tk-count');
    const scanControls = node(parent, 'div', 'tk-scan-controls');
    const scanButton = button(scanControls, '扫描全部视频', 'tk-button tk-primary');
    const pauseButton = button(scanControls, '暂停', 'tk-button');
    const stopButton = button(scanControls, '停止', 'tk-button tk-danger');
    scanButton.addEventListener('click', () => {
      if (scanState === 'paused') resumeCreatorScan();
      else startCreatorScan().catch((error) => {
        scanState = 'failed';
        persistCreatorVideos();
        updateCreatorStats();
        setStatus('扫描失败：' + error.message, 'error');
      });
    });
    pauseButton.addEventListener('click', () => pauseCreatorScan());
    stopButton.addEventListener('click', () => stopCreatorScan());
    creatorScanButtons = { scanButton, pauseButton, stopButton };
    updateCreatorStats();
    const filters = node(parent, 'div', 'tk-filter-row');
    const search = node(filters, 'input', 'tk-input');
    search.type = 'search';
    search.placeholder = '搜索标题或描述';
    search.value = creatorSearch;
    search.setAttribute('aria-label', '搜索创作者视频');
    search.addEventListener('input', () => { creatorSearch = search.value; renderCreatorRows(); });
    const status = node(filters, 'select', 'tk-select tk-filter');
    status.setAttribute('aria-label', '下载状态筛选');
    [
      ['all', '全部状态'],
      ['new', '未下载'],
      ['downloaded', '已下载'],
      ['failed', '下载失败']
    ].forEach(([value, label]) => {
      const option = node(status, 'option', '', label);
      option.value = value;
    });
    status.value = creatorStatusFilter;
    status.addEventListener('change', () => { creatorStatusFilter = status.value; renderCreatorRows(); });
    const date = node(filters, 'select', 'tk-select tk-filter');
    date.setAttribute('aria-label', '发布时间筛选');
    [['all', '全部时间'], ['7', '最近 7 天'], ['30', '最近 30 天'], ['90', '最近 90 天']].forEach(([value, label]) => {
      const option = node(date, 'option', '', label);
      option.value = value;
    });
    date.value = creatorDateFilter;
    date.addEventListener('change', () => { creatorDateFilter = date.value; renderCreatorRows(); });
    const actions = node(parent, 'div', 'tk-list-actions');
    const selectAll = button(actions, '全选当前结果', 'tk-mini-button', () => {
      visibleCreatorVideos().forEach((video) => selectedIds.add(video.id));
      renderCreatorRows();
    });
    const selectNew = button(actions, '只选未下载', 'tk-mini-button', async () => {
      const history = await getHistory().catch(() => []);
      const done = new Set(history.filter((item) => item.status === 'completed' && item.type === 'video').map((item) => item.videoId));
      visibleCreatorVideos().forEach((video) => { if (!done.has(video.id)) selectedIds.add(video.id); });
      renderCreatorRows();
    });
    button(actions, '取消选择', 'tk-mini-button', () => { selectedIds.clear(); renderCreatorRows(); });
    creatorRows = node(parent, 'div', 'tk-creator-list');
    const selectionBar = node(parent, 'div', 'tk-selection-bar');
    creatorSelectionStatus = node(selectionBar, 'span', '', '已选择 0 个视频');
    const addSelected = button(selectionBar, '加入下载队列', 'tk-button tk-primary');
    addSelected.addEventListener('click', () => enqueueCreatorSelection().catch((error) => setStatus(error.message, 'error')));
    renderCreatorRows();
    updateScanButtons();
  }

  let creatorScanButtons = null;
  function updateCreatorStats() {
    if (!creatorStats) return;
    const total = creatorVideos.size;
    const downloadCount = total > 0 ? ' · ' + total + ' 个视频' : ' · 尚未扫描';
    const stateLabel = {
      idle: '准备就绪',
      scanning: '正在扫描',
      paused: '已暂停',
      completed: '扫描完成',
      failed: '扫描异常'
    }[scanState] || '准备就绪';
    creatorStats.textContent = stateLabel + downloadCount;
    updateScanButtons();
  }

  function updateScanButtons() {
    if (!creatorScanButtons) return;
    const active = scanState === 'scanning';
    creatorScanButtons.scanButton.textContent = scanState === 'paused' ? '继续扫描' : '扫描全部视频';
    creatorScanButtons.scanButton.disabled = active;
    creatorScanButtons.pauseButton.textContent = scanPaused || scanState === 'paused' ? '继续' : '暂停';
    creatorScanButtons.pauseButton.disabled = !active && scanState !== 'paused';
    creatorScanButtons.stopButton.disabled = !active && scanState !== 'paused';
  }

  async function startCreatorScan() {
    if (!creatorPageAvailable()) throw new Error('请先打开创作者主页');
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
      startCreatorScan().catch((error) => setStatus('扫描失败：' + error.message, 'error'));
      return;
    }
    updateCreatorStats();
  }

  function stopCreatorScan() {
    if (scanState === 'scanning' || scanState === 'paused') {
      scanStopRequested = true;
      scanPaused = false;
      setStatus('扫描已暂停，可继续扫描已加载作品。', 'info');
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
        const stateLabel = scanState === 'scanning' ? '正在扫描' : scanState === 'paused' ? '已暂停' : scanState === 'completed' ? '扫描完成' : scanState === 'failed' ? '扫描异常' : '准备就绪';
        creatorStats.textContent = stateLabel + ' · 共 ' + all.length + ' 个 · 已下载 ' + downloadedCount + ' 个 · 新增 ' + Math.max(0, all.length - downloadedCount) + ' 个';
      }
      creatorRows.replaceChildren();
      if (!visible.length) {
        node(creatorRows, 'p', 'tk-empty-inline', all.length ? '没有符合筛选条件的视频。' : '开始扫描后，这里会显示已发现的公开视频。');
      }
      visible.slice(0, 200).forEach((video) => {
        const row = node(creatorRows, 'article', 'tk-creator-item');
        const check = node(row, 'input', 'tk-checkbox');
        check.type = 'checkbox';
        check.checked = selectedIds.has(video.id);
        check.setAttribute('aria-label', '选择 ' + (video.title || video.id));
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
        node(body, 'strong', 'tk-creator-item-title', video.title || 'TikTok 视频 ' + video.id);
        const meta = [video.author ? '@' + video.author : '', formatDate(video.publishTime), video.duration ? formatDuration(video.duration) : ''].filter(Boolean).join(' · ');
        node(body, 'span', 'tk-creator-item-meta', meta || 'ID ' + video.id);
        const downloaded = done.has(video.id);
        const hasResource = mediaResources(video, 'video').length > 0;
        node(body, 'span', 'tk-status-pill ' + (downloaded ? 'done' : failed.has(video.id) ? 'failed' : hasResource ? 'ready' : 'pending'),
          downloaded ? '已下载' : failed.has(video.id) ? '下载失败' : hasResource ? '可下载' : '等待识别资源');
        const open = node(body, 'a', 'tk-link', '打开视频页');
        open.href = video.pageUrl || ('https://www.tiktok.com/@' + encodeURIComponent(creator?.username || '') + '/video/' + video.id);
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
      });
      if (visible.length > 200) node(creatorRows, 'p', 'tk-muted', '列表显示前 200 条；已保存总数 ' + all.length + ' 条。');
      updateSelectionLabel();
      updateCreatorStats();
    }).catch(() => {});
  }

  function updateSelectionLabel() {
    if (creatorSelectionStatus) creatorSelectionStatus.textContent = '已选择 ' + selectedIds.size + ' 个视频';
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function taskStatusLabel(task) {
    return ({
      waiting: '等待中',
      downloading: '下载中',
      paused: '已暂停',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消'
    })[task.status] || task.status || '未知';
  }

  function taskActions(task) {
    if (task.status === 'downloading') return [['pause', '暂停'], ['cancel', '取消']];
    if (task.status === 'paused') return [['resume', '继续'], ['cancel', '取消']];
    if (task.status === 'waiting') return [['cancel', '取消']];
    if (task.status === 'failed' || task.status === 'cancelled') return [['retry', '重试'], ['delete', '删除记录']];
    if (task.status === 'completed') return [['delete', '删除记录']];
    return [];
  }

  function renderTaskManager(parent, inSheet) {
    parent.replaceChildren();
    const top = node(parent, 'div', 'tk-task-toolbar');
    const bulk = [
      ['pause-all', '全部暂停'],
      ['resume-all', '全部继续'],
      ['cancel-waiting', '取消等待'],
      ['retry-failed', '重试失败'],
      ['clear-completed', '清除已完成']
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
    status.textContent = '正在读取任务…';
    getTasks().then((tasks) => {
      if (!list.isConnected) return;
      const active = tasks.filter((task) => ['waiting', 'downloading', 'paused'].includes(task.status)).length;
      const done = tasks.filter((task) => task.status === 'completed').length;
      const failed = tasks.filter((task) => task.status === 'failed').length;
      progress.textContent = '队列 ' + active + ' · 已完成 ' + done + ' · 失败 ' + failed;
      if (active) {
        const banner = node(parent, 'section', 'tk-recovery-banner');
        node(banner, 'strong', '', '检测到未完成下载任务');
        node(banner, 'span', '', '已完成 ' + done + ' / ' + tasks.length + '，还有 ' + active + ' 个等待、暂停或下载中的任务。');
        const recoveryActions = node(banner, 'div', 'tk-task-actions');
        button(recoveryActions, '继续下载', 'tk-mini-button tk-recovery-primary', async () => {
          await bulkTask('resume-all').catch((error) => setStatus(error.message, 'error'));
          renderTaskManager(parent, inSheet);
        });
        button(recoveryActions, '放弃未完成任务', 'tk-mini-button tk-danger-text', async () => {
          if (!window.confirm('取消所有等待中、下载中和已暂停的任务？')) return;
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
      status.textContent = tasks.length ? '' : '暂无下载任务';
      const ordered = [...tasks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const pageSize = 50;
      const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
      taskPage = Math.min(taskPage, pageCount - 1);
      const shown = ordered.slice(taskPage * pageSize, (taskPage + 1) * pageSize);
      shown.forEach((task) => {
        const row = node(list, 'article', 'tk-task-item');
        const header = node(row, 'div', 'tk-task-item-header');
        node(header, 'strong', 'tk-task-title', task.title || 'TikTok 视频');
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
        button(pageControls, '上一页', 'tk-mini-button', () => { taskPage = Math.max(0, taskPage - 1); renderTaskManager(parent, inSheet); }).disabled = taskPage === 0;
        node(pageControls, 'span', 'tk-muted', (taskPage + 1) + ' / ' + pageCount);
        button(pageControls, '下一页', 'tk-mini-button', () => { taskPage = Math.min(pageCount - 1, taskPage + 1); renderTaskManager(parent, inSheet); }).disabled = taskPage + 1 >= pageCount;
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
    search.placeholder = '搜索标题、创作者或视频 ID';
    search.value = historySearch;
    search.setAttribute('aria-label', '搜索下载历史');
    const range = node(toolbar, 'select', 'tk-select tk-filter');
    [['all', '全部时间'], ['today', '今天'], ['7', '最近 7 天'], ['30', '最近 30 天']].forEach(([value, label]) => {
      const option = node(range, 'option', '', label);
      option.value = value;
    });
    range.value = historyRange;
    const clear = button(toolbar, '清空历史', 'tk-mini-button tk-danger-text', async () => {
      if (!window.confirm('清空 TikTok 下载历史？')) return;
      await send('TIKTOK_DL_DATA_CLEAR', { scope: 'history' });
      renderHistoryRows();
      setStatus('下载历史已清空。', 'success');
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
        summary.textContent = '显示 ' + Math.min(200, filtered.length) + ' / ' + filtered.length + ' 条记录';
        if (!filtered.length) node(list, 'p', 'tk-empty-inline', '没有符合条件的下载记录。');
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
          node(body, 'strong', '', item.title || 'TikTok 视频');
          node(body, 'span', 'tk-history-meta', (item.author ? '@' + item.author + ' · ' : '') + (item.type || 'video') + ' · ' + formatDate(item.time));
          node(body, 'span', 'tk-status-pill ' + item.status, taskStatusLabel(item));
          const file = node(body, 'span', 'tk-history-file', item.filename || '');
          file.title = item.filename || '';
          if (item.pageUrl) {
            const link = node(body, 'a', 'tk-link', '重新打开视频页');
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
    'author-title': '{author} - {title}',
    title: '{title}',
    'title-id': '{title} - {id}',
    detailed: '{author} - {title} - {quality}'
  };
  const FILENAME_CHIPS = [
    ['title', '标题'],
    ['author', '作者'],
    ['id', '视频 ID'],
    ['quality', '清晰度'],
    ['date', '日期']
  ];

  function themeChoices() {
    const listed = shell.theme?.list?.() || [{ id: 'default', name: '默认' }];
    return listed.map((item) => ({
      id: item.id,
      name: item.id === 'default' ? 'TikTok主题' : item.name
    }));
  }

  function syncThemePicker(themeControl) {
    if (!themeControl) return;
    const currentId = shell.theme?.current?.() || 'default';
    const current = themeChoices().find((item) => item.id === currentId) || themeChoices()[0];
    const currentLabel = themeControl.querySelector('.tk-dl-settings-theme-current-label');
    const currentSwatch = themeControl.querySelector('.tk-dl-settings-theme-current-swatch');
    if (currentLabel) currentLabel.textContent = current?.name || 'TikTok主题';
    if (currentSwatch) currentSwatch.dataset.theme = currentId === 'default' ? 'tiktok' : currentId;
    themeControl.querySelectorAll('[data-theme-option]').forEach((option) => {
      option.setAttribute('aria-selected', String(option.dataset.themeOption === currentId));
    });
  }

  async function copyFeedbackEmail(email, button) {
    const label = button?.querySelector('.dl-kit-feedback-label') || button;
    const original = label?.textContent || '反馈';
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
      label.textContent = '已复制';
      button.classList.add('is-copied');
      setTimeout(() => {
        if (!button.isConnected) return;
        label.textContent = original;
        button.classList.remove('is-copied');
      }, 1600);
      return;
    }
    const link = document.createElement('a');
    link.href = 'mailto:' + email + '?subject=' + encodeURIComponent('TikTok 下载助手反馈');
    link.click();
  }

  function fillSettingsSheet(body) {
    body.replaceChildren();
    const root = document.createElement('div');
    root.className = 'tk-dl-settings';

    const themeRow = document.createElement('div');
    themeRow.className = 'tk-dl-settings-row';
    const themeRowLabel = document.createElement('span');
    themeRowLabel.textContent = '主题色';
    const themeControl = document.createElement('div');
    themeControl.className = 'tk-dl-settings-theme-control';
    const themeTrigger = document.createElement('button');
    themeTrigger.type = 'button';
    themeTrigger.className = 'tk-dl-settings-theme-trigger';
    themeTrigger.setAttribute('aria-label', '主题色');
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
          themeOptions.classList.add('hidden');
          themeTrigger.setAttribute('aria-expanded', 'false');
          try {
            await shell.theme.set(theme.id);
            syncThemePicker(themeControl);
            status.textContent = '主题已保存';
          } catch (error) {
            status.textContent = error?.message || '主题保存失败';
          }
        });
        themeOptions.appendChild(option);
      });
      syncThemePicker(themeControl);
    }
    renderThemeOptions();
    themeTrigger.addEventListener('click', () => {
      const isOpen = !themeOptions.classList.contains('hidden');
      themeOptions.classList.toggle('hidden', isOpen);
      themeTrigger.setAttribute('aria-expanded', String(!isOpen));
    });
    themeControl.append(themeTrigger, themeOptions);
    themeRow.append(themeRowLabel, themeControl);
    root.appendChild(themeRow);

    const presetRow = document.createElement('label');
    presetRow.className = 'tk-dl-settings-row';
    const presetLabel = document.createElement('span');
    presetLabel.textContent = '文件名';
    const preset = document.createElement('select');
    preset.className = 'tk-dl-settings-select';
    preset.setAttribute('aria-label', '文件名规则');
    [
      ['author-title', '默认（作者 + 标题）'],
      ['title', '仅标题'],
      ['title-id', '标题 + 视频 ID'],
      ['detailed', '作者 + 标题 + 清晰度'],
      ['custom', '自定义…']
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      preset.appendChild(option);
    });
    presetRow.append(presetLabel, preset);
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
    template.placeholder = '{author} - {title}';
    template.setAttribute('aria-label', '自定义文件名模板');
    customBlock.appendChild(template);
    const chips = document.createElement('div');
    chips.className = 'tk-dl-settings-chips';
    FILENAME_CHIPS.forEach(([key, label]) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tk-dl-settings-chip';
      chip.textContent = label;
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
    reset.textContent = '恢复默认文件名';
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
          title: '示例视频标题',
          author: '示例作者',
          id: '7600000000000000000',
          quality: '1080P'
        }, 'mp4');
        error.hidden = true;
        error.textContent = '';
        preview.textContent = '预览：' + name;
        return currentTemplate();
      } catch (err) {
        error.hidden = false;
        error.textContent = err.message || '模板无效';
        preview.textContent = '—';
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
        status.textContent = '模板无效';
        return;
      }
      try {
        await shell.settings.save(nextTemplate);
        if (activeMode === 'video') updateVideoDownloadState();
        status.textContent = showOk ? '已保存' : '';
      } catch (err) {
        status.textContent = err?.message || '保存失败';
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
        status.textContent = '已恢复默认';
      } catch (err) {
        status.textContent = err?.message || '恢复失败';
      }
    });
    shell.settings?.ready?.then(() => applyForm(shell.settings.current())).catch((err) => {
      status.textContent = err?.message || '加载失败';
    });
    shell.theme?.ready?.then(() => renderThemeOptions()).catch(() => {});
  }

  document.addEventListener('pointerdown', (event) => {
    const themeControl = document.querySelector('.tk-dl-settings-theme-control');
    if (!themeControl || themeControl.contains(event.target)) return;
    themeControl.querySelector('.tk-dl-settings-theme-options')?.classList.add('hidden');
    themeControl.querySelector('.tk-dl-settings-theme-trigger')?.setAttribute('aria-expanded', 'false');
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

  function popupInfo() {
    if (snapshot.kind === 'video' && snapshot.video) {
      const video = snapshot.video;
      const available = mediaResources(video, 'video');
      return {
        mode: 'video',
        title: video.title || 'TikTok 视频',
        author: video.author || '',
        cover: safeHttpUrl(video.cover),
        sub: (video.duration ? formatDuration(video.duration) + ' · ' : '') + (available.length ? '可用资源 ' + available.length + ' 个' : '尚未识别到视频资源'),
        resourceCount: available.length,
        id: video.id
      };
    }
    if (snapshot.kind === 'creator') {
      return {
        mode: 'creator',
        title: snapshot.creator?.displayName || snapshot.creator?.username || 'TikTok Creator',
        author: snapshot.creator?.username ? '@' + snapshot.creator.username : '',
        cover: safeHttpUrl(snapshot.creator?.avatar),
        sub: creatorVideos.size + ' 个已发现作品 · ' + (scanState === 'completed' ? '扫描完成' : '可开始扫描'),
        creatorCount: creatorVideos.size
      };
    }
    return null;
  }

  async function onPageSnapshot(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.url && payload.url !== location.href) return;
    if ((payload.reason === 'no-matching-item' || payload.reason === 'no-player') && snapshot.kind === 'video' && snapshot.video) return;
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
      ? '已识别视频 ' + snapshot.video.id
      : '未识别到视频：' + (snapshot.kind || 'unknown') + (snapshot.reason ? ' / ' + snapshot.reason : '');
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
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source === SOURCE && event.data?.type === 'SNAPSHOT') {
      pageAgentVersion = Number(event.data.version) || 0;
      onPageSnapshot(event.data.payload).catch((error) => console.error('[TikTokDL] 快照处理失败', error));
    }
  });
  window.addEventListener('popstate', () => {
    route = location.href;
    window.postMessage({ source: 'tiktok-downloader-content', type: 'GET_SNAPSHOT' }, location.origin);
  });

  EXT.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'TIKTOK_DL_GET_INFO') {
      const info = popupInfo();
      respond(info ? { ok: true, data: { info } } : { ok: false, error: '请打开 TikTok 视频或创作者主页。' });
      return false;
    }
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
    const completed = new Set(history.filter((item) => item.status === 'completed').map((item) => item.id));
    if (completionNotesReady) {
      completed.forEach((id) => {
        if (!knownCompletedIds.has(id)) shell.noteSuccess();
      });
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
    if (!current?.filenameTemplate) shell.settings.save(DEFAULT_PREFS.filenameTemplate).catch(() => {});
  });
  loadPrefs().then(() => renderView()).catch(() => {});
  refreshCompletionNotes().catch(() => {});
  activeMode = /^\/@[^/]+\/video\/\d+/i.test(location.pathname) ? 'video'
    : (/^\/@[^/]+\/?$/i.test(location.pathname) ? 'creator' : 'video');
  renderView();
  window.postMessage({ source: 'tiktok-downloader-content', type: 'GET_SNAPSHOT' }, location.origin);
})();
