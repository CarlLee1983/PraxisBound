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
  };

  // ---------- DOM 進入點（Stage 2 才會實作抽屜與行內入口） ----------

  function initAnnotationUi(reviewAnnotationApi) {
    // Stage 2 fills the right-hand drawer and inline entry here, reading
    // batchId/manifest path/fingerprint from document.body.dataset and
    // driving reviewAnnotationApi. Stage 1 wires no visible UI.
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
