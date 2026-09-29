import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, locale: 'zh-CN' });
  await page.setContent('<html><body></body></html>');
  await page.evaluate(() => {
    const storage = {}, listeners = new Set();
    window.chrome = {
      runtime: { getManifest: () => ({ version: '1.0.0' }), getURL: p => 'https://extension.test/' + p,
        sendMessage: async () => ({ ok: false }), onMessage: { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f) } },
      storage: { local: { get: async key => ({ [key]: storage[key] }), set: async data => Object.assign(storage, data) },
        onChanged: { addListener() {}, removeListener() {} } }
    };
    window.fetch = async () => ({ ok: true, json: async () => ({ themes: [] }) });
    window.testListeners = listeners;
  });
  for (const file of ['runtime', 'dom', 'debug-flag', 'debug', 'remote-content', 'theme', 'settings', 'notice', 'rating', 'panel', 'i18n', 'shell']) {
    await page.addScriptTag({ path: path.join(root, 'shared', file + '.js') });
  }
  await page.addStyleTag({ path: path.join(root, 'shared', 'panel.css') });
  await page.addStyleTag({ path: path.join(root, 'shared', 'design-system.css') });
  await page.evaluate(() => {
    window.actionCount = 0;
    window.shell = DownloaderKit.shell.mount({ title: '模板验收', idPrefix: 'test-dl', theme: 'bilibili', showDebug: false,
      tasks: { list: () => [{ id: 'one', title: '测试任务', state: '下载中', actions: ['cancel'] }], cancel: async () => { window.actionCount++; } } });
  });
  await page.locator('#test-dl-toggle').click();
  assert.equal(await page.locator('#test-dl-toggle').getAttribute('aria-expanded'), 'true');
  await page.locator('[data-sheet="settings"]').click();
  const input = page.locator('.dl-kit-settings-field input');
  await input.fill('{title}_{quality}');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.waitForFunction(() => shell.settings.current().filenameTemplate === '{title}_{quality}');
  assert.equal(await page.evaluate(() => shell.settings.filename({ title: '../CON', quality: '1080P' }, 'mp4')), '.._CON_1080P.mp4');
  await input.fill('../{title}');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  assert.equal(await page.evaluate(() => shell.settings.current().filenameTemplate), '{title}_{quality}');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#test-dl-toggle').getAttribute('aria-expanded'), 'true');
  await page.locator('[data-sheet="tasks"]').click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForFunction(() => actionCount === 1);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#test-dl-toggle').getAttribute('aria-expanded'), 'false');
  const header = await page.locator('.dl-kit-header').evaluate(el => getComputedStyle(el).height);
  assert.equal(header, '52px');
  await page.evaluate(() => shell.destroy());
  assert.equal(await page.locator('#test-dl-root').count(), 0);
  assert.equal(await page.evaluate(() => testListeners.size), 0);
  console.log('shell settings, task actions, Escape, dimensions and cleanup passed');
} finally { await browser.close(); }
