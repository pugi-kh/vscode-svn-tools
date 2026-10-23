'use strict';
// 작업 폴더 하나의 SVN 상태와 Source Control 패널.
// 작업 사본 루트가 상위 폴더여도 상태는 "VS Code에서 연 폴더" 안만 본다(다른 프로젝트 변경이 섞이지 않게).
const vscode = require('vscode');
const path = require('path');
const svn = require('./svn');
const { t } = require('./i18n');

// svn status의 item 값 → 한 글자 상태
const ITEM_CODE = {
  modified: 'M', added: 'A', deleted: 'D', replaced: 'R', unversioned: '?', missing: '!',
  conflicted: 'C', obstructed: '~', ignored: 'I', external: 'X', incomplete: '!',
};

const CONTEXT_VALUE = {
  M: 'modified', A: 'added', D: 'deleted', R: 'modified', '?': 'unversioned', '!': 'missing',
  C: 'conflicted', '~': 'conflicted',
};

function key(p) {
  return path.normalize(p).toLowerCase();
}

function isInside(child, parent) {
  const c = key(child);
  const p = key(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

function codeOf(entry) {
  if (entry.treeConflict) return 'C';
  const code = ITEM_CODE[entry.item];
  if (code) return code;
  if (entry.props === 'conflicted') return 'C';
  if (entry.props === 'modified') return 'M';
  return undefined;
}

class Repository {
  constructor(folder, info, onDidChange) {
    this.folder = svn.realPath(folder.uri.fsPath);
    this.name = folder.name;
    this.wcRoot = info.wcRoot ? svn.realPath(path.normalize(info.wcRoot)) : this.folder;
    this.url = info.url;
    this.statuses = new Map();   // key(path) → { path, code }
    this.ignored = [];           // 무시된 경로(폴더면 그 아래도 무시)
    this.onDidChange = onDidChange;
    this.refreshing = undefined;
    this.pending = false;
    this.disposables = [];

    const sc = vscode.scm.createSourceControl('svnTools', `SVN: ${this.name}`, folder.uri);
    sc.acceptInputCommand = { command: 'svnTools.commitAll', title: 'Commit', arguments: [sc] };
    sc.quickDiffProvider = {
      provideOriginalResource: (uri) => {
        const s = this.statusOf(uri.fsPath);
        if (uri.scheme !== 'file' || !s || s === '?' || s === 'A' || s === 'I') return undefined;
        return baseUri(uri.fsPath, 'BASE');
      },
    };
    this.sourceControl = sc;
    this.conflicts = sc.createResourceGroup('conflicts', '');
    this.changes = sc.createResourceGroup('changes', '');
    this.unversioned = sc.createResourceGroup('unversioned', '');
    for (const g of [this.conflicts, this.unversioned]) g.hideWhenEmpty = true;
    this.applyLanguage();
    this.disposables.push(sc, this.conflicts, this.changes, this.unversioned);

    // 무시된 폴더 안의 변경(수집 중 logs/ 등)은 새로고침을 일으키지 않는다.
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**'));
    const onFs = (uri) => {
      const p = uri.fsPath;
      if (/[\\/]\.(svn|git)([\\/]|$)/.test(p)) return;
      if (this.isIgnored(p)) return;
      this.scheduleRefresh();
    };
    watcher.onDidChange(onFs, null, this.disposables);
    watcher.onDidCreate(onFs, null, this.disposables);
    watcher.onDidDelete(onFs, null, this.disposables);
    this.disposables.push(watcher);
  }

  // 그룹 이름은 svn 상태 이름이라 메뉴처럼 영어로 고정한다. 입력칸 안내만 설정 언어를 따른다.
  applyLanguage() {
    this.conflicts.label = 'Conflicts';
    this.changes.label = 'Changes';
    this.unversioned.label = 'Unversioned';
    this.sourceControl.inputBox.placeholder = t('commitPlaceholder');
  }

  contains(p) {
    return isInside(p, this.folder);
  }

  statusOf(p) {
    const s = this.statuses.get(key(p));
    if (s) return s.code;
    return this.isIgnored(p) ? 'I' : undefined;
  }

  isIgnored(p) {
    return this.ignored.some((ig) => isInside(p, ig));
  }

  scheduleRefresh(delay = 800) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), delay);
  }

  // 새로고침이 겹치면 하나만 돌리고, 도는 중에 들어온 요청은 끝난 뒤 한 번 더 돌린다.
  async refresh() {
    if (this.refreshing) {
      this.pending = true;
      return this.refreshing;
    }
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = undefined;
      if (this.pending) {
        this.pending = false;
        this.refresh();
      }
    });
    return this.refreshing;
  }

  async doRefresh() {
    let entries;
    try {
      const { stdout } = await svn.exec(['status', '--xml', '--no-ignore', this.folder], this.folder);
      entries = svn.parseStatus(stdout);
    } catch (e) {
      console.error('[svn-tools] status failed', e);
      return;
    }
    const statuses = new Map();
    const ignored = [];
    const conflicts = [];
    const changes = [];
    const unversioned = [];
    for (const e of entries) {
      const code = codeOf(e);
      if (!code || code === 'X') continue;
      if (code === 'I') {
        ignored.push(e.path);
        continue;
      }
      statuses.set(key(e.path), { path: e.path, code });
      const state = this.resourceState(e.path, code);
      if (code === 'C' || code === '~') conflicts.push(state);
      else if (code === '?') unversioned.push(state);
      else changes.push(state);
    }
    const byPath = (a, b) => a.resourceUri.fsPath.localeCompare(b.resourceUri.fsPath);
    this.statuses = statuses;
    this.ignored = ignored;
    this.conflicts.resourceStates = conflicts.sort(byPath);
    this.changes.resourceStates = changes.sort(byPath);
    this.unversioned.resourceStates = unversioned.sort(byPath);
    this.sourceControl.count = conflicts.length + changes.length;
    this.onDidChange();
  }

  resourceState(p, code) {
    const uri = vscode.Uri.file(p);
    const deleted = code === 'D' || code === '!';
    const fade = vscode.workspace.getConfiguration('svnTools').get('scm.fadeUnversioned', true);
    return {
      resourceUri: uri,
      contextValue: CONTEXT_VALUE[code] || 'modified',
      decorations: { strikeThrough: deleted, faded: fade && code === '?', tooltip: code },
      command: { command: 'svnTools.openChange', title: 'Open', arguments: [uri] },
    };
  }

  dispose() {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}

// svn-tools:/<경로>?{"p":...,"r":...} → svn cat 결과. 비교 화면의 왼쪽(이전 버전)에 쓴다.
function baseUri(fsPath, rev) {
  return vscode.Uri.from({
    scheme: 'svn-tools',
    path: '/' + fsPath.replace(/\\/g, '/'),
    query: JSON.stringify({ p: fsPath, r: String(rev) }),
  });
}

module.exports = { Repository, baseUri, isInside, key };
