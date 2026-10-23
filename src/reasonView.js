'use strict';
// 무시된 원인 화면(웹뷰). 항목 하나를 무시하게 만드는 규칙을 카드로 보여 준다.
// 카드에는 패턴과 "어떤 설정인지" 한 줄만 둔다. 고칠 수 있는 규칙에만 [패턴 삭제]가 있고, 누르면 확장 쪽 확인 창에서
// 같은 패턴에 걸린 다른 항목을 보여 준 뒤 지운다. svn은 원인 규칙을 알려 주지 않아서 ignore.findRules가 직접 맞춰 본다.
const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const ignore = require('./ignore');
const tortoise = require('./tortoise');
const { t } = require('./i18n');
const { isInside, key } = require('./repository');

const SOURCE_KEY = {
  userFile: 'sourceUserFile', userRegistry: 'sourceUserRegistry', systemFile: 'sourceSystemFile',
  systemRegistry: 'sourceSystemRegistry', default: 'sourceDefault',
};
const STRING_KEYS = ['reasonPattern', 'reasonDelete', 'reasonDeleteAll', 'openTortoiseSettings', 'viewRefresh'];
const MAX_LIST = 15;

let current;

class ReasonView {
  static show(repo, itemPath, onChanged) {
    if (current) {
      current.repo = repo;
      current.itemPath = itemPath;
      current.panel.reveal();
      current.render();
      return;
    }
    current = new ReasonView(repo, itemPath, onChanged);
  }

  constructor(repo, itemPath, onChanged) {
    this.repo = repo;
    this.itemPath = itemPath;
    this.onChanged = onChanged;
    this.rules = [];
    this.panel = vscode.window.createWebviewPanel('svnTools.ignoreReason', t('reasonTitle', path.basename(itemPath)),
      vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
    this.panel.webview.html = html();
    this.panel.webview.onDidReceiveMessage((m) => this.handle(m));
    this.panel.onDidDispose(() => { current = undefined; });
  }

  rel(p) {
    const r = path.relative(this.repo.folder, p);
    if (r === '') return t('viewRoot');
    return r.startsWith('..') || path.isAbsolute(r) ? p : r;
  }

  // 지금 무시의 대상: 항목 자체, 또는 항목을 품은 무시된 폴더(svn status는 무시된 폴더 안으로 들어가지 않는다).
  target() {
    return this.repo.ignored.find((ig) => isInside(this.itemPath, ig));
  }

  describe(rule, local) {
    if (rule.kind === 'local') {
      const source = t(SOURCE_KEY[local.source]);
      return { title: t('unignoreKindLocal', source), desc: t('reasonDescLocal', source) };
    }
    const where = rule.editable ? this.rel(rule.dir) : rule.dir;
    if (rule.kind === 'svn:ignore') return { title: `svn:ignore — ${where}`, desc: t('reasonDescIgnore') };
    return {
      title: `svn:global-ignores — ${where}`,
      desc: rule.editable ? t('reasonDescGlobal') : t('reasonDescGlobalUrl'),
    };
  }

  async render() {
    try {
      await this.repo.refresh();
      const target = this.target();
      this.rules = target ? await ignore.findRules(target) : [];
      const local = ignore.readLocal();
      const name = this.rel(this.itemPath);
      const state = {
        title: t('reasonTitle', path.basename(this.itemPath)),
        item: t('reasonTarget', name),
        via: target && key(target) !== key(this.itemPath) ? t('reasonVia', name, this.rel(target)) : '',
        message: !target ? t('reasonNowNotIgnored', name) : this.rules.length === 0 ? t('reasonNone') : '',
        cards: this.rules.map((r, index) => ({ index, pattern: r.pattern, editable: r.editable, local: r.kind === 'local', ...this.describe(r, local) })),
        strings: Object.fromEntries(STRING_KEYS.map((k) => [k, t(k)])),
      };
      this.panel.title = state.title;
      this.panel.webview.postMessage({ type: 'state', state });
    } catch (e) {
      vscode.window.showErrorMessage(t('svnError', (e.stderr || e.message).split(/\r?\n/)[0]));
    }
  }

  // 같은 패턴으로 무시되던 다른 항목: 규칙이 미치는 범위 안의 무시 목록만 본다.
  affected(rules, target) {
    const others = this.repo.ignored.filter((ig) => key(ig) !== key(target));
    const found = new Set();
    for (const r of rules) {
      for (const ig of others) {
        const inScope = r.kind === 'svn:ignore' ? key(path.dirname(ig)) === key(r.dir)
          : r.kind === 'svn:global-ignores' ? isInside(ig, r.dir) : true;
        if (inScope && ignore.matchPattern(r.pattern, path.basename(ig))) found.add(this.rel(ig));
      }
    }
    return [...found].sort();
  }

  async remove(rules) {
    const target = this.target();
    if (!target || rules.length === 0) return;
    const local = ignore.readLocal();
    const list = this.affected(rules, target);
    const detail = [t('unignoreDetailRules'), ...rules.map((r) => `  ${r.pattern}   — ${this.describe(r, local).title}`), ''];
    if (list.length) {
      detail.push(t('unignoreDetailAlso'), ...list.slice(0, MAX_LIST).map((x) => `  ${x}`));
      if (list.length > MAX_LIST) detail.push(`  ${t('unignoreDetailMore', list.length - MAX_LIST)}`);
    } else {
      detail.push(t('unignoreDetailNone'));
    }
    const remaining = this.rules.filter((r) => !rules.includes(r));
    if (remaining.length) detail.push('', t('unignoreStill', remaining.map((r) => r.pattern).join(', ')));
    const hasProp = rules.some((r) => r.kind !== 'local');
    if (rules.some((r) => r.kind === 'local')) detail.push('', t('unignoreLocalWarn'));
    if (hasProp) detail.push('', t('unignoreCommitNote'));

    const yes = t('unignoreYes');
    const pick = await vscode.window.showWarningMessage(t('unignoreConfirm', this.rel(target)),
      { modal: true, detail: detail.join('\n') }, yes);
    if (pick !== yes) return;
    for (const r of rules) await ignore.removeRule(r);
    await this.onChanged();
    vscode.window.showInformationMessage(t('unignoreDone', rules.length) + (hasProp ? ' ' + t('unignoreCommitNote') : ''));
  }

  async handle(m) {
    try {
      if (m.op === 'delete') await this.remove([this.rules[m.index]].filter(Boolean));
      if (m.op === 'deleteAll') await this.remove(this.rules.filter((r) => r.editable));
      if (m.op === 'tortoise') {
        tortoise.open('settings', [], () => this.render());
        return;
      }
    } catch (e) {
      vscode.window.showErrorMessage(t('svnError', (e.stderr || e.message).split(/\r?\n/)[0]));
    }
    await this.render();
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
  .info { margin: 12px 0 4px; }
  .note { color: var(--vscode-descriptionForeground); margin: 4px 0 12px; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 10px 0; }
  .card-head { padding: 6px 10px; background: var(--vscode-sideBarSectionHeader-background); font-weight: 600; }
  .card-body { padding: 8px 10px; display: grid; gap: 6px; }
  .card-body code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 6px; }
  .desc { color: var(--vscode-descriptionForeground); }
  .actions { display: flex; gap: 6px; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 10px; cursor: pointer; font: inherit; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { filter: brightness(1.15); }
</style></head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const send = (m) => vscode.postMessage(m);
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false && kid !== '') e.append(kid.nodeType ? kid : String(kid));
  return e;
}
function render(S) {
  const L = S.strings;
  const editable = S.cards.filter((c) => c.editable).length;
  const root = document.getElementById('root');
  // replaceChildren도 append처럼 null을 글자 "null"로 붙인다 — 조건부 자리는 걸러서 넘긴다.
  root.replaceChildren(...[
    el('div', { class: 'bar' }, el('h1', {}, S.title),
      editable > 1 ? el('button', { class: 'primary', on: { click: () => send({ op: 'deleteAll' }) } }, L.reasonDeleteAll) : null,
      el('button', { on: { click: () => send({ op: 'refresh' }) } }, L.viewRefresh)),
    el('div', { class: 'info' }, S.item),
    S.via ? el('div', { class: 'note' }, S.via) : null,
    S.message ? el('div', { class: 'note' }, S.message) : null,
    ...S.cards.map((c) => el('div', { class: 'card' },
      el('div', { class: 'card-head' }, c.title),
      el('div', { class: 'card-body' },
        el('div', {}, L.reasonPattern + ': ', el('code', {}, c.pattern)),
        el('div', { class: 'desc' }, c.desc),
        (c.editable || c.local) ? el('div', { class: 'actions' },
          c.editable ? el('button', { class: 'primary', on: { click: () => send({ op: 'delete', index: c.index }) } }, L.reasonDelete) : null,
          c.local ? el('button', { on: { click: () => send({ op: 'tortoise' }) } }, L.openTortoiseSettings) : null) : null))),
  ].filter(Boolean));
}
window.addEventListener('message', (ev) => { if (ev.data.type === 'state') render(ev.data.state); });
send({ op: 'refresh' });
</script>
</body></html>`;
}

module.exports = { ReasonView };
