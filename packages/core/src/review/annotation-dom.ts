/**
 * 審閱層 script 的第三段：不持有狀態的 DOM 輔助函式與意見表單的建構。
 *
 * 與其他三段接成同一個 IIFE 的函式本體（見 annotation-script.ts）；讀者與
 * 修訂單提供的文字一律以 textContent／value 寫入。撰寫規則同
 * annotation-script.ts：`String.raw`，不含反引號與 `${`。
 */

export const ANNOTATION_DOM = String.raw`
  var LOCATOR_SELECTOR = '[data-path][data-anchor][data-block-sha256]';
  var FOCUSABLE_SELECTOR = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

  function makeElement(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function makeButton(label, focusKey, onClick) {
    var button = makeElement('button', '', label);
    button.type = 'button';
    button.setAttribute('data-pb-focus', focusKey);
    button.addEventListener('click', onClick);
    return button;
  }

  /** 以屬性值比對找元素，不把任何 id 或讀者文字拼進 CSS selector。 */
  function findByAttribute(root, name, value) {
    var candidates = root.querySelectorAll('[' + name + ']');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].getAttribute(name) === value) return candidates[i];
    }
    return null;
  }

  function hasLocator(node) {
    return (
      node.nodeType === 1 &&
      node.hasAttribute('data-path') &&
      node.hasAttribute('data-anchor') &&
      node.hasAttribute('data-block-sha256')
    );
  }

  function closestLocatorElement(node) {
    for (var current = node; current && current.nodeType === 1; current = current.parentElement) {
      if (hasLocator(current)) return current;
    }
    return null;
  }

  function isInsideAnnotationUi(node, stopAt) {
    for (var current = node; current && current !== stopAt; current = current.parentElement) {
      if (isAnnotationUi(current)) return true;
    }
    return false;
  }

  function targetFromElement(element) {
    return {
      path: element.getAttribute('data-path'),
      anchor: element.getAttribute('data-anchor'),
      blockSha256: element.getAttribute('data-block-sha256'),
    };
  }

  function randomBytesForId() {
    var bytes = new Uint8Array(10);
    window.crypto.getRandomValues(bytes);
    return bytes;
  }

  function blankForm() {
    return { kind: 'supplement', proposal: '', rationale: '', blocking: true, error: '' };
  }

  function markerText(reviewApi, request) {
    var text = reviewApi.kindLabel(request.kind) + (request.blocking ? '・阻擋' : '・非阻擋') + '：';
    if (request.proposal) text += reviewApi.buildExcerpt(request.proposal, 40) + '／';
    return text + '理由：' + reviewApi.buildExcerpt(request.rationale, 40);
  }

  /** 意見表單；值存放在呼叫端的 values 物件，重繪時不遺失（H5）。 */
  function buildForm(reviewApi, values, prefix, onSubmit) {
    var form = makeElement('form', 'pb-annotation pb-annotation-form');

    var kindLabel = makeElement('label', '', '類型');
    var kindSelect = document.createElement('select');
    kindSelect.setAttribute('data-pb-focus', prefix + '-kind');
    reviewApi.kinds.forEach(function (kind) {
      var option = makeElement('option', '', reviewApi.kindLabel(kind));
      option.value = kind;
      kindSelect.appendChild(option);
    });
    kindSelect.value = values.kind;
    kindSelect.addEventListener('change', function () {
      values.kind = kindSelect.value;
    });
    kindLabel.appendChild(kindSelect);
    form.appendChild(kindLabel);

    [['proposal', '提案'], ['rationale', '理由']].forEach(function (pair) {
      var label = makeElement('label', '', pair[1]);
      var input = document.createElement('textarea');
      input.setAttribute('data-pb-focus', prefix + '-' + pair[0]);
      input.value = values[pair[0]];
      input.addEventListener('input', function () {
        values[pair[0]] = input.value;
      });
      label.appendChild(input);
      form.appendChild(label);
    });

    var blockingLabel = document.createElement('label');
    var blockingInput = document.createElement('input');
    blockingInput.type = 'checkbox';
    blockingInput.setAttribute('data-pb-focus', prefix + '-blocking');
    blockingInput.checked = values.blocking;
    blockingInput.addEventListener('change', function () {
      values.blocking = blockingInput.checked;
    });
    blockingLabel.appendChild(blockingInput);
    blockingLabel.appendChild(document.createTextNode(' 阻擋'));
    form.appendChild(blockingLabel);

    var error = makeElement('p', 'pb-annotation-error', values.error);
    error.setAttribute('role', 'alert');
    form.appendChild(error);

    var submit = makeElement('button', '', '儲存');
    submit.type = 'submit';
    submit.setAttribute('data-pb-focus', prefix + '-submit');
    form.appendChild(submit);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      // 以送出當下控制項的實際值為準（程式化填入不一定觸發 input 事件）。
      values.kind = kindSelect.value;
      values.proposal = form.querySelectorAll('textarea')[0].value;
      values.rationale = form.querySelectorAll('textarea')[1].value;
      values.blocking = blockingInput.checked;
      onSubmit();
    });
    return form;
  }
`;
