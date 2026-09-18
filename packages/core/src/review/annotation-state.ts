/**
 * 審閱層 script 的第二段：Revision Request 建立與頁面狀態轉換（contract §19）。
 *
 * 頁面狀態是不可變的 `{ requests: [...] }`；每則意見是 schema 欄位加上兩個
 * 頁面旗標 `exported`、`pending`。每個轉換函式都回傳新狀態，永不就地修改
 * 意見物件或狀態；annotation-ui.ts 只負責呈現狀態與呼叫這些函式。
 * 撰寫規則同 annotation-script.ts：`String.raw`，不含反引號與 `${`。
 */

export const ANNOTATION_STATE = String.raw`
  var STATE_FLAG_KEYS = ['exported', 'pending'];

  // ---------- createRequest（§6/§19） ----------

  function draftFieldsMessage(fields) {
    if (REVISION_KINDS.indexOf(fields.kind) === -1)
      return 'kind 必須是 supplement、rewrite、add-requirement 或 delete 之一';
    if (!isString(fields.rationale) || fields.rationale.trim().length === 0)
      return 'rationale（理由）為必填';
    if (fields.kind !== 'delete' && (!isString(fields.proposal) || fields.proposal.trim().length === 0))
      return 'proposal（提案）為必填，除非 kind 為 delete';
    if (utf8Length(fields.rationale) > MAX_TEXT_BYTES) return 'rationale 超過字串上限（64 KiB，UTF-8）';
    if (isString(fields.proposal) && utf8Length(fields.proposal) > MAX_TEXT_BYTES)
      return 'proposal 超過字串上限（64 KiB，UTF-8）';
    return null;
  }

  function createRequest(input) {
    var options = isPlainObject(input) ? input : {};
    var fields = {
      kind: options.kind,
      proposal: normalizeNewlines(isString(options.proposal) ? options.proposal : ''),
      rationale: normalizeNewlines(options.rationale),
    };
    var fieldsMessage = draftFieldsMessage(fields);
    if (fieldsMessage) return { ok: false, message: fieldsMessage };
    if (typeof options.now !== 'number' || !isFinite(options.now) || options.now < 0)
      return { ok: false, message: 'now 必須是毫秒時間戳' };
    if (!options.random || typeof options.random.length !== 'number' || options.random.length < 10)
      return { ok: false, message: 'random 必須提供至少 10 個位元組的亂數來源' };
    var targets = Array.isArray(options.targets) ? options.targets : [];
    var request = {
      id: 'REV-' + ulid(options.now, options.random),
      fingerprint: options.fingerprint,
      targets: targets.map(function (target) {
        return isPlainObject(target) ? copyLocator(target) : target;
      }),
      quote: truncateText(normalizeNewlines(isString(options.quote) ? options.quote : ''), MAX_TEXT_BYTES),
      kind: fields.kind,
      blocking: options.blocking === undefined ? true : !!options.blocking,
      proposal: fields.proposal,
      rationale: fields.rationale,
      createdAt: new Date(options.now).toISOString(),
    };
    if (isString(options.supersedes)) request.supersedes = options.supersedes;
    var message = validateRevision(request);
    if (message) return { ok: false, message: message };
    return { ok: true, request: request };
  }

  // ---------- 狀態的讀取輔助 ----------

  function emptyState() {
    return { requests: [] };
  }

  function stateRequests(state) {
    return isPlainObject(state) && Array.isArray(state.requests) ? state.requests : [];
  }

  function findRequest(state, id) {
    var list = stateRequests(state);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function withFlags(record, exported, pending) {
    var entry = revisionToRecord(record);
    entry.exported = exported;
    entry.pending = pending;
    return entry;
  }

  function replaceRequest(state, id, next) {
    return {
      requests: stateRequests(state).map(function (request) {
        return request.id === id ? next : request;
      }),
    };
  }

  function supersededIds(state) {
    var ids = [];
    stateRequests(state).forEach(function (request) {
      if (isString(request.supersedes) && ids.indexOf(request.supersedes) === -1) ids.push(request.supersedes);
    });
    return ids;
  }

  /** 存在且未被取代的意見才可修改（H1：已取代者只顯示「已取代」）。 */
  function canEdit(state, id) {
    return findRequest(state, id) !== null && supersededIds(state).indexOf(id) === -1;
  }

  function unexportedCount(state) {
    return stateRequests(state).filter(function (request) {
      return !request.exported;
    }).length;
  }

  /** 依 pending 旗標分組，供抽屜的「所有意見／待比對」兩區使用。 */
  function groupPendingRequests(state) {
    var attached = [];
    var pending = [];
    stateRequests(state).forEach(function (request) {
      if (request.pending) pending.push(request);
      else attached.push(request);
    });
    return { attached: attached, pending: pending };
  }

  /** 卡片與頁面標記的狀態標籤：類型、阻擋與否、已取代、待比對、匯出狀態。 */
  function requestBadges(state, request) {
    var badges = [kindLabel(request.kind), request.blocking ? '阻擋' : '非阻擋'];
    if (supersededIds(state).indexOf(request.id) !== -1) badges.push('已取代');
    if (request.pending) badges.push('待比對');
    badges.push(request.exported ? '已匯出' : '未匯出');
    return badges;
  }

  // ---------- 驗證暫存（H4：與 parseSheet 相同的驗證，無效者隔離） ----------

  function validateStateEntry(entry) {
    var message = validateRevision(entry, STATE_FLAG_KEYS);
    if (message) return message;
    if (typeof entry.exported !== 'boolean') return 'exported 必須是布林值';
    if (typeof entry.pending !== 'boolean') return 'pending 必須是布林值';
    return null;
  }

  function quarantineAll(message) {
    return { ok: false, state: emptyState(), messages: [message] };
  }

  /**
   * 驗證瀏覽器暫存的原始文字。回傳 { ok, state, messages }：state 只含合法意見；
   * ok 為 false 時呼叫端必須保留原始暫存不覆寫，直到讀者明確捨棄。
   */
  function loadState(raw) {
    if (raw === null || raw === undefined) return { ok: true, state: emptyState(), messages: [] };
    if (!isString(raw)) return quarantineAll('暫存資料不是文字');
    if (rawJsonMaxDepth(raw) > MAX_NESTING_DEPTH) return quarantineAll('暫存資料巢狀過深');
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return quarantineAll('暫存資料不是合法的 JSON');
    }
    if (!isPlainObject(data) || !Array.isArray(data.requests) || unknownKey(data, ['requests']) !== null)
      return quarantineAll('暫存資料的格式不符');

    var messages = [];
    var seen = Object.create(null);
    var valid = [];
    data.requests.forEach(function (entry, index) {
      var message = validateStateEntry(entry);
      if (!message && seen[entry.id]) message = 'id 重複：' + entry.id;
      if (message) {
        messages.push('第 ' + (index + 1) + ' 則：' + message);
        return;
      }
      seen[entry.id] = true;
      valid.push(withFlags(entry, entry.exported, entry.pending));
    });
    var conflicts = supersedesConflicts(valid);
    var rejected = conflicts.map(function (conflict) {
      messages.push(conflict.message);
      return conflict.id;
    });
    var kept = valid.filter(function (entry) {
      return rejected.indexOf(entry.id) === -1;
    });
    return { ok: messages.length === 0, state: { requests: kept }, messages: messages };
  }

  // ---------- 狀態轉換 ----------

  function addDraft(state, input) {
    var result = createRequest(input);
    if (!result.ok) return result;
    if (findRequest(state, result.request.id)) return { ok: false, message: '產生的 id 重複，請再試一次' };
    var entry = withFlags(result.request, false, false);
    return { ok: true, state: { requests: stateRequests(state).concat([entry]) }, request: entry };
  }

  function pick(changes, key, fallback) {
    return isPlainObject(changes) && changes[key] !== undefined ? changes[key] : fallback;
  }

  /**
   * 修改未匯出的草稿：保留 id、createdAt、fingerprint、supersedes。待比對的意見
   * 保留原本的 targets 與 quote（其目標不在頁面上，不可從頁面重算，M4）。
   */
  function editDraft(state, id, changes) {
    var current = findRequest(state, id);
    if (!current) return { ok: false, message: '找不到這則意見' };
    if (current.exported) return { ok: false, message: '已匯出的意見唯讀，修改會建立新版本' };
    var next = withFlags(current, false, current.pending);
    next.kind = pick(changes, 'kind', current.kind);
    next.proposal = normalizeNewlines(pick(changes, 'proposal', current.proposal));
    next.rationale = normalizeNewlines(pick(changes, 'rationale', current.rationale));
    next.blocking = !!pick(changes, 'blocking', current.blocking);
    if (!current.pending) {
      var targets = pick(changes, 'targets', current.targets);
      next.targets = Array.isArray(targets) ? targets.map(copyLocator) : targets;
      next.quote = truncateText(normalizeNewlines(pick(changes, 'quote', current.quote)), MAX_TEXT_BYTES);
    }
    var message = draftFieldsMessage(next) || validateStateEntry(next);
    if (message) return { ok: false, message: message };
    return { ok: true, state: replaceRequest(state, id, next), request: next };
  }

  /** 修改已匯出的意見：建立新 id 並以 supersedes 指向原 id；原意見不變（R7）。 */
  function editExported(state, id, changes, now, random) {
    var current = findRequest(state, id);
    if (!current) return { ok: false, message: '找不到這則意見' };
    if (!current.exported) return { ok: false, message: '這則意見尚未匯出，請直接修改草稿' };
    if (!canEdit(state, id)) return { ok: false, message: '這則意見已被取代，請修改最新版本' };
    var result = createRequest({
      kind: pick(changes, 'kind', current.kind),
      proposal: pick(changes, 'proposal', current.proposal),
      rationale: pick(changes, 'rationale', current.rationale),
      blocking: pick(changes, 'blocking', current.blocking),
      targets: current.pending ? current.targets : pick(changes, 'targets', current.targets),
      quote: current.pending ? current.quote : pick(changes, 'quote', current.quote),
      fingerprint: current.fingerprint,
      now: now,
      random: random,
      supersedes: current.id,
    });
    if (!result.ok) return result;
    if (findRequest(state, result.request.id)) return { ok: false, message: '產生的 id 重複，請再試一次' };
    var entry = withFlags(result.request, false, current.pending);
    return { ok: true, state: { requests: stateRequests(state).concat([entry]) }, request: entry };
  }

  /** 表單的單一入口：已取代者拒絕，已匯出者建立新版本，草稿就地修改。 */
  function editRequest(state, id, changes, now, random) {
    var current = findRequest(state, id);
    if (!current) return { ok: false, message: '找不到這則意見' };
    if (!canEdit(state, id)) return { ok: false, message: '這則意見已被取代，請修改最新版本' };
    return current.exported ? editExported(state, id, changes, now, random) : editDraft(state, id, changes);
  }

  /** 只在真正交出修訂單（下載或複製成功）後呼叫。 */
  function markExported(state, ids) {
    var list = Array.isArray(ids) ? ids : [];
    return {
      requests: stateRequests(state).map(function (request) {
        if (request.exported || list.indexOf(request.id) === -1) return request;
        return withFlags(request, true, request.pending);
      }),
    };
  }

  // ---------- restore（§19：去重、衝突、掛回原位或待比對） ----------

  function locatorKey(locator) {
    return locator.path + '\u0000' + locator.anchor + '\u0000' + locator.blockSha256;
  }

  function targetsAttach(targets, pageLocators) {
    var known = Object.create(null);
    (pageLocators || []).forEach(function (locator) {
      known[locatorKey(locator)] = true;
    });
    return targets.every(function (target) {
      return known[locatorKey(target)] === true;
    });
  }

  function rejectRestore(state, message, conflictIds) {
    return { ok: false, state: state, message: message, conflictIds: conflictIds, added: 0, skipped: 0, pending: 0 };
  }

  function restore(state, sheet, pageFingerprint, pageLocators) {
    var existing = stateRequests(state);
    var revisions = isPlainObject(sheet) && Array.isArray(sheet.revisions) ? sheet.revisions : [];
    var conflictIds = [];
    var fresh = [];
    var skipped = 0;
    revisions.forEach(function (revision) {
      var found = findRequest(state, revision.id);
      if (!found) fresh.push(revision);
      else if (sameRevisionContent(found, revision)) skipped++;
      else conflictIds.push(revision.id);
    });
    if (conflictIds.length > 0)
      return rejectRestore(state, '還原失敗，以下 id 內容衝突：' + conflictIds.join('、'), conflictIds);

    var added = 0;
    var pending = 0;
    var entries = fresh.map(function (revision) {
      var attached = revision.fingerprint === pageFingerprint && targetsAttach(revision.targets, pageLocators);
      if (attached) added++;
      else pending++;
      return withFlags(normalizedRevision(revision), true, !attached);
    });
    var merged = existing.concat(entries);
    var chain = supersedesConflicts(merged);
    if (chain.length > 0) {
      return rejectRestore(
        state,
        '還原失敗：' + chain[0].message,
        chain.map(function (conflict) {
          return conflict.id;
        }),
      );
    }
    return { ok: true, state: { requests: merged }, added: added, skipped: skipped, pending: pending, conflictIds: [] };
  }

  // ---------- 目標暫選清單（表單用，皆回傳新陣列） ----------

  function sameTarget(a, b) {
    return a.path === b.path && a.anchor === b.anchor && a.blockSha256 === b.blockSha256;
  }

  function withTarget(targets, target) {
    var has = targets.some(function (t) {
      return sameTarget(t, target);
    });
    return has ? targets : targets.concat([copyLocator(target)]);
  }

  function toggleTarget(targets, target) {
    var rest = targets.filter(function (t) {
      return !sameTarget(t, target);
    });
    return rest.length === targets.length ? targets.concat([copyLocator(target)]) : rest;
  }

  function withoutTargetAt(targets, index) {
    return targets.filter(function (t, i) {
      return i !== index;
    });
  }

  // ---------- 儲存輔助（§19：輔助暫存，失敗永不清空或標示已保存） ----------

  function draftKey(batchId, pageFingerprint) {
    return 'pb-review:' + batchId + ':' + pageFingerprint;
  }

  function saveDraft(storage, key, state) {
    if (!storage || typeof storage.setItem !== 'function') return { ok: false, reason: 'unavailable' };
    try {
      storage.setItem(key, JSON.stringify({ requests: stateRequests(state) }));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'error' };
    }
  }

  /** 讀出原始文字（不解析）；解析與驗證交給 loadState。 */
  function readDraft(storage, key) {
    if (!storage || typeof storage.getItem !== 'function') return { ok: false, reason: 'unavailable' };
    try {
      return { ok: true, raw: storage.getItem(key) };
    } catch (e) {
      return { ok: false, reason: 'error' };
    }
  }

  // ---------- 顯示用純函式 ----------

  /** 目標清單的可讀摘要，path#anchor 依序以「、」相接。 */
  function targetsSummary(targets) {
    var list = Array.isArray(targets) ? targets : [];
    return list.map(targetSummaryLine).join('、');
  }

  /** 顯示用摘要（非 §13 的儲存截斷）：壓成單行、超過長度以「…」收尾。 */
  function buildExcerpt(text, maxLength) {
    var limit = typeof maxLength === 'number' ? maxLength : 80;
    var singleLine = (isString(text) ? text : '').replace(/\s+/g, ' ').trim();
    return singleLine.length <= limit ? singleLine : singleLine.slice(0, limit) + '…';
  }

  /** #batch locator 形狀（§5 規則 3）：呼叫端提供已算好的頁面指紋雜湊。 */
  function batchLocator(manifestPath, blockSha256) {
    return { path: manifestPath, anchor: '#batch', blockSha256: blockSha256 };
  }

  /** bytes 轉十六進位字串，供 crypto.subtle.digest 的結果轉成 blockSha256。 */
  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var part = bytes[i].toString(16);
      hex += part.length < 2 ? '0' + part : part;
    }
    return hex;
  }

  var api = {
    createRequest: createRequest,
    buildQuote: buildQuote,
    targetDisplayText: targetDisplayText,
    exportSheet: exportSheet,
    parseSheet: parseSheet,
    sameRevisionContent: sameRevisionContent,
    revisionContentKey: revisionContentKey,
    sheetFileSizeMessage: sheetFileSizeMessage,
    emptyState: emptyState,
    loadState: loadState,
    addDraft: addDraft,
    editDraft: editDraft,
    editExported: editExported,
    editRequest: editRequest,
    markExported: markExported,
    restore: restore,
    supersededIds: supersededIds,
    canEdit: canEdit,
    unexportedCount: unexportedCount,
    groupPendingRequests: groupPendingRequests,
    requestBadges: requestBadges,
    withTarget: withTarget,
    toggleTarget: toggleTarget,
    withoutTargetAt: withoutTargetAt,
    sameTarget: sameTarget,
    draftKey: draftKey,
    saveDraft: saveDraft,
    readDraft: readDraft,
    kindLabel: kindLabel,
    kinds: REVISION_KINDS.slice(),
    targetsSummary: targetsSummary,
    buildExcerpt: buildExcerpt,
    batchLocator: batchLocator,
    bytesToHex: bytesToHex,
  };
`;
