// PROTOTYPE — throwaway. Question: which annotation interaction feels right
// for reviewing a batch in the offline HTML Review Projection?
// Plain browser JS, no dependencies. Three variants (A/B/C) share one data
// model, storage, export/import and print behavior; only the *interaction
// structure* for creating/viewing a request differs per variant.
(function () {
  'use strict';

  // ---------- 基礎資訊 ----------
  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const metaDds = qsa('dl.meta dd');
  const BATCH_ID = metaDds[0] ? metaDds[0].textContent.trim() : 'UNKNOWN-BATCH';
  const FINGERPRINT = metaDds[1] ? metaDds[1].textContent.trim() : '';
  const STORAGE_KEY = 'pb-review:' + BATCH_ID + ':' + FINGERPRINT;
  const MAX_QUOTE_BYTES = 65536;

  const ANNOTATABLE = qsa('[data-anchor]').filter(
    (el) => !el.classList.contains('visually-hidden')
  );

  const params = new URLSearchParams(location.search);
  let CURRENT_VARIANT = params.get('variant');
  if (!['A', 'B', 'C'].includes(CURRENT_VARIANT)) CURRENT_VARIANT = 'A';

  // ---------- ULID（crypto.getRandomValues + Date.now，Crockford base32） ----------
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function ulid() {
    let time = Date.now();
    let timeChars = '';
    for (let i = 0; i < 10; i++) {
      timeChars = CROCKFORD[time % 32] + timeChars;
      time = Math.floor(time / 32);
    }
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    let bits = '';
    for (const b of bytes) bits += b.toString(2).padStart(8, '0');
    let randChars = '';
    for (let i = 0; i < 80; i += 5) randChars += CROCKFORD[parseInt(bits.substr(i, 5), 2)];
    return timeChars + randChars;
  }

  // ---------- 目標解析 ----------
  // 整批目標沒有對應的 data-anchor 元素，統一指到頁首（可見、可捲動、可加註）。
  function elForTarget(t) {
    if (t.path === 'manifest' && t.anchor === '#batch') return qs('header.cover');
    return qsa('[data-path][data-anchor]').find(
      (el) =>
        el.dataset.path === t.path &&
        el.dataset.anchor === t.anchor &&
        (!t.blockSha256 || el.dataset.blockSha256 === t.blockSha256)
    );
  }
  function targetExists(t) {
    if (t.path === 'manifest' && t.anchor === '#batch') return true;
    return !!elForTarget(t);
  }
  function targetFromEl(el) {
    return { path: el.dataset.path, anchor: el.dataset.anchor, blockSha256: el.dataset.blockSha256 || '' };
  }
  function computeQuote(targets) {
    const parts = targets.map((t) => {
      const el = elForTarget(t);
      return el ? el.textContent.trim().replace(/\s+/g, ' ') : '（找不到目標文字）';
    });
    let quote = parts.join('\n---\n');
    const bytes = new TextEncoder().encode(quote);
    if (bytes.length > MAX_QUOTE_BYTES) {
      quote = new TextDecoder().decode(bytes.slice(0, MAX_QUOTE_BYTES));
    }
    return quote;
  }
  function scrollToTargets(req) {
    req.targets.forEach((t) => {
      const el = elForTarget(t);
      if (!el) return;
      let d = el.closest('details');
      while (d) {
        d.open = true;
        d = d.parentElement ? d.parentElement.closest('details') : null;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // ---------- 狀態與暫存 ----------
  let state = { requests: [] };
  let storageOK = true;
  function testStorage() {
    try {
      localStorage.setItem('__pb_test__', '1');
      localStorage.removeItem('__pb_test__');
      return true;
    } catch (e) {
      return false;
    }
  }
  function loadState() {
    storageOK = testStorage();
    if (!storageOK) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.requests)) state.requests = parsed.requests;
      }
    } catch (e) {
      console.warn('pb: 讀取暫存失敗', e);
    }
  }
  function saveState() {
    if (!storageOK) {
      showStorageBanner();
      updateUnexportedIndicator();
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      storageOK = false;
      showStorageBanner();
    }
    updateUnexportedIndicator();
  }
  function showStorageBanner() {
    if (document.getElementById('pb-storage-banner')) return;
    const b = document.createElement('div');
    b.id = 'pb-storage-banner';
    b.className = 'pb-ui pb-print-hide';
    b.textContent = '瀏覽器無法暫存，請記得匯出';
    document.body.appendChild(b);
  }
  window.addEventListener('beforeunload', (e) => {
    if (state.requests.some((r) => !r.exported)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  function updateUnexportedIndicator() {
    const el = document.getElementById('pb-unexported-indicator');
    if (!el) return;
    const n = state.requests.filter((r) => !r.exported).length;
    el.textContent = n > 0 ? '有 ' + n + ' 則未匯出的意見' : '目前沒有未匯出的意見';
    el.classList.toggle('pb-warn', n > 0);
  }

  // ---------- 請求（意見）CRUD ----------
  function createRequest({ kind, proposal, rationale, blocking, targets, supersedes }) {
    return {
      id: 'REV-' + ulid(),
      kind,
      proposal: proposal || '',
      rationale: rationale || '',
      blocking: !!blocking,
      targets,
      quote: computeQuote(targets),
      fingerprint: FINGERPRINT,
      createdAt: new Date().toISOString(),
      exported: false,
      pendingMatch: false,
      supersedes: supersedes || null,
    };
  }
  function addRequest(req) {
    state.requests.push(req);
    saveState();
    renderVariant();
  }
  function updateRequest(id, data) {
    state.requests = state.requests.map((r) =>
      r.id === id ? Object.assign({}, r, data, { quote: computeQuote(r.targets) }) : r
    );
    saveState();
    renderVariant();
  }
  function deleteRequest(id) {
    state.requests = state.requests.filter((r) => r.id !== id);
    saveState();
    renderVariant();
  }

  // ---------- 匯出 ----------
  function toContractRecord(r) {
    return {
      id: r.id,
      kind: r.kind,
      proposal: r.proposal,
      rationale: r.rationale,
      blocking: r.blocking,
      targets: r.targets,
      quote: r.quote,
      fingerprint: r.fingerprint,
      createdAt: r.createdAt,
      supersedes: r.supersedes || null,
    };
  }
  function quoteBlock(text) {
    return String(text || '')
      .split('\n')
      .map((l) => '> ' + l)
      .join('\n');
  }
  function buildMarkdown(list, json) {
    const lines = [];
    lines.push('# 修訂單 — ' + BATCH_ID);
    lines.push('');
    lines.push('- Fingerprint: `' + FINGERPRINT + '`');
    lines.push('- 匯出時間：' + json.exportedAt);
    lines.push('- 意見數：' + list.length);
    lines.push('');
    list.forEach((r) => {
      lines.push('## ' + r.id + '（' + r.kind + '）');
      lines.push('');
      lines.push('- 阻擋：' + (r.blocking ? '是' : '否'));
      lines.push('- 目標：' + r.targets.map((t) => t.path + '#' + t.anchor).join('、'));
      if (r.supersedes) lines.push('- 取代：' + r.supersedes);
      lines.push('');
      lines.push('原文引用：');
      lines.push(quoteBlock(r.quote));
      lines.push('');
      lines.push('提案：');
      lines.push(quoteBlock(r.proposal || '（無，屬刪除建議）'));
      lines.push('');
      lines.push('理由：');
      lines.push(quoteBlock(r.rationale));
      lines.push('');
    });
    lines.push('```praxisbound-revisions');
    lines.push(JSON.stringify(json, null, 2));
    lines.push('```');
    return lines.join('\n');
  }
  function exportRevisions() {
    const list = state.requests.slice();
    const exportedAt = new Date().toISOString();
    const json = {
      schemaVersion: '1.0.0',
      batchId: BATCH_ID,
      fingerprint: FINGERPRINT,
      exportedAt,
      revisions: list.map(toContractRecord),
    };
    const md = buildMarkdown(list, json);
    list.forEach((r) => (r.exported = true));
    saveState();
    return md;
  }
  function downloadMarkdown(md) {
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = BATCH_ID + '-revisions.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- 匯入 / 還原 ----------
  function parseImportText(text) {
    const lines = String(text || '').split(/\r\n|\n/);
    const opens = [];
    const closes = [];
    lines.forEach((line, i) => {
      if (line === '```praxisbound-revisions') opens.push(i);
      else if (line === '```') closes.push(i);
    });
    const blocks = [];
    for (const o of opens) {
      const c = closes.find((x) => x > o);
      if (c !== undefined) blocks.push([o, c]);
    }
    if (blocks.length !== 1) {
      throw new Error('必須恰好包含一個 ```praxisbound-revisions 區塊，找到 ' + blocks.length + ' 個');
    }
    const [o, c] = blocks[0];
    const jsonText = lines.slice(o + 1, c).join('\n');
    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      throw new Error('JSON 解析失敗：' + e.message);
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.revisions)) {
      throw new Error('資料格式不符合預期 schema（缺少 revisions 陣列）');
    }
    return data;
  }
  function sameContent(a, b) {
    const norm = (r) =>
      JSON.stringify({
        kind: r.kind,
        proposal: r.proposal || '',
        rationale: r.rationale || '',
        blocking: !!r.blocking,
        targets: r.targets,
        quote: r.quote || '',
        fingerprint: r.fingerprint,
        createdAt: r.createdAt,
        supersedes: r.supersedes || null,
      });
    return norm(a) === norm(b);
  }
  function importRevisions(data) {
    const existingById = new Map(state.requests.map((r) => [r.id, r]));
    const conflicts = [];
    const fresh = [];
    let dedupeCount = 0;
    for (const rev of data.revisions) {
      const existing = existingById.get(rev.id);
      if (existing) {
        if (sameContent(existing, rev)) dedupeCount++;
        else conflicts.push(rev.id);
        continue;
      }
      fresh.push(rev);
    }
    if (conflicts.length) {
      throw new Error('匯入中止，以下 ID 已存在但內容不同：' + conflicts.join('、'));
    }
    let attached = 0;
    let pending = 0;
    fresh.forEach((rev) => {
      const fpMatch = rev.fingerprint === FINGERPRINT;
      const targetsOk = fpMatch && rev.targets.length > 0 && rev.targets.every(targetExists);
      state.requests.push(Object.assign({}, rev, { exported: true, pendingMatch: !targetsOk }));
      if (targetsOk) attached++;
      else pending++;
    });
    saveState();
    return { attached, pending, deduped: dedupeCount };
  }

  // ---------- 共用表單 ----------
  function buildForm(opts) {
    const form = document.createElement('form');
    form.className = 'pb-form pb-print-hide';
    const kindSel = document.createElement('select');
    ['補充', '建議改寫', '新增要求', '刪除建議'].forEach((k) => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = k;
      kindSel.appendChild(o);
    });
    if (opts.prefill) kindSel.value = opts.prefill.kind;

    const targetsInfo = document.createElement('div');
    targetsInfo.className = 'pb-targets-info';
    targetsInfo.textContent = '目標：' + opts.targets.map((t) => t.path + '#' + t.anchor).join('、');

    const quotePreview = document.createElement('div');
    quotePreview.className = 'pb-quote-preview';
    quotePreview.textContent = '原文預覽：' + computeQuote(opts.targets).slice(0, 400);

    const proposalLabel = document.createElement('label');
    proposalLabel.textContent = '提案';
    const proposalTa = document.createElement('textarea');
    proposalTa.value = opts.prefill ? opts.prefill.proposal : '';
    proposalTa.required = kindSel.value !== '刪除建議';

    const rationaleLabel = document.createElement('label');
    rationaleLabel.textContent = '理由';
    const rationaleTa = document.createElement('textarea');
    rationaleTa.required = true;
    rationaleTa.value = opts.prefill ? opts.prefill.rationale : '';

    const blockingLabel = document.createElement('label');
    const blockingCb = document.createElement('input');
    blockingCb.type = 'checkbox';
    blockingCb.checked = opts.prefill ? !!opts.prefill.blocking : true;
    blockingLabel.append(blockingCb, document.createTextNode(' 阻擋（blocking）'));

    kindSel.addEventListener('change', () => {
      proposalTa.required = kindSel.value !== '刪除建議';
    });

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.textContent = '儲存';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => opts.onCancel && opts.onCancel());

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (kindSel.value !== '刪除建議' && !proposalTa.value.trim()) {
        proposalTa.focus();
        return;
      }
      if (!rationaleTa.value.trim()) {
        rationaleTa.focus();
        return;
      }
      opts.onSave({
        kind: kindSel.value,
        proposal: proposalTa.value.trim(),
        rationale: rationaleTa.value.trim(),
        blocking: blockingCb.checked,
      });
    });

    form.append(
      kindSel,
      targetsInfo,
      quotePreview,
      proposalLabel,
      proposalTa,
      rationaleLabel,
      rationaleTa,
      blockingLabel,
      saveBtn,
      cancelBtn
    );
    return form;
  }

  function buildNoteCard(req, opts) {
    const card = document.createElement('div');
    card.className = 'pb-note pb-print-hide' + (req.pendingMatch ? ' pb-pending' : '');
    const head = document.createElement('div');
    head.className = 'pb-note-head';
    const idSpan = document.createElement('span');
    idSpan.className = 'pb-note-id';
    idSpan.textContent = req.id;
    const kindSpan = document.createElement('span');
    kindSpan.className = 'pb-note-kind';
    kindSpan.textContent = req.kind;
    head.append(idSpan, kindSpan);
    if (req.blocking) {
      const b = document.createElement('span');
      b.className = 'pb-badge-blocking';
      b.textContent = '阻擋';
      head.appendChild(b);
    }
    if (req.exported) {
      const b = document.createElement('span');
      b.className = 'pb-badge-exported';
      b.textContent = '已匯出';
      head.appendChild(b);
    }
    if (req.pendingMatch) {
      const b = document.createElement('span');
      b.className = 'pb-badge-exported';
      b.textContent = '待比對';
      head.appendChild(b);
    }
    card.appendChild(head);

    const targetsLine = document.createElement('div');
    targetsLine.className = 'pb-targets-info';
    targetsLine.textContent = '目標：' + req.targets.map((t) => t.path + '#' + t.anchor).join('、');
    card.appendChild(targetsLine);

    if (req.kind === '刪除建議') {
      const orig = document.createElement('div');
      orig.className = 'pb-note-original';
      orig.textContent = '原文：' + req.quote;
      card.appendChild(orig);
    }
    if (req.proposal) {
      const p = document.createElement('div');
      p.className = 'pb-note-proposal';
      p.textContent = '提案：' + req.proposal;
      card.appendChild(p);
    }
    const r = document.createElement('div');
    r.className = 'pb-note-rationale';
    r.textContent = '理由：' + req.rationale;
    card.appendChild(r);

    const actions = document.createElement('div');
    actions.className = 'pb-note-actions';
    if (!req.exported) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = '編輯';
      editBtn.addEventListener('click', () => opts.onEdit && opts.onEdit());
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '刪除';
      delBtn.addEventListener('click', () => opts.onDelete && opts.onDelete());
      actions.append(editBtn, delBtn);
    } else {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = '編輯（將建立新版本）';
      editBtn.addEventListener('click', () => opts.onEditExported && opts.onEditExported());
      actions.append(editBtn);
    }
    card.appendChild(actions);
    return card;
  }

  // ---------- Dialog 輔助 ----------
  const dialogCache = {};
  function ensureDialog(id) {
    if (dialogCache[id]) return dialogCache[id];
    const dlg = document.createElement('dialog');
    dlg.id = id;
    dlg.className = 'pb-ui pb-dialog pb-print-hide';
    document.body.appendChild(dlg);
    dialogCache[id] = dlg;
    return dlg;
  }
  function openListDialog() {
    const dlg = ensureDialog('pb-list-dialog');
    dlg.textContent = '';
    const h = document.createElement('h3');
    h.textContent = '所有意見（' + state.requests.length + '）';
    dlg.appendChild(h);
    if (state.requests.length === 0) {
      const p = document.createElement('p');
      p.textContent = '目前沒有任何意見。';
      dlg.appendChild(p);
    }
    state.requests.forEach((req, i) => {
      const row = document.createElement('div');
      row.className = 'pb-list-row';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = (i + 1) + '. ' + req.id + '（' + req.kind + '）' + (req.pendingMatch ? '［待比對］' : '');
      btn.addEventListener('click', () => {
        dlg.close();
        scrollToTargets(req);
      });
      row.appendChild(btn);
      dlg.appendChild(row);
    });
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '關閉';
    closeBtn.addEventListener('click', () => dlg.close());
    dlg.appendChild(closeBtn);
    dlg.showModal();
  }
  function openExportDialog() {
    if (state.requests.length === 0) {
      alert('目前沒有任何意見可以匯出');
      return;
    }
    const md = exportRevisions();
    const dlg = ensureDialog('pb-export-dialog');
    dlg.textContent = '';
    const h = document.createElement('h3');
    h.textContent = '匯出修訂單';
    const ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.value = md;
    ta.style.minHeight = '16rem';
    const btnRow = document.createElement('div');
    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.textContent = '下載';
    dlBtn.addEventListener('click', () => downloadMarkdown(md));
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '複製';
    copyBtn.addEventListener('click', () => {
      const done = () => (copyBtn.textContent = '已複製');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(done, () => {
          ta.select();
          document.execCommand('copy');
          done();
        });
      } else {
        ta.select();
        document.execCommand('copy');
        done();
      }
    });
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '關閉';
    closeBtn.addEventListener('click', () => dlg.close());
    btnRow.append(dlBtn, copyBtn, closeBtn);
    dlg.append(h, ta, btnRow);
    dlg.showModal();
  }
  function openImportDialog() {
    const dlg = ensureDialog('pb-import-dialog');
    dlg.textContent = '';
    const h = document.createElement('h3');
    h.textContent = '匯入 / 還原修訂單';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.md,.txt';
    const pasteArea = document.createElement('textarea');
    pasteArea.placeholder = '貼上匯出的 Markdown 內容';
    pasteArea.style.minHeight = '10rem';
    const msg = document.createElement('p');
    const doImportBtn = document.createElement('button');
    doImportBtn.type = 'button';
    doImportBtn.textContent = '匯入';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '關閉';
    closeBtn.addEventListener('click', () => dlg.close());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      f.text().then((t) => {
        pasteArea.value = t;
      });
    });
    doImportBtn.addEventListener('click', () => {
      msg.textContent = '';
      try {
        const data = parseImportText(pasteArea.value);
        const result = importRevisions(data);
        renderVariant();
        msg.textContent =
          '匯入完成：新增 ' + result.attached + ' 則、待比對 ' + result.pending + ' 則、略過重複 ' + result.deduped + ' 則。';
      } catch (e) {
        msg.textContent = '匯入失敗：' + e.message;
      }
    });
    dlg.append(h, fileInput, pasteArea, doImportBtn, closeBtn, msg);
    dlg.showModal();
  }

  function buildToolbar() {
    const bar = document.createElement('div');
    bar.id = 'pb-toolbar';
    bar.className = 'pb-ui pb-print-hide';
    const indicator = document.createElement('span');
    indicator.id = 'pb-unexported-indicator';
    const listBtn = document.createElement('button');
    listBtn.type = 'button';
    listBtn.textContent = '意見列表';
    listBtn.addEventListener('click', openListDialog);
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.textContent = '匯出';
    exportBtn.addEventListener('click', openExportDialog);
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.textContent = '匯入';
    importBtn.addEventListener('click', openImportDialog);
    bar.append(indicator, listBtn, exportBtn, importBtn);
    if (CURRENT_VARIANT !== 'B') {
      const batchBtn = document.createElement('button');
      batchBtn.type = 'button';
      batchBtn.textContent = '＋整批意見';
      batchBtn.addEventListener('click', () => {
        const targets = [{ path: 'manifest', anchor: '#batch', blockSha256: '' }];
        if (CURRENT_VARIANT === 'A') VariantA.openBatchForm();
        else VariantC.openDialog(targets);
      });
      bar.appendChild(batchBtn);
    }
    document.body.appendChild(bar);
  }

  function buildSwitcher() {
    const bar = document.createElement('div');
    bar.id = 'pb-switcher';
    bar.className = 'pb-ui pb-print-hide';
    const order = ['A', 'B', 'C'];
    const names = { A: 'A：行內按鈕', B: 'B：右側抽屜', C: 'C：選取文字後彈出' };
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.textContent = '←';
    prev.setAttribute('aria-label', '上一個變體');
    const label = document.createElement('span');
    label.id = 'pb-switcher-label';
    label.textContent = names[CURRENT_VARIANT];
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = '→';
    next.setAttribute('aria-label', '下一個變體');
    function go(delta) {
      const i = order.indexOf(CURRENT_VARIANT);
      const n = order[(i + delta + order.length) % order.length];
      const url = new URL(location.href);
      url.searchParams.set('variant', n);
      location.href = url.toString();
    }
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    document.addEventListener('keydown', (e) => {
      const t = document.activeElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    });
    bar.append(prev, label, next);
    document.body.appendChild(bar);
  }

  // ---------- 變體 A：行內按鈕 ----------
  const VariantA = {
    anchors: new Map(),
    init() {
      ANNOTATABLE.forEach((el) => {
        el.classList.add('pb-a-target');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pb-a-add-btn pb-print-hide';
        btn.textContent = '＋意見';
        btn.setAttribute('aria-label', '對此段落提出意見');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openForm(el);
        });
        el.appendChild(btn);
      });
    },
    openForm(el, existing, asNew, explicitTargets) {
      qsa('.pb-a-form').forEach((f) => f.remove());
      const targets = existing ? existing.targets : explicitTargets || [targetFromEl(el)];
      const form = buildForm({
        targets,
        prefill: existing,
        onSave: (data) => {
          if (existing && !asNew && !existing.exported) updateRequest(existing.id, data);
          else if (existing) addRequest(createRequest(Object.assign({ targets, supersedes: existing.id }, data)));
          else addRequest(createRequest(Object.assign({ targets }, data)));
        },
        onCancel: () => form.remove(),
      });
      form.classList.add('pb-a-form');
      this.insertAfter(el, form);
      const ta = form.querySelector('textarea');
      if (ta) ta.focus();
    },
    openBatchForm() {
      this.openForm(qs('header.cover'), null, false, [{ path: 'manifest', anchor: '#batch', blockSha256: '' }]);
    },
    insertAfter(el, node) {
      const anchor = this.anchors.get(el) || el;
      anchor.insertAdjacentElement('afterend', node);
      this.anchors.set(el, node);
    },
    clearAll() {
      qsa('.pb-a-note, .pb-a-form').forEach((n) => n.remove());
      this.anchors.clear();
    },
    refresh() {
      this.clearAll();
      state.requests.forEach((req) => this.renderOne(req));
    },
    renderOne(req) {
      const el = elForTarget(req.targets[0]);
      if (!el) return;
      const card = buildNoteCard(req, {
        onEdit: () => this.openForm(el, req, false),
        onDelete: () => deleteRequest(req.id),
        onEditExported: () => this.openForm(el, req, true),
      });
      card.classList.add('pb-a-note');
      this.insertAfter(el, card);
    },
  };

  // ---------- 變體 B：右側抽屜 ----------
  const VariantB = {
    selecting: false,
    selected: [],
    drawer: null,
    init() {
      const drawer = document.createElement('div');
      drawer.id = 'pb-drawer';
      drawer.className = 'pb-ui pb-print-hide';
      this.drawer = drawer;
      document.body.appendChild(drawer);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.id = 'pb-drawer-toggle';
      toggle.className = 'pb-ui pb-print-hide';
      toggle.textContent = '意見面板 ▸';
      toggle.addEventListener('click', () => {
        drawer.classList.toggle('pb-drawer-open');
        toggle.textContent = drawer.classList.contains('pb-drawer-open') ? '意見面板 ◂' : '意見面板 ▸';
      });
      document.body.appendChild(toggle);
      ANNOTATABLE.forEach((el) => {
        el.classList.add('pb-b-selectable');
        el.addEventListener('click', (e) => {
          if (!VariantB.selecting) return;
          e.preventDefault();
          VariantB.toggleTarget(el);
        });
      });
      this.renderDrawer();
    },
    toggleTarget(el) {
      const t = targetFromEl(el);
      const idx = this.selected.findIndex((s) => s.path === t.path && s.anchor === t.anchor);
      if (idx >= 0) {
        this.selected.splice(idx, 1);
        el.classList.remove('pb-b-selected');
      } else {
        this.selected.push(t);
        el.classList.add('pb-b-selected');
      }
      this.renderDrawer();
    },
    addBatchTarget() {
      if (!this.selected.find((s) => s.path === 'manifest')) {
        this.selected.push({ path: 'manifest', anchor: '#batch', blockSha256: '' });
      }
      this.renderDrawer();
    },
    clearSelection() {
      qsa('.pb-b-selected').forEach((el) => el.classList.remove('pb-b-selected'));
      this.selected = [];
    },
    openEditForm(req, asNew) {
      const form = buildForm({
        targets: req.targets,
        prefill: req,
        onSave: (data) => {
          if (asNew) addRequest(createRequest(Object.assign({ targets: req.targets, supersedes: req.id }, data)));
          else updateRequest(req.id, data);
        },
        onCancel: () => this.renderDrawer(),
      });
      this.drawer.appendChild(form);
    },
    clearAll() {},
    refresh() {
      this.renderDrawer();
    },
    renderDrawer() {
      const drawer = this.drawer;
      drawer.textContent = '';
      const h = document.createElement('h3');
      h.textContent = '右側抽屜：意見';
      drawer.appendChild(h);
      const modeBtn = document.createElement('button');
      modeBtn.type = 'button';
      modeBtn.textContent = this.selecting ? '結束選取目標' : '選取目標';
      modeBtn.addEventListener('click', () => {
        this.selecting = !this.selecting;
        this.renderDrawer();
      });
      drawer.appendChild(modeBtn);
      const batchBtn = document.createElement('button');
      batchBtn.type = 'button';
      batchBtn.textContent = '整批';
      batchBtn.addEventListener('click', () => this.addBatchTarget());
      drawer.appendChild(batchBtn);
      const selInfo = document.createElement('div');
      selInfo.className = 'pb-b-selected-info';
      selInfo.textContent =
        '已選目標：' + (this.selected.length ? this.selected.map((t) => t.path + '#' + t.anchor).join('、') : '（無）');
      drawer.appendChild(selInfo);
      if (this.selected.length > 0) {
        const form = buildForm({
          targets: this.selected.slice(),
          onSave: (data) => {
            addRequest(createRequest(Object.assign({ targets: this.selected.slice() }, data)));
            this.clearSelection();
          },
          onCancel: () => {
            this.clearSelection();
            this.renderDrawer();
          },
        });
        drawer.appendChild(form);
      }
      const listTitle = document.createElement('h4');
      listTitle.textContent = '所有意見（' + state.requests.length + '）';
      drawer.appendChild(listTitle);
      state.requests.forEach((req) => {
        const card = buildNoteCard(req, {
          onEdit: () => this.openEditForm(req, false),
          onDelete: () => deleteRequest(req.id),
          onEditExported: () => this.openEditForm(req, true),
        });
        const scrollBtn = document.createElement('button');
        scrollBtn.type = 'button';
        scrollBtn.textContent = '跳至目標';
        scrollBtn.addEventListener('click', () => scrollToTargets(req));
        card.appendChild(scrollBtn);
        drawer.appendChild(card);
      });
    },
  };

  // ---------- 變體 C：選取文字後彈出 ----------
  let popoverEl = null;
  function removePopover() {
    if (popoverEl) {
      popoverEl.remove();
      popoverEl = null;
    }
  }
  const VariantC = {
    init() {
      document.addEventListener('mouseup', () => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.toString().trim()) {
          removePopover();
          return;
        }
        const anchorNode = sel.anchorNode;
        const startEl = anchorNode && (anchorNode.nodeType === 3 ? anchorNode.parentElement : anchorNode);
        const el = startEl && startEl.closest('[data-anchor]');
        if (!el || el.classList.contains('visually-hidden')) {
          removePopover();
          return;
        }
        this.showPopover(sel, el);
      });
      document.addEventListener('mousedown', (e) => {
        if (e.target.closest && e.target.closest('.pb-c-popover')) return;
        removePopover();
      });
    },
    showPopover(sel, el) {
      removePopover();
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pb-c-popover pb-ui pb-print-hide';
      btn.textContent = '提出意見';
      btn.style.top = window.scrollY + rect.bottom + 4 + 'px';
      btn.style.left = window.scrollX + rect.left + 'px';
      btn.addEventListener('click', () => {
        this.openDialog([targetFromEl(el)]);
        removePopover();
      });
      document.body.appendChild(btn);
      popoverEl = btn;
    },
    openDialog(targets, existing, asNew) {
      const dlg = ensureDialog('pb-c-form-dialog');
      dlg.textContent = '';
      const h = document.createElement('h3');
      h.textContent = existing ? '編輯意見' : '提出意見';
      dlg.appendChild(h);
      const form = buildForm({
        targets,
        prefill: existing,
        onSave: (data) => {
          if (existing && !asNew && !existing.exported) updateRequest(existing.id, data);
          else if (existing) addRequest(createRequest(Object.assign({ targets: existing.targets, supersedes: existing.id }, data)));
          else addRequest(createRequest(Object.assign({ targets }, data)));
          dlg.close();
        },
        onCancel: () => dlg.close(),
      });
      dlg.appendChild(form);
      dlg.showModal();
    },
    openMarkerDialog(req) {
      const dlg = ensureDialog('pb-c-view-dialog');
      dlg.textContent = '';
      const h = document.createElement('h3');
      h.textContent = req.id;
      dlg.appendChild(h);
      const card = buildNoteCard(req, {
        onEdit: () => {
          dlg.close();
          this.openDialog(req.targets, req, false);
        },
        onDelete: () => {
          deleteRequest(req.id);
          dlg.close();
        },
        onEditExported: () => {
          dlg.close();
          this.openDialog(req.targets, req, true);
        },
      });
      dlg.appendChild(card);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = '關閉';
      closeBtn.addEventListener('click', () => dlg.close());
      dlg.appendChild(closeBtn);
      dlg.showModal();
    },
    clearAll() {
      qsa('.pb-c-marker').forEach((m) => m.remove());
    },
    refresh() {
      this.clearAll();
      state.requests.forEach((req, i) => this.renderOne(req, i + 1));
    },
    renderOne(req, num) {
      const el = elForTarget(req.targets[0]);
      if (!el) return;
      el.classList.add('pb-c-anchor');
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'pb-c-marker pb-print-hide';
      marker.textContent = String(num);
      marker.title = req.id + '：' + req.kind;
      marker.addEventListener('click', () => this.openMarkerDialog(req));
      el.insertAdjacentElement('afterbegin', marker);
    },
  };

  function currentVariantObj() {
    return CURRENT_VARIANT === 'A' ? VariantA : CURRENT_VARIANT === 'B' ? VariantB : VariantC;
  }
  function renderVariant() {
    currentVariantObj().refresh();
    updateUnexportedIndicator();
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    buildToolbar();
    buildSwitcher();
    if (!storageOK) showStorageBanner();
    if (CURRENT_VARIANT === 'A') VariantA.init();
    else if (CURRENT_VARIANT === 'B') VariantB.init();
    else VariantC.init();
    renderVariant();
  });
})();
