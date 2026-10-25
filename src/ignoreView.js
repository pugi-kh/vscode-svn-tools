'use strict';
// 무시 목록 편집 화면(웹뷰). 프로젝트의 svn:ignore / svn:global-ignores 전체와 내 PC 전역 목록을 보고 고친다.
// 고친 내용은 화면에 모아 두었다가 [저장]할 때 적용한다. 저장은 svn에서 현재 값을 다시 읽고
// 그 위에 "추가·수정·삭제한 것"만 얹는다 — 화면을 연 뒤 밖에서 바뀐 패턴을 덮어쓰지 않게.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ignore = require('./ignore');
const tortoise = require('./tortoise');
const svn = require('./svn');
const { t } = require('./i18n');
const { isInside } = require('./repository');

const PROPS = ['svn:ignore', 'svn:global-ignores'];
const SOURCE_KEY = { userFile: 'sourceUserFile', userRegistry: 'sourceUserRegistry', systemFile: 'sourceSystemFile', systemRegistry: 'sourceSystemRegistry', default: 'sourceDefault' };
const STRING_KEYS = [
  'viewTitle', 'viewProjectSection', 'viewProjectHelp', 'viewNoRules', 'viewFolder', 'viewKind', 'viewPattern',
  'viewAdd', 'viewEdit', 'viewRemove', 'viewSave', 'viewCancel', 'viewRefresh', 'viewRoot', 'viewUncommitted',
  'viewLocalSection', 'viewLocalHelp', 'viewLocalDefault', 'viewInvalidPattern', 'viewSaveAll', 'viewDiscard',
  'viewUnsaved', 'viewNoChanges', 'viewOtherFolder', 'viewOtherFolderHelp', 'viewCreateCard', 'viewRestore',
  'viewAddedTag', 'viewEditedTag', 'viewRemovedTag', 'viewNewCardTag', 'viewHintIgnore', 'viewHintGlobal',
  'viewEmptyCard', 'viewRemoveCard', 'viewRemoveAll', 'viewRestoreAll', 'patternHelp', 'openTortoiseSettings',
  'viewFolderPick', 'viewFolderPlaceholder',
];

let current; // 화면은 하나만 연다

// 최신 목록에 화면에서 바꾼 것만 얹는다. edits: [{ old, new }]
function applyChange(fresh, { edits = [], removed = [], added = [] }) {
  let next = [...fresh];
  for (const e of edits) {
    const i = next.indexOf(e.old);
    if (i >= 0) next[i] = e.new;
    else next.push(e.new);
  }
  next = next.filter((p) => !removed.includes(p));
  for (const a of added) next.push(a);
  return [...new Set(next)];
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

class IgnoreView {
  static show(repo, focusDir, onChanged) {
    if (current && current.repo === repo) {
      current.panel.reveal();
      // 고치던 내용을 잃지 않게 전체를 다시 그리지 않고 강조할 폴더만 알린다.
      current.panel.webview.postMessage({ type: 'focus', focus: current.rel(focusDir) });
      return;
    }
    if (current) current.panel.dispose();
    current = new IgnoreView(repo, focusDir, onChanged);
  }

  constructor(repo, focusDir, onChanged) {
    this.repo = repo;
    this.focusDir = focusDir;
    this.onChanged = onChanged;
    this.dirty = false;
    this.panel = vscode.window.createWebviewPanel('svnTools.ignores', t('viewTitle'), vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true });
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage((m) => this.handle(m));
    this.panel.onDidDispose(() => {
      if (this.dirty) vscode.window.showWarningMessage(t('viewDiscardedOnClose'));
      if (current === this) current = undefined;
    });
  }

  rel(dir) {
    return dir ? path.relative(this.repo.folder, dir) || '.' : '.';
  }

  async state() {
    const rules = [];
    for (const prop of PROPS) {
      for (const { dir, patterns } of await ignore.listProp(prop, this.repo.folder)) {
        rules.push({ rel: this.rel(dir), prop, patterns, uncommitted: this.repo.statusOf(dir) === 'M' });
      }
    }
    // 작업 폴더(루트)는 규칙이 없어도 두 종류 카드를 항상 보인다 — 특히 global-ignores를 걸 자리가 보이게.
    for (const prop of PROPS) {
      if (!rules.some((r) => r.rel === '.' && r.prop === prop)) {
        rules.push({ rel: '.', prop, patterns: [], uncommitted: this.repo.statusOf(this.repo.folder) === 'M' });
      }
    }
    // 루트를 먼저, 같은 폴더 안에서는 svn:ignore → svn:global-ignores 순서
    const order = (r) => (r.rel === '.' ? '' : r.rel);
    rules.sort((a, b) => order(a).localeCompare(order(b)) || PROPS.indexOf(a.prop) - PROPS.indexOf(b.prop));
    const local = ignore.readLocal();
    const strings = Object.fromEntries(STRING_KEYS.map((k) => [k, t(k)]));
    strings.viewProjectSection = t('viewProjectSection', this.repo.name);
    const target = ignore.localWriteTarget() === 'userFile' ? t('sourceUserFile') : t('targetUserRegistry');
    strings.viewLocalDefault = t('viewLocalDefault', t(SOURCE_KEY[local.source]), target);
    return { rules, dirs: this.versionedDirs(), focus: this.rel(this.focusDir), local: { set: !!local.set, patterns: local.patterns }, strings };
  }

  // "다른 폴더에 규칙 추가"의 자동완성 후보: 규칙을 걸 수 있는(관리 중인) 폴더. 큰 작업 사본에서 느려지지 않게 개수를 자른다.
  versionedDirs(limit = 2000) {
    const out = [];
    const walk = (dir) => {
      let names;
      try {
        names = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of names) {
        if (out.length >= limit) return;
        if (!d.isDirectory() || d.name === '.svn') continue;
        const p = path.join(dir, d.name);
        if (['?', 'I'].includes(this.repo.statusOf(p))) continue;
        out.push(this.rel(p));
        walk(p);
      }
    };
    walk(this.repo.folder);
    return out;
  }

  async render() {
    try {
      this.panel.title = t('viewTitle');
      this.dirty = false;
      this.panel.webview.postMessage({ type: 'state', state: await this.state() });
    } catch (e) {
      vscode.window.showErrorMessage(t('svnError', (e.stderr || e.message).split(/\r?\n/)[0]));
    }
  }

  // 화면에서 받은 폴더 값(상대 경로)을 실제 폴더로 바꾸고 쓸 수 있는지 확인한다.
  resolveDir(relDir) {
    const dir = path.resolve(this.repo.folder, relDir || '.');
    if (!isInside(dir, this.repo.folder)) throw new Error(t('viewOutside', relDir));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(t('viewFolderNotFound', relDir));
    if (['?', 'I'].includes(this.repo.statusOf(dir))) throw new Error(t('viewFolderNotVersioned', relDir));
    return svn.realPath(dir);
  }

  async save(changes, local) {
    // svn:ignore는 줄 단위라 공백을 쓸 수 있다. global-ignores(폴더 속성·내 PC 전역)는 공백으로 나뉘어 다른 패턴이 된다.
    const bad = (list, spaced) => list.some((p) => !p || (!spaced && /\s/.test(p)));
    const newOf = (c) => [...(c.added || []), ...(c.edits || []).map((e) => e.new)];
    if (changes.some((c) => bad(newOf(c), c.prop === 'svn:ignore')) || (local && bad(newOf(local), false))) {
      throw new Error(t('viewInvalidPattern'));
    }

    // 폴더를 모두 확인한 뒤에 쓴다(중간에 실패해 일부만 저장되는 일을 줄인다).
    const targets = changes.map((c) => ({ ...c, abs: this.resolveDir(c.dir) }));
    let count = 0;
    for (const c of targets) {
      const fresh = await ignore.getProp(c.prop, c.abs);
      const next = applyChange(fresh, c);
      if (!same(fresh, next)) {
        await ignore.setProp(c.prop, c.abs, next);
        count++;
      }
    }
    if (local) {
      const fresh = ignore.readLocal().patterns;
      const next = applyChange(fresh, local);
      if (!same(fresh, next)) {
        ignore.writeLocal(next);
        count++;
      }
    }
    return count;
  }

  async handle(m) {
    if (m.op === 'tortoise') {
      tortoise.open('settings', [], () => { if (!this.dirty) this.render(); });
      return;
    }
    if (m.op === 'pickFolder') {
      const [uri] = (await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        defaultUri: vscode.Uri.file(this.repo.toUi(this.repo.folder)), openLabel: t('viewFolderPick'),
      })) || [];
      if (!uri) return;
      const dir = this.repo.toReal(svn.realPath(uri.fsPath));
      if (!isInside(dir, this.repo.folder)) {
        vscode.window.showWarningMessage(t('viewOutside', uri.fsPath));
        return;
      }
      this.panel.webview.postMessage({ type: 'picked', rel: this.rel(dir) });
      return;
    }
    if (m.op === 'dirty') {
      this.dirty = !!m.value;
      return;
    }
    if (m.op === 'save') {
      try {
        const count = await this.save(m.changes || [], m.local);
        await this.onChanged();
        vscode.window.showInformationMessage(t('viewSaved', count));
      } catch (e) {
        // 저장 실패면 고치던 내용을 남겨 두고 다시 그리지 않는다.
        vscode.window.showErrorMessage((e.stderr || e.message).split(/\r?\n/)[0]);
        return;
      }
    }
    await this.render();
  }

  html() {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 20px 40px; max-width: 900px; }
  .bar { position: sticky; top: 0; z-index: 1; background: var(--vscode-editor-background); padding: 10px 0; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  .bar h1 { font-size: 1.3em; margin: 0 auto 0 0; }
  .bar .status { color: var(--vscode-descriptionForeground); }
  .bar .status.dirty { color: var(--vscode-editorWarning-foreground); font-weight: 600; }
  h2 { font-size: 1.1em; margin-top: 28px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; }
  .help { color: var(--vscode-descriptionForeground); margin: 6px 0 12px; }
  .help.pattern { margin-top: 10px; padding: 6px 10px; border-left: 3px solid var(--vscode-textBlockQuote-border); }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 10px 0; }
  .card.focus { border-color: var(--vscode-focusBorder); }
  .card-head { padding: 6px 10px; background: var(--vscode-sideBarSectionHeader-background); display: flex; gap: 8px; align-items: center; }
  .card-head .dir { font-weight: 600; }
  .card-head .hint { color: var(--vscode-descriptionForeground); font-size: .9em; }
  .card-head .right { margin-left: auto; }
  .tag { font-size: .85em; padding: 1px 6px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .tag.warn { background: transparent; color: var(--vscode-editorWarning-foreground); border: 1px solid var(--vscode-editorWarning-foreground); }
  .tag.added { background: transparent; color: var(--vscode-gitDecoration-addedResourceForeground); border: 1px solid currentColor; }
  .tag.edited { background: transparent; color: var(--vscode-gitDecoration-modifiedResourceForeground); border: 1px solid currentColor; }
  .tag.removed { background: transparent; color: var(--vscode-gitDecoration-deletedResourceForeground); border: 1px solid currentColor; }
  .row { display: flex; align-items: center; gap: 6px; padding: 4px 10px; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row code { flex: 1; font-family: var(--vscode-editor-font-family); }
  .row.removed code { text-decoration: line-through; opacity: .6; }
  .row.add { border-top: 1px dashed var(--vscode-panel-border); }
  input, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; font: inherit; }
  input.grow { flex: 1; }
  input.invalid { border-color: var(--vscode-inputValidation-errorBorder); }
  .err { color: var(--vscode-errorForeground); font-size: .9em; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 10px; cursor: pointer; font: inherit; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:disabled { opacity: .45; cursor: default; }
  button:not(:disabled):hover { filter: brightness(1.15); }
  .empty { color: var(--vscode-descriptionForeground); padding: 6px 10px; }
  .form { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; padding: 10px; }
</style></head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let S;            // 서버에서 받은 원본
let cards = [];   // 편집 중인 사본: [{ rel, prop, uncommitted, isNew, items: [{ value, orig, state }] }]
let local = [];   // 내 PC 전역 편집 사본: items
let focus = '.';
let newDir = '';  // "다른 폴더에 규칙 추가"에 입력 중인 폴더(다시 그려도 남게)
let lastDirty = false;
const send = (m) => vscode.postMessage(m);

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'class') e.className = v;
    else if (k === 'disabled') e.disabled = !!v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : String(kid));
  return e;
}
// 잘못된 패턴이면 테두리와 함께 이유를 입력칸 옆에 한 번만 보인다.
function markInvalid(input) {
  input.classList.add('invalid');
  if (!(input.nextSibling && input.nextSibling.className === 'err')) input.after(el('span', { class: 'err' }, S.strings.viewInvalidPattern));
}
function onEnter(input, fn) { input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') fn(); }); return input; }
// spaced: svn:ignore 카드(공백 허용). global-ignores 카드와 내 PC 전역은 공백 불가.
const valid = (p, spaced) => p && (spaced || !/\\s/.test(p));
const toItems = (list) => list.map((p) => ({ value: p, orig: p, state: 'kept' }));
const normRel = (r) => {
  let x = (r || '').trim().replace(/\\//g, '\\\\').replace(/^\\.\\\\/, '').replace(/\\\\+$/, '');
  return x === '' ? '.' : x;
};

function loadState(state) {
  S = state;
  focus = state.focus;
  cards = state.rules.map((r) => ({ rel: r.rel, prop: r.prop, uncommitted: r.uncommitted, isNew: false, items: toItems(r.patterns) }));
  local = toItems(state.local.patterns);
}

function changeCount() {
  const n = (items) => items.filter((i) => i.state !== 'kept').length;
  return cards.reduce((s, c) => s + n(c.items), 0) + n(local);
}

// ---- 항목 조작 (화면 안에서만) ----
function addItem(items, value, spaced) {
  value = value.trim();
  if (!valid(value, spaced)) return false;
  const existing = items.find((i) => i.value === value || i.orig === value);
  if (existing) {
    if (existing.state === 'removed') { existing.state = 'kept'; existing.value = existing.orig; }
    return true;
  }
  items.push({ value, orig: undefined, state: 'added' });
  return true;
}
function editItem(items, item, value, spaced) {
  value = value.trim();
  if (!valid(value, spaced)) return false;
  if (item.state === 'added') item.value = value;
  else { item.value = value; item.state = value === item.orig ? 'kept' : 'edited'; }
  return true;
}
function removeItem(items, item) {
  if (item.state === 'added') items.splice(items.indexOf(item), 1);
  else { item.state = 'removed'; item.value = item.orig; }
}
function restoreItem(item) { item.state = 'kept'; item.value = item.orig; }

// ---- 저장할 내용 만들기 ----
function diffOf(items) {
  return {
    edits: items.filter((i) => i.state === 'edited').map((i) => ({ old: i.orig, new: i.value })),
    removed: items.filter((i) => i.state === 'removed').map((i) => i.orig),
    added: items.filter((i) => i.state === 'added').map((i) => i.value),
  };
}
function save() {
  const changes = [];
  for (const c of cards) {
    const d = diffOf(c.items);
    if (d.edits.length || d.removed.length || d.added.length) changes.push({ dir: c.rel, prop: c.prop, ...d });
  }
  const l = diffOf(local);
  const localChange = (l.edits.length || l.removed.length || l.added.length) ? l : null;
  send({ op: 'save', changes, local: localChange });
}

// ---- 그리기 ----
function itemRow(items, item, spaced) {
  const L = S.strings;
  const row = el('div', { class: 'row' + (item.state === 'removed' ? ' removed' : '') });
  const tag = { added: ['added', L.viewAddedTag], edited: ['edited', L.viewEditedTag], removed: ['removed', L.viewRemovedTag] }[item.state];
  const label = el('code', item.state === 'edited' ? { title: item.orig } : {}, item.value);
  if (item.state === 'removed') {
    row.append(label, el('span', { class: 'tag removed' }, tag[1]),
      el('button', { on: { click: () => { restoreItem(item); render(); } } }, L.viewRestore));
    return row;
  }
  const edit = () => {
    const input = el('input', { class: 'grow', value: item.value });
    const ok = () => { if (editItem(items, item, input.value, spaced)) render(); else markInvalid(input); };
    onEnter(input, ok);
    row.replaceChildren(input,
      el('button', { class: 'primary', on: { click: ok } }, L.viewSave),
      el('button', { on: { click: render } }, L.viewCancel));
    input.focus(); input.select();
  };
  // DOM의 append는 null을 글자 "null"로 붙이므로 꼬리표가 없을 때는 아예 넘기지 않는다.
  row.append(label);
  if (tag) row.append(el('span', { class: 'tag ' + tag[0] }, tag[1]));
  row.append(el('button', { on: { click: edit } }, L.viewEdit),
    el('button', { on: { click: () => { removeItem(items, item); render(); } } }, L.viewRemove));
  return row;
}

// 카드 머리의 삭제 버튼. 저장 안 한 새 카드는 바로 없애고, 있던 규칙은 패턴 전부를 삭제 예정으로 표시한다
// (저장하면 속성이 지워진다). 전부 삭제 예정이면 "모두 복구"로 바뀐다.
function cardButton(c) {
  const L = S.strings;
  if (c.isNew) {
    return el('button', { class: 'right', on: { click: () => { cards.splice(cards.indexOf(c), 1); render(); } } }, L.viewRemoveCard);
  }
  const kept = c.items.filter((i) => i.state !== 'removed');
  if (c.items.length > 0 && kept.length === 0) {
    return el('button', { class: 'right', on: { click: () => { c.items.forEach(restoreItem); render(); } } }, L.viewRestoreAll);
  }
  if (c.items.length === 0) return null;
  return el('button', { class: 'right', on: { click: () => {
    for (const item of [...c.items]) removeItem(c.items, item);
    render();
  } } }, L.viewRemoveAll);
}

function addRow(items, spaced) {
  const input = el('input', { class: 'grow', placeholder: S.strings.viewPattern });
  const add = () => { if (!input.value.trim()) return; if (addItem(items, input.value, spaced)) render(); else markInvalid(input); };
  onEnter(input, add);
  return el('div', { class: 'row add' }, input, el('button', { on: { click: add } }, S.strings.viewAdd));
}

function render() {
  const L = S.strings;
  const n = changeCount();
  if ((n > 0) !== lastDirty) { lastDirty = n > 0; send({ op: 'dirty', value: lastDirty }); }
  const root = document.getElementById('root');
  root.replaceChildren();

  root.append(el('div', { class: 'bar' },
    el('h1', {}, L.viewTitle),
    el('span', { class: 'status' + (n ? ' dirty' : '') }, n ? L.viewUnsaved.replace('{0}', n) : L.viewNoChanges),
    el('button', { class: 'primary', disabled: !n, on: { click: save } }, L.viewSaveAll),
    el('button', { disabled: !n, on: { click: () => { loadState(S); render(); } } }, L.viewDiscard),
    el('button', { disabled: !!n, on: { click: () => send({ op: 'refresh' }) } }, L.viewRefresh)));

  root.append(el('div', { class: 'help pattern' }, L.patternHelp));

  // ---- 프로젝트 규칙 ----
  root.append(el('h2', {}, L.viewProjectSection), el('div', { class: 'help' }, L.viewProjectHelp));
  if (cards.length === 0) root.append(el('div', { class: 'empty' }, L.viewNoRules));
  for (const c of cards) {
    const card = el('div', { class: 'card' + (c.rel === focus ? ' focus' : '') },
      el('div', { class: 'card-head' },
        el('span', { class: 'dir' }, c.rel === '.' ? L.viewRoot : c.rel),
        el('span', { class: 'tag' }, c.prop),
        el('span', { class: 'hint' }, c.prop === 'svn:ignore' ? L.viewHintIgnore : L.viewHintGlobal),
        c.isNew ? el('span', { class: 'tag added' }, L.viewNewCardTag) : null,
        c.uncommitted ? el('span', { class: 'tag warn' }, L.viewUncommitted) : null,
        cardButton(c)));
    if (c.items.length === 0) card.append(el('div', { class: 'empty' }, L.viewEmptyCard));
    const spaced = c.prop === 'svn:ignore';
    for (const item of c.items) card.append(itemRow(c.items, item, spaced));
    card.append(addRow(c.items, spaced));
    root.append(card);
  }

  // ---- 다른 폴더에 규칙 추가 ----
  // 폴더는 작업 폴더 기준 경로다. 직접 쓰거나(목록에서 자동완성), [폴더 선택…]으로 고른다. 비우면 작업 폴더.
  const dirInput = el('input', { id: 'newDir', value: newDir, list: 'dirs', placeholder: L.viewFolderPlaceholder, class: 'grow' });
  dirInput.addEventListener('input', () => { newDir = dirInput.value; });
  const kind = el('select', {}, el('option', { value: 'svn:ignore' }, 'svn:ignore'), el('option', { value: 'svn:global-ignores' }, 'svn:global-ignores'));
  const create = () => {
    const rel = normRel(dirInput.value);
    focus = rel;
    newDir = '';
    if (!cards.some((c) => c.rel === rel && c.prop === kind.value)) {
      cards.push({ rel, prop: kind.value, uncommitted: false, isNew: true, items: [] });
    }
    render();
    const f = document.querySelector('.card.focus .row.add input');
    if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); }
  };
  onEnter(dirInput, create);
  root.append(el('h2', {}, L.viewOtherFolder), el('div', { class: 'help' }, L.viewOtherFolderHelp),
    el('div', { class: 'card' }, el('div', { class: 'form' },
      L.viewFolder, el('div', { class: 'row' }, dirInput, el('button', { on: { click: () => send({ op: 'pickFolder' }) } }, L.viewFolderPick)),
      L.viewKind, kind,
      el('span'), el('div', {}, el('button', { on: { click: create } }, L.viewCreateCard)))),
    el('datalist', { id: 'dirs' }, ...[...new Set(['.', ...S.dirs])].map((d) => el('option', { value: d }))));

  // ---- 내 PC 전역 ----
  root.append(el('h2', {}, L.viewLocalSection), el('div', { class: 'help' }, L.viewLocalHelp));
  root.append(el('div', { class: 'help' }, L.viewLocalDefault,
    ' ', el('button', { on: { click: () => send({ op: 'tortoise' }) } }, L.openTortoiseSettings)));
  const box = el('div', { class: 'card' });
  for (const item of local) box.append(itemRow(local, item, false));
  box.append(addRow(local, false));
  root.append(box);
}

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m.type === 'state') { loadState(m.state); render(); scrollToFocus(); }
  if (m.type === 'focus') { focus = m.focus; render(); scrollToFocus(); }
  // 화면 전체를 다시 그리지 않고 폴더 칸만 채운다(고르던 종류, 입력 중이던 패턴이 그대로 남게).
  if (m.type === 'picked') {
    newDir = m.rel === '.' ? '' : m.rel;
    const input = document.getElementById('newDir');
    if (input) { input.value = newDir; input.focus(); }
  }
});
function scrollToFocus() {
  const f = document.querySelector('.card.focus');
  if (f && focus !== '.') f.scrollIntoView({ block: 'center' });
}
send({ op: 'refresh' });
</script>
</body></html>`;
  }
}

module.exports = { IgnoreView, applyChange };
