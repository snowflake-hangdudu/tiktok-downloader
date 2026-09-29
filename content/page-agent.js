/**
 * TikTok Downloader -- page data reader (MAIN world).
 * Reads the page's public DOM and hydration data. Sponsored feed cards may
 * need their public detail page because the feed supplies an ad playback URL.
 */
(function () {
  'use strict';

  if (window.__TIKTOK_DOWNLOADER_PAGE_AGENT__) return;
  window.__TIKTOK_DOWNLOADER_PAGE_AGENT__ = true;
  window.__TIKTOK_DOWNLOADER_PAGE_AGENT_VERSION__ = 4;

  const SOURCE = 'tiktok-downloader-page-agent';
  const CONTENT_SOURCE = 'tiktok-downloader-content';
  const MAX_NODES = 7000;
  const MAX_DEPTH = 18;
  let scheduled = 0;
  let lastUrl = location.href;
  let lastSnapshotJson = '';
  const fetchedItems = new Map();
  const recentVideos = new Map();
  const sponsoredDetails = new Map();
  const sponsoredRequests = new Map();
  const sponsoredFailures = new Map();

  const resolveQueue = [];
  let resolveActive = 0;
  let resolveEpoch = 0;

  function loadVideoDetail(id, pageUrl) {
    if (sponsoredRequests.has(id) || typeof window.fetch !== 'function') return Promise.resolve(false);
    if (Date.now() - (sponsoredFailures.get(id) || 0) < 30000) return Promise.resolve(false);
    const detailed = sponsoredDetails.get(id);
    if (detailed && chromeDownloadable(detailed)) return Promise.resolve(true);
    let url;
    try { url = new URL(pageUrl, location.origin); } catch (_) { return Promise.resolve(false); }
    if (url.origin !== location.origin || !new RegExp('/video/' + id + '/?$').test(url.pathname)) return Promise.resolve(false);
    const request = window.fetch(url.href, { credentials: 'same-origin' }).then(async (response) => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const html = await response.text();
      const raw = html.match(/<script\b[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
      if (!raw) throw new Error('作品页没有视频数据');
      const scope = JSON.parse(raw)?.__DEFAULT_SCOPE__;
      const item = itemStruct(scope?.['webapp.video-detail']?.itemInfo?.itemStruct);
      if (text(item?.id) !== id || !makeVideo(item)?.resources.some((resource) => resource.type === 'video')) {
        throw new Error('作品页没有匹配的下载资源');
      }
      fetchedItems.delete(id);
      fetchedItems.set(id, item);
      while (fetchedItems.size > 1000) fetchedItems.delete(fetchedItems.keys().next().value);
      item.__detailResolved = true;
      sponsoredDetails.set(id, item);
      while (sponsoredDetails.size > 1000) sponsoredDetails.delete(sponsoredDetails.keys().next().value);
      queueEmit();
      return true;
    }).catch((error) => {
      sponsoredFailures.set(id, Date.now());
      console.warn('[TikTokDL] 作品页解析失败', id, error);
      return false;
    }).finally(() => {
      sponsoredRequests.delete(id);
    });
    sponsoredRequests.set(id, request);
    return request;
  }

  function enqueueVideoResolve(videos, epoch) {
    if (epoch) resolveEpoch = epoch;
    (Array.isArray(videos) ? videos : []).forEach((video) => {
      const id = text(video?.id);
      const pageUrl = text(video?.pageUrl);
      if (!/^\d{6,}$/.test(id) || !pageUrl) return;
      if (resolveQueue.some((item) => item.id === id) || sponsoredRequests.has(id)) return;
      if (sponsoredDetails.has(id) && chromeDownloadable(sponsoredDetails.get(id))) return;
      resolveQueue.push({ id, pageUrl });
    });
    pumpVideoResolve();
  }

  let resolveIdleTimer = 0;
  function notifyResolveIdle() {
    window.postMessage({
      source: SOURCE,
      type: 'RESOLVE_IDLE',
      epoch: resolveEpoch
    }, location.origin);
  }

  function scheduleResolveIdle() {
    clearTimeout(resolveIdleTimer);
    const epoch = resolveEpoch;
    resolveIdleTimer = setTimeout(() => {
      resolveIdleTimer = 0;
      if (epoch !== resolveEpoch || resolveActive !== 0 || resolveQueue.length) return;
      notifyResolveIdle();
    }, 0);
  }

  function pumpVideoResolve() {
    while (resolveActive < 2 && resolveQueue.length) {
      const job = resolveQueue.shift();
      resolveActive += 1;
      loadVideoDetail(job.id, job.pageUrl).finally(() => {
        resolveActive -= 1;
        pumpVideoResolve();
      });
    }
    if (resolveActive === 0 && !resolveQueue.length) scheduleResolveIdle();
    else clearTimeout(resolveIdleTimer);
  }

  function loadSponsoredDetail(id, pageUrl) {
    enqueueVideoResolve([{ id, pageUrl }]);
  }

  function rememberItems(data) {
    const lists = [];
    [data, data?.data].forEach((source) => {
      [source?.itemList, source?.item_list, source?.aweme_list, source?.items,
        source?.pinnedItemList, source?.pinned_item_list, source?.pinnedItems, source?.pinned_items,
        source?.pinnedList, source?.pinnedPostList, source?.pinnedVideoList,
        source?.topItemList, source?.top_item_list].filter(Array.isArray).forEach((list) => lists.push(list));
      if (source?.itemInfo?.itemStruct) lists.push([source.itemInfo.itemStruct]);
      if (source?.itemStruct) lists.push([source.itemStruct]);
    });
    if (!lists.length) return;
    let added = false;
    lists.flatMap((list) => list.slice(0, 100)).forEach((value) => {
      const item = itemStruct(value);
      const id = text(item?.id || item?.awemeId || item?.aweme_id || item?.itemId || item?.item_id);
      if (!/^\d{6,}$/.test(id) || !item.video) return;
      fetchedItems.delete(id);
      fetchedItems.set(id, item);
      added = true;
    });
    while (fetchedItems.size > 1000) fetchedItems.delete(fetchedItems.keys().next().value);
    if (added) queueEmit();
  }

  function watchItemResponses() {
    if (typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch;
    window.fetch = function () {
      const input = arguments[0];
      const request = originalFetch.apply(this, arguments);
      let path = '';
      try { path = new URL(typeof input === 'string' ? input : input?.url, location.href).pathname; } catch (_) {}
      if (!/^\/api\/.*(?:item_list|item\/detail)/i.test(path)) return request;
      return request.then((response) => {
        try { response.clone().json().then(rememberItems).catch(() => {}); } catch (_) {}
        return response;
      });
    };
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
  }

  function isOurUiNode(node) {
    try {
      return !!(node?.closest?.('#tiktok-dl-root, #tiktok-dl-toggle, .dl-kit')
        || node?.id === 'tiktok-dl-root'
        || node?.id === 'tiktok-dl-toggle');
    } catch (_) {
      return false;
    }
  }

  /** Reject player chrome, masked anti-bot text, and our own panel copy. */
  function cleanCaption(value) {
    let valueText = text(value);
    if (!valueText) return '';
    valueText = valueText
      .replace(/\b\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!valueText) return '';
    if (/TikTok\s*下载助手|开始下载|清晰度|保存为|查看浏览器下载记录|文件名预览|预计大小/.test(valueText)) return '';
    if (/\b\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}\b/.test(valueText) && valueText.length < 40) return '';
    const letters = valueText.replace(/\s+/g, '');
    const masked = (letters.match(/x/gi) || []).length;
    if (letters.length >= 4 && masked / letters.length >= 0.7) return '';
    return valueText.slice(0, 500);
  }

  function cleanAuthorName(value) {
    const name = cleanCaption(value);
    if (!name) return '';
    if (/^@?x{3,}$/i.test(name)) return '';
    return name.slice(0, 80);
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function httpsUrl(value) {
    const raw = text(value);
    if (!raw) return '';
    try {
      const url = new URL(raw, location.href);
      return url.protocol === 'https:' ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function isCdnMediaUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:') return false;
      const host = url.hostname.toLowerCase();
      if (host === 'tiktok.com' || /^(www|m|vm|vt)\.tiktok\.com$/.test(host)) return false;
      return /(^|\.)(tiktok\.com|tiktokv\.com|tiktokcdn\.com|tiktokcdn-us\.com|byteoversea\.com|ibytedtos\.com|ttwstatic\.com|muscdn\.com|byteimg\.com|bytecdn\.cn)$/.test(host);
    } catch (_) {
      return false;
    }
  }

  function firstHttps(value) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = firstHttps(item);
        if (found) return found;
      }
      return '';
    }
    if (value && typeof value === 'object') {
      for (const candidate of [value.url_list, value.urlList, value.UrlList, value.url, value.Url, value.src]) {
        const found = firstHttps(candidate);
        if (found) return found;
      }
      return '';
    }
    return httpsUrl(value);
  }

  function urlList(value) {
    if (Array.isArray(value)) return [...new Set(value.flatMap(urlList))];
    if (value && typeof value === 'object') {
      return [...new Set([value.url_list, value.urlList, value.UrlList, value.url, value.Url, value.src].flatMap(urlList))];
    }
    const url = httpsUrl(value);
    return url ? [url] : [];
  }

  function stripLocale(pathname) {
    return text(pathname).replace(/^\/[a-z]{2}(?:-[A-Za-z0-9]{2,8})?(?=\/)/, '');
  }

  function digitsId(value) {
    const match = text(value).match(/(\d{8,})/);
    return match ? match[1] : '';
  }

  function pageMatch() {
    const path = stripLocale(location.pathname);
    const video = path.match(/^\/@([^/?#]+)\/video\/(\d+)(?:\/|$)/i);
    if (video) return { kind: 'video', username: decodeURIComponent(video[1]), id: video[2] };
    const shortVideo = path.match(/^\/video\/(\d+)(?:\/|$)/i);
    if (shortVideo) return { kind: 'video', username: '', id: shortVideo[1] };
    const photo = path.match(/^\/@([^/?#]+)\/photo\/(\d+)(?:\/|$)/i);
    if (photo) return { kind: 'photo', username: decodeURIComponent(photo[1]), id: photo[2] };
    const creator = path.match(/^\/@([^/?#]+)\/?$/i);
    return creator ? { kind: 'creator', username: decodeURIComponent(creator[1]), id: '' } : { kind: 'feed', username: '', id: '' };
  }

  function published(value) {
    const n = positiveNumber(value);
    if (!n) return '';
    return n < 100000000000 ? new Date(n * 1000).toISOString() : new Date(n).toISOString();
  }

  function mediaFormat(url, mime) {
    const match = text(url).match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
    const ext = match ? match[1].toLowerCase() : '';
    if (/^audio\/(mpeg|mp3)/i.test(text(mime))) return 'mp3';
    if (/^audio\/(mp4|x-m4a|m4a)/i.test(text(mime))) return 'm4a';
    if (/^audio\/aac/i.test(text(mime))) return 'aac';
    if (/^audio\/ogg/i.test(text(mime))) return 'ogg';
    if (/^audio\/wav/i.test(text(mime))) return 'wav';
    if (['mp3', 'm4a', 'aac', 'ogg', 'wav'].includes(ext)) return ext;
    if (/^audio\//i.test(text(mime))) return '';
    if (ext) return ext;
    if (/video/i.test(mime)) return 'mp4';
    return '';
  }

  function dimensionsLabel(width, height) {
    return width && height ? width + '×' + height : '原始资源';
  }

  function streamLabel(resource) {
    const width = positiveNumber(resource?.width);
    const height = positiveNumber(resource?.height);
    const resolution = width && height ? Math.min(width, height) : height || width;
    const family = codecFamily(resource?.codec);
    const codecLabel = family === 'h264' ? 'H.264' : family === 'h265' ? 'HEVC' : '';
    return [resolution ? resolution + 'P' : '', codecLabel].filter(Boolean).join(' ') || '视频';
  }

  function codecFamily(value) {
    const codec = text(value).toLowerCase();
    if (/265|hevc|hvc/.test(codec)) return 'h265';
    if (/264|avc/.test(codec)) return 'h264';
    return 'other';
  }

  function resourceScore(resource) {
    return positiveNumber(resource?.sizeBytes)
      || positiveNumber(resource?.estimatedBytes)
      || positiveNumber(resource?.bitrate)
      || 0;
  }

  function sourceRank(source) {
    const value = text(source);
    if (value === '页面下载') return 4;
    if (value === '画质档位') return 3;
    if (value === '页面播放') return 1;
    if (value === '播放器') return 0;
    return 2;
  }

  function resourcePriority(resource) {
    return sourceRank(resource?.source) * 1e15 + resourceScore(resource);
  }

  function playbackRank(resource) {
    const family = codecFamily(resource?.codec);
    if (family === 'h264') return 2;
    if (family === 'h265') return 0;
    return 1;
  }

  function backupPreference(resource) {
    return playbackRank(resource) * 10 + sourceRank(resource?.source);
  }

  function isDownloadableSource(resource) {
    return sourceRank(resource?.source) >= 3;
  }

  function chromeDownloadable(item) {
    return !!makeVideo(item)?.resources.some((resource) => resource.type === 'video' && isDownloadableSource(resource));
  }

  function betterPlayback(candidate, current) {
    const byCodec = playbackRank(candidate) - playbackRank(current);
    if (byCodec !== 0) return byCodec > 0;
    return resourcePriority(candidate) > resourcePriority(current);
  }

  /** Prefer addresses that chrome.downloads can fetch; play-only CDN links often return 没有权限. */
  function betterPrimary(candidate, current) {
    const candDl = isDownloadableSource(candidate);
    const currDl = isDownloadableSource(current);
    if (candDl !== currDl) return candDl;
    const candCodec = codecFamily(candidate?.codec);
    const currCodec = codecFamily(current?.codec);
    if ((candCodec === 'h264') !== (currCodec === 'h264')) return candCodec === 'h264';
    const candSize = positiveNumber(candidate.sizeBytes) || positiveNumber(candidate.estimatedBytes);
    const currSize = positiveNumber(current.sizeBytes) || positiveNumber(current.estimatedBytes);
    if ((candSize > 0) !== (currSize > 0)) return candSize > 0;
    return betterPlayback(candidate, current);
  }

  function isUsableVideoResource(resource) {
    if (!resource?.url || resource.type !== 'video') return false;
    if (sourceRank(resource.source) <= 0) return false;
    // TikTok's HEVC PlayAddr is often scoped to its own player and Chrome
    // downloads rejects it with SERVER_FORBIDDEN. Only use HEVC when TikTok
    // explicitly supplies a download address for that stream.
    if (resource.source === '页面播放' && codecFamily(resource.codec) === 'h265') return false;
    return true;
  }

  function isUsableAudioResource(resource, videos) {
    if (!resource?.url || resource.type !== 'audio') return false;
    if (!/^audio\//i.test(text(resource.mime))) return false;
    const videoUrls = new Set();
    videos.forEach((item) => {
      videoUrls.add(item.url);
      (item.backupUrls || []).forEach((url) => videoUrls.add(url));
    });
    if (videoUrls.has(resource.url)) return false;
    const audioSize = resourceScore(resource);
    if (audioSize < 16 * 1024) return false;
    const maxVideoSize = videos.reduce((max, item) => Math.max(max, resourceScore(item)), 0);
    if (maxVideoSize > 0 && audioSize >= maxVideoSize * 0.45) return false;
    return true;
  }

  function finalizeVideoResources(resources) {
    const videos = resources
      .filter((item) => item.type === 'video' && isUsableVideoResource(item))
      .sort((a, b) => {
        const pxA = (a.width || 0) * (a.height || 0);
        const pxB = (b.width || 0) * (b.height || 0);
        return pxB - pxA || resourcePriority(b) - resourcePriority(a);
      });
    const audios = resources
      .filter((item) => item.type === 'audio')
      .filter((item) => isUsableAudioResource(item, videos));
    return [...videos, ...audios];
  }

  function uniqueUrls(list) {
    const seen = [];
    (Array.isArray(list) ? list : []).forEach((url) => {
      if (url && !seen.includes(url)) seen.push(url);
    });
    return seen;
  }

  function consolidateVideoResources(videos) {
    if (!videos.length) return [];
    const downloadable = videos.filter(isDownloadableSource);
    const playOnly = videos.filter((item) => !isDownloadableSource(item));
    const ranked = downloadable.length ? downloadable : playOnly;
    let best = ranked[0];
    ranked.slice(1).forEach((item) => {
      if (betterPrimary(item, best)) best = item;
    });
    const playUrls = uniqueUrls([
      ...playOnly.flatMap((item) => [item.url, ...(item.backupUrls || [])]),
      ...downloadable.flatMap((item) => Array.isArray(item.downloadUrls)
        ? (item.backupUrls || []).filter((url) => !item.downloadUrls.includes(url)) : [])
    ]);
    const playUrlSet = new Set(playUrls);
    const downloadUrls = uniqueUrls(downloadable.flatMap((item) => Array.isArray(item.downloadUrls)
      ? item.downloadUrls : [item.url, ...(item.backupUrls || [])]))
      .filter((url) => !playUrlSet.has(url) || downloadable.some((item) => item.url === url));
    const primary = downloadUrls[0] || best.url;
    return [{
      ...best,
      url: primary,
      downloadUrls: downloadUrls.length ? downloadUrls : undefined,
      backupUrls: uniqueUrls([...downloadUrls.filter((url) => url !== primary), ...playUrls]).slice(0, 12),
      source: downloadUrls.length ? (isDownloadableSource(best) ? best.source : '页面下载') : best.source,
      mergedHeights: [...new Set(videos.map((item) => item.height).filter(Boolean))],
      quality: streamLabel(best)
    }];
  }

  /** One row per resolution. Extra URLs stay as silent fallbacks. */
  function consolidateResources(resources) {
    if (!Array.isArray(resources) || !resources.length) return [];
    const videos = resources.filter((item) => item.type === 'video' && item.url);
    const groups = new Map();
    resources.filter((item) => item.type !== 'video' && item.url).forEach((resource) => {
      const key = resource.type + ':' + resource.url;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { ...resource, backupUrls: [...(resource.backupUrls || [])] });
        return;
      }
      const backups = uniqueUrls([existing.url, ...(existing.backupUrls || []), resource.url, ...(resource.backupUrls || [])])
        .filter((url) => url !== existing.url)
        .slice(0, 12);
      groups.set(key, { ...existing, backupUrls: backups });
    });
    return [...consolidateVideoResources(videos), ...groups.values()];
  }

  function addResource(resources, seen, type, raw, width, height, mime, sizeBytes, bitrate, duration, formatHint, codec, source) {
    const urls = urlList(raw).filter((url) => isCdnMediaUrl(url) && !seen.has(type + ':' + url));
    if (!urls.length) return;
    urls.forEach((url) => seen.add(type + ':' + url));
    const size = positiveNumber(sizeBytes);
    const bits = positiveNumber(bitrate);
    const seconds = positiveNumber(duration);
    resources.push({
      type,
      url: urls[0],
      backupUrls: urls.slice(1),
      quality: dimensionsLabel(width, height),
      width: width || 0,
      height: height || 0,
      sizeBytes: size || 0,
      estimatedBytes: size || (bits && seconds ? Math.round(bits * seconds / 8) : 0),
      bitrate: bits,
      codec: text(codec),
      source: text(source),
      format: text(formatHint).toLowerCase() || mediaFormat(urls[0], mime),
      mime: text(mime)
    });
  }

  function authorFrom(item) {
    const author = item?.author || item?.authorInfo || item?.authorMeta || {};
    return {
      id: text(author.id || author.uid || author.userId || item?.authorId),
      username: text(author.uniqueId || author.unique_id || author.username || author.userName),
      displayName: text(author.nickname || author.nickName || author.displayName || author.name),
      avatar: firstHttps(author.avatarLarger || author.avatarMedium || author.avatarThumb || author.avatar)
    };
  }

  function itemStruct(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.itemStruct && typeof value.itemStruct === 'object') return value.itemStruct;
    if (value.itemInfo?.itemStruct && typeof value.itemInfo.itemStruct === 'object') return value.itemInfo.itemStruct;
    if (value.aweme_detail && typeof value.aweme_detail === 'object') return value.aweme_detail;
    if (value.video && (value.id || value.awemeId || value.aweme_id || value.itemId || value.item_id)) return value;
    return null;
  }

  function makeVideo(item, fallbackId) {
    item = itemStruct(item) || item;
    if (!item || typeof item !== 'object') return null;
    const id = text(item.id || item.awemeId || item.aweme_id || item.itemId || item.item_id || fallbackId);
    if (!/^\d+$/.test(id)) return null;
    const video = item.video || item.videoInfo || {};
    const author = authorFrom(item);
    const width = positiveNumber(video.width || video.widthPx || video.originWidth);
    const height = positiveNumber(video.height || video.heightPx || video.originHeight);
    const duration = positiveNumber(video.duration || item.duration);
    const resources = [];
    const seen = new Set();
    addResource(resources, seen, 'video', [video.downloadAddr, video.download_addr, video.DownloadAddr], width, height, video.mimeType || video.mime,
      video.size || video.downloadAddr?.size || video.download_addr?.size, video.bitrate || video.bitRate, duration, video.format, video.codecType, '页面下载');
    addResource(resources, seen, 'video', [video.playAddr, video.play_addr, video.PlayAddr], width, height, video.mimeType || video.mime,
      video.size || video.playAddr?.size || video.play_addr?.size, video.bitrate || video.bitRate, duration, video.format, video.codecType, '页面播放');
    const bitrates = [video.bitrateInfo, video.bitrate_info, video.BitrateInfo].find((value) => Array.isArray(value) && value.length) || [];
    bitrates.forEach((entry) => {
      const addressInfo = [entry.downloadAddr, entry.download_addr, entry.DownloadAddr, entry.playAddr, entry.play_addr, entry.PlayAddr]
        .find((candidate) => candidate && typeof candidate === 'object' && urlList(candidate).length) || {};
      const entryWidth = positiveNumber(entry.width || entry.Width || addressInfo.width || addressInfo.Width) || width;
      const entryHeight = positiveNumber(entry.height || entry.Height || addressInfo.height || addressInfo.Height) || height;
      const entryMime = entry.mimeType || entry.mime || addressInfo.MimeType || '';
      const entrySize = entry.size || entry.fileSize || entry.file_size || entry.DataSize || addressInfo.DataSize;
      const entryBitrate = entry.bitrate || entry.bitRate || entry.Bitrate;
      const entryFormat = entry.format || entry.Format;
      const entryCodec = entry.codecType || entry.CodecType;
      addResource(resources, seen, 'video', [entry.downloadAddr, entry.download_addr, entry.DownloadAddr],
        entryWidth, entryHeight, entryMime, entrySize, entryBitrate, duration, entryFormat, entryCodec, '画质档位');
      addResource(resources, seen, 'video', [entry.playAddr, entry.play_addr, entry.PlayAddr, entry.url, entry.url_list],
        entryWidth, entryHeight, entryMime, entrySize, entryBitrate, duration, entryFormat, entryCodec, '页面播放');
    });
    const music = item.music || item.musicInfo || {};
    addResource(resources, seen, 'audio', [music.downloadUrl, music.download_url, music.DownloadUrl], 0, 0, music.mimeType || music.mime,
      music.size || music.fileSize || music.file_size, music.bitrate || music.bitRate, positiveNumber(music.duration) || duration,
      music.format || music.Format, music.codecType || music.codec, '页面下载');
    addResource(resources, seen, 'audio', [music.playUrl, music.play_url, music.PlayUrl], 0, 0, music.mimeType || music.mime,
      music.size || music.fileSize || music.file_size, music.bitrate || music.bitRate, positiveNumber(music.duration) || duration,
      music.format || music.Format, music.codecType || music.codec, '页面播放');
    const cover = firstHttps([
      video.originCover, video.origin_cover, video.OriginCover,
      item.originCover, item.origin_cover,
      video.dynamicCover, video.dynamic_cover,
      video.cover, item.cover
    ]);
    const pageUrl = author.username ? 'https://www.tiktok.com/@' + encodeURIComponent(author.username) + '/video/' + id : location.origin + '/video/' + id;
    const pinned = item.isPinned === true || item.isPinnedItem === true || item.is_pinned === true || item.isTop === 1 || item.isTop === true;
    return {
      id,
      pageUrl,
      title: cleanCaption(item.desc || item.title || item.description),
      description: cleanCaption(item.desc || item.description),
      author: cleanAuthorName(author.displayName) || author.username,
      authorId: author.id,
      duration,
      publishTime: published(item.createTime || item.create_time || item.createTimestamp),
      cover,
      pinned,
      detailResolved: item.__detailResolved === true,
      resources: consolidateResources(finalizeVideoResources(resources))
    };
  }

  function pinnedIdsFromState() {
    const ids = [];
    const seen = new Set();
    function take(list) {
      if (!Array.isArray(list)) return;
      list.forEach((value) => {
        const item = itemStruct(value) || value;
        const id = text(item?.id || item?.awemeId || item?.aweme_id || item?.itemId || item?.item_id);
        if (!/^\d{6,}$/.test(id) || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
      });
    }
    function walk(value, depth) {
      if (!value || typeof value !== 'object' || depth > 6) return;
      if (Array.isArray(value)) return;
      Object.keys(value).forEach((key) => {
        const child = value[key];
        if (/^(pinned|pin)(item|video|post|aweme)?list$|^top_?item_?list$|^pinned_items$/i.test(key) && Array.isArray(child)) take(child);
        else if (child && typeof child === 'object') walk(child, depth + 1);
      });
    }
    walk(window.__UNIVERSAL_DATA_FOR_REHYDRATION__?.__DEFAULT_SCOPE__, 0);
    walk(window.SIGI_STATE, 0);
    return ids;
  }

  function collectState() {
    const values = [];
    const seen = new WeakSet();
    let visited = 0;
    const roots = [
      window.__UNIVERSAL_DATA_FOR_REHYDRATION__,
      window.SIGI_STATE,
      window.__NEXT_DATA__,
      document.getElementById('SIGI_STATE')?.textContent,
      document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent,
      document.getElementById('__NEXT_DATA__')?.textContent
    ];
    function walk(value, depth) {
      if (!value || typeof value !== 'object' || visited >= MAX_NODES || depth > MAX_DEPTH || seen.has(value)) return;
      seen.add(value);
      visited += 1;
      const item = itemStruct(value);
      if (item) values.push(item);
      if (Array.isArray(value)) {
        value.slice(0, 200).forEach((child) => walk(child, depth + 1));
      } else {
        Object.keys(value).slice(0, 250).forEach((key) => walk(value[key], depth + 1));
      }
    }
    roots.forEach((root) => {
      if (typeof root === 'string' && root.length < 4000000) {
        try { walk(JSON.parse(root), 0); } catch (_) { /* non JSON scripts are ignored */ }
      } else {
        walk(root, 0);
      }
    });
    const byId = new Map();
    values.forEach((item) => {
      const video = makeVideo(item);
      if (video && !byId.has(video.id)) byId.set(video.id, { item, video });
    });
    fetchedItems.forEach((item) => {
      const video = makeVideo(item);
      if (video) byId.set(video.id, { item, video });
    });
    sponsoredDetails.forEach((item) => {
      const video = makeVideo(item);
      if (video) byId.set(video.id, { item, video });
    });
    return [...byId.values()];
  }

  function findStateItem(id) {
    if (!/^\d{6,}$/.test(id)) return null;
    const sponsored = sponsoredDetails.get(id);
    if (sponsored) {
      const video = makeVideo(sponsored);
      if (video) return { item: sponsored, video };
    }
    const fetched = fetchedItems.get(id);
    if (fetched) {
      const video = makeVideo(fetched);
      if (video) return { item: fetched, video };
    }
    const seen = new WeakSet();
    const budget = { left: 5000 };
    const roots = [
      window.__UNIVERSAL_DATA_FOR_REHYDRATION__,
      window.SIGI_STATE,
      window.__NEXT_DATA__
    ];
    function visit(value, depth) {
      if (!value || typeof value !== 'object' || budget.left <= 0 || depth > 24 || seen.has(value)) return null;
      seen.add(value);
      budget.left -= 1;
      if (value[id] && typeof value[id] === 'object') {
        const direct = itemStruct(value[id]) || value[id];
        const rawId = text(direct.id || direct.awemeId || direct.aweme_id || direct.itemId || direct.item_id || id);
        if (rawId === id) {
          const video = makeVideo(direct, id);
          if (video?.id === id) return { item: direct, video };
        }
      }
      const item = itemStruct(value);
      if (item) {
        const rawId = text(item.id || item.awemeId || item.aweme_id || item.itemId || item.item_id);
        if (rawId === id) {
          const video = makeVideo(item);
          if (video?.id === id) return { item, video };
        }
      }
      const children = Array.isArray(value) ? value.slice(0, 40) : Object.keys(value).slice(0, 80).map((key) => value[key]);
      for (const child of children) {
        const found = visit(child, depth + 1);
        if (found) return found;
      }
      return null;
    }
    for (const root of roots) {
      const found = visit(root, 0);
      if (found) return found;
    }
    return null;
  }

  function meta(selector) {
    return text(document.querySelector(selector)?.content);
  }

  function currentDomPlayer() {
    const players = [...document.querySelectorAll('video')];
    return players.map((player, index) => {
      const source = text(player.currentSrc || player.src || player.querySelector('source')?.src);
      if (!source && positiveNumber(player.readyState) < 2) return null;
      let score = 1;
      if (source) score += 5;
      if (player.paused === false && player.ended !== true) score += 100;
      if (positiveNumber(player.readyState) >= 2) score += 15;
      if (positiveNumber(player.videoWidth) && positiveNumber(player.videoHeight)) score += 5;
      try {
        const rect = player.getBoundingClientRect();
        const viewportHeight = positiveNumber(window.innerHeight || document.documentElement.clientHeight) || rect.bottom;
        const viewportWidth = positiveNumber(window.innerWidth || document.documentElement.clientWidth) || rect.right;
        const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        score += Math.round(visibleWidth * visibleHeight / 1000);
      } catch (_) {}
      return { player, index, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.index - b.index)[0]?.player || null;
  }

  function feedContext(player) {
    const context = { id: '', ids: [], username: '', text: '', sponsored: false };
    const card = player.closest?.('[data-e2e="feed-video"], [id^="media-card-"], [data-e2e="recommend-list-item-container"], article, [id^="one-column-item"]')
      || player.parentElement;
    context.sponsored = !!card?.querySelector?.('[data-e2e="ad-tag"]');
    const pushId = (value) => {
      const id = digitsId(value);
      if (id && !context.ids.includes(id)) context.ids.push(id);
    };
    pushId(card?.querySelector?.('[data-more-menu-item-id]')?.getAttribute('data-more-menu-item-id'));
    pushId(card?.querySelector?.('[id^="xgwrapper-"]')?.id);
    let current = player;
    for (let depth = 0; current && depth < 18; depth += 1, current = current.parentElement) {
      if (isOurUiNode(current) || current === document.body || current === document.documentElement) break;
      if (/^xgwrapper-/i.test(current.id || '')) pushId(current.id);
      pushId(current.getAttribute?.('data-e2e-vid'));
      const desc = current.querySelector?.([
        '[data-e2e="video-desc"]',
        '[data-e2e="browse-video-desc"]',
        '[data-e2e="new-desc-span"]',
        '[data-e2e="video-desc-content"]'
      ].join(', '));
      if (!isOurUiNode(desc)) {
        const descText = cleanCaption(desc?.innerText || desc?.textContent);
        if (!context.text && descText.length >= 1) context.text = descText;
      }
      const nick = current.querySelector?.([
        '[data-e2e="video-author-nickname"]',
        '[data-e2e="browse-username"]',
        '[data-e2e="video-author-uniqueid"]'
      ].join(', '));
      if (!context.username && nick && !isOurUiNode(nick)) {
        const nickText = cleanAuthorName(nick.innerText || nick.textContent).replace(/^@/, '');
        if (nickText && !/^x{3,}$/i.test(nickText)) context.username = nickText;
      }
      const anchors = current.querySelectorAll?.('a[href]') || [];
      for (const anchor of anchors) {
        if (isOurUiNode(anchor)) continue;
        let url;
        try { url = new URL(anchor.href || anchor.getAttribute('href'), location.href); } catch (_) { continue; }
        const path = stripLocale(url.pathname);
        const videoMatch = path.match(/^\/@([^/]+)\/video\/(\d+)/i) || path.match(/^\/video\/(\d+)/i);
        if (videoMatch) {
          pushId(videoMatch[videoMatch.length - 1]);
          if (!context.username && videoMatch.length > 1 && path.startsWith('/@')) context.username = decodeURIComponent(videoMatch[1]);
        }
        const authorMatch = path.match(/^\/@([^/?#]+)\/?$/i);
        if (!context.username && authorMatch) context.username = decodeURIComponent(authorMatch[1]);
      }
      if (context.ids.length && context.username && context.text) break;
    }
    context.id = context.ids[0] || '';
    return context;
  }

  function normalizedCaption(value) {
    return text(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  function feedItem(items, context, playerUrl) {
    const ids = context.ids?.length ? context.ids : (context.id ? [context.id] : []);
    for (const id of ids) {
      const exact = items.find(({ video }) => video.id === id);
      if (exact) return exact;
    }
    if (ids.length) return null;
    const exactResource = playerUrl && items.find(({ video }) => video.resources.some((resource) => resource.type === 'video' && resource.url === playerUrl));
    if (exactResource) return exactResource;
    const authorItems = context.username
      ? items.filter(({ item }) => authorFrom(item).username.toLowerCase() === context.username.toLowerCase())
      : [];
    const caption = normalizedCaption(context.text);
    const captionPool = authorItems.length ? authorItems : items;
    const captionMatches = captionPool.filter(({ item }) => {
      const description = normalizedCaption(item.desc || item.title || item.description);
      return description.length >= 6 && caption.includes(description);
    });
    if (captionMatches.length === 1) return captionMatches[0];
    if (captionMatches.length > 1) return null;
    return authorItems.length === 1 ? authorItems[0] : null;
  }

  function withPlayerResource(video, player, context) {
    if (!video) return null;
    const url = httpsUrl(player?.currentSrc || player?.src || player?.querySelector('source')?.src);
    const resources = Array.isArray(video.resources) ? [...video.resources] : [];
    if (url && !resources.some((resource) => resource.type === 'video' && resource.url === url)) {
      const width = positiveNumber(player.videoWidth || player.width);
      const height = positiveNumber(player.videoHeight || player.height);
      resources.push({
        type: 'video', url, quality: dimensionsLabel(width, height), width: width || 0, height: height || 0,
        format: mediaFormat(url, 'video/mp4'), mime: 'video/mp4', backupUrls: [], source: '播放器'
      });
    }
    return {
      ...video,
      title: cleanCaption(video.title) || cleanCaption(context?.text) || '',
      author: cleanAuthorName(video.author) || cleanAuthorName(context?.username) || video.author || context?.username || '',
      duration: video.duration || positiveNumber(player?.duration),
      cover: video.cover || httpsUrl(player?.poster),
      resources: consolidateResources(finalizeVideoResources(resources))
    };
  }

  function domVideo(id, username, player) {
    player = player || currentDomPlayer() || document.querySelector('video');
    if (!player) return null;
    const url = httpsUrl(player.currentSrc || player.src || player.querySelector('source')?.src);
    if (!url) return null;
    const width = positiveNumber(player.videoWidth || player.width);
    const height = positiveNumber(player.videoHeight || player.height);
    const title = cleanCaption(meta('meta[property="og:title"]'))
      || cleanCaption(document.title.replace(/\s*\|\s*TikTok.*$/i, ''));
    const description = cleanCaption(meta('meta[property="og:description"]') || meta('meta[name="description"]'));
    return {
      id,
      pageUrl: location.href,
      title: title || description || '',
      description,
      author: cleanAuthorName(username) || username || '',
      authorId: '',
      duration: positiveNumber(player.duration),
      publishTime: '',
      cover: httpsUrl(player.poster) || httpsUrl(meta('meta[property="og:image"]')),
      resources: [{ type: 'video', url, quality: dimensionsLabel(width, height), width: width || 0, height: height || 0, format: mediaFormat(url, 'video/mp4'), mime: 'video/mp4' }]
    };
  }

  function imageHttps(node) {
    if (!node) return '';
    if (node.tagName === 'IMG') return httpsUrl(node.currentSrc || node.src);
    const image = node.querySelector?.('img');
    return httpsUrl(image?.currentSrc || image?.src);
  }

  function profileAvatarFromState(username) {
    const scope = window.__UNIVERSAL_DATA_FOR_REHYDRATION__?.__DEFAULT_SCOPE__;
    if (!scope || typeof scope !== 'object') return '';
    const expected = String(username || '').toLowerCase();
    for (const value of Object.values(scope)) {
      const user = value?.userInfo?.user || value?.userInfo || value?.user;
      if (!user || typeof user !== 'object' || Array.isArray(user)) continue;
      const name = text(user.uniqueId || user.unique_id || user.username);
      if (expected && name && name.toLowerCase() !== expected) continue;
      const avatar = firstHttps(user.avatarLarger || user.avatarMedium || user.avatarThumb || user.avatar);
      if (avatar) return avatar;
    }
    return '';
  }

  function profileAvatarFromDom() {
    const marked = imageHttps(document.querySelector('[data-e2e="user-avatar"]'));
    if (marked) return marked;
    const images = document.querySelectorAll('img');
    for (const image of images) {
      if (image.closest('#tiktok-dl-root, a[href*="/video/"]')) continue;
      const src = httpsUrl(image.currentSrc || image.src);
      if (!src || !/tiktokcdn|byteimg|muscdn|ibyteimg|ttwstatic/i.test(src)) continue;
      const width = image.naturalWidth || image.width || 0;
      const height = image.naturalHeight || image.height || 0;
      if (width >= 48 && height >= 48 && Math.abs(width - height) <= Math.max(width, height) * 0.4) return src;
    }
    return '';
  }

  function creatorFromState(items, username) {
    const match = items.find(({ item }) => authorFrom(item).username.toLowerCase() === username.toLowerCase());
    const author = authorFrom(match?.item || items[0]?.item || {});
    const heading = text(document.querySelector('h1')?.textContent);
    return {
      id: author.id,
      username: author.username || username,
      displayName: author.displayName || heading || username,
      avatar: author.avatar || profileAvatarFromState(username) || profileAvatarFromDom()
    };
  }

  function rememberRecentVideo(video) {
    const id = text(video?.id);
    if (!/^\d{6,}$/.test(id)) return video || null;
    const previous = recentVideos.get(id) || {};
    const liveResources = Array.isArray(video?.resources) ? video.resources : [];
    const liveHasVideo = liveResources.some((item) => item?.type === 'video' && item.url);
    const previousResources = Array.isArray(previous.resources) ? previous.resources : [];
    const next = {
      ...previous,
      ...video,
      id,
      title: text(video?.title) || previous.title || '',
      cover: text(video?.cover) || previous.cover || '',
      resources: liveHasVideo ? liveResources : previousResources
    };
    recentVideos.delete(id);
    recentVideos.set(id, next);
    while (recentVideos.size > 10) recentVideos.delete(recentVideos.keys().next().value);
    return next;
  }

  function recentVideo(id) {
    const video = recentVideos.get(text(id));
    if (!video) return null;
    recentVideos.delete(video.id);
    recentVideos.set(video.id, video);
    return { ...video, resources: Array.isArray(video.resources) ? video.resources.map((item) => ({ ...item })) : [] };
  }

  function snapshot() {
    const page = pageMatch();
    const items = collectState();
    if (page.kind === 'video') {
      const selected = items.find(({ video }) => video.id === page.id)?.video;
      const player = currentDomPlayer();
      const video = rememberRecentVideo(withPlayerResource(selected, player, null) || domVideo(page.id, page.username, player) || recentVideo(page.id));
      return { kind: 'video', video, creator: creatorFromState(items, page.username), url: location.href };
    }
    if (page.kind === 'photo') {
      return { kind: 'photo', reason: 'photo', creator: creatorFromState(items, page.username), url: location.href };
    }
    if (page.kind === 'creator') {
      const creator = creatorFromState(items, page.username);
      const pinnedIds = pinnedIdsFromState();
      const pinOrder = new Map(pinnedIds.map((id, index) => [id, index]));
      const videos = items.map(({ video }) => video).filter((video) => video.author && (!creator.username || video.pageUrl.includes('/@' + encodeURIComponent(creator.username) + '/')));
      if (pinnedIds.length) {
        videos.forEach((video) => {
          const index = pinOrder.has(video.id) ? pinOrder.get(video.id) : -1;
          video.pinned = index >= 0;
          video.pinIndex = index;
        });
      }
      const payload = { kind: 'creator', creator, url: location.href };
      if (videos.length) payload.videos = videos.slice(0, 500);
      return payload;
    }
    const player = currentDomPlayer();
    if (!player) return { kind: 'feed', reason: 'no-player', url: location.href };
    const playerUrl = httpsUrl(player.currentSrc || player.src || player.querySelector('source')?.src);
    const context = feedContext(player);
    const ids = context.ids?.length ? context.ids : (context.id ? [context.id] : []);
    const selected = feedItem(items, context, playerUrl) || ids.map((id) => findStateItem(id)).find(Boolean) || null;
    if (context.sponsored && context.id && !sponsoredDetails.has(context.id)) {
      const pageUrl = selected?.video?.pageUrl || (context.username ? location.origin + '/@' + encodeURIComponent(context.username) + '/video/' + context.id : '');
      if (pageUrl) loadSponsoredDetail(context.id, pageUrl);
      const pendingVideo = selected?.video || (context.id ? domVideo(context.id, context.username, player) : null) || recentVideo(context.id);
      if (!pendingVideo) return { kind: 'feed', reason: 'no-matching-item', activeId: context.id, url: location.href };
      return { kind: 'video', video: rememberRecentVideo({ ...pendingVideo, resources: [] }), creator: creatorFromState(items, context.username), url: location.href };
    }
    const video = rememberRecentVideo(context.sponsored
      ? selected?.video || recentVideo(context.id)
      : withPlayerResource(selected?.video, player, context) || (context.id ? domVideo(context.id, context.username, player) : null) || recentVideo(context.id));
    if (!video) return { kind: 'feed', reason: 'no-matching-item', activeId: context.id, url: location.href };
    const item = selected?.item;
    const author = authorFrom(item || {});
    const creator = {
      id: author.id,
      username: author.username || context.username,
      displayName: author.displayName || author.username || context.username,
      avatar: author.avatar
    };
    return { kind: 'video', video, creator, url: location.href };
  }

  function emit(force) {
    try {
      const payload = snapshot();
      const serialized = JSON.stringify(payload);
      if (!force && serialized === lastSnapshotJson) return;
      lastSnapshotJson = serialized;
      window.postMessage({ source: SOURCE, version: 4, type: 'SNAPSHOT', payload }, location.origin);
    } catch (error) {
      const payload = { kind: 'feed', reason: 'parse-error', url: location.href };
      const serialized = JSON.stringify(payload);
      if (!force && serialized === lastSnapshotJson) return;
      lastSnapshotJson = serialized;
      console.error('[TikTokDL] 页面解析失败', error);
      window.postMessage({ source: SOURCE, version: 4, type: 'SNAPSHOT', payload }, location.origin);
    }
  }

  function queueEmit() {
    clearTimeout(scheduled);
    scheduled = setTimeout(emit, 350);
  }

  function watchLocation() {
    ['pushState', 'replaceState'].forEach((name) => {
      const original = history[name];
      history[name] = function () {
        const result = original.apply(this, arguments);
        if (location.href !== lastUrl) { lastUrl = location.href; queueEmit(); }
        return result;
      };
    });
    window.addEventListener('popstate', () => { lastUrl = location.href; queueEmit(); });
    setInterval(() => {
      if (location.href !== lastUrl) { lastUrl = location.href; queueEmit(); }
    }, 1000);
    setInterval(() => {
      if (pageMatch().kind === 'feed') queueEmit();
    }, 1500);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== CONTENT_SOURCE) return;
    if (event.data.type === 'GET_SNAPSHOT') emit(true);
    if (event.data.type === 'RESTORE_VIDEOS') {
      const videos = Array.isArray(event.data.videos) ? event.data.videos : [];
      videos.slice().reverse().forEach((video) => rememberRecentVideo(video));
      queueEmit();
    }
    if (event.data.type === 'RESOLVE_VIDEOS') enqueueVideoResolve(event.data.videos, event.data.epoch);
  });
  new MutationObserver((mutations) => {
    if (mutations.some((mutation) => !mutation.target?.closest?.('#tiktok-dl-root'))) queueEmit();
  }).observe(document.documentElement, { childList: true, subtree: true });
  ['play', 'playing', 'loadedmetadata', 'canplay', 'emptied'].forEach((name) => {
    document.addEventListener(name, queueEmit, true);
  });
  document.addEventListener('scroll', queueEmit, true);
  watchItemResponses();
  watchLocation();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => emit(), { once: true });
  else queueMicrotask(emit);
})();
