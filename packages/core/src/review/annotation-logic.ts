/**
 * 審閱層 script 的第一段：常數、schema 驗證、Revision Sheet 的匯出與解析、
 * 同內容判定與 quote 文字收集（contract §6、§13、§19）。
 *
 * 這段文字與 annotation-state.ts、annotation-ui.ts 由 annotation-script.ts
 * 接成同一個 IIFE 的函式本體，彼此共用同一個函式作用域；它本身不是可單獨
 * 執行的 script。撰寫規則同 annotation-script.ts：`String.raw`，不含反引號
 * 與 `${`。
 */

export const ANNOTATION_LOGIC = String.raw`
  var MAX_TEXT_BYTES = 65536;
  var MAX_SHEET_BYTES = 1048576;
  var MAX_REVISIONS = 1000;
  var MAX_NESTING_DEPTH = 32;
  var MAX_TARGETS = 100;
  var MAX_LOCATOR_FIELD_LENGTH = 1024;
  var MAX_BATCH_ID_LENGTH = 128;
  var TRUNCATE_MARKER = '…（已截斷）';
  var SUMMARY_EXCERPT_LENGTH = 200;
  // Built from char codes, not a literal backtick: this source is authored
  // inside a String.raw template (see annotation-script.ts), where a raw
  // backtick would end the template.
  var BACKTICK = String.fromCharCode(96);
  var FENCE_OPEN = BACKTICK + BACKTICK + BACKTICK + 'praxisbound-revisions';
  var FENCE_CLOSE = BACKTICK + BACKTICK + BACKTICK;
  var REVISION_KINDS = ['supplement', 'rewrite', 'add-requirement', 'delete'];
  var KIND_LABELS = {
    supplement: '補充',
    rewrite: '建議改寫',
    'add-requirement': '新增要求',
    delete: '刪除建議',
  };
  var CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  var SHEET_KEYS = ['schemaVersion', 'batchId', 'fingerprint', 'exportedAt', 'revisions'];
  var REVISION_KEYS = [
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
  var LOCATOR_KEYS = ['path', 'anchor', 'blockSha256'];
  var TEXT_FIELDS = ['quote', 'proposal', 'rationale'];

  var SHA256_PATTERN = /^[a-f0-9]{64}$/;
  var REVISION_ID_PATTERN = /^REV-[0-9A-HJKMNP-TV-Z]{26}$/;
  var UTC_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;
  var BATCH_ID_PATTERN =
    /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]+(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
  var REPO_PATH_PATTERN =
    /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)[^\\\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/;
  // 所有會把文字切成 "> " 引用行的地方都以這組換行切割（security-M1）。
  var LINE_BREAK_PATTERN = /\r\n|\r|\n|\u2028|\u2029/;

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

  function codePointLength(text) {
    var count = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) i++;
      }
      count++;
    }
    return count;
  }

  /** 物件只可含 allowed 內的鍵；回傳第一個未知鍵，全部合法時回傳 null。 */
  function unknownKey(object, allowed) {
    var keys = Object.keys(object);
    for (var i = 0; i < keys.length; i++) {
      if (allowed.indexOf(keys[i]) === -1) return keys[i];
    }
    return null;
  }

  /** 換行正規化：\r\n 與單獨的 \r 一律視為 \n（還原與同內容判定共用）。 */
  function normalizeNewlines(text) {
    return isString(text) ? text.replace(/\r\n?/g, '\n') : text;
  }

  /**
   * §13：截斷至 maxBytes（UTF-8），並在結尾附上可見標記，總長度（含標記）
   * 永不超過上限。以逐位元組退位方式找到合法的 UTF-8 邊界，避免切壞字元。
   */
  function truncateText(text, maxBytes) {
    var encoder = new TextEncoder();
    var bytes = encoder.encode(text);
    if (bytes.length <= maxBytes) return text;
    var budget = maxBytes - encoder.encode(TRUNCATE_MARKER).length;
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
      .split(LINE_BREAK_PATTERN)
      .map(function (line) {
        return '> ' + line;
      })
      .join('\n');
  }

  function kindLabel(kind) {
    return Object.prototype.hasOwnProperty.call(KIND_LABELS, kind) ? KIND_LABELS[kind] : String(kind);
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
      var byteBits = (randomBytes[j] & 0xff).toString(2);
      while (byteBits.length < 8) byteBits = '0' + byteBits;
      bits += byteBits;
    }
    var randomChars = '';
    for (var k = 0; k + 5 <= bits.length; k += 5) {
      randomChars += CROCKFORD_ALPHABET.charAt(parseInt(bits.substr(k, 5), 2));
    }
    return timeChars + randomChars;
  }

  // ---------- UTC 時間：defs 的 pattern 加上真實日期檢查 ----------

  /** 同 schema 的 date-time（RFC 3339）：閏秒 :60 只能出現在 UTC 的 23:59。 */
  function isUtcDateTime(value) {
    if (!isString(value)) return false;
    var match = UTC_TIME_PATTERN.exec(value);
    if (!match) return false;
    var parts = match.slice(1, 7).map(Number);
    var leap = parts[5] === 60;
    if (leap && (parts[3] !== 23 || parts[4] !== 59)) return false;
    var seconds = leap ? 59 : parts[5];
    var date = new Date(0);
    date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
    date.setUTCHours(parts[3], parts[4], seconds, 0);
    return (
      date.getUTCFullYear() === parts[0] &&
      date.getUTCMonth() === parts[1] - 1 &&
      date.getUTCDate() === parts[2] &&
      date.getUTCHours() === parts[3] &&
      date.getUTCMinutes() === parts[4] &&
      date.getUTCSeconds() === seconds
    );
  }

  /** 標準 UTC 形式：大寫 T、小數秒去除尾端 0（全為 0 則省略）、結尾 Z；閏秒保留 :60。 */
  function canonicalUtcTime(value) {
    var match = isString(value) ? UTC_TIME_PATTERN.exec(value) : null;
    if (!match) return value;
    var fraction = (match[7] || '').replace(/0+$/, '');
    if (fraction === '.') fraction = '';
    return (
      match[1] + '-' + match[2] + '-' + match[3] + 'T' + match[4] + ':' + match[5] + ':' + match[6] +
      fraction + 'Z'
    );
  }

  // ---------- schema 驗證（revision-sheet.schema.json 與 defs.schema.json） ----------

  function textMessage(value, name) {
    if (!isString(value)) return name + ' 必須是字串';
    if (utf8Length(value) > MAX_TEXT_BYTES) return name + ' 超過字串上限（64 KiB，UTF-8）';
    return null;
  }

  function boundedStringMessage(value, name) {
    if (!isString(value) || value.length === 0) return name + ' 必須是非空字串';
    if (value.length > MAX_LOCATOR_FIELD_LENGTH * 2 || codePointLength(value) > MAX_LOCATOR_FIELD_LENGTH)
      return name + ' 超過 ' + MAX_LOCATOR_FIELD_LENGTH + ' 字元';
    return null;
  }

  function validateLocator(target) {
    if (!isPlainObject(target)) return '目標必須是物件';
    var extra = unknownKey(target, LOCATOR_KEYS);
    if (extra !== null) return '目標包含未知欄位：' + extra;
    var pathMessage = boundedStringMessage(target.path, '目標路徑');
    if (pathMessage) return pathMessage;
    if (!REPO_PATH_PATTERN.test(target.path)) return '目標路徑格式不正確';
    var anchorMessage = boundedStringMessage(target.anchor, '目標錨點');
    if (anchorMessage) return anchorMessage;
    if (!isString(target.blockSha256) || !SHA256_PATTERN.test(target.blockSha256))
      return '目標區塊雜湊格式不正確';
    return null;
  }

  function validateTargets(targets) {
    if (!Array.isArray(targets) || targets.length < 1) return '至少需要一個目標';
    if (targets.length > MAX_TARGETS) return '目標數量超過上限（' + MAX_TARGETS + '）';
    for (var i = 0; i < targets.length; i++) {
      var message = validateLocator(targets[i]);
      if (message) return message;
    }
    return null;
  }

  function validateRevision(revision, extraKeys) {
    if (!isPlainObject(revision)) return '每則修訂必須是物件';
    var extra = unknownKey(revision, REVISION_KEYS.concat(extraKeys || []));
    if (extra !== null) return '修訂內容包含未知欄位：' + extra;
    if (!isString(revision.id) || !REVISION_ID_PATTERN.test(revision.id))
      return 'id 必須是合法的 ULID（REV- 加 26 碼）';
    if (!isString(revision.fingerprint) || !SHA256_PATTERN.test(revision.fingerprint))
      return 'fingerprint 格式不正確';
    var targetsMessage = validateTargets(revision.targets);
    if (targetsMessage) return targetsMessage;
    for (var i = 0; i < TEXT_FIELDS.length; i++) {
      var message = textMessage(revision[TEXT_FIELDS[i]], TEXT_FIELDS[i]);
      if (message) return message;
    }
    if (REVISION_KINDS.indexOf(revision.kind) === -1) return 'kind 值不合法';
    if (typeof revision.blocking !== 'boolean') return 'blocking 必須是布林值';
    if (!isUtcDateTime(revision.createdAt)) return 'createdAt 必須是 UTC 日期時間';
    if (revision.supersedes !== undefined) {
      if (!isString(revision.supersedes) || !REVISION_ID_PATTERN.test(revision.supersedes))
        return 'supersedes 格式不正確';
      if (revision.supersedes === revision.id) return 'supersedes 不可指向自己';
    }
    return null;
  }

  function validateSheet(data, expectedBatchId) {
    if (!isPlainObject(data)) return '資料格式不符合預期 schema';
    var extra = unknownKey(data, SHEET_KEYS);
    if (extra !== null) return '修訂單包含未知欄位：' + extra;
    if (data.schemaVersion !== '1.0.0') return 'schemaVersion 不受支援';
    if (
      !isString(data.batchId) ||
      data.batchId.length > MAX_BATCH_ID_LENGTH ||
      !BATCH_ID_PATTERN.test(data.batchId)
    )
      return 'batchId 格式不正確';
    if (data.batchId !== expectedBatchId) return 'batchId 與目前批次不符';
    if (!isString(data.fingerprint) || !SHA256_PATTERN.test(data.fingerprint))
      return 'fingerprint 格式不正確';
    if (!isUtcDateTime(data.exportedAt)) return 'exportedAt 必須是 UTC 日期時間';
    if (!Array.isArray(data.revisions)) return '缺少 revisions 陣列';
    if (data.revisions.length > MAX_REVISIONS) return '修訂數量超過上限（' + MAX_REVISIONS + '）';
    for (var i = 0; i < data.revisions.length; i++) {
      var message = validateRevision(data.revisions[i]);
      if (message) return '第 ' + (i + 1) + ' 則修訂：' + message;
    }
    return null;
  }

  // ---------- supersedes 鏈：不可指向自己、不可成環、同一 id 只能被一則取代 ----------

  /**
   * 回傳違規清單 [{ id, message }]；ids 為參與違規、應拒絕或隔離的意見。
   * 每則意見至多一個 supersedes，沿鏈判定循環時記下每個節點的結論，整體為線性時間。
   */
  function supersedesConflicts(list) {
    var byId = Object.create(null);
    var supersededBy = Object.create(null);
    var conflicts = [];
    list.forEach(function (request) {
      byId[request.id] = request;
    });
    list.forEach(function (request) {
      if (!isString(request.supersedes)) return;
      if (request.supersedes === request.id) {
        conflicts.push({ id: request.id, message: '意見 ' + request.id + ' 不可取代自己' });
        return;
      }
      var earlier = supersededBy[request.supersedes];
      if (earlier !== undefined) {
        conflicts.push({
          id: request.id,
          message: '意見 ' + request.supersedes + ' 同時被 ' + earlier + ' 與 ' + request.id + ' 取代',
        });
        return;
      }
      supersededBy[request.supersedes] = request.id;
    });
    var reachesCycle = Object.create(null);
    list.forEach(function (request) {
      var path = [];
      var onPath = Object.create(null);
      var cyclic = false;
      var current = request;
      while (current && isString(current.supersedes)) {
        if (reachesCycle[current.id] !== undefined) {
          cyclic = reachesCycle[current.id];
          break;
        }
        if (onPath[current.id]) {
          cyclic = true;
          break;
        }
        onPath[current.id] = true;
        path.push(current.id);
        current = byId[current.supersedes];
      }
      path.forEach(function (id) {
        reachesCycle[id] = cyclic;
      });
      if (cyclic) conflicts.push({ id: request.id, message: '意見 ' + request.id + ' 的 supersedes 形成循環' });
    });
    return conflicts;
  }

  // ---------- 同內容判定（contract §6 修訂性澄清，R-004） ----------

  function copyLocator(target) {
    return { path: target.path, anchor: target.anchor, blockSha256: target.blockSha256 };
  }

  /** 只取 schema 欄位，產生新物件（不帶 exported／pending 等頁面旗標）。 */
  function revisionToRecord(request) {
    var record = {
      id: request.id,
      fingerprint: request.fingerprint,
      targets: request.targets.map(copyLocator),
      quote: request.quote,
      kind: request.kind,
      blocking: request.blocking,
      proposal: request.proposal,
      rationale: request.rationale,
      createdAt: request.createdAt,
    };
    if (isString(request.supersedes)) record.supersedes = request.supersedes;
    return record;
  }

  function canonicalJson(value) {
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    if (isPlainObject(value)) {
      return (
        '{' +
        Object.keys(value)
          .sort()
          .map(function (key) {
            return JSON.stringify(key) + ':' + canonicalJson(value[key]);
          })
          .join(',') +
        '}'
      );
    }
    return JSON.stringify(value);
  }

  /** 各層鍵名排序、createdAt 轉標準 UTC、文字欄位換行正規化後的標準字串。 */
  function revisionContentKey(revision) {
    var record = revisionToRecord(revision);
    record.createdAt = canonicalUtcTime(record.createdAt);
    TEXT_FIELDS.forEach(function (field) {
      record[field] = normalizeNewlines(record[field]);
    });
    return canonicalJson(record);
  }

  function sameRevisionContent(a, b) {
    return revisionContentKey(a) === revisionContentKey(b);
  }

  // ---------- parseSheet（§6 區塊規則、§13 上限、schema、同單內重複 id） ----------

  function findFenceBlock(text) {
    var lines = text.split('\n');
    var opens = [];
    var closes = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\r$/, '');
      if (line === FENCE_OPEN) opens.push(i);
      else if (line === FENCE_CLOSE) closes.push(i);
    }
    if (opens.length !== 1)
      return { ok: false, message: '必須恰好包含一個 praxisbound-revisions 區塊，找到 ' + opens.length + ' 個' };
    var closeLine = -1;
    for (var c = 0; c < closes.length; c++) {
      if (closes[c] > opens[0]) {
        closeLine = closes[c];
        break;
      }
    }
    if (closeLine === -1) return { ok: false, message: 'praxisbound-revisions 區塊未閉合' };
    return { ok: true, jsonText: lines.slice(opens[0] + 1, closeLine).join('\n') };
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
      } else if (ch === '{' || ch === '[') {
        depth++;
        if (depth > max) max = depth;
      } else if (ch === '}' || ch === ']') {
        depth--;
      }
    }
    return max;
  }

  function normalizedRevision(revision) {
    var record = revisionToRecord(revision);
    TEXT_FIELDS.forEach(function (field) {
      record[field] = normalizeNewlines(record[field]);
    });
    return record;
  }

  /** 同一份修訂單內重複的 id：同內容只留一則並計數，不同內容列出 id。 */
  function dedupeRevisions(revisions) {
    var firstById = Object.create(null);
    var unique = [];
    var conflictIds = [];
    var skipped = 0;
    revisions.forEach(function (revision) {
      var first = firstById[revision.id];
      if (first === undefined) {
        firstById[revision.id] = revision;
        unique.push(revision);
      } else if (sameRevisionContent(first, revision)) {
        skipped++;
      } else if (conflictIds.indexOf(revision.id) === -1) {
        conflictIds.push(revision.id);
      }
    });
    return { unique: unique, skipped: skipped, conflictIds: conflictIds };
  }

  function parseSheet(text, options) {
    var expectedBatchId = isPlainObject(options) ? options.batchId : undefined;
    if (!isString(text)) return { ok: false, message: '修訂單必須是文字' };
    if (utf8Length(text) > MAX_SHEET_BYTES) return { ok: false, message: '修訂單超過大小上限（1 MiB）' };

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
    var shapeMessage = validateSheet(data, expectedBatchId);
    if (shapeMessage) return { ok: false, message: shapeMessage };

    var deduped = dedupeRevisions(data.revisions);
    if (deduped.conflictIds.length > 0) {
      return {
        ok: false,
        conflictIds: deduped.conflictIds,
        message: '修訂單內同一 id 的內容不同：' + deduped.conflictIds.join('、'),
      };
    }
    var conflicts = supersedesConflicts(deduped.unique);
    if (conflicts.length > 0) return { ok: false, message: conflicts[0].message };

    return {
      ok: true,
      skipped: deduped.skipped,
      sheet: {
        schemaVersion: data.schemaVersion,
        batchId: data.batchId,
        fingerprint: data.fingerprint,
        exportedAt: data.exportedAt,
        revisions: deduped.unique.map(normalizedRevision),
      },
    };
  }

  // ---------- exportSheet（§6 格式；R8：讀者文字只以 "> " 引用；輸出先自我驗證） ----------

  function targetSummaryLine(target) {
    return target.path + '#' + target.anchor;
  }

  /** JSON.stringify 不跳脫 U+2028/U+2029；改寫成跳脫序列，讓匯出文字只含 \n 換行。 */
  function jsonLine(value) {
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  /** 摘要只放每段讀者文字的前 200 個字元（碼位），完整內容以 JSON 區塊為準（Q18）。 */
  function summaryExcerpt(text) {
    var chars = Array.from(isString(text) ? text : '');
    if (chars.length <= SUMMARY_EXCERPT_LENGTH) return chars.join('');
    return chars.slice(0, SUMMARY_EXCERPT_LENGTH).join('') + '…';
  }

  function sheetText(batchId, pageFingerprint, exportedAt, records) {
    var lines = [];
    lines.push('# 修訂單 — ' + batchId);
    lines.push('');
    lines.push('- Fingerprint：' + pageFingerprint);
    lines.push('- 匯出時間：' + exportedAt);
    lines.push('- 意見數：' + records.length);
    lines.push('');
    lines.push('以下摘要中的原文引用、提案與理由只列前 ' + SUMMARY_EXCERPT_LENGTH + ' 字；完整內容以 JSON 區塊為準。');
    lines.push('');
    records.forEach(function (record) {
      lines.push('## ' + record.id + '（' + record.kind + '）');
      lines.push('');
      lines.push('- 阻擋：' + (record.blocking ? '是' : '否'));
      if (isString(record.supersedes)) lines.push('- 取代：' + record.supersedes);
      lines.push('');
      lines.push('目標：');
      lines.push(quoteLines(record.targets.map(targetSummaryLine).join('\n')));
      lines.push('');
      lines.push('原文引用：');
      lines.push(quoteLines(summaryExcerpt(record.quote)));
      lines.push('');
      lines.push('提案：');
      lines.push(quoteLines(summaryExcerpt(record.proposal)));
      lines.push('');
      lines.push('理由：');
      lines.push(quoteLines(summaryExcerpt(record.rationale)));
      lines.push('');
    });
    lines.push(FENCE_OPEN);
    lines.push(
      jsonLine({
        schemaVersion: '1.0.0',
        batchId: batchId,
        fingerprint: pageFingerprint,
        exportedAt: exportedAt,
        revisions: records,
      }),
    );
    lines.push(FENCE_CLOSE);
    return lines.join('\n');
  }

  /**
   * 回傳 { ok: true, text, ids } 或 { ok: false, message }。輸出先以 parseSheet
   * 驗證（大小、數量、字串、schema、supersedes）；驗證失敗時呼叫端不可標示任何意見為已匯出。
   */
  function exportSheet(input) {
    var options = isPlainObject(input) ? input : {};
    var requests = Array.isArray(options.requests) ? options.requests : [];
    var text;
    try {
      var records = requests.map(revisionToRecord);
      text = sheetText(options.batchId, options.pageFingerprint, new Date(options.now).toISOString(), records);
    } catch (e) {
      return { ok: false, message: '無法匯出：意見資料不完整' };
    }
    var check = parseSheet(text, { batchId: options.batchId });
    if (!check.ok) return { ok: false, message: '無法匯出：' + check.message };
    if (check.skipped > 0) return { ok: false, message: '無法匯出：有重複的意見 id' };
    return {
      ok: true,
      text: text,
      ids: requests.map(function (request) {
        return request.id;
      }),
    };
  }

  // ---------- quote 的目標文字（H2：排除 .pb-annotation，heading 含其下內容） ----------

  var BLOCK_TAGS = [
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIGURE',
    'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P',
    'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'THEAD', 'TR', 'UL',
  ];

  function tagOf(node) {
    return isString(node.tagName) ? node.tagName.toUpperCase() : '';
  }

  function isAnnotationUi(node) {
    return (
      node.nodeType === 1 &&
      isString(node.className) &&
      (' ' + node.className + ' ').indexOf(' pb-annotation ') !== -1
    );
  }

  function headingLevel(node) {
    if (!node || node.nodeType !== 1) return 0;
    var match = /^H([1-6])$/.exec(tagOf(node));
    return match ? Number(match[1]) : 0;
  }

  function rawNodeText(node) {
    if (node.nodeType === 3) return isString(node.nodeValue) ? node.nodeValue : '';
    if (node.nodeType !== 1 || isAnnotationUi(node)) return '';
    var tag = tagOf(node);
    if (tag === 'BR') return '\n';
    var text = '';
    var children = node.childNodes || [];
    for (var i = 0; i < children.length; i++) text += rawNodeText(children[i]);
    if (tag === 'TD' || tag === 'TH') return text + ' ';
    return BLOCK_TAGS.indexOf(tag) === -1 ? text : '\n' + text + '\n';
  }

  function tidyText(text) {
    return text
      .split('\n')
      .map(function (line) {
        return line.replace(/\s+$/, '');
      })
      .filter(function (line) {
        return line.trim().length > 0;
      })
      .join('\n')
      .trim();
  }

  /**
   * 目標在頁面上顯示的文字：排除所有 .pb-annotation 節點（行內入口、頁面標記）。
   * heading 目標另收其後同一容器內的內容，直到下一個同級或更高級 heading。
   * 只讀 nodeType、nodeValue、tagName、className、childNodes、nextSibling，
   * 因此可用不含 DOM 的簡單物件測試。
   */
  function targetDisplayText(node) {
    if (!node) return '';
    var text = rawNodeText(node);
    var level = headingLevel(node);
    if (level > 0) {
      for (var sibling = node.nextSibling; sibling; sibling = sibling.nextSibling) {
        var siblingLevel = headingLevel(sibling);
        if (siblingLevel > 0 && siblingLevel <= level) break;
        text += '\n' + rawNodeText(sibling);
      }
    }
    return tidyText(text);
  }

  /** §19：quote 依目標順序以 \n---\n 相接並截斷。 */
  function buildQuote(texts) {
    var list = Array.isArray(texts) ? texts : [];
    var joined = list
      .map(function (t) {
        return isString(t) ? t : '';
      })
      .join('\n---\n');
    return truncateText(joined, MAX_TEXT_BYTES);
  }

  /** 還原選檔的大小檢查：超過 1 MiB 時不讀檔（security-LOW-5）。 */
  function sheetFileSizeMessage(size) {
    return typeof size === 'number' && size > MAX_SHEET_BYTES ? '檔案超過大小上限（1 MiB），未讀取' : null;
  }
`;
