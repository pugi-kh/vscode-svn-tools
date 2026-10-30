'use strict';
// Source Control 아래의 SVN 이력 뷰(트리). git의 그래프 자리처럼 커밋 목록을 보인다.
//   - 작업 사본 리비전에 해당하는 커밋에 "현재 위치", 그보다 새 커밋(서버에만 있음)은 받지 않은 커밋으로 표시한다.
//   - 커밋을 펼치면 바뀐 파일, 파일을 누르면 그 커밋의 변경(이전 리비전 ↔ 그 리비전)을 비교 화면으로 연다.
// svn log는 서버를 부르므로 뷰가 보일 때만 읽는다: 보이게 될 때, 창으로 돌아올 때(간격 제한), 커밋·업데이트 뒤, 새로고침 버튼.
const vscode = require('vscode');
const path = require('path');
const os = require('os');
const svn = require('./svn');
const { tFor } = require('./i18n');

const PAGE = 50;
const FOCUS_INTERVAL = 30 * 1000;
const SCHEME = 'svn-tools-history';  // 바뀐 파일 항목의 resourceUri — 파일 아이콘과 동작 배지(A/M/D/R)용
const ACTION_COLOR = {
  A: 'svnTools.addedForeground', M: 'svnTools.modifiedForeground', R: 'svnTools.modifiedForeground', D: 'svnTools.deletedForeground',
};

const s = (key, ...args) => tFor('scm', key, ...args);

// 로그 날짜(UTC) → 지역 시각 "YYYY-MM-DD HH:mm"
function localDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 저장소 루트 기준 경로(/trunk/a b.txt) → URL. 로그의 경로는 인코딩되지 않았고 info의 root는 인코딩돼 있다.
const toUrl = (root, repoPath) => root + repoPath.split('/').map(encodeURIComponent).join('/');

class HistoryView {
  constructor(ctx) {
    this.ctx = ctx;
    this.states = new Map();  // repo → { info, entries, end, error, loading, details: Map(rev → paths), loadedAt }
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.view = vscode.window.createTreeView('svnTools.history', { treeDataProvider: this, showCollapseAll: true });
    this.applyLanguage();
    this.decoEmitter = new vscode.EventEmitter();
    this.disposables = [
      this.view,
      this.view.onDidChangeVisibility((e) => { if (e.visible) this.refresh(); }),
      vscode.window.registerFileDecorationProvider({ provideFileDecoration: (uri) => this.decorate(uri) }),
      vscode.commands.registerCommand('svnTools.history.diff', (node) => this.diff(node).catch((e) => this.fail(e))),
      vscode.commands.registerCommand('svnTools.history.more', (repo) => this.more(repo).catch((e) => this.fail(e))),
      vscode.commands.registerCommand('svnTools.history.update', (node) => this.askUpdate(node)),
    ];
    this.reloadConfig();
  }

  dispose() {
    clearInterval(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }

  // 자동 확인(svnTools.history.autoRefresh, autoRefreshMinutes): 칸이 보이고 창이 앞에 있을 때만 서버를 부른다
  reloadConfig() {
    clearInterval(this.timer);
    const config = vscode.workspace.getConfiguration('svnTools');
    if (!config.get('history.autoRefresh', true)) return;
    const minutes = Number(config.get('history.autoRefreshMinutes', 5)) || 5;
    this.timer = setInterval(() => {
      if (vscode.window.state.focused) this.refresh();
    }, Math.max(1, minutes) * 60 * 1000);
  }

  applyLanguage() {
    this.view.title = s('historyTitle');
    this.emitter.fire(undefined);
  }

  fail(e) {
    vscode.window.showErrorMessage(s('svnError', ((e && (e.stderr || e.message)) || String(e)).split(/\r?\n/)[0]));
  }

  // repo를 주면 그 저장소만. 뷰가 안 보이면 읽지 않는다 — 보이게 될 때 전부 다시 읽는다.
  refresh(repo) {
    if (!this.view.visible) return;
    for (const r of repo ? [repo] : this.ctx.repositories()) this.load(r);
  }

  // 창으로 돌아올 때: 마지막으로 읽은 지 FOCUS_INTERVAL이 지났을 때만(창 전환마다 서버를 부르지 않게)
  refreshOnFocus() {
    if (!this.view.visible) return;
    for (const r of this.ctx.repositories()) {
      const st = this.states.get(r);
      if (!st || Date.now() - (st.loadedAt || 0) > FOCUS_INTERVAL) this.load(r);
    }
  }

  // 작업 폴더가 열리고 닫힐 때
  reposChanged() {
    for (const r of [...this.states.keys()]) if (!this.ctx.repositories().includes(r)) this.states.delete(r);
    this.emitter.fire(undefined);
  }

  async load(repo) {
    const prev = this.states.get(repo);
    const st = { details: prev ? prev.details : new Map(), loading: true, entries: prev ? prev.entries : [], info: prev && prev.info };
    this.states.set(repo, st);
    const token = (st.token = Symbol());
    try {
      // 작업 사본 경로에 -r HEAD:1을 주면 받지 않은 새 커밋까지 나온다(기본 범위는 BASE:1).
      const [info, log, range] = await Promise.all([
        svn.exec(['info', '--xml', repo.folder], repo.folder),
        svn.exec(['log', '--xml', '-l', String(PAGE), '-r', 'HEAD:1', repo.folder], repo.folder),
        svn.wcVersion(repo.folder),
      ]);
      if (this.states.get(repo) !== st || st.token !== token) return;
      st.info = svn.parseInfo(info.stdout);
      // 위치는 작업 사본에서 가장 새 리비전으로 본다(폴더 리비전은 내가 커밋해도 그대로라 받지 않은 것처럼 보인다)
      st.range = range || { min: Number(st.info.revision), max: Number(st.info.revision) };
      st.entries = svn.parseLog(log.stdout);
      st.end = st.entries.length < PAGE;
      st.error = undefined;
    } catch (e) {
      if (this.states.get(repo) !== st) return;
      st.error = ((e.stderr || e.message) || '').split(/\r?\n/).find(Boolean) || String(e);
    }
    st.loading = false;
    st.loadedAt = Date.now();
    this.emitter.fire(undefined);
  }

  async more(repo) {
    const st = this.states.get(repo);
    if (!st || st.entries.length === 0) return;
    const last = st.entries[st.entries.length - 1].revision;
    if (last <= 1) return;
    const { stdout } = await svn.exec(['log', '--xml', '-l', String(PAGE), '-r', `${last - 1}:1`, repo.folder], repo.folder);
    const older = svn.parseLog(stdout);
    st.entries = st.entries.concat(older);
    st.end = older.length < PAGE;
    this.emitter.fire(undefined);
  }

  // 커밋에서 바뀐 경로(펼칠 때 한 번 읽고 기억한다)
  async details(repo, rev) {
    const st = this.states.get(repo);
    if (st.details.has(rev)) return st.details.get(rev);
    const { stdout } = await svn.exec(['log', '--xml', '-v', '-r', String(rev), repo.folder], repo.folder);
    const [entry] = svn.parseLog(stdout);
    const paths = entry ? entry.paths.sort((a, b) => a.path.localeCompare(b.path)) : [];
    st.details.set(rev, paths);
    return paths;
  }

  // ---- 트리 ----

  getChildren(node) {
    const repos = this.ctx.repositories();
    if (!node) {
      if (repos.length === 1) return this.repoChildren(repos[0]);
      return repos.map((repo) => ({ type: 'repo', repo }));
    }
    if (node.type === 'repo') return this.repoChildren(node.repo);
    if (node.type === 'commit') {
      return this.details(node.repo, node.entry.revision)
        .then((paths) => paths.map((p) => ({ type: 'file', repo: node.repo, rev: node.entry.revision, p })))
        .catch((e) => [{ type: 'error', message: ((e.stderr || e.message) || '').split(/\r?\n/)[0] }]);
    }
    return [];
  }

  repoChildren(repo) {
    const st = this.states.get(repo);
    if (!st || (st.loading && st.entries.length === 0)) {
      if (!st) this.load(repo);
      return [{ type: 'loading' }];
    }
    if (st.error && st.entries.length === 0) return [{ type: 'error', message: st.error }];
    const wcRev = st.range ? st.range.max : Infinity;
    const mixed = st.range && st.range.min < st.range.max ? st.range : undefined;
    const incoming = st.entries.filter((e) => e.revision > wcRev);
    const current = st.entries.find((e) => e.revision <= wcRev);
    const nodes = [];
    if (st.error) nodes.push({ type: 'error', message: st.error });
    if (incoming.length) nodes.push({ type: 'incoming', repo, count: incoming.length });
    for (const entry of st.entries) {
      nodes.push({ type: 'commit', repo, entry, wcRev, mixed, incoming: entry.revision > wcRev, current: entry === current });
    }
    if (!st.end) nodes.push({ type: 'more', repo });
    return nodes;
  }

  getTreeItem(node) {
    const None = vscode.TreeItemCollapsibleState.None;
    if (node.type === 'loading') return new vscode.TreeItem(s('historyLoading'), None);
    if (node.type === 'error') {
      const item = new vscode.TreeItem(s('historyError'), None);
      item.description = node.message;
      item.tooltip = node.message;
      item.iconPath = new vscode.ThemeIcon('warning');
      return item;
    }
    if (node.type === 'repo') {
      const item = new vscode.TreeItem(path.basename(node.repo.folder), vscode.TreeItemCollapsibleState.Expanded);
      item.id = `repo|${node.repo.folder}`;
      item.iconPath = new vscode.ThemeIcon('repo');
      return item;
    }
    if (node.type === 'incoming') {
      const item = new vscode.TreeItem(s('historyIncoming', node.count), None);
      item.description = s('historyIncomingHint');
      item.iconPath = new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('charts.blue'));
      // 누르자마자 업데이트하면 무슨 일이 일어났는지 알기 어렵다(사용자 제보) — 묻고 한다
      item.command = { command: 'svnTools.history.update', title: 'Update', arguments: [node] };
      return item;
    }
    if (node.type === 'more') {
      const item = new vscode.TreeItem(s('logMore'), None);
      item.iconPath = new vscode.ThemeIcon('ellipsis');
      item.command = { command: 'svnTools.history.more', title: s('logMore'), arguments: [node.repo] };
      return item;
    }
    if (node.type === 'commit') return this.commitItem(node);
    return this.fileItem(node);
  }

  commitItem(node) {
    const e = node.entry;
    const firstLine = e.message.split('\n')[0] || s('historyNoMessage');
    const item = new vscode.TreeItem(firstLine, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `commit|${node.repo.folder}|${e.revision}`;
    item.contextValue = 'commit';
    const meta = `r${e.revision} · ${e.author} · ${localDate(e.date)}`;
    item.description = node.current ? `${s('historyCurrent')} · ${meta}` : node.incoming ? `${s('historyNotUpdated')} · ${meta}` : meta;
    item.iconPath = node.current ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'))
      : node.incoming ? new vscode.ThemeIcon('arrow-circle-down', new vscode.ThemeColor('charts.blue'))
        : new vscode.ThemeIcon('git-commit');
    const tip = new vscode.MarkdownString();
    tip.appendMarkdown(`**r${e.revision}** · `).appendText(`${e.author} · ${localDate(e.date)}`);
    if (node.current) tip.appendMarkdown('\n\n').appendText(s('historyCurrentTip', node.wcRev));
    if (node.current && node.mixed) tip.appendMarkdown('\n\n').appendText(s('historyMixedTip', node.mixed.min, node.mixed.max));
    if (node.incoming) tip.appendMarkdown('\n\n').appendText(s('historyNotUpdatedTip', node.wcRev));
    tip.appendMarkdown('\n\n---\n\n').appendText(e.message || s('historyNoMessage'));
    item.tooltip = tip;
    return item;
  }

  fileItem(node) {
    const { p } = node;
    const item = new vscode.TreeItem(vscode.Uri.from({ scheme: SCHEME, path: p.path, query: p.action }), vscode.TreeItemCollapsibleState.None);
    item.label = path.posix.basename(p.path);
    const st = this.states.get(node.repo);
    const base = st && st.info ? decodeURIComponent(st.info.url.slice(st.info.root.length)) : '';
    const dir = path.posix.dirname(p.path);
    // 작업 폴더 밖(같은 커밋에서 함께 바뀐 다른 경로)은 저장소 기준 경로로, 안쪽은 작업 폴더 기준 경로로 보인다
    const inside = base && (dir === base || dir.startsWith(base + '/'));
    item.description = inside ? dir.slice(base.length).replace(/^\//, '') : `${dir}  (${s('historyOutside')})`;
    item.tooltip = `${p.action} ${p.path}`;
    item.contextValue = 'file';
    item.command = { command: 'svnTools.history.diff', title: 'Diff', arguments: [node] };
    return item;
  }

  decorate(uri) {
    if (uri.scheme !== SCHEME) return undefined;
    const action = uri.query;
    if (!ACTION_COLOR[action]) return undefined;
    return { badge: action, color: new vscode.ThemeColor(ACTION_COLOR[action]) };
  }

  // ---- 동작 ----

  // 그 커밋의 변경: 이전 리비전 ↔ 그 리비전. 추가는 왼쪽, 삭제는 오른쪽이 비어 있다. 폴더는 svn diff 텍스트.
  async diff(node) {
    const st = this.states.get(node.repo);
    if (!st || !st.info) return;
    const { p, rev } = node;
    const url = toUrl(st.info.root, p.path);
    if (p.kind === 'dir') {
      const { stdout } = await svn.exec(['diff', '-c', String(rev), url], os.homedir());
      const doc = await vscode.workspace.openTextDocument({ content: stdout || '(no changes)', language: 'diff' });
      await vscode.window.showTextDocument(doc, { preview: true });
      return;
    }
    const side = (r, empty) => vscode.Uri.from({
      scheme: 'svn-tools', path: p.path, query: JSON.stringify(empty ? { empty: true } : { u: url, r: String(r) }),
    });
    const name = path.posix.basename(p.path);
    await vscode.commands.executeCommand('vscode.diff', side(rev - 1, p.action === 'A'), side(rev, p.action === 'D'),
      s('historyDiffTitle', name, rev - 1, rev));
  }

  async askUpdate(node) {
    const yes = s('historyUpdateYes');
    const pick = await vscode.window.showInformationMessage(s('historyUpdateAsk', node.count), { modal: true }, yes);
    if (pick === yes) await vscode.commands.executeCommand('svnTools.update', vscode.Uri.file(node.repo.folder));
  }

  async copyMessage(node) {
    if (node && node.entry) await vscode.env.clipboard.writeText(node.entry.message);
  }
}

module.exports = { HistoryView };
