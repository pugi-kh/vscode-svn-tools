'use strict';
// 커밋 탭(웹뷰). 커밋 메시지를 쓰고 올릴 항목을 트리에서 고른다(사용자 결정 2.0.0 — 스테이징·패널 입력칸 대신).
// 항목은 변경과 미등록 두 묶음이고, 미등록을 체크하면 커밋 직전에 svn add 한다.
// 체크 규칙(웹뷰 스크립트): 폴더를 켜고 끄면 하위 전부가 따라가고, 항목을 켜면 svn이 함께 올리라고 요구하는 새 상위 폴더
// (requires)도 켜지며, 새 폴더를 끄면 그 아래 항목도 꺼진다. 저장소가 새로고침되면 목록을 따라 고치고 체크는 경로로 유지한다.
// [커밋]은 확장이 상태를 다시 읽어, 사용자가 본 목록과 같을 때만 진행한다(version).
// 항목 우클릭은 VS Code 메뉴(webview/context, manifest.js)로 연다 — data-vscode-context의 svnPath가 명령 인자로 간다.
const vscode = require('vscode');
const crypto = require('crypto');
const { t } = require('./i18n');

let current; // 탭은 저장소마다 하나만 연다

class CommitView {
  // opts.build(): { items, note } — 지금 상태의 항목 목록(commands.js commitItems)
  // opts.validate(paths): { error } 또는 커밋에 넘길 값 — 상태를 다시 읽은 뒤 부른다
  // 결과: { message, ...validate 결과 } 또는 취소면 undefined
  static open(repo, opts) {
    if (current && current.repo === repo) {
      // 같은 저장소의 탭이 이미 있으면 그 탭을 앞으로 가져오고 고른 범위만 새로 적용한다.
      // 커밋은 처음 연 쪽이 이어서 한다(둘 다 기다리면 두 번 커밋한다).
      current.retarget(opts);
      return Promise.resolve(undefined);
    }
    if (current) current.finish(undefined);
    current = new CommitView(repo, opts);
    return current.promise;
  }

  constructor(repo, opts) {
    this.repo = repo;
    this.opts = opts;
    this.version = 0;
    this.sig = '';
    this.promise = new Promise((resolve) => { this.resolve = resolve; });
    this.panel = vscode.window.createWebviewPanel('svnTools.commit', t('reviewTitle', repo.name), vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true });
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage((m) => this.handle(m));
    this.panel.onDidDispose(() => this.finish(undefined, true));
    this.sub = repo.onDidRender(() => this.push(false));
  }

  retarget(opts) {
    this.opts = { ...this.opts, build: opts.build };
    // 탭을 연 뒤 패널 입력칸에서 고친 메시지를 가져온다
    if (this.ready) this.panel.webview.postMessage({ type: 'message', value: this.repo.draft });
    this.panel.reveal();
    this.push(true);
  }

  finish(result, disposed) {
    if (this.resolve) {
      this.resolve(result);
      this.resolve = undefined;
    }
    if (current === this) current = undefined;
    if (this.sub) this.sub.dispose();
    if (!disposed) this.panel.dispose();
  }

  strings() {
    return {
      title: t('reviewTitle', this.repo.name), help: t('reviewHelp'), messageLabel: t('reviewMessageLabel'),
      changes: t('reviewChanges'), unversioned: t('reviewUnversioned'), commit: t('reviewCommit'), cancel: t('reviewCancel'),
      noItems: t('reviewNoItems'), none: t('reviewNone'), selected: t('reviewSelected', '{0}', '{1}'),
      movedFrom: t('reviewMovedFrom', '{0}'),  // 자리표시는 웹뷰가 채운다(t는 빈 인자를 지운다) missing: t('reviewMissing'), withContents: t('reviewWithContents'),
      renamable: t('reviewRenamable'), props: t('reviewProps'), root: t('reviewRootFolder', this.repo.name),
    };
  }

  // 목록을 웹뷰로 보낸다. reset이면 체크를 기본값으로 다시 잡는다(탐색기에서 다른 범위로 다시 연 경우).
  push(reset) {
    if (!this.ready) return;
    const { items, note } = this.opts.build();
    const sig = items.map((x) => `${x.path}|${x.code}|${x.movedFrom || ''}`).join('\n') + '#' + note;
    if (!reset && sig === this.sig) return;
    this.sig = sig;
    this.version++;
    this.panel.webview.postMessage({ type: 'items', items, note, version: this.version, reset });
  }

  async handle(m) {
    if (m.op === 'ready') {
      this.ready = true;
      this.panel.webview.postMessage({ type: 'init', strings: this.strings(), message: this.repo.draft });
      this.push(true);
    }
    if (m.op === 'message') this.repo.draft = m.value;
    if (m.op === 'open') await vscode.commands.executeCommand('svnTools.openChange', vscode.Uri.file(this.repo.toUi(m.path)));
    if (m.op === 'cancel') this.finish(undefined);
    if (m.op === 'commit') {
      if (this.validating) return;
      this.validating = true;
      let res;
      try {
        // svn은 빈 메시지 커밋을 받는다. 실수일 수 있어 한 번만 묻는다(사용자 결정).
        if (!m.message.trim()) {
          const yes = t('commitEmptyYes');
          if (await vscode.window.showWarningMessage(t('commitEmptyAsk'), { modal: true }, yes) !== yes) {
            this.validating = false;
            this.panel.webview.postMessage({ type: 'error', text: '' });
            return;
          }
        }
        await this.repo.refresh();  // 바뀐 것이 있으면 render → push가 version을 올린다
        if (m.version !== this.version) res = { error: t('reviewChanged') };
        else res = await this.opts.validate(m.paths);
      } catch (e) {
        res = { error: (e && (e.stderr || e.message)) || String(e) };  // 버튼이 꺼진 채 남지 않게 이유를 돌려준다
      } finally {
        this.validating = false;
      }
      if (!this.resolve) return; // 검증하는 사이 닫혔다
      if (res.error) {
        this.panel.webview.postMessage({ type: 'error', text: res.error });
        return;
      }
      this.finish({ message: m.message, ...res });
    }
  }

  html() {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 20px 40px; }
  h1 { font-size: 1.3em; margin: 14px 0 4px; }
  h2 { font-size: 1.05em; margin: 20px 0 6px; display: flex; align-items: center; gap: 6px; }
  h2 .count { font-weight: normal; color: var(--vscode-descriptionForeground); font-size: .9em; }
  /* 화면 폭은 제한하지 않는다(긴 경로가 잘리지 않고 버튼이 오른쪽 끝에 오게, 사용자 결정).
     설명 글은 문구의 \n에서 문장마다 줄을 바꾼다. */
  .help { color: var(--vscode-descriptionForeground); margin: 4px 0 12px; white-space: pre-line; }
  textarea { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 6px; font-family: var(--vscode-editor-font-family); }
  .row { display: flex; align-items: center; gap: 6px; padding: 1px 6px; line-height: 22px; cursor: default; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row.off .name { opacity: .55; }
  .twisty { width: 1em; text-align: center; cursor: pointer; color: var(--vscode-descriptionForeground); user-select: none; }
  .code { width: 1.2em; text-align: center; font-weight: 600; font-family: var(--vscode-editor-font-family); }
  .code.M, .code.R { color: var(--vscode-svnTools-modifiedForeground); }
  .code.A { color: var(--vscode-svnTools-addedForeground); }
  .code.D, .code.miss { color: var(--vscode-svnTools-deletedForeground); }
  .code.U { color: var(--vscode-svnTools-unversionedForeground); }
  .name { cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name.folder { font-weight: 600; }
  .name.gone { text-decoration: line-through; }
  .tag { font-size: .85em; color: var(--vscode-descriptionForeground); white-space: nowrap; }
  .empty { color: var(--vscode-descriptionForeground); padding: 2px 6px; }
  /* 목록이 길어도 [커밋]이 늘 보이게 화면 아래에 붙인다 */
  .bar { display: flex; gap: 8px; align-items: center; margin-top: 18px; position: sticky; bottom: 0; padding: 10px 0;
    background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-panel-border, transparent); }
  .bar .err { color: var(--vscode-errorForeground); margin-right: auto; }
  .note { margin-top: 12px; padding: 6px 10px; border-left: 3px solid var(--vscode-editorWarning-foreground); }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 12px; cursor: pointer; font: inherit; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:disabled { opacity: .45; cursor: default; }
</style></head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let L = {};
let message = '';
let items = [];
let version = 0;
let note = '';     // 상태 안내(충돌 등 목록에서 뺀 항목)
let error = '';    // 확장이 검증하고 돌려준 이유
let pending = false;
const byPath = new Map();
const checked = new Set();
const known = new Set();      // 한 번이라도 보낸 경로 — 새로 생긴 항목만 기본 체크를 적용한다
const collapsed = new Set();
const send = (m) => vscode.postMessage(m);

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'class') e.className = v;
    else if (k === 'disabled' || k === 'checked' || k === 'indeterminate') e[k] = !!v;
    else e.setAttribute(k, v);
  }
  // DOM의 append는 null을 글자 "null"로 붙이므로 빈 값은 넘기지 않는다.
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : String(kid));
  return e;
}

// ---- 체크 규칙 ----
function turnOn(paths) {
  for (const p of paths) {
    const x = byPath.get(p);
    if (!x) continue;
    checked.add(p);
    for (const r of x.requires) if (byPath.has(r)) checked.add(r);
  }
}

// 끈 항목을 새 상위 폴더로 요구하는 항목도 끈다(새 폴더 없이 그 안의 항목만 올릴 수 없다).
function turnOff(paths) {
  const off = new Set(paths);
  for (const p of off) checked.delete(p);
  for (const x of items) if (x.requires.some((r) => off.has(r))) checked.delete(x.path);
}

function load(list, reset) {
  items = list;
  byPath.clear();
  for (const x of items) byPath.set(x.path, x);
  if (reset) {
    checked.clear();
    known.clear();
  }
  for (const p of [...checked]) if (!byPath.has(p)) checked.delete(p);
  turnOn(items.filter((x) => !known.has(x.path) && x.def).map((x) => x.path));
  turnOn([...checked]);
  for (const x of items) known.add(x.path);
}

// ---- 트리 ----
// 트리의 맨 위는 항상 작업 폴더다. 작업 폴더 자신의 변경(rel '.', 대개 속성)은 그 줄에 붙는다.
function buildTree(list) {
  const root = { name: L.root, key: '', children: new Map(), item: null };
  for (const x of list) {
    if (x.rel === '.') {
      root.item = x;
      continue;
    }
    let node = root;
    for (const part of x.rel.split(/[\\\\/]/)) {
      const k = part.toLowerCase();
      let child = node.children.get(k);
      if (!child) {
        child = { name: part, key: node.key + '/' + k, children: new Map(), item: null };
        node.children.set(k, child);
      }
      node = child;
    }
    node.item = x;
  }
  return root;
}

function itemsUnder(node, out = []) {
  if (node.item) out.push(node.item.path);
  for (const c of node.children.values()) itemsUnder(c, out);
  return out;
}

function stateOf(paths) {
  const on = paths.filter((p) => checked.has(p)).length;
  return on === 0 ? 'off' : on === paths.length ? 'on' : 'mixed';
}

// VS Code 탐색기 기본 정렬과 같게: 폴더 먼저, 이름은 대소문자 무시·숫자는 크기순(file2 < file10)
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function sorted(node) {
  return [...node.children.values()].sort((a, b) => (b.children.size > 0) - (a.children.size > 0) || collator.compare(a.name, b.name));
}

function toggle(paths) {
  if (stateOf(paths) === 'on') turnOff(paths); else turnOn(paths);
  error = '';
  render();
}

function tagsOf(x) {
  const tags = [];
  if (x.movedFrom) tags.push(L.movedFrom.replace('{0}', x.movedFrom));
  if (x.props) tags.push(L.props);
  if (x.code === '!') tags.push(L.missing);
  if (x.unversioned && x.dir) tags.push(L.withContents);
  if (x.renamable) tags.push(L.renamable);
  return tags.map((s) => el('span', { class: 'tag' }, s));
}

function rows(node, depth, section, out) {
  for (let child of sorted(node)) {
    // 변경 없는 폴더가 한 줄로 이어지면 a\\b\\c처럼 합쳐 보인다(VS Code 탐색기의 compact folders와 같다).
    let name = child.name;
    while (!child.item && child.children.size === 1) {
      const only = [...child.children.values()][0];
      if (only.children.size === 0) break;
      name += '\\\\' + only.name;
      child = only;
    }
    addRow(child, name, depth, section, out);
  }
  return out;
}

function addRow(child, name, depth, section, out) {
    const isFolder = child.children.size > 0;
    const paths = itemsUnder(child);
    const state = stateOf(paths);
    const x = child.item;
    const ckey = section + child.key;
    const box = el('input', { type: 'checkbox', checked: state === 'on', indeterminate: state === 'mixed' });
    box.addEventListener('change', () => toggle(paths));
    const code = x ? (x.unversioned ? 'U' : x.code) : '';
    const nameEl = el('span', { class: 'name' + (isFolder || (x && x.props) ? ' folder' : '') + (x && (x.code === 'D' || x.code === '!') ? ' gone' : ''), title: x ? x.rel : name }, name);
    nameEl.addEventListener('click', () => {
      if (isFolder) {
        if (collapsed.has(ckey)) collapsed.delete(ckey); else collapsed.add(ckey);
        render();
      } else if (x) {
        send({ op: 'open', path: x.path });
      }
    });
    const twisty = el('span', { class: 'twisty' }, isFolder ? (collapsed.has(ckey) ? '▸' : '▾') : '');
    twisty.addEventListener('click', () => nameEl.click());
    const row = el('div', { class: 'row' + (state === 'off' ? ' off' : ''), style: 'padding-left:' + (6 + depth * 16) + 'px' },
      twisty, box, el('span', { class: 'code ' + (code === '!' ? 'miss' : code) }, code), nameEl, x ? tagsOf(x) : []);
    // 우클릭 메뉴(manifest.js webview/context)가 쓰는 값
    if (x) {
      row.setAttribute('data-vscode-context', JSON.stringify({
        webviewSection: 'item', svnKind: x.unversioned ? 'unversioned' : 'change', svnCode: x.code,
        svnRenamable: !!x.renamable, svnPath: x.path, preventDefaultContextMenuItems: true,
      }));
    }
    out.push(row);
    if (isFolder && !collapsed.has(ckey)) rows(child, depth + 1, section, out);
}

function section(label, list, id) {
  const on = list.filter((x) => checked.has(x.path)).length;
  const head = el('h2', {}, label, el('span', { class: 'count' }, list.length ? L.selected.replace('{0}', on).replace('{1}', list.length) : ''));
  // 작업 폴더 줄의 체크박스가 이 묶음 전체 선택을 겸한다
  const body = list.length ? [] : [el('div', { class: 'empty' }, L.none)];
  if (list.length) addRow(buildTree(list), L.root, 0, id, body);
  return [head, ...body];
}

function render() {
  const root = document.getElementById('root');
  const scroll = window.scrollY;
  const msg = el('textarea', { id: 'msg' });
  msg.value = message;
  msg.addEventListener('input', () => { message = msg.value; send({ op: 'message', value: message }); update(); });
  msg.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); commit(); } });
  const focused = document.activeElement && document.activeElement.id === 'msg';
  const changes = items.filter((x) => !x.unversioned);
  const unversioned = items.filter((x) => x.unversioned);
  const notes = [note, error].filter(Boolean).map((s) => el('div', { class: 'note' }, s));
  root.replaceChildren(...[
    el('h1', {}, L.title),
    el('div', { class: 'help' }, L.help),
    el('h2', {}, L.messageLabel), msg,
    ...section(L.changes, changes, 'c'),
    ...section(L.unversioned, unversioned, 'u'),
    ...notes,
    // 목록이 왼쪽 정렬이라 버튼은 오른쪽 끝에 둔다(사용자 결정). 주 버튼 [커밋]이 맨 오른쪽.
    el('div', { class: 'bar' },
      el('span', { class: 'err', id: 'err' }),
      el('button', { on: { click: () => send({ op: 'cancel' }) } }, L.cancel),
      el('button', { class: 'primary', id: 'commit', on: { click: commit } }, L.commit)),
  ].filter(Boolean));
  update();
  window.scrollTo(0, scroll);
  if (focused || !render.done) {
    msg.focus();
    msg.setSelectionRange(msg.value.length, msg.value.length);
  }
  render.done = true;
}

function update() {
  const none = checked.size === 0;
  document.getElementById('commit').disabled = pending || none;
  document.getElementById('err').textContent = none ? L.noItems : '';
}

// 검증 중에는 다시 보내지 않는다(Ctrl+Enter 연타로 바뀐 목록을 보기 전에 커밋되지 않게).
// 빈 메시지는 확장이 확인 창으로 한 번 묻는다.
function commit() {
  if (pending || checked.size === 0) return;
  pending = true;
  error = '';
  update();
  send({ op: 'commit', message, version, paths: items.filter((x) => checked.has(x.path)).map((x) => x.path) });
}

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    L = m.strings;
    message = m.message || '';
  }
  if (m.type === 'message' && m.value !== message) {
    message = m.value || '';
    render();
  }
  if (m.type === 'items') {
    load(m.items, m.reset);
    version = m.version;
    note = m.note;
    render();
  }
  if (m.type === 'error') {
    pending = false;
    error = m.text;
    render();
  }
});
send({ op: 'ready' });
</script>
</body></html>`;
  }
}

module.exports = { CommitView };
