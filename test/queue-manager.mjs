import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listeners = { message: [], startup: [], installed: [], storage: [], downloadsChanged: [] };
const stored = {};
const broadcasts = [];
const nativeItems = new Map();
const nativeOptions = [];
const cancelledIds = [];
const erasedIds = [];
const extensionId = 'test-extension-id';
let nextDownloadId = 1;
let deferNextDownload = null;
let failNextDownload = false;

function event(name) {
  return {
    addListener(listener) { listeners[name].push(listener); },
    removeListener(listener) { listeners[name] = listeners[name].filter((item) => item !== listener); }
  };
}

const storageLocal = {
  async get(keys) {
    if (keys === null || keys === undefined) return { ...stored };
    if (typeof keys === 'string') return { [keys]: stored[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, stored[key]]));
    const result = {};
    Object.entries(keys).forEach(([key, fallback]) => { result[key] = stored[key] ?? fallback; });
    return result;
  },
  async set(values) {
    const changes = {};
    Object.entries(values).forEach(([key, newValue]) => {
      changes[key] = { oldValue: stored[key], newValue };
      stored[key] = newValue;
    });
    listeners.storage.forEach((listener) => listener(changes, 'local'));
  },
  async remove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const changes = {};
    list.forEach((key) => {
      if (!Object.hasOwn(stored, key)) return;
      changes[key] = { oldValue: stored[key] };
      delete stored[key];
    });
    if (Object.keys(changes).length) listeners.storage.forEach((listener) => listener(changes, 'local'));
  }
};

const api = {
  runtime: {
    id: extensionId,
    getManifest: () => ({ version: '1.0.0' }),
    onMessage: event('message'),
    onStartup: event('startup'),
    onInstalled: event('installed'),
    async sendMessage(message) { broadcasts.push(message); return { ok: true }; }
  },
  storage: { local: storageLocal, onChanged: event('storage') },
  downloads: {
    onChanged: event('downloadsChanged'),
    async download(options) {
      if (failNextDownload) {
        failNextDownload = false;
        throw new Error('simulated network failure');
      }
      const id = nextDownloadId++;
      nativeOptions.push(options);
      const item = { id, byExtensionId: extensionId, state: 'in_progress', bytesReceived: 0, totalBytes: 100000, url: options.url };
      nativeItems.set(id, item);
      if (deferNextDownload) {
        const pending = deferNextDownload;
        deferNextDownload = null;
        await new Promise((resolve) => { pending.resolve = resolve; });
      }
      return id;
    },
    async search(query) {
      const requested = Array.isArray(query) ? query[0] : query;
      return [...nativeItems.values()].filter((item) => !requested?.id || item.id === requested.id).map((item) => ({ ...item }));
    },
    async pause(id) {
      const item = nativeItems.get(id);
      if (!item || item.state !== 'in_progress') throw new Error('download is not active');
      item.state = 'paused';
    },
    async resume(id) {
      const item = nativeItems.get(id);
      if (!item || item.state !== 'paused') throw new Error('download is not paused');
      item.state = 'in_progress';
    },
    async cancel(id) {
      const item = nativeItems.get(id);
      if (item) item.state = 'interrupted';
      cancelledIds.push(id);
    },
    async removeFile() {},
    async erase(query) {
      const id = Array.isArray(query) ? query[0]?.id : query?.id;
      erasedIds.push(id);
      nativeItems.delete(id);
    }
  }
};

const context = vm.createContext({
  chrome: api,
  browser: undefined,
  URL,
  Promise,
  Date,
  Math,
  Set,
  Map,
  Object,
  Array,
  String,
  Number,
  Error,
  console,
  setTimeout,
  clearTimeout,
  importScripts(...files) {
    files.forEach((file) => {
      const source = readFileSync(path.join(root, file), 'utf8');
      vm.runInContext(source, context, { filename: file });
    });
  }
});

vm.runInContext(readFileSync(path.join(root, 'background.js'), 'utf8'), context, { filename: 'background.js' });

function send(message) {
  return new Promise((resolve, reject) => {
    let asyncResponse = false;
    for (const listener of listeners.message) {
      const result = listener(message, {}, resolve);
      if (result === true) asyncResponse = true;
      else if (result && typeof result.then === 'function') result.then(resolve, reject);
    }
    if (!asyncResponse) resolve(undefined);
  });
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for ' + label);
}

function task(videoId, id) {
  return {
    id,
    videoId,
    author: 'Creator',
    title: 'Video ' + videoId,
    url: 'https://v16-webapp-prime.tiktok.com/video-' + videoId + '.mp4',
    pageUrl: 'https://www.tiktok.com/@creator/video/' + videoId,
    type: 'video',
    format: 'mp4',
    filename: 'Creator - ' + videoId + '.mp4'
  };
}

await storageLocal.set({ 'tiktok-dl-settings-v1': { maxConcurrentDownloads: 1 } });

// A queue mutation received while downloads.download() is pending must not be
// overwritten by the scheduler's older storage snapshot.
const firstDownloadGate = {};
deferNextDownload = firstDownloadGate;
await send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [task('1001', 'task-1001')] });
await waitFor(() => nativeOptions.length === 1 && typeof firstDownloadGate.resolve === 'function', 'first download start');
const secondAdd = send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [task('1002', 'task-1002')] });
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(stored['tiktok-dl-tasks-v1'].some((item) => item.videoId === '1002'), false, 'serial queue waits for in-flight start');
firstDownloadGate.resolve();
await secondAdd;
await waitFor(() => stored['tiktok-dl-tasks-v1'].some((item) => item.videoId === '1002'), 'second queue insert');
assert.equal(nativeOptions.length, 1, 'concurrency one leaves second task waiting');

// Completion advances the queue and writes history exactly once.
nativeItems.get(1).state = 'complete';
nativeItems.get(1).bytesReceived = 100;
listeners.downloadsChanged.forEach((listener) => listener({ id: 1, state: { current: 'complete' } }));
await waitFor(() => nativeOptions.length === 2 && stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1002')?.status === 'downloading', 'next queue task');
assert.equal(stored['tiktok-dl-history-v1'].filter((item) => item.videoId === '1001' && item.status === 'completed').length, 1);

// A successful video ID is deduplicated against local history.
const duplicate = await send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [task('1001', 'duplicate-1001')] });
assert.equal(duplicate.added, 0);
assert.equal(duplicate.skipped, 1);

// Browser startup pauses in-flight and waiting work. A task without a native
// download ID resumes through the waiting queue rather than becoming stuck.
await send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [task('1003', 'task-1003')] });
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1003')?.status === 'waiting', 'third waiting task');
for (const listener of listeners.startup) listener();
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1002')?.status === 'paused', 'startup pause');
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1003')?.status === 'paused', 'queued task pause');
assert.equal(nativeItems.get(2).state, 'paused');
await send({ type: 'TIKTOK_DL_QUEUE_BULK', action: 'resume-all' });
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1002')?.status === 'downloading', 'native task resume');
assert.equal(stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1003')?.status, 'waiting');

// Clearing unfinished tasks cancels paused/native jobs and retains completed
// records in the task center.
await send({ type: 'TIKTOK_DL_QUEUE_CONTROL', id: 'task-1002', action: 'pause' });
await send({ type: 'TIKTOK_DL_DATA_CLEAR', scope: 'tasks' });
assert.deepEqual(Array.from(stored['tiktok-dl-tasks-v1'], (item) => item.id), ['task-1001']);
assert.ok(cancelledIds.includes(2), 'paused native download is cancelled');
assert.equal(nativeItems.get(2).state, 'interrupted');

// Native download errors are persisted to history and can be retried.
failNextDownload = true;
await send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [task('1004', 'task-1004')] });
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1004')?.status === 'failed', 'failed task persistence');
assert.equal(stored['tiktok-dl-history-v1'].find((item) => item.id === 'task-1004')?.status, 'failed');
await send({ type: 'TIKTOK_DL_QUEUE_CONTROL', id: 'task-1004', action: 'retry' });
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1004')?.status === 'downloading', 'failed task retry');
const retried = stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1004');
nativeItems.get(retried.downloadId).state = 'complete';
listeners.downloadsChanged.forEach((listener) => listener({ id: retried.downloadId, state: { current: 'complete' } }));
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1004')?.status === 'completed', 'retried task completion');

// Same quality keeps fallback URLs. A forbidden mirror is erased, then the next URL downloads.
const backupTask = {
  ...task('1005', 'task-1005'),
  backupUrls: [
    'https://v19-webapp-prime.tiktok.com/video-1005.mp4',
    'https://v20-webapp-prime.tiktok.com/video-1005.mp4'
  ]
};
await send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [backupTask] });
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1005')?.status === 'downloading', 'primary start');
let fallback = stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1005');
const failedId = fallback.downloadId;
nativeItems.get(failedId).state = 'interrupted';
nativeItems.get(failedId).error = 'SERVER_FORBIDDEN';
listeners.downloadsChanged.forEach((listener) => listener({ id: failedId, state: { current: 'interrupted' } }));
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1005')?.url === backupTask.backupUrls[0] && stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1005')?.status === 'downloading', 'fallback start');
assert.ok(erasedIds.includes(failedId), 'failed mirror is removed from the download list');
fallback = stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1005');
nativeItems.get(fallback.downloadId).state = 'complete';
listeners.downloadsChanged.forEach((listener) => listener({ id: fallback.downloadId, state: { current: 'complete' } }));
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1005')?.status === 'completed', 'fallback completion');
assert.equal(stored['tiktok-dl-history-v1'].filter((item) => item.id === 'task-1005' && item.status === 'failed').length, 0);

// The browser can finish before downloads.download() resolves with its ID.
const fastGate = {};
deferNextDownload = fastGate;
await send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [task('1006', 'task-1006')] });
await waitFor(() => typeof fastGate.resolve === 'function', 'fast download start');
const fastId = nextDownloadId - 1;
nativeItems.get(fastId).state = 'complete';
nativeItems.get(fastId).bytesReceived = 100;
listeners.downloadsChanged.forEach((listener) => listener({ id: fastId, state: { current: 'complete' } }));
fastGate.resolve();
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1006')?.status === 'completed', 'fast download completion');
assert.equal(stored['tiktok-dl-history-v1'].filter((item) => item.id === 'task-1006' && item.status === 'completed').length, 1);

// Firefox can omit byExtensionId from downloads.search results.
await send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [task('1007', 'task-1007')] });
await waitFor(() => Number.isInteger(stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1007')?.downloadId), 'Firefox-style download start');
const firefoxTask = stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1007');
delete nativeItems.get(firefoxTask.downloadId).byExtensionId;
nativeItems.get(firefoxTask.downloadId).state = 'complete';
listeners.downloadsChanged.forEach((listener) => listener({ id: firefoxTask.downloadId, state: { current: 'complete' } }));
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1007')?.status === 'completed', 'Firefox-style completion');
const repeat = { ...task('1007', 'task-1007-repeat'), forceDuplicate: true };
await send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [repeat] });
await waitFor(() => Number.isInteger(stored['tiktok-dl-tasks-v1'].find((item) => item.id === repeat.id)?.downloadId), 'repeat download start');
const duplicateWhileActive = await send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [{ ...repeat, id: 'task-1007-active-duplicate' }] });
assert.equal(duplicateWhileActive.skipped, 1, 'active duplicate is rejected even during an intentional repeat download');
const repeated = stored['tiktok-dl-tasks-v1'].find((item) => item.id === repeat.id);
nativeItems.get(repeated.downloadId).state = 'complete';
listeners.downloadsChanged.forEach((listener) => listener({ id: repeated.downloadId, state: { current: 'complete' } }));
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === repeat.id)?.status === 'completed', 'repeat download completion');

// Pinned videos are checked before handing an address to the browser. A 403
// does not create an .htm download; the next MP4 address is tried instead.
const pinnedPrimary = 'https://v16-webapp-prime.tiktok.com/pinned-denied.mp4';
const pinnedBackup = 'https://v19-webapp-prime.tiktok.com/pinned-valid.mp4';
const probedUrls = [];
context.fetch = async (url) => {
  probedUrls.push(url);
  if (url === pinnedPrimary) return { ok: false, status: 403 };
  return { ok: true, headers: { get: () => 'video/mp4' },
    arrayBuffer: async () => new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]).buffer };
};
const pinnedTask = { ...task('1008', 'task-1008'), url: pinnedPrimary, backupUrls: [pinnedBackup], validateMedia: true };
const downloadCountBeforePinned = nativeOptions.length;
await send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [pinnedTask] });
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1008')?.url === pinnedBackup
  && Number.isInteger(stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1008')?.downloadId), 'pinned fallback download');
assert.equal(nativeOptions.length, downloadCountBeforePinned + 1, 'the denied address never starts a browser download');
assert.equal(nativeOptions.at(-1).url, pinnedBackup);
assert.deepEqual(probedUrls, [pinnedPrimary, pinnedBackup]);
const pinnedNative = stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1008');
nativeItems.get(pinnedNative.downloadId).state = 'complete';
listeners.downloadsChanged.forEach((listener) => listener({ id: pinnedNative.downloadId, state: { current: 'complete' } }));
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1008')?.status === 'completed', 'pinned fallback completion');

await send({ type: 'TIKTOK_DL_QUEUE_ADD', tasks: [task('1009', 'task-1009')] });
await waitFor(() => Number.isInteger(stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1009')?.downloadId), 'invalid document download start');
const invalid = stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1009');
Object.assign(nativeItems.get(invalid.downloadId), { state: 'complete', bytesReceived: 425, totalBytes: 425,
  filename: 'C:\\Downloads\\denied.htm', mime: 'text/html' });
listeners.downloadsChanged.forEach((listener) => listener({ id: invalid.downloadId, state: { current: 'complete' } }));
await waitFor(() => stored['tiktok-dl-tasks-v1'].find((item) => item.id === 'task-1009')?.status === 'failed', 'HTML document is rejected');
assert.ok(erasedIds.includes(invalid.downloadId), 'failed HTML download is removed from browser history');

await send({ type: 'TIKTOK_DL_DATA_CLEAR', scope: 'all' });
assert.equal(stored['tiktok-dl-tasks-v1'], undefined);
assert.equal(stored['tiktok-dl-history-v1'], undefined);
const firefoxManifest = JSON.parse(readFileSync(path.join(root, 'manifest.firefox.json'), 'utf8'));
const firefoxContext = vm.createContext({
  browser: api, URL, Promise, Date, Math, Set, Map, Object, Array, String, Number, Error,
  console, setTimeout, clearTimeout
});
for (const file of firefoxManifest.background.scripts) {
  vm.runInContext(readFileSync(path.join(root, file), 'utf8'), firefoxContext, { filename: file });
}
console.log('queue serialization, CDN fallback, concurrency, dedupe, restart recovery, retry and cleanup passed');
