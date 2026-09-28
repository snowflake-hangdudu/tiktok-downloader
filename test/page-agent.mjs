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
      codecType: 'h265_hvc1',
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
assert.equal(fakeVideos.some((resource) => resource.height === 1920), false, 'undersized fake 1920p streams are hidden');
assert.ok(fakeVideos.some((resource) => resource.height === 1280), 'valid 720p stream remains available');
const low = payload.video.resources.find((resource) => resource.type === 'video');
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
assert.ok(highest.url.endsWith('/feed-1080.mp4') || highest.backupUrls.includes('https://v16-webapp-prime.tiktok.com/video/feed-1080.mp4'));
assert.ok(highest.backupUrls.includes('https://v19-webapp-prime.tiktok.com/video/feed-1080-backup.mp4') || highest.url.endsWith('/feed-1080-backup.mp4'));
assert.equal(feedPayload.creator.username, 'sample_creator');
console.log('detail-page parsing and blob-backed active-feed resource detection passed');
