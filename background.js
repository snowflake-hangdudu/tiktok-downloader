importScripts('shared/runtime.js', 'shared/i18n.js', 'shared/remote-content.js', 'shared/config-handler.js');

// The queue is deliberately self-contained: service workers can stop at any time,
// so the storage copy is always the source of truth.
const EXT = DownloaderKit.runtime.getApi();
const TASKS_KEY = 'tiktok-dl-tasks-v1';
const HISTORY_KEY = 'tiktok-dl-history-v1';
const SETTINGS_KEY = 'tiktok-dl-settings-v1';
const CONFIG_URL = 'http://124.222.62.190:8081/api/config/tiktok';
const CONFIG_MESSAGE = 'TIKTOK_DL_FETCH_JSON';
const ACTIVE = new Set(['waiting', 'downloading', 'paused']);
const FINISHED = new Set(['completed', 'failed', 'cancelled']);
let work = Promise.resolve();
let scheduling = false;
const pageInfoByTab = new Map();

function rememberPageInfo(tabId, url, info) {
  if (!Number.isInteger(tabId) || !info || typeof info !== 'object') return;
  pageInfoByTab.set(tabId, { url: String(url || ''), info, at: Date.now() });
}

EXT.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'TIKTOK_DL_PAGE_INFO') {
    rememberPageInfo(sender.tab?.id, message.url || sender.tab?.url, message.info);
    respond({ ok: true });
    return false;
  }
  if (message?.type === 'TIKTOK_DL_READ_PAGE_INFO') {
    const hit = pageInfoByTab.get(message.tabId);
    const fresh = Boolean(hit?.info) && Date.now() - Number(hit.at || 0) < 5 * 60 * 1000;
    respond(fresh ? { ok: true, info: hit.info, url: hit.url } : { ok: false });
    return false;
  }
  return undefined;
});

DownloaderKit.attachConfigHandler(EXT, {
  configUrl: CONFIG_URL,
  messageType: CONFIG_MESSAGE
});

function serial(task) {
  const next = work.then(task, task);
  work = next.catch(() => {});
  return next;
}

function requestSchedule() {
  serial(schedule).catch(() => {});
}

function now() { return Date.now(); }

async function t(key, values) {
  await DownloaderKit.i18n.ready;
  return DownloaderKit.i18n.t(key, values);
}

function text(value, limit) {
  return String(value || '').trim().slice(0, limit || 500);
}

function fileExtension(task) {
  const raw = String(task?.format || (task?.type === 'audio' ? 'm4a' : task?.type === 'cover' ? 'jpg' : 'mp4')).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(raw) ? raw : 'mp4';
}

function withExtension(name, ext) {
  const match = String(name || '').match(/\.([a-z0-9]{1,8})$/i);
  const fileExt = match ? match[1].toLowerCase() : ext;
  const base = (match ? String(name).slice(0, -match[0].length) : String(name || '')).replace(/[. ]+$/g, '');
  const room = Math.max(1, 180 - fileExt.length - 1);
  return (base.slice(0, room) || 'tiktok') + '.' + fileExt;
}

function safeFilename(value, task) {
  const ext = fileExtension(task);
  const fallback = `${text(task?.creatorId, 80) || 'tiktok'}-${text(task?.videoId, 120) || 'download'}.${ext}`;
  const raw = text(value, 240);
  if (!raw) return fallback;
  // Chrome accepts forward-slash relative folders. Validate every component so
  // creatorFolders can keep `TikTok Downloads/<creator>/...` without allowing
  // traversal or an empty path component.
  const parts = raw.split(/[\\/]/);
  if (!parts.length || parts.some((part) => {
    const trimmed = part.trim();
    return !trimmed || trimmed === '.' || trimmed === '..';
  })) return fallback;
  const clean = parts.map((part, index) => {
    const piece = part.replace(/[:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
    if (index !== parts.length - 1) return piece.replace(/[. ]+$/g, '').slice(0, 80);
    return withExtension(piece, ext);
  });
  if (clean.some((part) => !part || part === '.' || part === '..')) return fallback;
  let joined = clean.join('/');
  if (joined.length > 220) {
    const file = clean[clean.length - 1];
    const fileExt = file.match(/\.([a-z0-9]{1,8})$/i)?.[1] || ext;
    const prefix = clean.slice(0, -1).join('/');
    const room = Math.max(1, 220 - (prefix ? prefix.length + 1 : 0) - fileExt.length - 1);
    const base = file.slice(0, file.length - fileExt.length - 1).slice(0, room);
    joined = (prefix ? prefix + '/' : '') + (base || 'tiktok') + '.' + fileExt;
  }
  return joined || fallback;
}

function allowedMediaUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return /(^|\.)(tiktok\.com|tiktokv\.com|tiktokcdn\.com|tiktokcdn-us\.com|byteoversea\.com|ibytedtos\.com|ttwstatic\.com|muscdn\.com|byteimg\.com|bytecdn\.cn)$/.test(host);
  } catch (_) {
    return false;
  }
}

async function stored() {
  const data = await DownloaderKit.runtime.storageGet([TASKS_KEY, HISTORY_KEY, SETTINGS_KEY], EXT);
  return {
    tasks: Array.isArray(data?.[TASKS_KEY]) ? data[TASKS_KEY] : [],
    history: Array.isArray(data?.[HISTORY_KEY]) ? data[HISTORY_KEY] : [],
    settings: data?.[SETTINGS_KEY] && typeof data[SETTINGS_KEY] === 'object' ? data[SETTINGS_KEY] : {}
  };
}

async function save(values) {
  const update = {};
  if (values.tasks) update[TASKS_KEY] = values.tasks;
  if (values.history) update[HISTORY_KEY] = values.history;
  await DownloaderKit.runtime.storageSet(update, EXT);
}

function notify(kind = 'tasks') {
  // No receiver is normal while the popup and content scripts are closed.
  try { Promise.resolve(EXT.runtime.sendMessage({ type: 'TIKTOK_DL_TASKS_CHANGED', kind })).catch(() => {}); } catch (_) {}
}

function nativeOutcome(item, delta) {
  if (item?.state === 'complete' || delta?.state?.current === 'complete') return 'complete';
  if (item?.state === 'interrupted' || delta?.state?.current === 'interrupted') return 'interrupted';
  return '';
}

async function syncActiveDownloads(state) {
  let terminal = false;
  for (const task of state.tasks) {
    if (!ACTIVE.has(task.status) || !Number.isInteger(task.downloadId)) continue;
    const item = (await DownloaderKit.runtime.invoke(EXT.downloads.search, EXT.downloads, [{ id: task.downloadId }]).catch(() => []))[0];
    if (!item || item.byExtensionId !== EXT.runtime.id) continue;
    const outcome = nativeOutcome(item, null);
    if (!outcome && task.status !== 'downloading') continue;
    task.bytesReceived = item.bytesReceived || 0;
    task.totalBytes = item.totalBytes || 0;
    task.progress = task.totalBytes > 0 ? Math.min(100, Math.round(task.bytesReceived * 100 / task.totalBytes)) : (task.progress || 0);
    if (outcome === 'complete') {
      task.status = 'completed';
      task.progress = 100;
      task.updatedAt = now();
      state.history = appendHistory(state.history, task, 'completed');
      terminal = true;
    } else if (outcome === 'interrupted' && task.status === 'downloading') {
      const failedId = task.downloadId;
      const switched = item.error !== 'USER_CANCELED' && nextDownloadAddress(task);
      if (switched) await discardFailedDownload(failedId);
      else {
        task.status = item.error === 'USER_CANCELED' ? 'cancelled' : 'failed';
        task.error = item.error || await t('downloadInterrupted');
        task.updatedAt = now();
        if (task.status === 'failed') state.history = appendHistory(state.history, task, 'failed', task.error);
      }
      terminal = true;
    }
  }
  return terminal;
}

function historyEntry(task, status, error) {
  return {
    id: task.id,
    downloadId: task.downloadId || null,
    videoId: task.videoId || '',
    creatorId: task.creatorId || '',
    author: task.author || '',
    title: task.title || '',
    publishTime: task.publishTime || '',
    pageUrl: task.pageUrl || '',
    coverUrl: task.coverUrl || '',
    type: task.type,
    format: task.format || '',
    quality: task.quality || '',
    filename: task.filename || '',
    status,
    error: error || '',
    time: now()
  };
}

function appendHistory(history, task, status, error) {
  if (task.recordHistory === false) return history;
  if (history.some((item) => item.id === task.id && item.status === status)) return history;
  history.unshift(historyEntry(task, status, error));
  return history.slice(0, 1000);
}

function cap(settings) {
  return Math.min(3, Math.max(1, Number.parseInt(settings.maxConcurrentDownloads, 10) || 2));
}

function normalizeTask(input) {
  const type = ['video', 'audio', 'cover'].includes(input?.type) ? input.type : 'video';
  const id = text(input?.id, 160) || `${text(input?.videoId, 120)}-${type}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  const primaryUrl = text(input?.url, 4000);
  const backupUrls = [...new Set((Array.isArray(input?.backupUrls) ? input.backupUrls : [])
    .map((value) => text(value, 4000))
    .filter((url) => url !== primaryUrl && allowedMediaUrl(url)))].slice(0, 12);
  return {
    id,
    videoId: text(input?.videoId, 160),
    creatorId: text(input?.creatorId, 160),
    author: text(input?.author, 160),
    title: text(input?.title, 300),
    publishTime: text(input?.publishTime, 80),
    pageUrl: text(input?.pageUrl, 2000),
    url: primaryUrl,
    primaryUrl,
    backupUrls,
    backupIndex: 0,
    type,
    quality: text(input?.quality, 80),
    format: text(input?.format, 30),
    filename: safeFilename(input?.filename, { ...input, type }),
    coverUrl: text(input?.coverUrl, 4000),
    recordHistory: input?.recordHistory !== false,
    status: 'waiting',
    progress: 0,
    bytesReceived: 0,
    totalBytes: 0,
    downloadId: null,
    error: '',
    createdAt: now(),
    updatedAt: now()
  };
}

function briefUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const tail = url.pathname.split('/').filter(Boolean).pop() || '';
    return url.hostname + '/' + tail.slice(0, 48);
  } catch (_) {
    return 'invalid-url';
  }
}

function debugLog(message, extra) {
  const line = {
    time: new Date().toISOString().slice(11, 19),
    message,
    extra: extra || ''
  };
  console.log('[TikTokDL]', line.time, message, extra || '');
  try { Promise.resolve(EXT.runtime.sendMessage({ type: 'TIKTOK_DL_DEBUG', line })).catch(() => {}); } catch (_) {}
}

async function discardFailedDownload(downloadId) {
  if (!Number.isInteger(downloadId)) return;
  const notes = [];
  try { await DownloaderKit.runtime.invoke(EXT.downloads.cancel, EXT.downloads, [downloadId]); notes.push('已取消'); }
  catch (error) { notes.push('取消失败:' + (error?.message || error)); }
  try { await DownloaderKit.runtime.invoke(EXT.downloads.removeFile, EXT.downloads, [downloadId]); notes.push('已删文件'); }
  catch (error) { notes.push('删文件失败:' + (error?.message || error)); }
  try { await DownloaderKit.runtime.invoke(EXT.downloads.erase, EXT.downloads, [{ id: downloadId }]); notes.push('已清除记录'); }
  catch (error) { notes.push('清除失败:' + (error?.message || error)); }
  debugLog('清除失败下载', 'id=' + downloadId + ' ' + notes.join(' | '));
}

function nextDownloadAddress(task) {
  const index = Number(task.backupIndex) || 0;
  const next = Array.isArray(task.backupUrls) ? task.backupUrls[index] : '';
  if (!allowedMediaUrl(next)) return false;
  task.backupIndex = index + 1;
  task.url = next;
  task.status = 'waiting';
  task.downloadId = null;
  task.error = '';
  task.progress = 0;
  task.bytesReceived = 0;
  task.totalBytes = 0;
  task.updatedAt = now();
  return true;
}

async function schedule() {
  if (scheduling) return;
  scheduling = true;
  try {
    let state = await stored();
    while (state.tasks.filter((task) => task.status === 'downloading').length < cap(state.settings)) {
      const task = state.tasks.find((item) => item.status === 'waiting');
      if (!task) break;
      task.status = 'downloading';
      task.error = '';
      task.updatedAt = now();
      debugLog('开始下载', briefUrl(task.url) + ' 备用' + ((task.backupUrls || []).length - (task.backupIndex || 0)) + '个');
      await save({ tasks: state.tasks }); // Persist before downloads.download so an MV3 restart can recover it.
      notify();
      try {
        task.downloadId = await DownloaderKit.runtime.invoke(EXT.downloads.download, EXT.downloads, [{
          url: task.url,
          filename: safeFilename(task.filename, task),
          saveAs: false,
          conflictAction: 'uniquify'
        }]);
        task.updatedAt = now();
        await save({ tasks: state.tasks });
        notify();
        // A tiny download may already be complete before download() returns its ID.
        // Its onChanged callback is serialized behind this scheduler, so inspect
        // the native state now instead of depending on event timing.
        const native = (await DownloaderKit.runtime.invoke(EXT.downloads.search, EXT.downloads, [{ id: task.downloadId }]).catch(() => []))[0];
        if (native?.byExtensionId === EXT.runtime.id && native.state === 'complete') {
          task.status = 'completed';
          task.progress = 100;
          task.bytesReceived = native.bytesReceived || 0;
          task.totalBytes = native.totalBytes || 0;
          task.updatedAt = now();
          state.history = appendHistory(state.history, task, 'completed');
          await save({ tasks: state.tasks, history: state.history });
          notify('terminal');
        } else if (native?.byExtensionId === EXT.runtime.id && native.state === 'interrupted') {
          const failedId = task.downloadId;
          debugLog('下载中断', (native.error || '未知') + ' ' + briefUrl(task.url));
          const switched = native.error !== 'USER_CANCELED' && nextDownloadAddress(task);
          if (switched) {
            debugLog('改用备用地址', briefUrl(task.url));
            await discardFailedDownload(failedId);
          }
          else {
            task.status = native.error === 'USER_CANCELED' ? 'cancelled' : 'failed';
            task.error = native.error || await t('downloadInterrupted');
            task.updatedAt = now();
            if (task.status === 'failed') state.history = appendHistory(state.history, task, 'failed', task.error);
          }
          await save({ tasks: state.tasks, history: state.history });
          notify(task.status === 'waiting' ? 'tasks' : 'terminal');
        }
      } catch (error) {
        if (nextDownloadAddress(task)) {
          await save({ tasks: state.tasks });
        } else {
          task.status = 'failed';
          task.error = String(error?.message || error);
          task.updatedAt = now();
          state.history = appendHistory(state.history, task, 'failed', task.error);
          await save({ tasks: state.tasks, history: state.history });
        }
        notify();
      }
      state = await stored();
    }
  } finally {
    scheduling = false;
  }
}

async function reconcile() {
  const state = await stored();
  let changed = false;
  for (const task of state.tasks) {
    if (!ACTIVE.has(task.status)) continue;
    // downloads.download may not have returned before MV3 stops. That task has
    // no native download to reconcile, so make it eligible for a fresh start.
    if (!Number.isInteger(task.downloadId)) {
      if (task.status === 'downloading') {
        task.status = 'waiting';
        task.downloadId = null;
        task.updatedAt = now();
        changed = true;
      }
      continue;
    }
    const found = await DownloaderKit.runtime.invoke(EXT.downloads.search, EXT.downloads, [{ id: task.downloadId }]).catch(() => []);
    const item = found[0];
    if (!item || item.byExtensionId !== EXT.runtime.id) {
      if (task.status === 'downloading') { task.status = 'waiting'; task.downloadId = null; task.updatedAt = now(); changed = true; }
      continue;
    }
    task.bytesReceived = item.bytesReceived || 0;
    task.totalBytes = item.totalBytes || 0;
    if (item.state === 'complete') {
      task.status = 'completed'; task.updatedAt = now();
      state.history = appendHistory(state.history, task, 'completed'); changed = true;
    } else if (item.state === 'interrupted') {
      const failedId = task.downloadId;
      const switched = task.status === 'downloading' && item.error !== 'USER_CANCELED' && nextDownloadAddress(task);
      if (switched) await discardFailedDownload(failedId);
      else {
        task.status = item.error === 'USER_CANCELED' ? 'cancelled' : 'failed';
        task.error = item.error || await t('downloadInterrupted'); task.updatedAt = now();
        if (task.status === 'failed') state.history = appendHistory(state.history, task, 'failed', task.error);
      }
      changed = true;
    } else if (task.status === 'downloading') changed = true;
  }
  if (changed) { await save({ tasks: state.tasks, history: state.history }); notify('terminal'); }
  requestSchedule();
}

async function holdIncompleteForStartup() {
  const state = await stored();
  let changed = false;
  for (const task of state.tasks) {
    if (task.status === 'waiting') {
      task.status = 'paused';
      task.updatedAt = now();
      changed = true;
    } else if (task.status === 'downloading') {
      if (Number.isInteger(task.downloadId)) {
        try {
          await DownloaderKit.runtime.invoke(EXT.downloads.pause, EXT.downloads, [task.downloadId]);
        } catch (_) {
          await DownloaderKit.runtime.invoke(EXT.downloads.cancel, EXT.downloads, [task.downloadId]).catch(() => {});
          task.downloadId = null;
          task.progress = 0;
          task.bytesReceived = 0;
          task.totalBytes = 0;
        }
      }
      task.status = 'paused';
      task.updatedAt = now();
      changed = true;
    }
  }
  if (changed) { await save({ tasks: state.tasks }); notify(); }
  await reconcile();
}

EXT.downloads.onChanged.addListener((delta) => {
  if (!delta?.id) return;
  serial(async () => {
    const state = await stored();
    const task = state.tasks.find((item) => item.downloadId === delta.id);
    if (!task || FINISHED.has(task.status)) return;
    const item = (await DownloaderKit.runtime.invoke(EXT.downloads.search, EXT.downloads, [{ id: delta.id }]).catch(() => []))[0];
    if (item && item.byExtensionId !== EXT.runtime.id) return;
    if (!item && !delta.state) return;
    if (item) {
      task.bytesReceived = item.bytesReceived || task.bytesReceived || 0;
      task.totalBytes = item.totalBytes || task.totalBytes || 0;
      task.progress = task.totalBytes > 0 ? Math.min(100, Math.round(task.bytesReceived * 100 / task.totalBytes)) : task.progress || 0;
    }
    const outcome = nativeOutcome(item, delta);
    let terminal = false;
    let alternate = false;
    if (outcome === 'complete') {
      task.status = 'completed'; task.progress = 100;
      state.history = appendHistory(state.history, task, 'completed');
      terminal = true;
    } else if (outcome === 'interrupted') {
      const failedId = task.downloadId;
      const errorCode = item?.error || '';
      debugLog('下载中断', (errorCode || '未知') + ' ' + briefUrl(task.url));
      alternate = task.status === 'downloading' && errorCode !== 'USER_CANCELED' && nextDownloadAddress(task);
      if (alternate) {
        debugLog('改用备用地址', briefUrl(task.url));
        await discardFailedDownload(failedId);
      }
      else {
        task.status = errorCode === 'USER_CANCELED' || task.status === 'cancelled' ? 'cancelled' : 'failed';
        task.error = errorCode || await t('downloadInterrupted');
        if (task.status === 'failed') state.history = appendHistory(state.history, task, 'failed', task.error);
        terminal = true;
      }
    }
    task.updatedAt = now();
    await save({ tasks: state.tasks, history: state.history });
    notify(terminal ? 'terminal' : alternate ? 'tasks' : 'progress');
    requestSchedule();
  });
});

async function control(state, id, action) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error(await t('taskNotFound'));
  if (action === 'pause' && task.status === 'downloading') {
    if (Number.isInteger(task.downloadId)) await DownloaderKit.runtime.invoke(EXT.downloads.pause, EXT.downloads, [task.downloadId]);
    task.status = 'paused';
  } else if (action === 'resume' && task.status === 'paused') {
    if (Number.isInteger(task.downloadId)) {
      try {
        await DownloaderKit.runtime.invoke(EXT.downloads.resume, EXT.downloads, [task.downloadId]);
        task.status = 'downloading';
      } catch (_) {
        await DownloaderKit.runtime.invoke(EXT.downloads.cancel, EXT.downloads, [task.downloadId]).catch(() => {});
        task.status = 'waiting';
        task.downloadId = null;
        task.progress = 0;
        task.bytesReceived = 0;
        task.totalBytes = 0;
      }
    } else {
      task.status = 'waiting';
    }
  } else if (action === 'cancel' && !FINISHED.has(task.status)) {
    task.status = 'cancelled';
    if (Number.isInteger(task.downloadId)) await DownloaderKit.runtime.invoke(EXT.downloads.cancel, EXT.downloads, [task.downloadId]).catch(() => {});
  } else if (action === 'retry' && ['failed', 'cancelled'].includes(task.status)) {
    task.status = 'waiting'; task.downloadId = null; task.error = ''; task.progress = 0; task.bytesReceived = 0; task.totalBytes = 0;
    task.url = task.primaryUrl || task.url;
    task.backupIndex = 0;
  } else if (!['pause', 'resume', 'cancel', 'retry'].includes(action)) throw new Error(await t('invalidAction'));
  task.updatedAt = now();
  return task;
}

EXT.runtime.onMessage.addListener((message, _sender, respond) => {
  const type = message?.type;
  if (!String(type || '').startsWith('TIKTOK_DL_') || type === 'TIKTOK_DL_FETCH_JSON' || type === 'TIKTOK_DL_TASKS_CHANGED' || type === 'TIKTOK_DL_DEBUG' || type === 'TIKTOK_DL_PAGE_INFO' || type === 'TIKTOK_DL_READ_PAGE_INFO' || type === 'TIKTOK_DL_GET_INFO') return undefined;
  serial(async () => {
    const state = await stored();
    if (type === 'TIKTOK_DL_QUEUE_LIST') {
      const finished = await syncActiveDownloads(state);
      if (finished) {
        await save({ tasks: state.tasks, history: state.history });
        notify('terminal');
      }
      requestSchedule();
      return { ok: true, tasks: state.tasks };
    }
    if (type === 'TIKTOK_DL_HISTORY_LIST') return { ok: true, history: state.history };
    if (type === 'TIKTOK_DL_HISTORY_CLEAR') { state.history = []; await save({ history: state.history }); notify('history'); return { ok: true }; }
    if (type === 'TIKTOK_DL_OPEN_DOWNLOADS') {
      const url = typeof browser !== 'undefined' && browser.runtime?.getBrowserInfo ? 'about:downloads' : 'chrome://downloads/';
      if (!EXT.tabs?.create) throw new Error(await t('cannotOpenDownloads'));
      await DownloaderKit.runtime.invoke(EXT.tabs.create, EXT.tabs, [{ url }]);
      return { ok: true };
    }
    if (type === 'TIKTOK_DL_DATA_CLEAR') {
      const scope = message.scope;
      if (!['history', 'tasks', 'all'].includes(scope)) throw new Error(await t('invalidClearScope'));
      if (scope === 'history' || scope === 'all') state.history = [];
      if (scope === 'tasks' || scope === 'all') {
        await Promise.all(state.tasks
          .filter((task) => ACTIVE.has(task.status) && Number.isInteger(task.downloadId))
          .map((task) => DownloaderKit.runtime.invoke(EXT.downloads.cancel, EXT.downloads, [task.downloadId]).catch(() => {})));
        state.tasks = scope === 'all' ? [] : state.tasks.filter((task) => task.status === 'completed');
      }
      if (scope === 'all') {
        const local = await DownloaderKit.runtime.storageGet(null, EXT);
        const keys = Object.keys(local || {}).filter((key) => key.startsWith('tiktok-dl-'));
        if (keys.length) await DownloaderKit.runtime.invoke(EXT.storage.local.remove, EXT.storage.local, [keys]);
      } else {
        await save({ tasks: state.tasks, history: state.history });
      }
      notify(scope === 'history' || scope === 'all' ? 'history' : 'tasks'); return { ok: true };
    }
    if (type === 'TIKTOK_DL_QUEUE_ADD') {
      let added = 0; let skipped = 0;
      for (const input of Array.isArray(message.tasks) ? message.tasks : []) {
        const task = normalizeTask(input);
        const duplicate = state.tasks.some((item) => item.id === task.id) || (!input?.forceDuplicate && (
          state.tasks.some((item) => !FINISHED.has(item.status) && item.videoId && item.videoId === task.videoId && item.type === task.type) ||
          state.history.some((item) => item.status === 'completed' && item.videoId && item.videoId === task.videoId && item.type === task.type)
        ));
        if (!task.videoId || !allowedMediaUrl(task.url) || duplicate) { skipped += 1; continue; }
        state.tasks.push(task); added += 1;
      }
      await save({ tasks: state.tasks }); notify();
      // Scheduling follows persistence, and remains serialized with message changes.
      requestSchedule();
      return { ok: true, added, skipped, tasks: state.tasks };
    }
    if (type === 'TIKTOK_DL_QUEUE_CONTROL') {
      const task = await control(state, text(message.id, 160), message.action);
      await save({ tasks: state.tasks }); notify(); requestSchedule();
      return { ok: true, task };
    }
    if (type === 'TIKTOK_DL_QUEUE_DELETE') {
      const id = text(message.id, 160);
      const task = state.tasks.find((item) => item.id === id);
      if (!task) throw new Error(await t('taskNotFound'));
      if (ACTIVE.has(task.status) && Number.isInteger(task.downloadId)) {
        await DownloaderKit.runtime.invoke(EXT.downloads.cancel, EXT.downloads, [task.downloadId]).catch(() => {});
      }
      state.tasks = state.tasks.filter((item) => item.id !== id);
      await save({ tasks: state.tasks });
      notify();
      requestSchedule();
      return { ok: true, tasks: state.tasks };
    }
    if (type === 'TIKTOK_DL_QUEUE_BULK') {
      const action = message.action;
      if (!['pause-all', 'resume-all', 'cancel-waiting', 'retry-failed', 'clear-completed'].includes(action)) throw new Error(await t('invalidBulkAction'));
      for (const task of [...state.tasks]) {
        if (action === 'pause-all' && task.status === 'downloading') await control(state, task.id, 'pause');
        if (action === 'resume-all' && task.status === 'paused') await control(state, task.id, 'resume');
        if (action === 'cancel-waiting' && task.status === 'waiting') await control(state, task.id, 'cancel');
        if (action === 'retry-failed' && task.status === 'failed') await control(state, task.id, 'retry');
      }
      if (action === 'clear-completed') state.tasks = state.tasks.filter((task) => task.status !== 'completed');
      await save({ tasks: state.tasks }); notify(); requestSchedule();
      return { ok: true, tasks: state.tasks };
    }
    return undefined;
  }).then(respond, (error) => respond({ ok: false, error: String(error?.message || error) }));
  return true;
});

EXT.runtime.onStartup?.addListener(() => { serial(holdIncompleteForStartup); });
EXT.runtime.onInstalled?.addListener((details) => {
  if (details?.reason === 'install') serial(reconcile);
  else if (details?.reason === 'update') serial(holdIncompleteForStartup);
});
EXT.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes?.[SETTINGS_KEY]) serial(schedule);
});
