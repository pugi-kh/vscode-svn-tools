'use strict';
// 상태 색 편집 화면(웹뷰). 설정 화면에는 색 고르기 입력이 없어서 직접 만든다.
// 고른 색은 사용자 설정 workbench.colorCustomizations에 svnTools.* 키로 쓴다(manifest.js COLORS의 색상 ID).
// 기본값은 값을 지우는 것이다 — 기본은 git 색 ID를 가리켜서 테마를 바꾸면 따라 바뀐다.
const vscode = require('vscode');
const crypto = require('crypto');
const { t } = require('./i18n');

// [색상 ID, 문구 키, 미리보기 배지] — 배지는 decorations.js STYLE과 같다
const ROWS = [
  ['modifiedForeground', 'colorModified', 'M'],
  ['addedForeground', 'colorAdded', 'A'],
  ['deletedForeground', 'colorDeleted', 'D'],
  ['conflictedForeground', 'colorConflicted', 'C'],
  ['unversionedForeground', 'colorUnversioned', 'U'],
  ['ignoredForeground', 'colorIgnored', ''],
];
const STRING_KEYS = ['colorsDefault', 'colorsResetAll', 'colorsIsDefault', 'colorsIsCustom', 'colorsOverridden', 'colorsOpenJson', 'colorsHelp'];
const SETTING = 'colorCustomizations';

let current;

class ColorView {
  static show() {
    if (current) {
      current.panel.reveal();
      return;
    }
    current = new ColorView();
  }

  constructor() {
    this.panel = vscode.window.createWebviewPanel('svnTools.colors', t('colorsTitle'),
      vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
    this.panel.webview.html = html();
    this.panel.webview.onDidReceiveMessage((m) => this.handle(m));
    const watch = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`workbench.${SETTING}`)) this.render();
    });
    this.panel.onDidDispose(() => {
      watch.dispose();
      current = undefined;
    });
  }

  inspect() {
    return vscode.workspace.getConfiguration('workbench').inspect(SETTING) || {};
  }

  render() {
    const { globalValue = {}, workspaceValue = {} } = this.inspect();
    // 작업 공간 값과 테마별 묶음("[테마 이름]": {...})은 사용자 값보다 우선해서, 여기서 바꿔도 안 보일 수 있다
    const themed = (obj, id) => Object.entries(obj).some(([k, v]) => k.startsWith('[') && v && typeof v === 'object' && id in v);
    const rows = ROWS.map(([name, label, badge]) => {
      const id = `svnTools.${name}`;
      return {
        id, badge, label: t(label),
        custom: typeof globalValue[id] === 'string' ? globalValue[id] : '',
        overridden: id in workspaceValue || themed(globalValue, id) || themed(workspaceValue, id),
      };
    });
    this.panel.webview.postMessage({
      type: 'state',
      state: { title: t('colorsTitle'), rows, strings: Object.fromEntries(STRING_KEYS.map((k) => [k, t(k)])) },
    });
  }

  async write(change) {
    const next = { ...(this.inspect().globalValue || {}) };
    change(next);
    await vscode.workspace.getConfiguration('workbench')
      .update(SETTING, Object.keys(next).length ? next : undefined, vscode.ConfigurationTarget.Global);
  }

  async handle(m) {
    try {
      if (m.op === 'set') await this.write((o) => { o[m.id] = m.value; });
      if (m.op === 'reset') await this.write((o) => { delete o[m.id]; });
      if (m.op === 'resetAll') await this.write((o) => { for (const [name] of ROWS) delete o[`svnTools.${name}`]; });
      if (m.op === 'json') await vscode.commands.executeCommand('workbench.action.openSettingsJson');
    } catch (e) {
      vscode.window.showErrorMessage(e.message);
    }
    if (m.op === 'refresh') this.render();
  }
}

function html() {
  const nonce = crypto.randomBytes(16).toString('hex');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 20px 40px; max-width: 900px; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .bar h1 { font-size: 1.3em; margin: 0 auto 0 0; }
  .note { color: var(--vscode-descriptionForeground); margin: 10px 0 14px; }
  .row { display: grid; grid-template-columns: 10em minmax(12em, 1fr) auto; align-items: center; gap: 12px;
         padding: 8px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 8px 0; }
  .label { font-weight: 600; }
  .label small { display: block; font-weight: normal; color: var(--vscode-descriptionForeground); }
  /* 탐색기 한 줄처럼 보이게: 사이드바 배경, 이름은 왼쪽, 배지는 오른쪽 */
  .preview { display: flex; justify-content: space-between; padding: 3px 10px; background: var(--vscode-sideBar-background);
             font-family: var(--vscode-font-family); }
  .controls { display: flex; align-items: center; gap: 6px; }
  .controls code { font-family: var(--vscode-editor-font-family); min-width: 5.5em; }
  input[type=color] { width: 36px; height: 24px; padding: 0; border: 1px solid var(--vscode-panel-border); background: none; cursor: pointer; }
  .warn { grid-column: 1 / -1; color: var(--vscode-editorWarning-foreground); }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 10px; cursor: pointer; font: inherit; }
  button:disabled { opacity: 0.5; cursor: default; }
  button:hover:not(:disabled) { filter: brightness(1.15); }
  #probe { display: none; }
</style></head>
<body>
<div id="root"></div>
<div id="probe"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const send = (m) => vscode.postMessage(m);
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false && kid !== '') e.append(kid.nodeType ? kid : String(kid));
  return e;
}
// 지금 실제로 적용된 색(테마 변수)을 #rrggbb로. 색 고르기 입력은 이 형식만 받는다(투명도는 버린다).
function hexOf(css) {
  const probe = document.getElementById('probe');
  probe.style.color = '';
  probe.style.color = css;
  const n = (getComputedStyle(probe).color.match(/[\\d.]+/g) || []).slice(0, 3);
  if (n.length < 3) return '#000000';
  return '#' + n.map((x) => Math.round(+x).toString(16).padStart(2, '0')).join('');
}
const cssVar = (id) => 'var(--vscode-' + id.replace(/\\./g, '-') + ')';
let S;
function render() {
  if (!S) return;
  const L = S.strings;
  const anyCustom = S.rows.some((r) => r.custom);
  // replaceChildren도 append처럼 null을 글자 "null"로 붙인다 — 조건부 자리는 걸러서 넘긴다.
  document.getElementById('root').replaceChildren(...[
    el('div', { class: 'bar' }, el('h1', {}, S.title),
      el('button', { on: { click: () => send({ op: 'json' }) } }, L.colorsOpenJson),
      el('button', { ...(anyCustom ? {} : { disabled: '' }), on: { click: () => send({ op: 'resetAll' }) } }, L.colorsResetAll)),
    el('div', { class: 'note' }, L.colorsHelp),
    ...S.rows.map((r) => {
      const color = r.custom || cssVar(r.id);
      const name = el('span', { style: 'color: ' + color }, 'example.txt');
      const badge = el('span', { style: 'color: ' + color }, r.badge);
      const code = el('code', {}, r.custom || hexOf(cssVar(r.id)));
      // 고르는 동안은 미리보기만 바꾸고, 고르기 창을 닫을 때(change) 저장한다 — 끌 때마다 설정 파일을 쓰지 않게
      const picker = el('input', { type: 'color', value: hexOf(color), on: {
        input: (e) => { name.style.color = badge.style.color = e.target.value; code.textContent = e.target.value; },
        change: (e) => send({ op: 'set', id: r.id, value: e.target.value }),
      } });
      return el('div', { class: 'row' },
        el('div', { class: 'label' }, r.label, el('small', {}, r.custom ? L.colorsIsCustom : L.colorsIsDefault)),
        el('div', { class: 'preview' }, name, badge),
        el('div', { class: 'controls' }, picker, code,
          el('button', { ...(r.custom ? {} : { disabled: '' }), on: { click: () => send({ op: 'reset', id: r.id }) } }, L.colorsDefault)),
        r.overridden ? el('div', { class: 'warn' }, L.colorsOverridden) : null);
    }),
  ].filter(Boolean));
}
window.addEventListener('message', (ev) => { if (ev.data.type === 'state') { S = ev.data.state; render(); } });
// 테마를 바꾸거나 기본값으로 돌리면 VS Code가 html의 style(테마 변수)을 바꾼다 — 보이는 색 코드를 다시 계산한다
new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
send({ op: 'refresh' });
</script>
</body></html>`;
}

module.exports = { ColorView, html };  // html은 test/manifest-check.js가 스크립트를 검사하려고 쓴다
