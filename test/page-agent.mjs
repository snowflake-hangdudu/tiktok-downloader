import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshots = [];
const location = {
  href: 'https://www.tiktok.com/@sample_creator/video/9876543210',
  origin: 'https://www.tiktok.com',
  pathname: '/@sample_creator/video/9876543210'
};
const item = {
  id: '9876543210',
  desc: 'A public video with real resources',
  createTime: 1700000000,
  author: { id: 'creator-1', uniqueId: 'sample_creator', nickname: 'Sample Creator' },
  video: {
    width: 720,
    height: 1280,
    duration: 12,
    mimeType: 'video/mp4',
    size: 1500000,
    playAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/play.mp4', 'http://blocked.example/video.mp4'] },
    downloadAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/play.mp4'] },
    bitrateInfo: [{
      width: 540,
      height: 960,
      bitrate: 500000,
      playAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/540.mp4'] }
    }],
    cover: { url_list: ['https://p16-sign-va.tiktokcdn.com/cover.jpg'] }
  },
  music: {
    mimeType: 'audio/mp4',
    size: 50000,
    playUrl: { url_list: ['https://sf16-ies-music.tiktokcdn.com/music.m4a'] }
  }
};
const document = {
  readyState: 'complete',
  title: 'Sample Creator video | TikTok',
  documentElement: {},
  addEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => []
};
const window = {
  __UNIVERSAL_DATA_FOR_REHYDRATION__: { defaultScope: { itemInfo: { itemStruct: item } } },
  addEventListener() {},
  postMessage(message) { snapshots.push(message); }
};

class MutationObserver {
  constructor(callback) { this.callback = callback; }
  observe() {}
}

const context = vm.createContext({
  window,
  document,
  location,
  history: { pushState() {}, replaceState() {} },
  URL,
  Date,
  Math,
  Set,
  Map,
  WeakSet,
  Array,
  Object,
  String,
  Number,
  RegExp,
  MutationObserver,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  queueMicrotask
});

vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), context, { filename: 'page-agent.js' });
await new Promise((resolve) => setTimeout(resolve, 10));

const message = snapshots.find((entry) => entry.type === 'SNAPSHOT');
assert.ok(message, 'page agent emits an initial snapshot');
const payload = JSON.parse(JSON.stringify(message.payload));
assert.equal(payload.kind, 'video');
assert.equal(payload.video.id, '9876543210');
assert.equal(payload.video.title, 'A public video with real resources');
assert.equal(payload.video.author, 'Sample Creator');
assert.equal(payload.video.publishTime, '2023-11-14T22:13:20.000Z');
assert.equal(payload.video.cover, 'https://p16-sign-va.tiktokcdn.com/cover.jpg');
assert.equal(payload.video.resources.filter((resource) => resource.type === 'video').length, 1, 'all resolutions collapse to one video option');
assert.ok(payload.video.resources.some((resource) => resource.url.endsWith('/540.mp4') || resource.backupUrls?.some((url) => url.endsWith('/540.mp4'))));
const duplicateBitrateItem = {
  ...item,
  video: {
    width: 576,
    height: 1024,
    duration: 12,
    codecType: 'h264',
    playAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/play576-h264.mp4'] },
    bitrateInfo: [
      { width: 576, height: 1024, bitrate: 900000, codecType: 'h264', playAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/a576-h264.mp4'] } },
      { width: 576, height: 1024, bitrate: 800000, codecType: 'h264', playAddr: { url_list: ['https://v19-webapp-prime.tiktok.com/video/b576-h264.mp4'] } },
      { width: 576, height: 1024, bitrate: 700000, codecType: 'h265_hvc1', playAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/c576-h265.mp4'] } },
      { width: 720, height: 1280, bitrate: 1200000, codecType: 'h265_hvc1', playAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/720-h265.mp4'] } }
    ]
  }
};
const dupWindow = {
  __UNIVERSAL_DATA_FOR_REHYDRATION__: { defaultScope: { itemInfo: { itemStruct: duplicateBitrateItem } } },
  addEventListener() {},
  postMessage(message) { snapshots.push(message); }
};
const dupContext = vm.createContext({
  window: dupWindow,
  document,
  location,
  history: { pushState() {}, replaceState() {} },
  URL, Date, Math, Set, Map, WeakSet, Array, Object, String, Number, RegExp,
  MutationObserver, setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask
});
snapshots.length = 0;
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), dupContext, { filename: 'page-agent-dup.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
const dupPayload = snapshots.find((entry) => entry.type === 'SNAPSHOT')?.payload;
const dupVideos = dupPayload.video.resources.filter((resource) => resource.type === 'video');
assert.equal(dupVideos.length, 1, '1280p and 1024p style variants stay one option');
assert.ok((dupVideos[0].backupUrls || []).length >= 1);

const fakeHdItem = {
  ...item,
  video: {
    width: 1080,
    height: 1920,
    duration: 7,
    codecType: 'h264',
    playAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/fake-1920.mp4'], size: 987870 },
    downloadAddr: {},
    bitrateInfo: [{
      width: 720,
      height: 1280,
      bitrate: 1200000,
      codecType: 'h264',
      playAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/real-720-h265.mp4'] },
      size: 3600000
    }]
  }
};
const fakeSnapshots = [];
const fakeContext = vm.createContext({
  window: {
    __UNIVERSAL_DATA_FOR_REHYDRATION__: { defaultScope: { itemInfo: { itemStruct: fakeHdItem } } },
    addEventListener() {},
    postMessage(message) { fakeSnapshots.push(message); }
  },
  document,
  location,
  history: { pushState() {}, replaceState() {} },
  URL, Date, Math, Set, Map, WeakSet, Array, Object, String, Number, RegExp,
  MutationObserver, setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask
});
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), fakeContext, { filename: 'page-agent-fake-hd.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
const fakePayload = fakeSnapshots.find((entry) => entry.type === 'SNAPSHOT')?.payload;
const fakeVideos = fakePayload.video.resources.filter((resource) => resource.type === 'video');
assert.ok(fakeVideos.some((resource) => resource.url.endsWith('/fake-1920.mp4') || resource.backupUrls?.some((url) => url.endsWith('/fake-1920.mp4'))), 'a short high-resolution stream is not rejected by an arbitrary byte threshold');

const shortVideoItem = {
  ...item,
  id: '7679558278900190484',
  video: {
    width: 576, height: 1024, duration: 6, size: 452280, codecType: 'h264',
    playAddr: 'https://v16-webapp-prime.tiktok.com/video/quran-play.mp4',
    downloadAddr: 'https://v16-webapp-prime.tiktok.com/video/quran-download.mp4',
    bitrateInfo: [
      { CodecType: 'h265_hvc1', PlayAddr: { Width: 720, Height: 1280, DataSize: '640933', UrlList: ['https://v16-webapp-prime.tiktok.com/video/quran-hevc-720.mp4'] } },
      { CodecType: 'h264', PlayAddr: { Width: 576, Height: 1024, DataSize: '452280', UrlList: ['https://v16-webapp-prime.tiktok.com/video/quran-h264.mp4'] } }
    ]
  }
};
const shortSnapshots = [];
const shortContext = vm.createContext({
  window: { __UNIVERSAL_DATA_FOR_REHYDRATION__: { defaultScope: { itemInfo: { itemStruct: shortVideoItem } } }, addEventListener() {}, postMessage(message) { shortSnapshots.push(message); } },
  document, location: { ...location, href: 'https://www.tiktok.com/@islamicquran744/video/7679558278900190484', pathname: '/@islamicquran744/video/7679558278900190484' },
  history: { pushState() {}, replaceState() {} },
  URL, Date, Math, Set, Map, WeakSet, Array, Object, String, Number, RegExp,
  MutationObserver, setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask
});
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), shortContext, { filename: 'page-agent-short-video.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
const shortResource = shortSnapshots.at(-1).payload.video.resources.find((resource) => resource.type === 'video');
assert.ok(shortResource, 'the six-second 452 KB video retains a downloadable quality');
assert.equal(shortResource.quality, '576P H.264');
assert.equal(shortResource.sizeBytes, 452280);
assert.ok(shortResource.url.endsWith('/quran-download.mp4'));

const hevcOnlyItem = {
  ...item,
  video: {
    width: 1080, height: 1920, duration: 20,
    playAddr: '', downloadAddr: '',
    bitrateInfo: [{ CodecType: 'h265_hvc1', PlayAddr: {
      Width: 1080, Height: 1920, DataSize: '8000000',
      UrlList: ['https://v16-webapp-prime.tiktok.com/video/play-only-hevc.mp4']
    } }]
  },
  music: null
};
const hevcSnapshots = [];
const hevcContext = vm.createContext({
  window: { __UNIVERSAL_DATA_FOR_REHYDRATION__: { defaultScope: { itemInfo: { itemStruct: hevcOnlyItem } } }, addEventListener() {}, postMessage(message) { hevcSnapshots.push(message); } },
  document, location, history: { pushState() {}, replaceState() {} },
  URL, Date, Math, Set, Map, WeakSet, Array, Object, String, Number, RegExp,
  MutationObserver, setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask
});
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), hevcContext, { filename: 'page-agent-hevc-only.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(hevcSnapshots.at(-1).payload.video.resources.filter((resource) => resource.type === 'video').length, 0, 'HEVC play-only address is not offered as a download');

const explicitHevcItem = {
  ...hevcOnlyItem,
  video: {
    ...hevcOnlyItem.video,
    bitrateInfo: [{ CodecType: 'h265_hvc1', DownloadAddr: {
      Width: 1080, Height: 1920, DataSize: '8000000',
      UrlList: ['https://v16-webapp-prime.tiktok.com/video/download-hevc.mp4']
    } }]
  }
};
const explicitHevcSnapshots = [];
const explicitHevcContext = vm.createContext({
  window: { __UNIVERSAL_DATA_FOR_REHYDRATION__: { defaultScope: { itemInfo: { itemStruct: explicitHevcItem } } }, addEventListener() {}, postMessage(message) { explicitHevcSnapshots.push(message); } },
  document, location, history: { pushState() {}, replaceState() {} },
  URL, Date, Math, Set, Map, WeakSet, Array, Object, String, Number, RegExp,
  MutationObserver, setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask
});
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), explicitHevcContext, { filename: 'page-agent-hevc-download.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
const explicitHevcVideo = explicitHevcSnapshots.at(-1).payload.video.resources.find((resource) => resource.type === 'video');
assert.equal(explicitHevcVideo.quality, '1080P HEVC', 'portrait video is labeled by its shorter side');
assert.ok(explicitHevcVideo.url.endsWith('/download-hevc.mp4'), 'explicit HEVC download address remains usable');

const sharedAddressItem = {
  ...item,
  video: {
    width: 720, height: 1280, duration: 10, codecType: 'h264', size: 2400000,
    playAddr: 'https://v16-webapp-prime.tiktok.com/video/same-url.mp4',
    downloadAddr: 'https://v16-webapp-prime.tiktok.com/video/same-url.mp4'
  }
};
const sharedSnapshots = [];
const sharedContext = vm.createContext({
  window: { __UNIVERSAL_DATA_FOR_REHYDRATION__: { defaultScope: { itemInfo: { itemStruct: sharedAddressItem } } }, addEventListener() {}, postMessage(message) { sharedSnapshots.push(message); } },
  document, location, history: { pushState() {}, replaceState() {} },
  URL, Date, Math, Set, Map, WeakSet, Array, Object, String, Number, RegExp,
  MutationObserver, setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask
});
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), sharedContext, { filename: 'page-agent-shared-address.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(sharedSnapshots.at(-1).payload.video.resources.find((resource) => resource.type === 'video').source, '页面下载', 'a shared play/download URL keeps its download provenance');

const mixedCodecItem = {
  ...item,
  video: {
    width: 720, height: 1280, duration: 12, codecType: 'h264', size: 3000000,
    playAddr: 'https://v16-webapp-prime.tiktok.com/video/h264-play.mp4',
    downloadAddr: '',
    bitrateInfo: [{ CodecType: 'h265_hvc1', DownloadAddr: {
      Width: 1080, Height: 1920, DataSize: '6000000',
      UrlList: ['https://v16-webapp-prime.tiktok.com/video/hevc-download.mp4']
    } }]
  }
};
const mixedSnapshots = [];
const mixedContext = vm.createContext({
  window: { __UNIVERSAL_DATA_FOR_REHYDRATION__: { defaultScope: { itemInfo: { itemStruct: mixedCodecItem } } }, addEventListener() {}, postMessage(message) { mixedSnapshots.push(message); } },
  document, location, history: { pushState() {}, replaceState() {} },
  URL, Date, Math, Set, Map, WeakSet, Array, Object, String, Number, RegExp,
  MutationObserver, setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask
});
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), mixedContext, { filename: 'page-agent-mixed-codec.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
const mixedVideo = mixedSnapshots.at(-1).payload.video.resources.find((resource) => resource.type === 'video');
assert.ok(mixedVideo.url.endsWith('/h264-play.mp4'), 'H.264 is attempted before a HEVC mirror');
assert.ok(mixedVideo.backupUrls.some((url) => url.endsWith('/hevc-download.mp4')), 'explicit HEVC download remains a fallback');

const playOnlyHdItem = {
  ...item,
  video: {
    width: 1080,
    height: 1920,
    duration: 20,
    codecType: 'h264',
    playAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/play-only-1920.mp4'] },
    downloadAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/download-720.mp4'], size: 2800000 },
    size: 2800000,
    bitrateInfo: [{
      width: 1080,
      height: 1920,
      codecType: 'h264',
      playAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/bitrate-play-1920.mp4'] }
    }, {
      width: 720,
      height: 1280,
      bitrate: 1500000,
      codecType: 'h265_hvc1',
      downloadAddr: { url_list: ['https://v16-webapp-prime.tiktok.com/video/bitrate-dl-1280.mp4'], DataSize: 2200000 },
      size: 2200000
    }]
  }
};
const playOnlySnapshots = [];
const playOnlyContext = vm.createContext({
  window: {
    __UNIVERSAL_DATA_FOR_REHYDRATION__: { defaultScope: { itemInfo: { itemStruct: playOnlyHdItem } } },
    addEventListener() {},
    postMessage(message) { playOnlySnapshots.push(message); }
  },
  document,
  location,
  history: { pushState() {}, replaceState() {} },
  URL, Date, Math, Set, Map, WeakSet, Array, Object, String, Number, RegExp,
  MutationObserver, setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask
});
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), playOnlyContext, { filename: 'page-agent-play-only-hd.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
const playOnlyPayload = playOnlySnapshots.find((entry) => entry.type === 'SNAPSHOT')?.payload;
const playOnlyVideo = playOnlyPayload.video.resources.find((resource) => resource.type === 'video');
assert.ok(playOnlyVideo, 'play-only HD case still exposes one video option');
assert.ok(
  playOnlyVideo.url.endsWith('/download-720.mp4') || playOnlyVideo.url.endsWith('/bitrate-dl-1280.mp4'),
  'primary URL prefers a downloadable address over play-only 1920p'
);
assert.ok(
  playOnlyVideo.backupUrls.some((url) => url.endsWith('/play-only-1920.mp4') || url.endsWith('/bitrate-play-1920.mp4')),
  'play-only 1920p stays available as a silent backup'
);
assert.ok(
  !playOnlyVideo.url.endsWith('/play-only-1920.mp4') && !playOnlyVideo.url.endsWith('/bitrate-play-1920.mp4'),
  'play-only 1920p is not the first download attempt'
);const low = payload.video.resources.find((resource) => resource.type === 'video');
assert.ok(low.url.endsWith('/540.mp4') || low.backupUrls.some((url) => url.endsWith('/540.mp4')));
const audioResource = payload.video.resources.find((resource) => resource.type === 'audio');
assert.equal(audioResource.format, 'm4a');
assert.notEqual(audioResource.url, payload.video.resources.find((resource) => resource.type === 'video').url);

const videoAudioDupSnapshots = [];
const videoAudioDupItem = {
  ...item,
  music: {
    mimeType: 'video/mp4',
    size: 1400000,
    playUrl: { url_list: ['https://v16-webapp-prime.tiktok.com/video/play.mp4'] }
  }
};
const videoAudioDupContext = vm.createContext({
  window: {
    __UNIVERSAL_DATA_FOR_REHYDRATION__: { defaultScope: { itemInfo: { itemStruct: videoAudioDupItem } } },
    addEventListener() {},
    postMessage(message) { videoAudioDupSnapshots.push(message); }
  },
  document,
  location,
  history: { pushState() {}, replaceState() {} },
  URL, Date, Math, Set, Map, WeakSet, Array, Object, String, Number, RegExp,
  MutationObserver, setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask
});
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), videoAudioDupContext, { filename: 'page-agent-audio-dup.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
const dupAudioPayload = videoAudioDupSnapshots.find((entry) => entry.type === 'SNAPSHOT')?.payload;
assert.equal(dupAudioPayload.video.resources.some((resource) => resource.type === 'audio'), false, 'video streams are not offered as audio');
assert.ok(payload.video.resources.every((resource) => resource.url.startsWith('https://')));

const feedSnapshots = [];
const feedLocation = {
  href: 'https://www.tiktok.com/',
  origin: 'https://www.tiktok.com',
  pathname: '/'
};
const feedText = 'safe to say i will be going back to my roots for this task weddingdress weddingplanning dasem';
const authorLink = {
  href: 'https://www.tiktok.com/@sample_creator',
  getAttribute(name) { return name === 'href' ? this.href : null; }
};
const feedCard = {
  innerText: feedText,
  textContent: feedText,
  parentElement: null,
  querySelector(selector) {
    if (selector === '[data-more-menu-item-id]') return { getAttribute: () => '9876543211' };
    if (selector === '[id^="xgwrapper-"]') return { id: 'xgwrapper-0-9876543211' };
    return null;
  },
  querySelectorAll(selector) { return selector === 'a[href]' ? [authorLink] : []; }
};
const feedPlayer = {
  currentSrc: 'blob:https://www.tiktok.com/00000000-0000-0000-0000-000000000001',
  src: 'blob:https://www.tiktok.com/00000000-0000-0000-0000-000000000001',
  paused: true,
  ended: false,
  readyState: 4,
  videoWidth: 720,
  videoHeight: 1280,
  duration: 15,
  poster: 'https://p16-sign-va.tiktokcdn.com/feed-cover.jpg',
  parentElement: feedCard,
  closest() { return feedCard; },
  querySelector() { return null; },
  getBoundingClientRect() { return { width: 360, height: 640, top: 40, left: 20, right: 380, bottom: 680 }; }
};
const nextCard = {
  ...feedCard,
  querySelector(selector) {
    return selector === '[data-more-menu-item-id]' ? { getAttribute: () => '9876543212' } : null;
  }
};
const offscreenPlayer = {
  ...feedPlayer,
  paused: false,
  parentElement: nextCard,
  closest() { return nextCard; },
  getBoundingClientRect() { return { width: 360, height: 640, top: 1000, left: 20, right: 380, bottom: 1640 }; }
};
const feedItem = {
  ...item,
  id: '9876543211',
  desc: 'safe to say i will be going back to my roots for this task',
  video: {
    ...item.video,
    width: 576,
    height: 1024,
    playAddr: {},
    play_addr: 'https://v16-webapp-prime.tiktok.com/video/feed-play.mp4',
    downloadAddr: 'https://v16-webapp-prime.tiktok.com/video/feed-download.mp4',
    bitrateInfo: [],
    BitrateInfo: [{
      Bitrate: 1112466,
      CodecType: 'h265_hvc1',
      Format: 'mp4',
      PlayAddr: {
        Width: 1080,
        Height: 1920,
        DataSize: '3500000',
        UrlList: [
          'https://v16-webapp-prime.tiktok.com/video/feed-1080.mp4',
          'https://v19-webapp-prime.tiktok.com/video/feed-1080-backup.mp4'
        ]
      }
    }]
  }
};
const feedState = { __DEFAULT_SCOPE__: { 'webapp.updated-items': { feed: [
  { itemStruct: { ...item, id: '9876543212', desc: 'Another video from this creator' } },
  { itemStruct: feedItem }
] } } };
const feedDocument = {
  readyState: 'complete',
  title: 'TikTok - Make Your Day',
  documentElement: {},
  addEventListener() {},
  getElementById: (id) => id === '__UNIVERSAL_DATA_FOR_REHYDRATION__' ? { textContent: JSON.stringify(feedState) } : null,
  querySelector: () => null,
  querySelectorAll: (selector) => selector === 'video' ? [feedPlayer, offscreenPlayer] : []
};
const feedWindow = {
  innerHeight: 800,
  innerWidth: 1000,
  addEventListener() {},
  postMessage(message) { feedSnapshots.push(message); }
};
const feedContext = vm.createContext({
  window: feedWindow,
  document: feedDocument,
  location: feedLocation,
  history: { pushState() {}, replaceState() {} },
  URL,
  Date,
  Math,
  Set,
  Map,
  WeakSet,
  Array,
  Object,
  String,
  Number,
  RegExp,
  MutationObserver,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  queueMicrotask
});
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), feedContext, { filename: 'page-agent-feed.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
const feedMessage = feedSnapshots.find((entry) => entry.type === 'SNAPSHOT');
assert.ok(feedMessage, 'page agent emits a feed snapshot');
const feedPayload = JSON.parse(JSON.stringify(feedMessage.payload));
assert.equal(feedPayload.kind, 'video', 'the currently playing feed item is exposed as the current video');
assert.equal(feedPayload.video.id, '9876543211', 'feed card ID identifies the current hydration item');
assert.ok(feedPayload.video.resources.every((resource) => resource.url.startsWith('https://')), 'blob player URL is never offered for download');
assert.ok(
  feedPayload.video.resources.some((resource) => resource.url.endsWith('/feed-download.mp4')
    || resource.url.endsWith('/feed-play.mp4')
    || (Array.isArray(resource.backupUrls) && resource.backupUrls.some((url) => url.endsWith('/feed-play.mp4')))),
  'snake-case play_addr survives and prefers download mirrors when available'
);
const highest = feedPayload.video.resources.find((resource) => resource.type === 'video');
assert.ok(highest, 'feed video has one download option');
assert.equal(highest.sizeBytes, 1500000);
assert.ok(highest.url.endsWith('/feed-download.mp4'), 'the explicit download address is primary');
assert.ok(![highest.url, ...highest.backupUrls].some((url) => url.includes('feed-1080')), 'HEVC play-only mirrors are excluded from download attempts');
assert.equal(feedPayload.creator.username, 'sample_creator');

// A sponsored card's feed playback address can return an error document.
// Wait for the public video page and expose only that page's download source.
const sponsoredSnapshots = [];
const sponsoredId = '7685776857777622285';
const sponsoredFeedItem = {
  ...feedItem,
  id: sponsoredId,
  isAd: true,
  author: { ...item.author, uniqueId: 'theluxurycollection' },
  video: {
    width: 1080, height: 1920, duration: 6,
    downloadAddr: 'https://v16-webapp-prime.tiktok.com/ad/feed-invalid.mp4'
  }
};
const sponsoredDetailItem = {
  ...sponsoredFeedItem,
  video: {
    width: 720, height: 1280, duration: 6, codecType: 'h264', size: 586839,
    downloadAddr: 'https://v16-webapp-prime.tiktok.com/video/detail-h264.mp4'
  }
};
const sponsoredCard = {
  ...feedCard,
  querySelector(selector) {
    if (selector === '[data-e2e="ad-tag"]') return {};
    if (selector === '[data-more-menu-item-id]') return { getAttribute: () => sponsoredId };
    return null;
  }
};
const sponsoredPlayer = { ...feedPlayer, parentElement: sponsoredCard, closest: () => sponsoredCard };
const sponsoredDocument = {
  ...feedDocument,
  getElementById(id) {
    return id === '__UNIVERSAL_DATA_FOR_REHYDRATION__'
      ? { textContent: JSON.stringify({ __DEFAULT_SCOPE__: { feed: [{ itemStruct: sponsoredFeedItem }] } }) }
      : null;
  },
  querySelectorAll(selector) { return selector === 'video' ? [sponsoredPlayer] : []; }
};
let resolveSponsoredFetch;
let sponsoredRequest;
const sponsoredWindow = {
  innerHeight: 800, innerWidth: 1000,
  addEventListener() {},
  postMessage(message) { sponsoredSnapshots.push(message); },
  fetch: (url, options) => {
    sponsoredRequest = { url, options };
    return new Promise((resolve) => { resolveSponsoredFetch = resolve; });
  }
};
const sponsoredContext = vm.createContext({
  window: sponsoredWindow, document: sponsoredDocument, location: feedLocation,
  history: { pushState() {}, replaceState() {} },
  URL, Date, Math, Set, Map, WeakSet, Array, Object, String, Number, RegExp,
  MutationObserver, setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask
});
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), sponsoredContext, { filename: 'page-agent-sponsored.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(sponsoredSnapshots.at(-1).payload.video.id, sponsoredId);
assert.equal(sponsoredSnapshots.at(-1).payload.video.resources.length, 0, 'unverified ad playback cannot be downloaded');
assert.equal(sponsoredRequest.url, 'https://www.tiktok.com/@theluxurycollection/video/' + sponsoredId);
assert.equal(sponsoredRequest.options.credentials, 'same-origin');
resolveSponsoredFetch({
  ok: true,
  text: async () => '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">'
    + JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: sponsoredDetailItem } } } })
    + '</script>'
});
await new Promise((resolve) => setTimeout(resolve, 400));
const sponsoredResource = sponsoredSnapshots.at(-1).payload.video.resources.find((resource) => resource.type === 'video');
assert.ok(sponsoredResource?.url.endsWith('/detail-h264.mp4'), 'sponsored video uses its public detail-page H.264 source');
assert.equal(sponsoredResource.quality, '720P H.264');
assert.ok(!sponsoredResource.backupUrls?.some((url) => url.includes('feed-invalid')), 'ad playback address is not a fallback');

// The next feed card is not in the initial hydration script. TikTok supplies
// it through /api/preload/item_list/ after the user scrolls.
const dynamicSnapshots = [];
const documentListeners = {};
let activeFeedId = '9876543211';
const dynamicCard = {
  ...feedCard,
  querySelector(selector) {
    if (selector === '[data-more-menu-item-id]') return { getAttribute: () => activeFeedId };
    if (selector === '[id^="xgwrapper-"]') return { id: 'xgwrapper-0-' + activeFeedId };
    return null;
  }
};
const dynamicPlayer = { ...feedPlayer, parentElement: dynamicCard, closest: () => dynamicCard };
const dynamicDocument = {
  ...feedDocument,
  addEventListener(name, listener) { documentListeners[name] = listener; },
  querySelectorAll(selector) { return selector === 'video' ? [dynamicPlayer] : []; }
};
const nextFeedItem = {
  ...feedItem,
  id: '9876543213',
  desc: 'A later recommended video',
  video: {
    ...feedItem.video,
    play_addr: 'https://v16-webapp-prime.tiktok.com/video/later-play.mp4',
    downloadAddr: 'https://v16-webapp-prime.tiktok.com/video/later-download.mp4'
  }
};
const dynamicWindow = {
  innerHeight: 800,
  innerWidth: 1000,
  addEventListener() {},
  postMessage(message) { dynamicSnapshots.push(message); },
  fetch: async () => ({ clone: () => ({ json: async () => ({ itemList: [nextFeedItem] }) }) })
};
const dynamicContext = vm.createContext({
  window: dynamicWindow, document: dynamicDocument, location: feedLocation,
  history: { pushState() {}, replaceState() {} },
  URL, Date, Math, Set, Map, WeakSet, Array, Object, String, Number, RegExp,
  MutationObserver, setTimeout, clearTimeout, setInterval: () => 0, queueMicrotask
});
vm.runInContext(readFileSync(path.join(root, 'content', 'page-agent.js'), 'utf8'), dynamicContext, { filename: 'page-agent-later-feed.js' });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(dynamicSnapshots.at(-1).payload.video.id, '9876543211');
activeFeedId = '9876543213';
documentListeners.scroll();
await new Promise((resolve) => setTimeout(resolve, 400));
assert.equal(dynamicSnapshots.at(-1).payload.reason, 'no-matching-item', 'old video is cleared while the next item loads');
await dynamicWindow.fetch('/api/preload/item_list/');
await new Promise((resolve) => setTimeout(resolve, 400));
assert.equal(dynamicSnapshots.at(-1).payload.video.id, '9876543213', 'the fetched item is matched to the newly visible card');
assert.ok(dynamicSnapshots.at(-1).payload.video.resources.some((resource) => resource.url.includes('later-') || resource.backupUrls?.some((url) => url.includes('later-'))));
console.log('detail-page, initial feed and scroll-loaded feed parsing passed');
