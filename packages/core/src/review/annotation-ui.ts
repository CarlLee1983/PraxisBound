/**
 * 審閱層 script 的第四段：DOM 進入點（右側抽屜、行內入口、頁面標記）。
 *
 * 這裡不做任何狀態決策：頁面狀態只經由 annotation-state.ts 的純函式轉換，
 * 本段負責讀寫 DOM、把讀者輸入交給那些函式、再依結果重新呈現。讀者與修訂單
 * 提供的文字一律以 textContent／value 寫入，永不成為標記或屬性。
 * 撰寫規則同 annotation-script.ts：`String.raw`，不含反引號與 `${`。
 */

export const ANNOTATION_UI = String.raw`
  function initAnnotationUi(reviewApi) {
    var body = document.body;
    var page = {
      batchId: body.getAttribute('data-pb-batch-id') || '',
      manifestPath: body.getAttribute('data-pb-manifest-path') || '',
      fingerprint: body.getAttribute('data-pb-fingerprint') || '',
    };
    var storageKey = reviewApi.draftKey(page.batchId, page.fingerprint);

    var state = reviewApi.emptyState();
    var ui = {
      drawerOpen: false,
      selecting: false,
      targets: [],
      form: blankForm(),
      edit: null,
      panel: null,
      batchBlockSha256: null,
      storageMessage: '',
      quarantine: null,
      initMessage: '',
    };
    var annotatable = [];
    var elementsByKey = Object.create(null);
    var originalTabindex = [];
    var drawer = null;
    var toggleButton = null;
    var noticeElement = null;
    var lastFocusedBeforeDrawer = null;

    // 永遠先註冊離頁提示與整批雜湊，之後任何初始化步驟失敗都不影響這兩件事（H4）。
    window.addEventListener('beforeunload', function (e) {
      if (reviewApi.unexportedCount(state) > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
      window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(page.fingerprint)).then(
        function (digest) {
          ui.batchBlockSha256 = reviewApi.bytesToHex(new Uint8Array(digest));
          renderDrawer();
        },
        function () {},
      );
    }

    // ---------- 儲存與提示 ----------

    function safeStorage() {
      try {
        return window.localStorage;
      } catch (e) {
        return undefined;
      }
    }

    function renderNotice() {
      var messages = [];
      if (ui.initMessage) messages.push(ui.initMessage);
      if (ui.storageMessage) messages.push(ui.storageMessage);
      if (ui.quarantine) {
        messages.push(
          '瀏覽器暫存中有 ' + ui.quarantine.length + ' 項無效資料，已隔離且不會匯出；在捨棄前暫停寫入暫存，請記得匯出。',
        );
        ui.quarantine.slice(0, 3).forEach(function (message) {
          messages.push('・' + message);
        });
      }
      if (messages.length === 0) {
        if (noticeElement) noticeElement.hidden = true;
        return;
      }
      if (!noticeElement) {
        noticeElement = makeElement('div', 'pb-annotation pb-annotation-notice');
        noticeElement.setAttribute('role', 'status');
        body.appendChild(noticeElement);
      }
      noticeElement.hidden = false;
      noticeElement.textContent = '';
      messages.forEach(function (message) {
        noticeElement.appendChild(makeElement('p', '', message));
      });
      if (ui.quarantine) noticeElement.appendChild(makeButton('捨棄無效暫存', 'notice-discard', discardQuarantine));
    }

    function persist() {
      if (ui.quarantine) return;
      var result = reviewApi.saveDraft(safeStorage(), storageKey, state);
      ui.storageMessage = result.ok ? '' : '瀏覽器無法暫存，請記得匯出';
      renderNotice();
    }

    function discardQuarantine() {
      ui.quarantine = null;
      persist();
      renderNotice();
    }

    function loadInitial() {
      var read = reviewApi.readDraft(safeStorage(), storageKey);
      if (!read.ok) {
        ui.storageMessage = '瀏覽器無法暫存，請記得匯出';
        return;
      }
      var loaded = reviewApi.loadState(read.raw);
      state = loaded.state;
      if (!loaded.ok) ui.quarantine = loaded.messages;
    }

    /** 狀態的唯一寫入點；任何非匯出的變更都讓已開啟的匯出內容失效。 */
    function commit(next, keepExportPanel) {
      state = next;
      if (!keepExportPanel && ui.panel && ui.panel.type === 'export') closePanel();
      persist();
      renderPageMarkers();
      renderToggle();
      renderDrawer();
    }

    // ---------- 頁面目標 ----------

    function pageLocators() {
      var list = annotatable.map(targetFromElement);
      if (ui.batchBlockSha256) list.push(reviewApi.batchLocator(page.manifestPath, ui.batchBlockSha256));
      return list;
    }

    function keyOf(target) {
      return target.path + '\u0000' + target.anchor + '\u0000' + target.blockSha256;
    }

    function elementForTarget(target) {
      return elementsByKey[keyOf(target)] || null;
    }

    function quoteForTargets(targets) {
      return reviewApi.buildQuote(
        targets.map(function (target) {
          return reviewApi.targetDisplayText(elementForTarget(target));
        }),
      );
    }

    function revealTarget(target) {
      var element = elementForTarget(target);
      if (!element) return;
      for (var details = element.closest('details'); details; details = details.parentElement && details.parentElement.closest('details')) {
        details.open = true;
      }
      if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
      element.scrollIntoView({ block: 'center' });
      element.focus();
    }

    function highlightSelected() {
      annotatable.forEach(function (element) {
        var target = targetFromElement(element);
        var selected = ui.targets.some(function (t) {
          return reviewApi.sameTarget(t, target);
        });
        element.classList.toggle('pb-annotation-target-selected', selected);
        if (ui.selecting) element.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }

    function setTargets(targets) {
      ui.targets = targets;
      highlightSelected();
      renderDrawer();
    }

    function setSelecting(active) {
      ui.selecting = active;
      annotatable.forEach(function (element, index) {
        element.classList.toggle('pb-annotation-selectable', active);
        if (active) {
          element.setAttribute('tabindex', '0');
          element.setAttribute('role', 'button');
        } else {
          if (originalTabindex[index] === null) element.removeAttribute('tabindex');
          else element.setAttribute('tabindex', originalTabindex[index]);
          element.removeAttribute('role');
          element.removeAttribute('aria-pressed');
        }
      });
      highlightSelected();
      renderDrawer();
    }

    function onTargetClick(e) {
      if (!ui.selecting) return;
      if (isInsideAnnotationUi(e.target, e.currentTarget)) return;
      if (closestLocatorElement(e.target) !== e.currentTarget) return;
      e.preventDefault();
      setTargets(reviewApi.toggleTarget(ui.targets, targetFromElement(e.currentTarget)));
    }

    function onTargetKeydown(e) {
      if (!ui.selecting || e.target !== e.currentTarget) return;
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      setTargets(reviewApi.toggleTarget(ui.targets, targetFromElement(e.currentTarget)));
    }

    function setupTargets() {
      annotatable = Array.prototype.slice.call(document.querySelectorAll(LOCATOR_SELECTOR));
      annotatable.forEach(function (element) {
        var key = keyOf(targetFromElement(element));
        if (!elementsByKey[key]) elementsByKey[key] = element;
        originalTabindex.push(element.getAttribute('tabindex'));
        element.addEventListener('click', onTargetClick);
        element.addEventListener('keydown', onTargetKeydown);

        var inline = makeElement('button', 'pb-annotation pb-annotation-inline-add', '＋意見');
        inline.type = 'button';
        inline.setAttribute('aria-label', '對此段落提出意見');
        inline.addEventListener('click', function (e) {
          e.stopPropagation();
          e.preventDefault();
          ui.targets = reviewApi.withTarget(ui.targets, targetFromElement(element));
          highlightSelected();
          setDrawerOpen(true, 'new-kind');
        });
        element.appendChild(inline);
      });
    }

    // ---------- 頁面標記（M6：顯示類型、阻擋、提案與理由） ----------

    function renderPageMarkers() {
      var old = document.querySelectorAll('.pb-annotation-marker');
      for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
      var superseded = reviewApi.supersededIds(state);
      state.requests.forEach(function (request) {
        if (request.pending || superseded.indexOf(request.id) !== -1) return;
        request.targets.forEach(function (target) {
          var element = elementForTarget(target);
          if (!element) return;
          var marker = makeElement('button', 'pb-annotation pb-annotation-marker', markerText(reviewApi, request));
          marker.type = 'button';
          marker.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            setDrawerOpen(true, 'card-' + request.id);
          });
          element.appendChild(marker);
        });
      });
    }

    // ---------- 抽屜與焦點 ----------

    function renderToggle() {
      if (!toggleButton) return;
      var count = reviewApi.unexportedCount(state);
      toggleButton.textContent = count > 0 ? '審閱意見（未匯出 ' + count + '）' : '審閱意見';
      toggleButton.setAttribute('aria-expanded', ui.drawerOpen ? 'true' : 'false');
    }

    function focusables() {
      return Array.prototype.slice.call(drawer.querySelectorAll(FOCUSABLE_SELECTOR)).filter(function (element) {
        return !element.disabled;
      });
    }

    function onDocumentKeydown(e) {
      if (!ui.drawerOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (ui.selecting) setSelecting(false);
        else setDrawerOpen(false);
        return;
      }
      // 選取目標時不困住 Tab，讓讀者可以 Tab 到頁面上的目標（M5）。
      if (e.key !== 'Tab' || ui.selecting || !drawer.contains(document.activeElement)) return;
      var list = focusables();
      if (list.length === 0) return;
      if (e.shiftKey && document.activeElement === list[0]) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === list[list.length - 1]) {
        e.preventDefault();
        list[0].focus();
      }
    }

    function setDrawerOpen(open, focusKey) {
      if (open && !ui.drawerOpen) lastFocusedBeforeDrawer = document.activeElement;
      ui.drawerOpen = open;
      drawer.hidden = !open;
      renderToggle();
      if (open) {
        renderDrawer(focusKey || 'close');
        return;
      }
      if (ui.selecting) setSelecting(false);
      var back = lastFocusedBeforeDrawer;
      if (back && back !== body && typeof back.focus === 'function' && document.contains(back)) back.focus();
      else toggleButton.focus();
    }

    function captureFocus() {
      var active = document.activeElement;
      if (!active || !drawer.contains(active)) return null;
      var saved = { key: active.getAttribute('data-pb-focus') };
      if (typeof active.selectionStart === 'number') {
        saved.start = active.selectionStart;
        saved.end = active.selectionEnd;
      }
      return saved;
    }

    /** 重繪後把焦點放回同一個控制項；找不到時落在抽屜內，永不落到 body（H5）。 */
    function restoreFocus(saved, focusKey) {
      var key = focusKey || (saved && saved.key);
      if (!key) return;
      var target = findByAttribute(drawer, 'data-pb-focus', key) || findByAttribute(drawer, 'data-pb-focus', 'close');
      if (!target) return;
      target.focus();
      if (!focusKey && saved && typeof saved.start === 'number' && typeof target.setSelectionRange === 'function') {
        try {
          target.setSelectionRange(saved.start, saved.end);
        } catch (e) {
          // Not a text control; the focus itself is what matters.
        }
      }
      if (key.indexOf('card-') === 0) target.scrollIntoView({ block: 'center' });
    }

    function renderDrawer(focusKey) {
      if (!drawer || !ui.drawerOpen) return;
      var saved = captureFocus();
      drawer.textContent = '';
      drawer.appendChild(renderHeader());
      if (ui.edit) drawer.appendChild(renderEditSection());
      if (ui.panel) drawer.appendChild(renderPanel());
      drawer.appendChild(renderSelectionSection());
      drawer.appendChild(renderListSection());
      restoreFocus(saved, focusKey);
    }

    function renderHeader() {
      var header = makeElement('div', 'pb-annotation-drawer-header');
      header.appendChild(makeElement('h2', '', '審閱意見'));
      header.appendChild(makeButton('關閉', 'close', function () {
        setDrawerOpen(false);
      }));
      var toolbar = makeElement('div', 'pb-annotation-toolbar');
      var count = reviewApi.unexportedCount(state);
      toolbar.appendChild(makeElement('span', '', count > 0 ? '有 ' + count + ' 則未匯出的意見' : '沒有未匯出的意見'));
      toolbar.appendChild(makeButton('匯出', 'export', openExportPanel));
      toolbar.appendChild(makeButton('還原', 'restore', openRestorePanel));
      header.appendChild(toolbar);
      return header;
    }

    // ---------- 表單（值保存在 ui 狀態，重繪不遺失，H5） ----------

    function submitNewRequest() {
      var targets = ui.targets;
      var result = reviewApi.addDraft(state, {
        kind: ui.form.kind,
        proposal: ui.form.proposal,
        rationale: ui.form.rationale,
        blocking: ui.form.blocking,
        targets: targets,
        quote: quoteForTargets(targets),
        fingerprint: page.fingerprint,
        now: Date.now(),
        random: randomBytesForId(),
      });
      if (!result.ok) {
        ui.form.error = result.message;
        renderDrawer('new-submit');
        return;
      }
      ui.form = blankForm();
      ui.targets = [];
      highlightSelected();
      commit(result.state);
      renderDrawer('card-' + result.request.id);
    }

    function renderSelectionSection() {
      var section = makeElement('section', 'pb-annotation-section');
      section.appendChild(makeElement('h3', '', '目前選取目標'));
      var modeButton = makeButton(ui.selecting ? '結束選取目標' : '選取目標', 'select-mode', function () {
        setSelecting(!ui.selecting);
      });
      modeButton.setAttribute('aria-pressed', ui.selecting ? 'true' : 'false');
      section.appendChild(modeButton);
      var batchButton = makeButton('整批', 'batch', function () {
        if (!ui.batchBlockSha256) return;
        setTargets(reviewApi.withTarget(ui.targets, reviewApi.batchLocator(page.manifestPath, ui.batchBlockSha256)));
      });
      batchButton.disabled = !ui.batchBlockSha256;
      section.appendChild(batchButton);
      if (ui.selecting) {
        section.appendChild(makeElement('p', 'pb-annotation-muted', '在頁面上點選或以 Tab 移到段落後按 Enter／空白鍵加入或移除目標；Esc 結束選取。'));
      }

      var list = makeElement('ul', 'pb-annotation-target-list');
      ui.targets.forEach(function (target, index) {
        var item = document.createElement('li');
        item.appendChild(makeElement('span', '', reviewApi.targetsSummary([target])));
        item.appendChild(makeButton('移除', 'target-remove-' + index, function () {
          var remaining = reviewApi.withoutTargetAt(ui.targets, index);
          var nextKey = remaining.length === 0 ? 'select-mode' : 'target-remove-' + Math.min(index, remaining.length - 1);
          ui.targets = remaining;
          highlightSelected();
          renderDrawer(nextKey);
        }));
        list.appendChild(item);
      });
      section.appendChild(list);

      if (ui.targets.length > 0) {
        section.appendChild(makeElement('h3', '', '新增意見'));
        section.appendChild(buildForm(reviewApi, ui.form, 'new', submitNewRequest));
      }
      return section;
    }

    function openEdit(request) {
      ui.edit = {
        id: request.id,
        exported: request.exported,
        kind: request.kind,
        proposal: request.proposal,
        rationale: request.rationale,
        blocking: request.blocking,
        error: '',
      };
      renderDrawer('edit-kind');
    }

    function submitEdit() {
      var current = null;
      state.requests.forEach(function (request) {
        if (request.id === ui.edit.id) current = request;
      });
      var changes = {
        kind: ui.edit.kind,
        proposal: ui.edit.proposal,
        rationale: ui.edit.rationale,
        blocking: ui.edit.blocking,
      };
      if (current && !current.pending) changes.quote = quoteForTargets(current.targets);
      var result = reviewApi.editRequest(state, ui.edit.id, changes, Date.now(), randomBytesForId());
      if (!result.ok) {
        ui.edit.error = result.message;
        renderDrawer('edit-submit');
        return;
      }
      ui.edit = null;
      commit(result.state);
      renderDrawer('card-' + result.request.id);
    }

    function renderEditSection() {
      var section = makeElement('section', 'pb-annotation-section pb-annotation-edit-container');
      section.appendChild(makeElement('h3', '', ui.edit.exported ? '修改（將建立取代原意見的新版本）' : '修改草稿'));
      section.appendChild(buildForm(reviewApi, ui.edit, 'edit', submitEdit));
      section.appendChild(makeButton('取消', 'edit-cancel', function () {
        var id = ui.edit.id;
        ui.edit = null;
        renderDrawer('card-' + id);
      }));
      return section;
    }

    // ---------- 匯出 / 還原 ----------

    function closePanel() {
      if (ui.panel && ui.panel.url) URL.revokeObjectURL(ui.panel.url);
      ui.panel = null;
    }

    function openExportPanel() {
      closePanel();
      var result = reviewApi.exportSheet({
        batchId: page.batchId,
        pageFingerprint: page.fingerprint,
        requests: state.requests,
        now: Date.now(),
      });
      ui.panel = result.ok
        ? { type: 'export', text: result.text, ids: result.ids, url: null, message: '' }
        : { type: 'export-error', message: result.message + '；草稿未變更，也未標示為已匯出。' };
      renderDrawer(result.ok ? 'export-text' : 'export');
    }

    /** 真正交出修訂單後才標示已匯出（H3）；期間狀態若改變，匯出面板已被關閉。 */
    function handOff(panel, how) {
      if (ui.panel !== panel) return;
      panel.message = how + '，已將 ' + panel.ids.length + ' 則意見標示為已匯出。';
      commit(reviewApi.markExported(state, panel.ids), true);
    }

    function copyFallback(panel) {
      var textarea = findByAttribute(drawer, 'data-pb-focus', 'export-text');
      var copied = false;
      if (textarea) {
        textarea.focus();
        textarea.select();
        try {
          copied = document.execCommand('copy') === true;
        } catch (e) {
          copied = false;
        }
      }
      if (copied) {
        handOff(panel, '已複製');
        return;
      }
      if (ui.panel !== panel) return;
      panel.message = '複製失敗，請手動選取文字框內容；意見未標示為已匯出。';
      renderDrawer('export-copy');
    }

    function copySheet() {
      var panel = ui.panel;
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(panel.text).then(
          function () {
            handOff(panel, '已複製');
          },
          function () {
            copyFallback(panel);
          },
        );
      } else {
        copyFallback(panel);
      }
    }

    function renderExportPanel(container) {
      var panel = ui.panel;
      container.appendChild(makeElement('h3', '', '匯出的修訂單'));
      var textarea = makeElement('textarea', 'pb-annotation-export-text');
      textarea.readOnly = true;
      textarea.value = panel.text;
      textarea.setAttribute('data-pb-focus', 'export-text');
      textarea.setAttribute('aria-label', '修訂單全文');
      container.appendChild(textarea);
      if (!panel.url) panel.url = URL.createObjectURL(new Blob([panel.text], { type: 'text/markdown' }));
      var link = makeElement('a', '', '下載');
      link.href = panel.url;
      link.setAttribute('download', page.batchId + '-revisions.md');
      link.setAttribute('data-pb-focus', 'export-download');
      link.addEventListener('click', function () {
        handOff(panel, '已下載');
      });
      container.appendChild(link);
      container.appendChild(makeButton('複製', 'export-copy', copySheet));
      var status = makeElement('p', '', panel.message);
      status.setAttribute('role', 'status');
      container.appendChild(status);
    }

    function openRestorePanel() {
      closePanel();
      ui.panel = { type: 'restore', text: '', message: '' };
      renderDrawer('restore-text');
    }

    function applyRestore() {
      var panel = ui.panel;
      var box = findByAttribute(drawer, 'data-pb-focus', 'restore-text');
      if (box) panel.text = box.value;
      var parsed = reviewApi.parseSheet(panel.text, { batchId: page.batchId });
      if (!parsed.ok) {
        panel.message = '還原失敗：' + parsed.message + '；草稿未變更。';
        renderDrawer('restore-apply');
        return;
      }
      var result = reviewApi.restore(state, parsed.sheet, page.fingerprint, pageLocators());
      if (!result.ok) {
        panel.message = result.message + '；草稿未變更。';
        renderDrawer('restore-apply');
        return;
      }
      panel.message =
        '新增 ' + result.added + ' 則、待比對 ' + result.pending + ' 則、略過重複 ' + (result.skipped + parsed.skipped) + ' 則。';
      commit(result.state);
      renderDrawer('restore-apply');
    }

    function readChosenFile(input) {
      var panel = ui.panel;
      var file = input.files && input.files[0];
      if (!file) return;
      var sizeMessage = reviewApi.sheetFileSizeMessage(file.size);
      if (sizeMessage) {
        panel.message = sizeMessage;
        renderDrawer('restore-file');
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        panel.text = String(reader.result || '');
        panel.message = '已讀取檔案，請按「套用」。';
        renderDrawer('restore-apply');
      };
      reader.onerror = function () {
        panel.message = '無法讀取檔案；草稿未變更。';
        renderDrawer('restore-file');
      };
      reader.readAsText(file);
    }

    function renderRestorePanel(container) {
      var panel = ui.panel;
      container.appendChild(makeElement('h3', '', '還原修訂單'));
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.md,.txt';
      fileInput.setAttribute('data-pb-focus', 'restore-file');
      fileInput.setAttribute('aria-label', '選擇修訂單檔案');
      fileInput.addEventListener('change', function () {
        readChosenFile(fileInput);
      });
      container.appendChild(fileInput);
      var textarea = makeElement('textarea', 'pb-annotation-restore-text');
      textarea.placeholder = '貼上修訂單文字';
      textarea.setAttribute('aria-label', '貼上修訂單文字');
      textarea.setAttribute('data-pb-focus', 'restore-text');
      textarea.value = panel.text;
      textarea.addEventListener('input', function () {
        panel.text = textarea.value;
      });
      container.appendChild(textarea);
      var status = makeElement('p', '', panel.message);
      status.setAttribute('role', 'status');
      container.appendChild(status);
      container.appendChild(makeButton('套用', 'restore-apply', applyRestore));
    }

    function renderPanel() {
      var container = makeElement('div', 'pb-annotation-action-panel');
      if (ui.panel.type === 'export') renderExportPanel(container);
      else if (ui.panel.type === 'restore') renderRestorePanel(container);
      else container.appendChild(makeElement('p', 'pb-annotation-error', ui.panel.message));
      return container;
    }

    // ---------- 意見清單（M6：卡片顯示意見本身） ----------

    function renderCard(request) {
      var card = makeElement('div', 'pb-annotation-card');
      card.setAttribute('tabindex', '-1');
      card.setAttribute('data-pb-focus', 'card-' + request.id);
      var head = makeElement('div', 'pb-annotation-card-head');
      reviewApi.requestBadges(state, request).forEach(function (badge) {
        var className = badge === '阻擋' ? 'pb-annotation-badge pb-annotation-badge-blocking' : 'pb-annotation-badge';
        head.appendChild(makeElement('span', className, badge));
      });
      card.appendChild(head);
      card.appendChild(makeElement('p', 'pb-annotation-targets', reviewApi.targetsSummary(request.targets)));
      card.appendChild(makeElement('p', 'pb-annotation-excerpt', '原文：' + reviewApi.buildExcerpt(request.quote)));
      if (request.proposal) card.appendChild(makeElement('p', 'pb-annotation-request-text', '提案：' + request.proposal));
      card.appendChild(makeElement('p', 'pb-annotation-request-text', '理由：' + request.rationale));
      if (request.supersedes) card.appendChild(makeElement('p', 'pb-annotation-muted', '取代 ' + request.supersedes));

      var actions = makeElement('div', 'pb-annotation-card-actions');
      if (!request.pending) {
        actions.appendChild(makeButton('跳回原文', 'card-' + request.id + '-reveal', function () {
          request.targets.forEach(revealTarget);
        }));
      }
      if (reviewApi.canEdit(state, request.id)) {
        actions.appendChild(makeButton('修改', 'card-' + request.id + '-edit', function () {
          openEdit(request);
        }));
      }
      card.appendChild(actions);
      return card;
    }

    function renderListSection() {
      var section = makeElement('section', 'pb-annotation-section');
      section.appendChild(makeElement('h3', '', '所有意見（' + state.requests.length + '）'));
      var groups = reviewApi.groupPendingRequests(state);
      if (state.requests.length === 0) section.appendChild(makeElement('p', 'pb-annotation-muted', '目前沒有任何意見。'));
      var attachedList = document.createElement('div');
      groups.attached.forEach(function (request) {
        attachedList.appendChild(renderCard(request));
      });
      section.appendChild(attachedList);
      if (groups.pending.length > 0) {
        section.appendChild(makeElement('h4', '', '待比對'));
        var pendingList = document.createElement('div');
        groups.pending.forEach(function (request) {
          pendingList.appendChild(renderCard(request));
        });
        section.appendChild(pendingList);
      }
      return section;
    }

    function setupDrawer() {
      toggleButton = makeElement('button', 'pb-annotation pb-annotation-toggle', '審閱意見');
      toggleButton.type = 'button';
      toggleButton.addEventListener('click', function () {
        setDrawerOpen(!ui.drawerOpen);
      });
      drawer = makeElement('div', 'pb-annotation pb-annotation-drawer');
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-label', '審閱意見面板');
      drawer.hidden = true;
      body.appendChild(toggleButton);
      body.appendChild(drawer);
      document.addEventListener('keydown', onDocumentKeydown, true);
      window.addEventListener('pagehide', closePanel);
      renderToggle();
    }

    // ---------- 初始化：每一步獨立，失敗只記錄提示，不中斷其餘步驟 ----------

    function step(label, run) {
      try {
        run();
      } catch (e) {
        ui.initMessage = '審閱層部分功能無法啟動（' + label + '），請記得匯出。';
      }
    }

    step('暫存', loadInitial);
    step('頁面目標', setupTargets);
    step('抽屜', setupDrawer);
    step('頁面標記', renderPageMarkers);
    step('提示', renderNotice);
  }
`;
