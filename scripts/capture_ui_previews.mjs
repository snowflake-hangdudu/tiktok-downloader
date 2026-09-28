/**
 * Capture V1 UI preview screenshots (Bilibili + Douyin).
 * Usage: node shared-download-kit/scripts/capture_ui_previews.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(__dirname, '..');
const outDir = path.join(kitRoot, 'docs', 'acceptance', 'v1');

const pages = [
  {
    name: 'bilibili-normal',
    file: path.join(kitRoot, 'docs/previews/panel-bilibili.html'),
  },
  {
    name: 'douyin-normal',
    file: path.join(kitRoot, 'docs/previews/panel-douyin.html'),
  },
];

async function measure(page, selectors) {
  return page.evaluate((sels) => {
    const out = {};
    for (const [key, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      if (!el) {
        out[key] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[key] = {
        width: Math.round(r.width),
        height: Math.round(r.height),
        fontSize: cs.fontSize,
        color: cs.color,
        background: cs.backgroundColor,
      };
    }
    return out;
  }, selectors);
}

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 480, height: 900 },
  deviceScaleFactor: 2,
});

const metrics = {};

for (const item of pages) {
  const page = await context.newPage();
  await page.goto(`file:///${item.file.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);

  const panelSel = item.name.startsWith('bilibili') ? '#bili-dl-menu' : '.dl-kit-menu';
  const headerSel = item.name.startsWith('bilibili') ? '.bili-dl-header' : '.dl-kit-header';
  const iconSel = item.name.startsWith('bilibili') ? '.bili-dl-header-icon' : '.dl-kit-header-icon';
  const btnSel = item.name.startsWith('bilibili') ? '.bili-dl-btn' : '.dy-dl-btn';

  metrics[item.name] = await measure(page, {
    panel: panelSel,
    header: headerSel,
    icon: iconSel,
    cta: btnSel,
  });

  const panel = page.locator(panelSel);
  await panel.screenshot({ path: path.join(outDir, `${item.name}.png`) });
  await page.close();
}

await browser.close();

fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2), 'utf8');
console.log('Saved screenshots to', outDir);
console.log(JSON.stringify(metrics, null, 2));
