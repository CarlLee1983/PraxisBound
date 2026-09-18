// PROTOTYPE build script — throwaway. Reads the fixture Review Projection HTML,
// strips its CSP meta (prototype-only relaxation), and injects one <style> and
// one <script> implementing three annotation-interaction variants (A/B/C).
// Plain Node, no npm packages.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT = join(__dirname, '..', 'fixture', 'out', 'review.html');
const OUTPUT = join(__dirname, '..', 'fixture', 'out', 'review-annotate.html');

let html = readFileSync(INPUT, 'utf8');

// 移除 CSP meta（prototype 專用；正式輸出不可這樣做）
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, '');

const TOP_COMMENT =
  '<!-- PROTOTYPE — throwaway. Question: which annotation interaction feels right for reviewing a batch in the offline HTML Review Projection? Not production code. -->\n';

const STYLE = readFileSync(join(__dirname, 'annotate.css'), 'utf8');
const SCRIPT = readFileSync(join(__dirname, 'annotate.js'), 'utf8');

const injected = `<style>\n${STYLE}\n</style>\n<script>\n${SCRIPT}\n</script>\n</body>`;

if (!html.includes('</body>')) {
  throw new Error('review.html 缺少 </body>，無法注入 prototype 腳本');
}
html = html.replace('</body>', injected);
html = TOP_COMMENT + html;

writeFileSync(OUTPUT, html, 'utf8');
console.log('written:', OUTPUT);
