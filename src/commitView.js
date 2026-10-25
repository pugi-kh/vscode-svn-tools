'use strict';
// 커밋 확인 탭(웹뷰). 커밋 직전에 메시지와 올라갈 항목을 한 번 더 보여 준다(스테이징 더블체크, 설정 svnTools.commit.review).
// 항목 체크를 끄면 이번 커밋에서만 빠진다(스테이징은 그대로). 함께 올라가야 하는 항목(새 상위 폴더, 이동의 반대쪽)은
// 끌 수 없게 잠가 두고, 이동 양쪽은 같이 켜고 끈다. [커밋]을 누르면 확장이 상태를 다시 읽어 검증한 뒤에야 커밋한다
// (validate) — 탭을 연 사이 바뀐 것이 있거나 끈 항목이 함께 올라가야 하면 이유를 보이고 탭을 닫지 않는다.
// 메시지는 고칠 때마다 패널 입력칸에도 써서, 취소해도 남는다.
const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const { t } = require('./i18n');

let current; // 탭은 하나만 연다. 새로 열면 이전 것은 취소로 닫는다.

class CommitView {
  // items: [{ path, code, locked, pair }]
  // validate(checkedPaths) → { paths } 이면 커밋, { error, items? } 이면 탭에 이유를 보이고(목록이 바뀌었으면 새로 그리고) 머문다.
  // 결과: { message, paths } 또는 취소면 undefined
  static open(repo, message, items, validate) {
    if (current) current.finish(undefined);
    return new Promise((resolve) => {
      current = new CommitView(repo, message, items, validate, resolve);
    });
  }

  constructor(repo, message, items, validate, resolve) {
    this.repo = repo;
    this.message = message;
    this.items = items;
    this.validate = validate;
    this.resolve = resolve;
    this.panel = vscode.window.createWebviewPanel('svnTools.commit', t('reviewTitle', repo.name), vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true });
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage((m) => this.handle(m));
    this.panel.onDidDispose(() => this.finish(undefined, true));
  }

  finish(result, disposed) {
    if (this.resolve) {
      this.resolve(result);
      this.resolve = undefined;
    }
    if (current === this) current = undefined;
    if (!disposed) this.panel.dispose();
  }

  state() {
    const strings = {
      title: t('reviewTitle', this.repo.name), help: t('reviewHelp'), messageLabel: t('reviewMessage'),
      itemsLabel: t('reviewItems'), locked: t('reviewLocked'), diff: t('reviewDiff'), commit: t('reviewCommit'),
      cancel: t('reviewCancel'), emptyMessage: t('commitEmptyMessage'), noItems: t('reviewNoItems'),
    };
    const items = this.items.map((x) => ({
      path: x.path, rel: path.relative(this.repo.folder, x.path) || x.path, code: x.code, locked: !!x.locked, pair: x.pair,
    }));
    return { message: this.message, items, strings };
  }

  async handle(m) {
    if (m.op === 'ready') this.panel.webview.postMessage({ type: 'state', state: this.state() });
    if (m.op === 'message') this.repo.sourceControl.inputBox.value = m.value;
    if (m.op === 'diff') await vscode.commands.executeCommand('svnTools.openChange', vscode.Uri.file(this.repo.toUi(m.path)));
    if (m.op === 'cancel') this.finish(undefined);
    if (m.op === 'commit') {
      if (this.validating) return;
      this.validating = true;
      let res;
      try {
        res = await this.validate(m.paths);
      } catch (e) {
        res = { error: (e && (e.stderr || e.message)) || String(e) };  // 버튼이 꺼진 채 남지 않게 이유를 돌려준다
      } finally {
        this.validating = false;
      }
      if (!this.resolve) return; // 검증하는 사이 닫혔다
      if (res.error) {
        if (res.items) this.items = res.items;
        this.panel.webview.postMessage({ type: 'error', text: res.error, state: res.items ? this.state() : undefined });
        return;
      }
      this.finish({ message: m.message, paths: res.paths });
    }
  }

  html() {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 20px 40px; max-width: 900px; }
  h1 { font-size: 1.3em; margin: 14px 0 4px; }
  h2 { font-size: 1.05em; margin: 20px 0 6px; }
  .help { color: var(--vscode-descriptionForeground); margin: 4px 0 12px; }
  textarea { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 6px; font-family: var(--vscode-editor-font-family); }
  .row { display: flex; align-items: center; gap: 8px; padding: 3px 6px; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row.off .rel { opacity: .5; text-decoration: line-through; }
  .code { width: 1.5em; text-align: center; font-weight: 600; font-family: var(--vscode-editor-font-family); }
  .code.M, .code.R { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
  .code.A { color: var(--vscode-gitDecoration-addedResourceForeground); }
  .code.D, .code.miss { color: var(--vscode-gitDecoration-deletedResourceForeground); }
  .rel { flex: 1; font-family: var(--vscode-editor-font-family); }
  .tag { font-size: .85em; padding: 1px 6px; border-radius: 3px; border: 1px solid var(--vscode-descriptionForeground); color: var(--vscode-descriptionForeground); }
  .bar { display: flex; gap: 8px; align-items: center; margin-top: 18px; }
  .bar .err { color: var(--vscode-errorForeground); }
  .note { margin-top: 12px; padding: 6px 10px; border-left: 3px solid var(--vscode-editorWarning-foreground); }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 12px; cursor: pointer; font: inherit; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:disabled { opacity: .45; cursor: default; }
  .row button { padding: 1px 8px; }
</style></head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let S;
const checked = new Set();
const send = (m) => vscode.postMessage(m);

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'class') e.className = v;
    else if (k === 'disabled' || k === 'checked') e[k] = !!v;
    else e.setAttribute(k, v);
  }
  // DOM의 append는 null을 글자 "null"로 붙이므로 빈 값은 넘기지 않는다.
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : String(kid));
  return e;
}

let note = '';  // 확장이 검증하고 돌려준 이유(다시 그려도 남게)
let pending = false;  // 검증 중에는 다시 보내지 않는다(Ctrl+Enter 연타로 바뀐 목록을 보기 전에 커밋되지 않게)

function commit() {
  const message = document.getElementById('msg').value;
  if (pending || !message.trim() || !anyPicked()) return;
  pending = true;
  document.getElementById('commit').disabled = true;
  send({ op: 'commit', message, paths: S.items.filter((x) => checked.has(x.path)).map((x) => x.path) });
}

// 잠긴 항목(함께 올라감)만 남으면 올릴 것이 없는 것이다.
function anyPicked() {
  return S.items.some((x) => !x.locked && checked.has(x.path));
}

// 이동의 양쪽은 같이 켜고 끈다(한쪽만으로는 svn이 커밋을 거부한다).
function setChecked(x, on) {
  for (const y of S.items) {
    if (y === x || (!y.locked && (y.path === x.pair || y.pair === x.path))) {
      if (on) checked.add(y.path); else checked.delete(y.path);
    }
  }
}

function render() {
  const L = S.strings;
  const root = document.getElementById('root');
  const msg = el('textarea', { id: 'msg' });
  msg.value = S.message;
  msg.addEventListener('input', () => { S.message = msg.value; send({ op: 'message', value: msg.value }); update(); });
  msg.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); commit(); } });

  const list = el('div', {});
  for (const x of S.items) {
    const box = el('input', { type: 'checkbox', checked: checked.has(x.path), disabled: x.locked });
    const row = el('div', { class: 'row' + (checked.has(x.path) ? '' : ' off') },
      box,
      el('span', { class: 'code ' + (x.code === '!' ? 'miss' : x.code) }, x.code),
      el('span', { class: 'rel' }, x.rel),
      x.locked ? el('span', { class: 'tag' }, L.locked) : null,
      ['M', 'R'].includes(x.code) ? el('button', { on: { click: () => send({ op: 'diff', path: x.path }) } }, L.diff) : null);
    box.addEventListener('change', () => {
      setChecked(x, box.checked);
      note = '';
      render();
    });
    list.append(row);
  }

  const err = el('span', { class: 'err', id: 'err' });
  const noteBox = note ? el('div', { class: 'note' }, note) : null;
  // replaceChildren도 null을 글자 "null"로 붙인다(함정 6) — 빈 값은 걸러서 넘긴다.
  root.replaceChildren(...[
    el('h1', {}, L.title),
    el('div', { class: 'help' }, L.help),
    el('h2', {}, L.messageLabel), msg,
    el('h2', {}, L.itemsLabel), list,
    noteBox,
    el('div', { class: 'bar' },
      el('button', { class: 'primary', id: 'commit', on: { click: commit } }, L.commit),
      el('button', { on: { click: () => send({ op: 'cancel' }) } }, L.cancel),
      err),
  ].filter(Boolean));
  update();
  msg.focus();
  msg.setSelectionRange(msg.value.length, msg.value.length);
}

function update() {
  const L = S.strings;
  const empty = !S.message.trim();
  document.getElementById('commit').disabled = empty || !anyPicked();
  document.getElementById('err').textContent = empty ? L.emptyMessage : !anyPicked() ? L.noItems : '';
}

function load(state) {
  const message = S ? S.message : state.message;
  S = state;
  S.message = message;
  checked.clear();
  for (const x of S.items) checked.add(x.path);
}

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m.type === 'state') {
    load(m.state);
    render();
  }
  if (m.type === 'error') {
    pending = false;
    if (m.state) load(m.state);
    note = m.text;
    render();
  }
});
send({ op: 'ready' });
</script>
</body></html>`;
  }
}

module.exports = { CommitView };
