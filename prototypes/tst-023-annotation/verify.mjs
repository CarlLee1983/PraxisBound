// PROTOTYPE verification script — throwaway. Smoke-tests the three annotation
// variants in Chrome via playwright-core: create two requests (AC item +
// batch-wide), export, reload with localStorage cleared, import, confirm
// restoration; capture screenshots.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_HTML = join(__dirname, '..', 'fixture', 'out', 'review-annotate.html');
const FILE_URL = 'file://' + OUT_HTML;

async function runVariant(browser, variant) {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
  });

  await page.goto(FILE_URL + '?variant=' + variant, { waitUntil: 'load' });
  await page.waitForSelector('#pb-toolbar');

  // 開啟第一張需求卡片（collapsed <details class="card">）
  const firstCard = page.locator('details.card').first();
  await firstCard.locator('summary').click();
  const acItem = firstCard.locator('li[data-anchor]').first();
  await acItem.scrollIntoViewIfNeeded();

  if (variant === 'A') {
    await acItem.hover();
    await acItem.locator('.pb-a-add-btn').click();
    await page.locator('.pb-a-form textarea').first().fill('補充：這裡需要更明確的邊界條件');
    await page.locator('.pb-a-form textarea').nth(1).fill('避免不同 Story 對同一詞彙有不同理解');
    // 截圖時保留互動開啟中的狀態（行內表單展開）
    await page.screenshot({ path: join(__dirname, 'A.png'), fullPage: false });
    await page.locator('.pb-a-form button[type=submit]').click();
    await page.click('#pb-toolbar button:has-text("＋整批意見")');
    await page.locator('.pb-a-form textarea').first().fill('整批補充：請補上跨批次相依說明');
    await page.locator('.pb-a-form textarea').nth(1).fill('目前跨批依賴僅在文字中描述，缺少表格');
    await page.locator('.pb-a-form button[type=submit]').click();
  } else if (variant === 'B') {
    await page.click('#pb-drawer-toggle');
    await page.click('#pb-drawer button:has-text("選取目標")');
    await acItem.click();
    await page.locator('#pb-drawer textarea').first().fill('補充：這裡需要更明確的邊界條件');
    await page.locator('#pb-drawer textarea').nth(1).fill('避免不同 Story 對同一詞彙有不同理解');
    // 截圖時保留互動開啟中的狀態（抽屜展開、表單填寫中）
    await page.screenshot({ path: join(__dirname, 'B.png'), fullPage: false });
    await page.locator('#pb-drawer button[type=submit]').click();
    await page.click('#pb-drawer button:has-text("整批")');
    await page.locator('#pb-drawer textarea').first().fill('整批補充：請補上跨批次相依說明');
    await page.locator('#pb-drawer textarea').nth(1).fill('目前跨批依賴僅在文字中描述，缺少表格');
    await page.locator('#pb-drawer button[type=submit]').click();
  } else {
    // 選取 AC 項目文字（合成選取後直接派發 mouseup，避免真滑鼠點擊清掉選取範圍）
    await acItem.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    // 用 JS 直接觸發 popover 點擊：畫面上該按鈕的螢幕座標常疊在其他固定 UI
    // 之上，Playwright 的真滑鼠點擊會誤中別的元素，這裡只驗證互動邏輯本身。
    await page.evaluate(() => document.querySelector('.pb-c-popover').click());
    await page.locator('dialog[open] .pb-form textarea').first().fill('補充：這裡需要更明確的邊界條件');
    await page.locator('dialog[open] .pb-form textarea').nth(1).fill('避免不同 Story 對同一詞彙有不同理解');
    // 截圖時保留互動開啟中的狀態（置中對話框）
    await page.screenshot({ path: join(__dirname, 'C.png'), fullPage: false });
    await page.locator('dialog[open] button[type=submit]').click();
    await page.click('#pb-toolbar button:has-text("＋整批意見")');
    await page.locator('dialog[open] .pb-form textarea').first().fill('整批補充：請補上跨批次相依說明');
    await page.locator('dialog[open] .pb-form textarea').nth(1).fill('目前跨批依賴僅在文字中描述，缺少表格');
    await page.locator('dialog[open] button[type=submit]').click();
  }

  const beforeCount = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('pb-review:'));
    return key ? JSON.parse(localStorage.getItem(key)).requests.length : 0;
  });

  // 匯出
  await page.click('#pb-toolbar button:has-text("匯出")');
  const md = await page.locator('dialog[open] textarea').inputValue();

  await context.close();

  // 縮小視窗截圖（390px）
  const context2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page2 = await context2.newPage();
  page2.on('pageerror', (e) => errors.push('narrow pageerror: ' + e.message));
  await page2.goto(FILE_URL + '?variant=' + variant, { waitUntil: 'load' });
  await page2.waitForSelector('#pb-toolbar');
  const firstCard2 = page2.locator('details.card').first();
  await firstCard2.locator('summary').click();
  if (variant === 'B') {
    await page2.click('#pb-drawer-toggle');
  } else if (variant === 'A') {
    const ac2 = firstCard2.locator('li[data-anchor]').first();
    await ac2.scrollIntoViewIfNeeded();
    await ac2.hover();
  }
  await page2.screenshot({ path: join(__dirname, variant + '-narrow.png'), fullPage: false });
  await context2.close();

  // 重新開啟、清空 localStorage、匯入還原
  const context3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page3 = await context3.newPage();
  page3.on('pageerror', (e) => errors.push('reload pageerror: ' + e.message));
  await page3.goto(FILE_URL + '?variant=' + variant, { waitUntil: 'load' });
  await page3.evaluate(() => localStorage.clear());
  await page3.reload({ waitUntil: 'load' });
  await page3.waitForSelector('#pb-toolbar');

  await page3.click('#pb-toolbar button:has-text("匯入")');
  await page3.locator('dialog[open] textarea').fill(md);
  await page3.click('dialog[open] button:has-text("匯入")');
  const msg = await page3.locator('dialog[open] p').textContent();

  const afterState = await page3.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('pb-review:'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
  const restoredCount = afterState ? afterState.requests.length : 0;
  const pendingCount = afterState ? afterState.requests.filter((r) => r.pendingMatch).length : 0;

  await context3.close();

  return {
    variant,
    beforeCount,
    restoredCount,
    pendingCount,
    importMsg: msg,
    errors,
  };
}

const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
for (const v of ['A', 'B', 'C']) {
  const r = await runVariant(browser, v);
  results.push(r);
  console.log(JSON.stringify(r, null, 2));
}
await browser.close();

const failed = results.filter((r) => r.errors.length > 0 || r.restoredCount !== r.beforeCount || r.pendingCount !== 0);
if (failed.length) {
  console.log('FAILED:', JSON.stringify(failed, null, 2));
  process.exit(1);
} else {
  console.log('ALL OK');
}
