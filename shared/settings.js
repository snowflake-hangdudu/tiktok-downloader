(function (root) {
  const kit = root.DownloaderKit = root.DownloaderKit || {};
  const TOKENS = ['title', 'author', 'id', 'video_id', 'index', 'partTitle', 'quality', 'resolution', 'format', 'date'];
  function t(key, values) {
    return kit.i18n?.t?.(key, values) || key;
  }
  function validate(value) {
    const template = String(value || '').trim();
    if (!template || template.length > 180) throw new Error(t('templateLength'));
    if (/[\\/<>:"|?*\x00-\x1f]/.test(template)) throw new Error(t('templateIllegal'));
    const rest = template.replace(/\{([a-zA-Z_]+)\}/g, (_, token) => {
      if (!TOKENS.includes(token)) throw new Error(t('unknownField', { token }));
      return '';
    });
    if (/[{}]/.test(rest)) throw new Error(t('fieldFormat', { example: '{title}' }));
    return template;
  }
  function filename(template, meta = {}, format = 'mp4') {
    const ext = String(format).toLowerCase();
    if (!/^[a-z0-9]{1,10}$/.test(ext)) throw new Error(t('invalidFormat'));
    const values = { title: t('untitled'), author: '', index: 1, date: new Date().toISOString().slice(0, 10), ...meta, format: ext };
    values.video_id = values.video_id || values.id || '';
    values.id = values.id || values.video_id || '';
    values.resolution = values.resolution || values.quality || '';
    values.quality = values.quality || values.resolution || '';
    const base = validate(template).replace(/\{([a-zA-Z_]+)\}/g, (_, token) => String(values[token] ?? ''))
      .replace(/[\\/<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || t('untitled');
    return (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? '_' : '') + base + '.' + ext;
  }
  function create(options = {}) {
    const runtime = kit.runtime, key = options.storageKey || 'downloadKitSettings_v1';
  let value = { version: 1, filenameTemplate: '{title} - {author}' };
    function normalize(raw) {
      try { return { version: 1, filenameTemplate: validate(raw?.filenameTemplate || '{title} - {author}') }; }
      catch (_) { return { version: 1, filenameTemplate: '{title} - {author}' }; }
    }
    const ready = runtime.storageGet(key).then(stored => { value = normalize(stored[key]); return { ...value }; }).catch(() => ({ ...value }));
    return {
      ready, current: () => ({ ...value }), tokens: TOKENS,
      filename: (meta, format) => filename(value.filenameTemplate, meta, format),
      async save(template) {
        await ready;
        const next = { version: 1, filenameTemplate: validate(template) };
        await runtime.storageSet({ [key]: next }); value = next; return { ...value };
      },
      reset() { return this.save('{title} - {author}'); }
    };
  }
  kit.settings = { create, validate, filename, TOKENS };
  if (typeof module === 'object' && module.exports) module.exports = kit.settings;
})(globalThis);
