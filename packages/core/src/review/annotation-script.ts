/**
 * The one fixed browser script contract §19 embeds in the Review Projection.
 *
 * Authoring choice: the script is written as an ordinary `String.raw`
 * template literal rather than derived from a function's `.toString()`.
 * `String.raw` leaves every backslash in the source untouched (no escaping
 * of the regexes and `\n`/`\r` literals the script itself needs), so the
 * text below reads exactly like the JS it is, stays reviewable, and is
 * inert to Prettier (which treats a template literal's contents as opaque
 * text and never reformats them). The literal must therefore contain no
 * backtick and no `${` — the script avoids both entirely, using string
 * concatenation instead of template literals internally.
 *
 * The script defines a pure logic namespace (Revision Request creation,
 * Revision Sheet export/parse, restore matching, storage helpers — contract
 * §6/§13/§19) and, only when `typeof document !== "undefined"`, calls a DOM
 * entry point. When the host instead provides
 * `globalThis.__PRAXIS_REVIEW_TEST__ = {}` before evaluating this script,
 * the script attaches its pure API onto that object and does nothing else —
 * this is how `review-annotation.test.mjs` drives the exact embedded logic
 * from Node's `vm` module.
 *
 * `initAnnotationUi` is a stage-2 placeholder: this Story embeds the pure
 * logic and its DOM entry seam only; the drawer and inline UI are a
 * following Story and are deliberately left unbuilt here.
 */

export const ANNOTATION_SCRIPT = String.raw`(function () {
  'use strict';

  var MAX_TEXT_LENGTH = 65536;
  var MAX_SHEET_BYTES = 1048576;
  var MAX_REVISIONS = 1000;
  var MAX_NESTING_DEPTH = 32;
  var MAX_TARGETS = 100;
  var TRUNCATE_MARKER = '…（已截斷）';
  // Built from char codes, not a literal backtick: this source is authored
  // inside a String.raw template (see annotation-script.ts), where a raw
  // backtick would still need its escaping backslash to survive into the
  // fence marker text.
  var BACKTICK = String.fromCharCode(96);
  var FENCE_OPEN = BACKTICK + BACKTICK + BACKTICK + 'praxisbound-revisions';
  var FENCE_CLOSE = BACKTICK + BACKTICK + BACKTICK;
  var REVISION_KINDS = ['supplement', 'rewrite', 'add-requirement', 'delete'];
  var CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  var SHA256_PATTERN = /^[a-f0-9]{64}$/;
  var REVISION_ID_PATTERN = /^REV-[0-9A-HJKMNP-TV-Z]{26}$/;
  var UTC_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  var BATCH_ID_PATTERN =
    /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]+(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
  var REPO_PATH_PATTERN =
    /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)[^\\\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/;

  // ---------- 小工具 ----------

  function isString(value) {
    return typeof value === 'string';
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function utf8Length(text) {
    return new TextEncoder().encode(text).length;
  }

  /**
   * §13：截斷至 65536 bytes（UTF-8），並在結尾附上可見標記，總長度（含標記）
   * 永不超過上限。以逐位元組退位方式找到合法的 UTF-8 邊界，避免切壞字元。
   */
  function truncateText(text, maxBytes) {
    var encoder = new TextEncoder();
    var bytes = encoder.encode(text);
    if (bytes.length <= maxBytes) return text;
    var markerBytes = encoder.encode(TRUNCATE_MARKER).length;
    var budget = maxBytes - markerBytes;
    if (budget < 0) budget = 0;
    var decoder = new TextDecoder('utf-8', { fatal: true });
    for (var end = budget; end >= 0; end--) {
      try {
        return decoder.decode(bytes.subarray(0, end)) + TRUNCATE_MARKER;
      } catch (e) {
        // Sliced mid-codepoint; retreat one byte and try again.
      }
    }
    return TRUNCATE_MARKER;
  }

  function quoteLines(text) {
    var value = isString(text) ? text : '';
    return value
      .split(/\r\n|\n/)
      .map(function (line) {
        return '> ' + line;
      })
      .join('\n');
  }

  // ---------- ULID：Date.now() 與呼叫端提供的亂數位元組 ----------

  function ulid(nowMs, randomBytes) {
    var time = nowMs;
    var timeChars = '';
    for (var i = 0; i < 10; i++) {
      timeChars = CROCKFORD_ALPHABET.charAt(time % 32) + timeChars;
      time = Math.floor(time / 32);
    }
    var bits = '';
    for (var j = 0; j < randomBytes.length; j++) {
      var byte = randomBytes[j] & 0xff;
      var byteBits = byte.toString(2);
      while (byteBits.length < 8) byteBits = '0' + byteBits;
      bits += byteBits;
    }
    var randomChars = '';
    for (var k = 0; k + 5 <= bits.length; k += 5) {
      randomChars += CROCKFORD_ALPHABET.charAt(parseInt(bits.substr(k, 5), 2));
    }
    return timeChars + randomChars;
  }

  // ---------- 目標 locator 驗證 ----------

  function validateLocator(target) {
    if (!isPlainObject(target)) return '目標必須是物件';
    if (!isString(target.path) || !REPO_PATH_PATTERN.test(target.path))
      return '目標路徑格式不正確';
    if (!isString(target.anchor) || target.anchor.length < 1 || target.anchor.length > 1024)
      return '目標錨點格式不正確';
    if (!isString(target.blockSha256) || !SHA256_PATTERN.test(target.blockSha256))
      return '目標區塊雜湊格式不正確';
    return null;
  }

  function validateTargets(targets) {
    if (!Array.isArray(targets) || targets.length < 1)
      return '至少需要一個目標';
    if (targets.length > MAX_TARGETS)
      return '目標數量超過上限（' + MAX_TARGETS + '）';
    for (var i = 0; i < targets.length; i++) {
      var message = validateLocator(targets[i]);
      if (message) return message;
    }
    return null;
  }

  function locatorKey(locator) {
    return locator.path + '\u0000' + locator.anchor + '\u0000' + locator.blockSha256;
  }

  // ---------- buildQuote（§19：quote 依目標順序相接並截斷） ----------

  function buildQuote(texts) {
    var list = Array.isArray(texts) ? texts : [];
    var joined = list
      .map(function (t) {
        return isString(t) ? t : '';
      })
      .join('\n---\n');
    return truncateText(joined, MAX_TEXT_LENGTH);
  }

  // ---------- createRequest（§6/§19） ----------

  function createRequest(input) {
    var options = isPlainObject(input) ? input : {};
    if (REVISION_KINDS.indexOf(options.kind) === -1)
      return { ok: false, message: 'kind 必須是 supplement、rewrite、add-requirement 或 delete 之一' };
    if (!isString(options.rationale) || options.rationale.trim().length === 0)
      return { ok: false, message: 'rationale（理由）為必填' };
    var isDelete = options.kind === 'delete';
    var proposal = isString(options.proposal) ? options.proposal : '';
    if (!isDelete && proposal.trim().length === 0)
      return { ok: false, message: 'proposal（提案）為必填，除非 kind 為 delete' };
    var targetsMessage = validateTargets(options.targets);
    if (targetsMessage) return { ok: false, message: targetsMessage };
    if (!isString(options.fingerprint) || options.fingerprint.length === 0)
      return { ok: false, message: 'fingerprint 為必填' };
    if (typeof options.now !== 'number' || !isFinite(options.now))
      return { ok: false, message: 'now 必須是毫秒時間戳' };
    if (!options.random || typeof options.random.length !== 'number' || options.random.length < 10)
      return { ok: false, message: 'random 必須提供至少 10 個位元組的亂數來源' };
    var blocking = options.blocking === undefined ? true : !!options.blocking;
    var quote = truncateText(isString(options.quote) ? options.quote : '', MAX_TEXT_LENGTH);

    var request = {
      id: 'REV-' + ulid(options.now, options.random),
      fingerprint: options.fingerprint,
      targets: options.targets.slice(),
      quote: quote,
      kind: options.kind,
      blocking: blocking,
      proposal: truncateText(proposal, MAX_TEXT_LENGTH),
      rationale: truncateText(options.rationale, MAX_TEXT_LENGTH),
      createdAt: new Date(options.now).toISOString(),
    };
    if (isString(options.supersedes)) request.supersedes = options.supersedes;
    return { ok: true, request: request };
  }

  // ---------- editExported（§19 R7：已匯出唯讀，編輯建立新 id + supersedes） ----------

  function editExported(request, changes, now, random) {
    var overrides = isPlainObject(changes) ? changes : {};
    var merged = {
      kind: overrides.kind !== undefined ? overrides.kind : request.kind,
      proposal: overrides.proposal !== undefined ? overrides.proposal : request.proposal,
      rationale: overrides.rationale !== undefined ? overrides.rationale : request.rationale,
      blocking: overrides.blocking !== undefined ? overrides.blocking : request.blocking,
      targets: overrides.targets !== undefined ? overrides.targets : request.targets,
      quote: overrides.quote !== undefined ? overrides.quote : request.quote,
      fingerprint: request.fingerprint,
      now: now,
      random: random,
    };
    var result = createRequest(merged);
    if (!result.ok) return result;
    result.request.supersedes = request.id;
    return result;
  }

  // ---------- exportSheet（§6：格式；R8：讀者文字只以 "> " 引用） ----------

  function revisionToRecord(request) {
    var record = {
      id: request.id,
      fingerprint: request.fingerprint,
      targets: request.targets,
      quote: request.quote,
      kind: request.kind,
      blocking: !!request.blocking,
      proposal: request.proposal,
      rationale: request.rationale,
      createdAt: request.createdAt,
    };
    if (isString(request.supersedes)) record.supersedes = request.supersedes;
    return record;
  }

  function targetSummaryLine(target) {
    return target.path + '#' + target.anchor;
  }

  function exportSheet(input) {
    var options = isPlainObject(input) ? input : {};
    var requests = Array.isArray(options.requests) ? options.requests : [];
    var exportedAt = new Date(options.now).toISOString();
    var revisions = requests.map(revisionToRecord);
    var json = {
      schemaVersion: '1.0.0',
      batchId: options.batchId,
      fingerprint: options.pageFingerprint,
      exportedAt: exportedAt,
      revisions: revisions,
    };

    var lines = [];
    lines.push('# 修訂單 — ' + options.batchId);
    lines.push('');
    lines.push('- Fingerprint：' + options.pageFingerprint);
    lines.push('- 匯出時間：' + exportedAt);
    lines.push('- 意見數：' + requests.length);
    lines.push('');
    requests.forEach(function (request) {
      lines.push('## ' + request.id + '（' + request.kind + '）');
      lines.push('');
      lines.push('- 阻擋：' + (request.blocking ? '是' : '否'));
      if (isString(request.supersedes)) lines.push('- 取代：' + request.supersedes);
      lines.push('');
      lines.push('目標：');
      lines.push(quoteLines(request.targets.map(targetSummaryLine).join('\n')));
      lines.push('');
      lines.push('原文引用：');
      lines.push(quoteLines(request.quote));
      lines.push('');
      lines.push('提案：');
      lines.push(quoteLines(request.proposal));
      lines.push('');
      lines.push('理由：');
      lines.push(quoteLines(request.rationale));
      lines.push('');
    });
    lines.push(FENCE_OPEN);
    lines.push(JSON.stringify(json));
    lines.push(FENCE_CLOSE);
    return lines.join('\n');
  }

  // ---------- parseSheet（§6 區塊規則、§13 上限、schema 形狀） ----------

  function findFenceBlock(text) {
    var lines = String(text || '').split('\n');
    var opens = [];
    var closes = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\r$/, '');
      if (line === FENCE_OPEN) opens.push(i);
      else if (line === FENCE_CLOSE) closes.push(i);
    }
    if (opens.length !== 1)
      return { ok: false, message: '必須恰好包含一個 praxisbound-revisions 區塊，找到 ' + opens.length + ' 個' };
    var openLine = opens[0];
    var closeLine = -1;
    for (var c = 0; c < closes.length; c++) {
      if (closes[c] > openLine) {
        closeLine = closes[c];
        break;
      }
    }
    if (closeLine === -1) return { ok: false, message: 'praxisbound-revisions 區塊未閉合' };
    return { ok: true, jsonText: lines.slice(openLine + 1, closeLine).join('\n') };
  }

  /** 在真正 JSON.parse 前掃描原始文字的括號巢狀深度，避免對病態輸入遞迴。 */
  function rawJsonMaxDepth(text) {
    var depth = 0;
    var max = 0;
    var inString = false;
    var escape = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{' || ch === '[') {
        depth++;
        if (depth > max) max = depth;
      } else if (ch === '}' || ch === ']') {
        depth--;
      }
    }
    return max;
  }

  function validateRevisionShape(revision) {
    if (!isPlainObject(revision)) return '每則修訂必須是物件';
    if (!isString(revision.id) || !REVISION_ID_PATTERN.test(revision.id))
      return 'id 必須是合法的 ULID（REV- 加 26 碼）';
    if (!isString(revision.fingerprint) || !SHA256_PATTERN.test(revision.fingerprint))
      return 'fingerprint 格式不正確';
    var targetsMessage = validateTargets(revision.targets);
    if (targetsMessage) return targetsMessage;
    if (!isString(revision.quote) || revision.quote.length > MAX_TEXT_LENGTH)
      return 'quote 超過字串上限';
    if (REVISION_KINDS.indexOf(revision.kind) === -1) return 'kind 值不合法';
    if (typeof revision.blocking !== 'boolean') return 'blocking 必須是布林值';
    if (!isString(revision.proposal) || revision.proposal.length > MAX_TEXT_LENGTH)
      return 'proposal 超過字串上限';
    if (!isString(revision.rationale) || revision.rationale.length > MAX_TEXT_LENGTH)
      return 'rationale 超過字串上限';
    if (!isString(revision.createdAt) || !UTC_TIME_PATTERN.test(revision.createdAt))
      return 'createdAt 格式不正確';
    if (
      revision.supersedes !== undefined &&
      (!isString(revision.supersedes) || !REVISION_ID_PATTERN.test(revision.supersedes))
    )
      return 'supersedes 格式不正確';
    var allowed = [
      'id',
      'fingerprint',
      'targets',
      'quote',
      'kind',
      'blocking',
      'proposal',
      'rationale',
      'createdAt',
      'supersedes',
    ];
    var keys = Object.keys(revision);
    for (var i = 0; i < keys.length; i++) {
      if (allowed.indexOf(keys[i]) === -1) return '修訂內容包含未知欄位：' + keys[i];
    }
    return null;
  }

  function validateSheetShape(data, expectedBatchId) {
    if (!isPlainObject(data)) return '資料格式不符合預期 schema';
    if (data.schemaVersion !== '1.0.0') return 'schemaVersion 不受支援';
    if (!isString(data.batchId) || !BATCH_ID_PATTERN.test(data.batchId))
      return 'batchId 格式不正確';
    if (data.batchId !== expectedBatchId) return 'batchId 與目前批次不符';
    if (!isString(data.fingerprint) || !SHA256_PATTERN.test(data.fingerprint))
      return 'fingerprint 格式不正確';
    if (!isString(data.exportedAt) || !UTC_TIME_PATTERN.test(data.exportedAt))
      return 'exportedAt 格式不正確';
    if (!Array.isArray(data.revisions)) return '缺少 revisions 陣列';
    if (data.revisions.length > MAX_REVISIONS)
      return '修訂數量超過上限（' + MAX_REVISIONS + '）';
    for (var i = 0; i < data.revisions.length; i++) {
      var message = validateRevisionShape(data.revisions[i]);
      if (message) return '第 ' + (i + 1) + ' 則修訂：' + message;
    }
    var allowed = ['schemaVersion', 'batchId', 'fingerprint', 'exportedAt', 'revisions'];
    var keys = Object.keys(data);
    for (var k = 0; k < keys.length; k++) {
      if (allowed.indexOf(keys[k]) === -1) return '修訂單包含未知欄位：' + keys[k];
    }
    return null;
  }

  function parseSheet(text, options) {
    var expectedBatchId = isPlainObject(options) ? options.batchId : undefined;
    if (utf8Length(String(text || '')) > MAX_SHEET_BYTES)
      return { ok: false, message: '修訂單超過大小上限（1 MiB）' };

    var fence = findFenceBlock(text);
    if (!fence.ok) return { ok: false, message: fence.message };

    if (rawJsonMaxDepth(fence.jsonText) > MAX_NESTING_DEPTH)
      return { ok: false, message: 'JSON 巢狀深度超過上限（' + MAX_NESTING_DEPTH + '）' };

    var data;
    try {
      data = JSON.parse(fence.jsonText);
    } catch (e) {
      return { ok: false, message: 'JSON 解析失敗：' + e.message };
    }

    var shapeMessage = validateSheetShape(data, expectedBatchId);
    if (shapeMessage) return { ok: false, message: shapeMessage };

    return { ok: true, sheet: data };
  }

  // ---------- restore（§19：去重、衝突、掛回原位或待比對） ----------

  function normalizeForCompare(revision) {
    return JSON.stringify({
      fingerprint: revision.fingerprint,
      targets: revision.targets,
      quote: revision.quote,
      kind: revision.kind,
      blocking: !!revision.blocking,
      proposal: revision.proposal,
      rationale: revision.rationale,
      createdAt: revision.createdAt,
      supersedes: isString(revision.supersedes) ? revision.supersedes : null,
    });
  }

  function sameRevisionContent(a, b) {
    return normalizeForCompare(a) === normalizeForCompare(b);
  }

  function targetsAttach(targets, pageLocators) {
    var known = {};
    (pageLocators || []).forEach(function (locator) {
      known[locatorKey(locator)] = true;
    });
    return targets.every(function (target) {
      return known[locatorKey(target)] === true;
    });
  }

  function restore(existingRequests, sheet, pageFingerprint, pageLocators) {
    var existing = Array.isArray(existingRequests) ? existingRequests : [];
    var revisions = isPlainObject(sheet) && Array.isArray(sheet.revisions) ? sheet.revisions : [];
    var existingById = {};
    existing.forEach(function (request) {
      existingById[request.id] = request;
    });

    var conflictIds = [];
    var fresh = [];
    var skipped = 0;
    revisions.forEach(function (revision) {
      var found = existingById[revision.id];
      if (found) {
        if (sameRevisionContent(found, revision)) skipped++;
        else conflictIds.push(revision.id);
        return;
      }
      fresh.push(revision);
    });

    if (conflictIds.length > 0) {
      return { requests: existing, added: 0, skipped: 0, pending: 0, conflictIds: conflictIds };
    }

    var added = 0;
    var pending = 0;
    var restored = existing.slice();
    fresh.forEach(function (revision) {
      var attached = revision.fingerprint === pageFingerprint && targetsAttach(revision.targets, pageLocators);
      var record = {};
      Object.keys(revision).forEach(function (key) {
        record[key] = revision[key];
      });
      record.pending = !attached;
      restored.push(record);
      if (attached) added++;
      else pending++;
    });

    return { requests: restored, added: added, skipped: skipped, pending: pending, conflictIds: [] };
  }

  // ---------- 儲存輔助（§19：輔助暫存，失敗永不清空或標示已保存） ----------

  function draftKey(batchId, pageFingerprint) {
    return 'pb-review:' + batchId + ':' + pageFingerprint;
  }

  function saveDraft(storage, key, state) {
    if (!storage || typeof storage.setItem !== 'function')
      return { ok: false, reason: 'unavailable' };
    try {
      storage.setItem(key, JSON.stringify(state));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'error' };
    }
  }

  function loadDraft(storage, key) {
    if (!storage || typeof storage.getItem !== 'function')
      return { ok: false, reason: 'unavailable' };
    var raw;
    try {
      raw = storage.getItem(key);
    } catch (e) {
      return { ok: false, reason: 'error' };
    }
    if (raw === null || raw === undefined) return { ok: true, state: null };
    try {
      return { ok: true, state: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, reason: 'malformed' };
    }
  }

  // ---------- unexportedCount ----------

  function unexportedCount(requests) {
    var list = Array.isArray(requests) ? requests : [];
    return list.filter(function (request) {
      return !request.exported;
    }).length;
  }

  // ---------- Stage 2 的其餘純邏輯（抽屜顯示用，皆與 DOM 無關、可單獨測試） ----------

  /** 目標清單的可讀摘要，path#anchor 依序以「、」相接，供抽屜與行內標記顯示。 */
  function targetsSummary(targets) {
    var list = Array.isArray(targets) ? targets : [];
    return list.map(targetSummaryLine).join('、');
  }

  /** 顯示用摘要（非 §13 的儲存截斷）：壓成單行、超過長度以「…」收尾。 */
  function buildExcerpt(text, maxLength) {
    var limit = typeof maxLength === 'number' ? maxLength : 80;
    var value = isString(text) ? text : '';
    var singleLine = value.replace(/\s+/g, ' ').trim();
    if (singleLine.length <= limit) return singleLine;
    return singleLine.slice(0, limit) + '…';
  }

  /** 依 pending 旗標分組，供抽屜的「所有意見／待比對」兩區使用。 */
  function groupPendingRequests(requests) {
    var list = Array.isArray(requests) ? requests : [];
    var attached = [];
    var pending = [];
    list.forEach(function (request) {
      if (request && request.pending) pending.push(request);
      else attached.push(request);
    });
    return { attached: attached, pending: pending };
  }

  /** #batch locator 形狀（§5 規則 3）：呼叫端提供已算好的頁面指紋雜湊十六進位字串。 */
  function batchLocator(manifestPath, blockSha256) {
    return { path: manifestPath, anchor: '#batch', blockSha256: blockSha256 };
  }

  /** bytes 轉十六進位字串，供 crypto.subtle.digest 的結果轉成 blockSha256。 */
  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var part = bytes[i].toString(16);
      if (part.length < 2) part = '0' + part;
      hex += part;
    }
    return hex;
  }

  // ---------- 純邏輯 API ----------

  var api = {
    createRequest: createRequest,
    buildQuote: buildQuote,
    editExported: editExported,
    exportSheet: exportSheet,
    parseSheet: parseSheet,
    restore: restore,
    saveDraft: saveDraft,
    loadDraft: loadDraft,
    draftKey: draftKey,
    unexportedCount: unexportedCount,
    targetsSummary: targetsSummary,
    buildExcerpt: buildExcerpt,
    groupPendingRequests: groupPendingRequests,
    batchLocator: batchLocator,
    bytesToHex: bytesToHex,
  };

  // ---------- DOM 進入點：右側抽屜與行內入口（Stage 2） ----------

  function initAnnotationUi(reviewApi) {
    var body = document.body;
    var batchId = body.getAttribute('data-pb-batch-id') || '';
    var manifestPath = body.getAttribute('data-pb-manifest-path') || '';
    var fingerprint = body.getAttribute('data-pb-fingerprint') || '';
    var storageKey = reviewApi.draftKey(batchId, fingerprint);

    var state = { requests: [] };
    var storageNotice = null;
    var batchBlockSha256 = null;
    var drawerOpen = false;
    var selectingMode = false;
    var selectedTargets = [];
    var lastFocusedBeforeDrawer = null;

    var annotatable = Array.prototype.slice.call(
      document.querySelectorAll('[data-path][data-anchor][data-block-sha256]'),
    );

    // ---------- 儲存 ----------

    function safeStorage() {
      try {
        return window.localStorage;
      } catch (e) {
        return undefined;
      }
    }

    function showPersistentNotice(text) {
      if (storageNotice) {
        storageNotice.textContent = text;
        return;
      }
      storageNotice = document.createElement('div');
      storageNotice.className = 'pb-annotation pb-annotation-notice';
      storageNotice.setAttribute('role', 'status');
      storageNotice.textContent = text;
      document.body.appendChild(storageNotice);
    }

    function persist() {
      var result = reviewApi.saveDraft(safeStorage(), storageKey, state);
      if (!result.ok) showPersistentNotice('瀏覽器無法暫存，請記得匯出');
    }

    function loadInitial() {
      var result = reviewApi.loadDraft(safeStorage(), storageKey);
      if (!result.ok) {
        showPersistentNotice(
          result.reason === 'malformed'
            ? '瀏覽器暫存的資料已損毀，請記得匯出'
            : '瀏覽器無法暫存，請記得匯出',
        );
        return;
      }
      if (result.state && Array.isArray(result.state.requests)) {
        state.requests = result.state.requests.map(function (request) {
          if (request.exported === undefined) request.exported = false;
          return request;
        });
      }
    }

    // ---------- 目標與定位 ----------

    function targetFromElement(el) {
      return {
        path: el.getAttribute('data-path'),
        anchor: el.getAttribute('data-anchor'),
        blockSha256: el.getAttribute('data-block-sha256'),
      };
    }

    function sameTarget(a, b) {
      return a.path === b.path && a.anchor === b.anchor && a.blockSha256 === b.blockSha256;
    }

    function elementForTarget(target) {
      if (target.anchor === '#batch') return null;
      for (var i = 0; i < annotatable.length; i++) {
        if (sameTarget(targetFromElement(annotatable[i]), target)) return annotatable[i];
      }
      return null;
    }

    function pageLocators() {
      var list = annotatable.map(targetFromElement);
      if (batchBlockSha256)
        list.push(reviewApi.batchLocator(manifestPath, batchBlockSha256));
      return list;
    }

    function quotesForTargets(targets) {
      return targets.map(function (target) {
        var el = elementForTarget(target);
        return el ? (el.textContent || '').trim() : '';
      });
    }

    function revealTarget(target) {
      var el = elementForTarget(target);
      if (!el) return;
      var details = typeof el.closest === 'function' ? el.closest('details') : null;
      while (details) {
        details.open = true;
        var parent = details.parentElement;
        details = parent && typeof parent.closest === 'function' ? parent.closest('details') : null;
      }
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.scrollIntoView({ block: 'center' });
      el.focus();
    }

    function randomBytesForId() {
      var bytes = new Uint8Array(10);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
      else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      return bytes;
    }

    function kindLabelFor(kind) {
      var labels = {
        supplement: '補充',
        rewrite: '建議改寫',
        'add-requirement': '新增要求',
        delete: '刪除建議',
      };
      return labels[kind] || kind;
    }

    // ---------- 選取目標 ----------

    function highlightSelected() {
      annotatable.forEach(function (el) {
        var t = targetFromElement(el);
        var selected = selectedTargets.some(function (s) {
          return sameTarget(s, t);
        });
        el.classList.toggle('pb-annotation-target-selected', selected);
      });
    }

    function addSelectedTarget(target) {
      if (!selectedTargets.some(function (t) { return sameTarget(t, target); }))
        selectedTargets.push(target);
      highlightSelected();
      renderDrawer();
    }

    function toggleSelectedTarget(target) {
      var index = selectedTargets.findIndex(function (t) { return sameTarget(t, target); });
      if (index === -1) selectedTargets.push(target);
      else selectedTargets.splice(index, 1);
      highlightSelected();
      renderDrawer();
    }

    function removeSelectedTarget(index) {
      selectedTargets.splice(index, 1);
      highlightSelected();
      renderDrawer();
    }

    function addBatchTarget() {
      if (!batchBlockSha256) return;
      addSelectedTarget(reviewApi.batchLocator(manifestPath, batchBlockSha256));
    }

    function setSelectingMode(active) {
      selectingMode = active;
      annotatable.forEach(function (el) {
        if (active) {
          el.setAttribute('tabindex', '0');
          el.classList.add('pb-annotation-selectable');
        } else {
          el.removeAttribute('tabindex');
          el.classList.remove('pb-annotation-selectable');
        }
      });
      renderDrawer();
    }

    function onAnnotatableActivate(e) {
      if (!selectingMode) return;
      if (e.type === 'keydown' && e.key !== 'Enter') return;
      e.preventDefault();
      toggleSelectedTarget(targetFromElement(e.currentTarget));
    }

    annotatable.forEach(function (el) {
      el.addEventListener('click', onAnnotatableActivate);
      el.addEventListener('keydown', onAnnotatableActivate);
    });

    // ---------- 行內「＋意見」入口 ----------

    annotatable.forEach(function (el) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'pb-annotation pb-annotation-inline-add';
      button.textContent = '＋意見';
      button.setAttribute('aria-label', '對此段落提出意見');
      button.addEventListener('click', function (e) {
        e.stopPropagation();
        addSelectedTarget(targetFromElement(el));
        setDrawerOpen(true);
      });
      el.appendChild(button);
    });

    // ---------- 抽屜骨架 ----------

    var toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'pb-annotation pb-annotation-toggle';
    toggleButton.textContent = '審閱意見';
    toggleButton.setAttribute('aria-expanded', 'false');
    toggleButton.addEventListener('click', function () {
      setDrawerOpen(!drawerOpen);
    });

    var drawer = document.createElement('div');
    drawer.className = 'pb-annotation pb-annotation-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', '審閱意見面板');
    drawer.hidden = true;

    var editContainer = document.createElement('div');
    editContainer.className = 'pb-annotation-edit-container';

    var actionPanel = document.createElement('div');
    actionPanel.className = 'pb-annotation-action-panel';

    document.body.appendChild(toggleButton);
    document.body.appendChild(drawer);

    function onDrawerKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      var focusables = Array.prototype.slice
        .call(
          drawer.querySelectorAll(
            'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
          ),
        )
        .filter(function (el) {
          return !el.disabled;
        });
      if (focusables.length === 0) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    function setDrawerOpen(open) {
      drawerOpen = open;
      drawer.hidden = !open;
      toggleButton.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        lastFocusedBeforeDrawer = document.activeElement;
        renderDrawer();
        var focusable = drawer.querySelector('button, input, select, textarea, [tabindex]');
        if (focusable) focusable.focus();
        document.addEventListener('keydown', onDrawerKeydown, true);
      } else {
        document.removeEventListener('keydown', onDrawerKeydown, true);
        if (lastFocusedBeforeDrawer && typeof lastFocusedBeforeDrawer.focus === 'function')
          lastFocusedBeforeDrawer.focus();
      }
    }

    // ---------- 表單 ----------

    function buildRequestForm(container, targets, prefill, onSave) {
      var form = document.createElement('form');
      form.className = 'pb-annotation pb-annotation-form';

      var kindLabel = document.createElement('label');
      kindLabel.textContent = '類型';
      var kindSelect = document.createElement('select');
      [
        ['supplement', '補充'],
        ['rewrite', '建議改寫'],
        ['add-requirement', '新增要求'],
        ['delete', '刪除建議'],
      ].forEach(function (pair) {
        var option = document.createElement('option');
        option.value = pair[0];
        option.textContent = pair[1];
        kindSelect.appendChild(option);
      });
      kindSelect.value = prefill ? prefill.kind : 'supplement';
      kindLabel.appendChild(kindSelect);

      var proposalLabel = document.createElement('label');
      proposalLabel.textContent = '提案';
      var proposalInput = document.createElement('textarea');
      proposalInput.value = prefill ? prefill.proposal : '';
      proposalLabel.appendChild(proposalInput);

      var rationaleLabel = document.createElement('label');
      rationaleLabel.textContent = '理由';
      var rationaleInput = document.createElement('textarea');
      rationaleInput.value = prefill ? prefill.rationale : '';
      rationaleLabel.appendChild(rationaleInput);

      var blockingLabel = document.createElement('label');
      var blockingInput = document.createElement('input');
      blockingInput.type = 'checkbox';
      blockingInput.checked = prefill ? !!prefill.blocking : true;
      blockingLabel.appendChild(blockingInput);
      blockingLabel.appendChild(document.createTextNode(' 阻擋'));

      var errorText = document.createElement('p');
      errorText.className = 'pb-annotation-error';
      errorText.setAttribute('role', 'alert');

      var submitButton = document.createElement('button');
      submitButton.type = 'submit';
      submitButton.textContent = '儲存';

      form.appendChild(kindLabel);
      form.appendChild(proposalLabel);
      form.appendChild(rationaleLabel);
      form.appendChild(blockingLabel);
      form.appendChild(errorText);
      form.appendChild(submitButton);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var result = onSave({
          kind: kindSelect.value,
          proposal: proposalInput.value,
          rationale: rationaleInput.value,
          blocking: blockingInput.checked,
        });
        if (result && result.ok === false) errorText.textContent = result.message;
      });

      container.appendChild(form);
      return form;
    }

    function renderNewRequestForm(container) {
      if (selectedTargets.length === 0) return;
      var heading = document.createElement('h3');
      heading.textContent = '新增意見';
      container.appendChild(heading);
      var targets = selectedTargets.slice();
      buildRequestForm(container, targets, null, function (fields) {
        var quote = reviewApi.buildQuote(quotesForTargets(targets));
        var result = reviewApi.createRequest({
          kind: fields.kind,
          proposal: fields.proposal,
          rationale: fields.rationale,
          blocking: fields.blocking,
          targets: targets,
          quote: quote,
          fingerprint: fingerprint,
          now: Date.now(),
          random: randomBytesForId(),
        });
        if (!result.ok) return result;
        result.request.exported = false;
        state.requests.push(result.request);
        selectedTargets = [];
        highlightSelected();
        persist();
        renderDrawer();
        renderPageMarkers();
        return result;
      });
    }

    function closeEdit() {
      editContainer.textContent = '';
    }

    function openEditForm(request) {
      editContainer.textContent = '';
      var heading = document.createElement('h3');
      heading.textContent = request.exported ? '修改（將建立新版本）' : '修改草稿';
      editContainer.appendChild(heading);
      buildRequestForm(editContainer, request.targets, request, function (fields) {
        var quote = reviewApi.buildQuote(quotesForTargets(request.targets));
        if (request.exported) {
          var edited = reviewApi.editExported(
            request,
            {
              kind: fields.kind,
              proposal: fields.proposal,
              rationale: fields.rationale,
              blocking: fields.blocking,
              quote: quote,
            },
            Date.now(),
            randomBytesForId(),
          );
          if (!edited.ok) return edited;
          edited.request.exported = false;
          state.requests.push(edited.request);
        } else {
          var result = reviewApi.createRequest({
            kind: fields.kind,
            proposal: fields.proposal,
            rationale: fields.rationale,
            blocking: fields.blocking,
            targets: request.targets,
            quote: quote,
            fingerprint: request.fingerprint,
            now: Date.now(),
            random: randomBytesForId(),
          });
          if (!result.ok) return result;
          result.request.id = request.id;
          result.request.createdAt = request.createdAt;
          result.request.exported = false;
          var index = state.requests.indexOf(request);
          if (index !== -1) state.requests[index] = result.request;
        }
        persist();
        closeEdit();
        renderDrawer();
        renderPageMarkers();
        return { ok: true };
      });
      var cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = '取消';
      cancelButton.addEventListener('click', closeEdit);
      editContainer.appendChild(cancelButton);
    }

    // ---------- 匯出 / 還原 ----------

    function clearActionPanel() {
      actionPanel.textContent = '';
    }

    function openExportPanel() {
      clearActionPanel();
      var text;
      try {
        text = reviewApi.exportSheet({
          batchId: batchId,
          pageFingerprint: fingerprint,
          requests: state.requests,
          now: Date.now(),
        });
      } catch (e) {
        var errorMessage = document.createElement('p');
        errorMessage.className = 'pb-annotation-error';
        errorMessage.textContent = '匯出失敗，草稿未變更。';
        actionPanel.appendChild(errorMessage);
        return;
      }
      state.requests = state.requests.map(function (request) {
        request.exported = true;
        return request;
      });
      persist();
      renderDrawer();

      var heading = document.createElement('h3');
      heading.textContent = '匯出的修訂單';
      actionPanel.appendChild(heading);

      var textarea = document.createElement('textarea');
      textarea.className = 'pb-annotation-export-text';
      textarea.readOnly = true;
      textarea.value = text;
      actionPanel.appendChild(textarea);

      var downloadLink = document.createElement('a');
      downloadLink.textContent = '下載';
      downloadLink.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      downloadLink.setAttribute('download', batchId + '-revisions.md');
      actionPanel.appendChild(downloadLink);

      var copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.textContent = '複製';
      copyButton.addEventListener('click', function () {
        function done() {
          copyButton.textContent = '已複製';
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {
            textarea.select();
            try {
              document.execCommand('copy');
            } catch (e) {}
            done();
          });
        } else {
          textarea.select();
          try {
            document.execCommand('copy');
          } catch (e) {}
          done();
        }
      });
      actionPanel.appendChild(copyButton);
    }

    function openRestorePanel() {
      clearActionPanel();
      var heading = document.createElement('h3');
      heading.textContent = '還原修訂單';
      actionPanel.appendChild(heading);

      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.md,.txt';
      actionPanel.appendChild(fileInput);

      var pasteArea = document.createElement('textarea');
      pasteArea.className = 'pb-annotation-restore-text';
      pasteArea.placeholder = '貼上修訂單文字';
      actionPanel.appendChild(pasteArea);

      fileInput.addEventListener('change', function () {
        var file = fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          pasteArea.value = String(reader.result || '');
        };
        reader.readAsText(file);
      });

      var messageEl = document.createElement('p');
      messageEl.setAttribute('role', 'status');
      actionPanel.appendChild(messageEl);

      var applyButton = document.createElement('button');
      applyButton.type = 'button';
      applyButton.textContent = '套用';
      applyButton.addEventListener('click', function () {
        var parsed = reviewApi.parseSheet(pasteArea.value, { batchId: batchId });
        if (!parsed.ok) {
          messageEl.textContent = parsed.message;
          return;
        }
        var result = reviewApi.restore(state.requests, parsed.sheet, fingerprint, pageLocators());
        if (result.conflictIds.length > 0) {
          messageEl.textContent = '還原失敗，以下 id 內容衝突：' + result.conflictIds.join('、');
          return;
        }
        state.requests = result.requests.map(function (request) {
          if (request.exported === undefined) request.exported = true;
          return request;
        });
        persist();
        renderDrawer();
        renderPageMarkers();
        messageEl.textContent =
          '新增 ' + result.added + ' 則、待比對 ' + result.pending + ' 則、略過重複 ' + result.skipped + ' 則。';
      });
      actionPanel.appendChild(applyButton);
    }

    // ---------- 清單與抽屜組裝 ----------

    function renderRequestCard(list, request) {
      var card = document.createElement('div');
      card.className = 'pb-annotation-card';
      card.setAttribute('tabindex', '-1');
      card.setAttribute('data-pb-request-id', request.id);

      var head = document.createElement('div');
      head.className = 'pb-annotation-card-head';
      var kindBadge = document.createElement('span');
      kindBadge.className = 'pb-annotation-badge';
      kindBadge.textContent = kindLabelFor(request.kind);
      head.appendChild(kindBadge);
      if (request.blocking) {
        var blockingBadge = document.createElement('span');
        blockingBadge.className = 'pb-annotation-badge pb-annotation-badge-blocking';
        blockingBadge.textContent = '阻擋';
        head.appendChild(blockingBadge);
      }
      var statusBadge = document.createElement('span');
      statusBadge.className = 'pb-annotation-badge';
      statusBadge.textContent = request.pending ? '待比對' : request.exported ? '已匯出' : '未匯出';
      head.appendChild(statusBadge);
      card.appendChild(head);

      var targetsLine = document.createElement('p');
      targetsLine.className = 'pb-annotation-targets';
      targetsLine.textContent = reviewApi.targetsSummary(request.targets);
      card.appendChild(targetsLine);

      var excerpt = document.createElement('p');
      excerpt.className = 'pb-annotation-excerpt';
      excerpt.textContent = reviewApi.buildExcerpt(request.quote);
      card.appendChild(excerpt);

      var actions = document.createElement('div');
      actions.className = 'pb-annotation-card-actions';

      if (!request.pending) {
        var revealButton = document.createElement('button');
        revealButton.type = 'button';
        revealButton.textContent = '跳回原文';
        revealButton.addEventListener('click', function () {
          request.targets.forEach(revealTarget);
        });
        actions.appendChild(revealButton);
      }

      var editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.textContent = '修改';
      editButton.addEventListener('click', function () {
        openEditForm(request);
      });
      actions.appendChild(editButton);

      card.appendChild(actions);
      list.appendChild(card);
    }

    function renderToolbar(container) {
      var toolbar = document.createElement('div');
      toolbar.className = 'pb-annotation-toolbar';

      var countText = document.createElement('span');
      var count = reviewApi.unexportedCount(state.requests);
      countText.textContent = count > 0 ? '有 ' + count + ' 則未匯出的意見' : '沒有未匯出的意見';
      toolbar.appendChild(countText);

      var exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.textContent = '匯出';
      exportButton.addEventListener('click', openExportPanel);
      toolbar.appendChild(exportButton);

      var restoreButton = document.createElement('button');
      restoreButton.type = 'button';
      restoreButton.textContent = '還原';
      restoreButton.addEventListener('click', openRestorePanel);
      toolbar.appendChild(restoreButton);

      container.appendChild(toolbar);
    }

    function renderSelectedTargetsSection(container) {
      var section = document.createElement('section');
      section.className = 'pb-annotation-section';
      var heading = document.createElement('h3');
      heading.textContent = '目前選取目標';
      section.appendChild(heading);

      var modeButton = document.createElement('button');
      modeButton.type = 'button';
      modeButton.textContent = selectingMode ? '結束選取目標' : '選取目標';
      modeButton.addEventListener('click', function () {
        setSelectingMode(!selectingMode);
      });
      section.appendChild(modeButton);

      var batchButton = document.createElement('button');
      batchButton.type = 'button';
      batchButton.textContent = '整批';
      batchButton.disabled = !batchBlockSha256;
      batchButton.addEventListener('click', addBatchTarget);
      section.appendChild(batchButton);

      var list = document.createElement('ul');
      list.className = 'pb-annotation-target-list';
      selectedTargets.forEach(function (target, index) {
        var item = document.createElement('li');
        var label = document.createElement('span');
        label.textContent = reviewApi.targetsSummary([target]);
        item.appendChild(label);
        var removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = '移除';
        removeButton.addEventListener('click', function () {
          removeSelectedTarget(index);
        });
        item.appendChild(removeButton);
        list.appendChild(item);
      });
      section.appendChild(list);
      container.appendChild(section);
      renderNewRequestForm(section);
    }

    function revealRequestInDrawer(request) {
      var card = drawer.querySelector('[data-pb-request-id="' + request.id + '"]');
      if (card) {
        card.scrollIntoView({ block: 'center' });
        card.focus();
      }
    }

    function renderDrawer() {
      drawer.textContent = '';

      var header = document.createElement('div');
      header.className = 'pb-annotation-drawer-header';
      var heading = document.createElement('h2');
      heading.textContent = '審閱意見';
      header.appendChild(heading);
      var closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.textContent = '關閉';
      closeButton.addEventListener('click', function () {
        setDrawerOpen(false);
      });
      header.appendChild(closeButton);
      renderToolbar(header);
      drawer.appendChild(header);

      drawer.appendChild(editContainer);
      drawer.appendChild(actionPanel);

      renderSelectedTargetsSection(drawer);

      var listSection = document.createElement('section');
      listSection.className = 'pb-annotation-section';
      var listHeading = document.createElement('h3');
      listHeading.textContent = '所有意見（' + state.requests.length + '）';
      listSection.appendChild(listHeading);

      var groups = reviewApi.groupPendingRequests(state.requests);

      if (groups.attached.length === 0 && groups.pending.length === 0) {
        var empty = document.createElement('p');
        empty.className = 'pb-annotation-muted';
        empty.textContent = '目前沒有任何意見。';
        listSection.appendChild(empty);
      }

      var attachedList = document.createElement('div');
      groups.attached.forEach(function (request) {
        renderRequestCard(attachedList, request);
      });
      listSection.appendChild(attachedList);

      if (groups.pending.length > 0) {
        var pendingHeading = document.createElement('h4');
        pendingHeading.textContent = '待比對';
        listSection.appendChild(pendingHeading);
        var pendingList = document.createElement('div');
        groups.pending.forEach(function (request) {
          renderRequestCard(pendingList, request);
        });
        listSection.appendChild(pendingList);
      }

      drawer.appendChild(listSection);
    }

    function renderPageMarkers() {
      var markers = document.querySelectorAll('.pb-annotation-marker');
      for (var i = 0; i < markers.length; i++) markers[i].parentNode.removeChild(markers[i]);

      state.requests.forEach(function (request) {
        if (request.pending) return;
        request.targets.forEach(function (target) {
          var el = elementForTarget(target);
          if (!el) return;
          var marker = document.createElement('button');
          marker.type = 'button';
          marker.className = 'pb-annotation pb-annotation-marker';
          marker.textContent = kindLabelFor(request.kind) + '：' + reviewApi.buildExcerpt(request.quote, 40);
          marker.addEventListener('click', function () {
            setDrawerOpen(true);
            revealRequestInDrawer(request);
          });
          el.appendChild(marker);
        });
      });
    }

    // ---------- 初始化 ----------

    loadInitial();
    renderPageMarkers();

    window.addEventListener('beforeunload', function (e) {
      if (reviewApi.unexportedCount(state.requests) > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
      window.crypto.subtle
        .digest('SHA-256', new TextEncoder().encode(fingerprint))
        .then(function (digest) {
          batchBlockSha256 = reviewApi.bytesToHex(new Uint8Array(digest));
          if (drawerOpen) renderDrawer();
        }, function () {});
    }
  }

  var testHook =
    typeof globalThis !== 'undefined' ? globalThis.__PRAXIS_REVIEW_TEST__ : undefined;
  if (testHook) {
    Object.keys(api).forEach(function (key) {
      testHook[key] = api[key];
    });
  } else if (typeof document !== 'undefined') {
    initAnnotationUi(api);
  }
})();
`;
