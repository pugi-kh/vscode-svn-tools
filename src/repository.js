'use strict';
// 작업 폴더 하나의 SVN 상태, 스테이징, Source Control 패널.
// 작업 사본 루트가 상위 폴더여도 상태는 "VS Code에서 연 폴더" 안만 본다(다른 프로젝트 변경이 섞이지 않게).
//
// 스테이징: svn에는 스테이징이 없어서 이 확장이 "다음 커밋에 넣을 경로"를 기억한다(작업 공간 상태에 저장, 재시작해도 유지).
// TortoiseSVN·명령줄에서는 보이지 않는다. 커밋은 스테이징된 경로만 --depth empty로 정확히 넘긴다(commands.js).
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const svn = require('./svn');
const { t, tFor, languageFor } = require('./i18n');

// svn status의 item 값 → 한 글자 상태. N(incomplete)은 Update가 중간에 끊겨 다 받지 못한 폴더 — 확장이 쓰는 표시다.
const ITEM_CODE = {
  modified: 'M', added: 'A', deleted: 'D', replaced: 'R', unversioned: '?', missing: '!',
  conflicted: 'C', obstructed: '~', ignored: 'I', external: 'X', incomplete: 'N',
};

// 새 폴더 안을 훑어 "추가 가능" 메뉴 목록에 넣는 최대 개수(큰 폴더에서 느려지지 않게)
const MAX_WALK = 3000;

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

const isConflict = (code) => code === 'C' || code === '~';

// 일반 add(복사·이동이 아닌 A)는 git처럼 add = 스테이징이다(사용자 결정). 스테이징 취소 = add 취소.
const isPlainAdd = (s) => s.code === 'A' && !s.copied;

// 충돌 때 svn이 만드는 부산물(파일.mine, 파일.r12 등). 미등록으로 보이지만 추가하면 안 된다.
const LEFTOVER = /\.(mine|working|r\d+|merge-(left|right)\.r\d+)$/;

class Repository {
  constructor(folder, info, memento, onDidChange) {
    this.folder = svn.realPath(folder.uri.fsPath);
    // VS Code가 쓰는 표기(연 폴더 경로 그대로). 디스크 표기와 대소문자·junction이 다를 수 있다 — toUi/toReal 참고.
    this.uiFolder = folder.uri.fsPath;
    this.name = folder.name;
    this.wcRoot = info.wcRoot ? svn.realPath(path.normalize(info.wcRoot)) : this.folder;
    this.url = info.url;
    this.statuses = new Map();   // key(path) → { path, code }
    this.ignored = [];           // 무시된 경로(폴더면 그 아래도 무시)
    this.memento = memento;
    this.stateKey = `svnTools.staged:${key(this.folder)}`;
    this.staged = new Map((memento.get(this.stateKey) || []).map((p) => [key(p), p]));  // key → path
    // svn 없이(탐색기 F2 등) 이름을 바꾼 기록: key(새 경로) → { from, to }. 나중에 SVN 이름 바꾸기로 적용할 수 있게 둔다.
    this.renameKey = `svnTools.renames:${key(this.folder)}`;
    this.renames = new Map((memento.get(this.renameKey) || []).map((r) => [key(r.to), r]));
    this.onDidChange = onDidChange;
    this.refreshing = undefined;
    this.next = undefined;
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
    this.stagedGroup = sc.createResourceGroup('staged', '');
    this.changes = sc.createResourceGroup('changes', '');
    this.unversioned = sc.createResourceGroup('unversioned', '');
    this.conflicts = sc.createResourceGroup('conflicts', '');
    for (const g of [this.stagedGroup, this.unversioned, this.conflicts]) g.hideWhenEmpty = true;
    this.applyLanguage();
    this.disposables.push(sc, this.stagedGroup, this.changes, this.unversioned, this.conflicts);

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

  // 그룹 이름과 입력칸 안내는 패널 언어(svnTools.scmLanguage)를 따른다.
  applyLanguage() {
    const ko = languageFor('scm') === 'ko';
    this.stagedGroup.label = ko ? '스테이징된 변경' : 'Staged Changes';
    this.changes.label = ko ? '변경' : 'Changes';
    this.unversioned.label = ko ? '미등록' : 'Unversioned';
    this.conflicts.label = ko ? '충돌' : 'Conflicts';
    this.sourceControl.inputBox.placeholder = tFor('scm', 'commitPlaceholder');
  }

  // 디스크 표기 ↔ VS Code 표기. 탐색기 메뉴 조건(resourcePath in ...)은 문자열을 정확히 비교하므로,
  // 연 폴더를 다른 대소문자나 junction 경로로 열었으면 목록도 그 표기로 만들어야 메뉴가 뜬다.
  toUi(p) {
    return isInside(p, this.folder) ? this.uiFolder + p.slice(this.folder.length) : vscode.Uri.file(p).fsPath;
  }

  toReal(p) {
    if (isInside(p, this.folder)) return p;
    return isInside(p, this.uiFolder) ? this.folder + p.slice(this.uiFolder.length) : p;
  }

  contains(p) {
    return isInside(this.toReal(p), this.folder);
  }

  statusOf(p) {
    p = this.toReal(p);
    const s = this.statuses.get(key(p));
    if (s) return s.code;
    return this.isIgnored(p) ? 'I' : undefined;
  }

  isIgnored(p) {
    p = this.toReal(p);
    return this.ignored.some((ig) => isInside(p, ig));
  }

  // 미등록 폴더 안의 항목도 미등록이다(svn status는 미등록 폴더 안으로 들어가지 않는다).
  isUnversioned(p) {
    if (this.statusOf(p) === '?') return true;
    return [...this.statuses.values()].some((s) => s.code === '?' && isInside(p, s.path));
  }

  isStaged(p) {
    const k = key(this.toReal(p));
    const s = this.statuses.get(k);
    return this.staged.has(k) || (!!s && isPlainAdd(s));
  }

  entry(p) {
    return this.statuses.get(key(this.toReal(p)));
  }

  // 이동의 반대쪽 경로(없으면 undefined). 이동은 양쪽을 함께 커밋·되돌려야 한다.
  movePair(p) {
    const s = this.entry(p);
    return s && (s.movedFrom || s.movedTo);
  }

  isLeftover(p) {
    if (!LEFTOVER.test(p)) return false;
    const base = p.replace(LEFTOVER, '');
    return [...this.statuses.values()].some((s) => isConflict(s.code) && key(s.path) === key(base));
  }

  // ---- 스테이징 상태 (svn 작업은 commands.js가 하고, 여기서는 기억만 한다) ----

  // 상태를 다시 읽지 않고 그룹만 다시 나눈다. 바로 앞 새로고침은 아직 스테이징 전이라 항목이 Changes에 들어가 있다.
  stage(paths) {
    for (const p of paths) this.staged.set(key(p), p);
    this.saveStaged();
    this.render();
  }

  unstage(paths) {
    for (const p of paths) this.staged.delete(key(p));
    this.saveStaged();
    this.render();
  }

  // 스테이징 목록 + 일반 add 항목(자동 스테이징)
  stagedPaths() {
    const out = new Map(this.staged);
    for (const s of this.statuses.values()) if (isPlainAdd(s)) out.set(key(s.path), s.path);
    return [...out.values()];
  }

  saveStaged() {
    this.memento.update(this.stateKey, [...this.staged.values()]);
  }

  renameRecord(to) {
    return this.renames.get(key(this.toReal(to)));
  }

  recordRename(from, to) {
    this.renames.set(key(to), { from, to });
    this.memento.update(this.renameKey, [...this.renames.values()]);
  }

  forgetRename(to) {
    if (this.renames.delete(key(to))) this.memento.update(this.renameKey, [...this.renames.values()]);
  }

  // 아직 적용할 수 있는 이름 바꾸기 기록(옛 경로는 누락, 새 경로는 미등록일 때만). 사용자가 그사이 직접 고쳤으면 없다.
  renameOf(p) {
    const r = this.renames.get(key(this.toReal(p)));
    return r && this.statusOf(r.from) === '!' && this.isUnversioned(r.to) ? r : undefined;
  }

  scheduleRefresh(delay = 800) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), delay);
  }

  // 새로고침이 겹치면 하나만 돌린다. 도는 중에 들어온 요청은 끝난 뒤 한 번 더 돌리고 그 결과를 기다린다 —
  // 도는 중인 것은 svn 작업 전에 시작됐을 수 있어서, 그걸 돌려주면 방금 add한 항목이 아직 '?'로 보인다.
  async refresh() {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => { this.refreshing = undefined; });
      return this.refreshing;
    }
    if (!this.next) {
      this.next = this.refreshing.then(() => {
        this.next = undefined;
        return this.refresh();
      });
    }
    return this.next;
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
    for (const e of entries) {
      const code = codeOf(e);
      if (!code || code === 'X') continue;
      if (code === 'I') {
        ignored.push(e.path);
        continue;
      }
      statuses.set(key(e.path), { path: e.path, code, copied: e.copied, movedFrom: e.movedFrom, movedTo: e.movedTo, locked: e.locked });
    }
    // 덜 받은 폴더 안의 누락(!)은 진짜 삭제가 아니라 아직 못 받은 것일 수 있다 — 같이 N으로 둔다.
    const incomplete = [...statuses.values()].filter((s) => s.code === 'N').map((s) => s.path);
    for (const s of statuses.values()) if (s.code === '!' && incomplete.some((d) => isInside(s.path, d))) s.code = 'N';
    this.statuses = statuses;
    this.ignored = ignored;

    // 더 이상 커밋할 변경이 없는 경로(되돌렸거나 커밋됨)와 미등록·충돌로 바뀐 경로는 스테이징에서 뺀다.
    let pruned = false;
    for (const k of [...this.staged.keys()]) {
      const s = statuses.get(k);
      if (!s || s.code === '?' || s.code === 'N' || isConflict(s.code)) {
        this.staged.delete(k);
        pruned = true;
      }
    }
    if (pruned) this.saveStaged();
    // 기록은 디스크로만 판단해 버린다(새 이름이 없어졌거나 옛 이름이 다시 생김). 상태로 판단하면, 이름을 바꾸는 순간 돌고 있던
    // 새로고침(바꾸기 전 상태)이 끝나면서 방금 남긴 기록을 지운다. 메뉴에 띄울지는 renameOf가 상태까지 보고 정한다.
    for (const r of [...this.renames.values()]) if (!fs.existsSync(r.to) || fs.existsSync(r.from)) this.forgetRename(r.to);
    this.render();
  }

  render() {
    const staged = [];
    const changes = [];
    const unversioned = [];
    const conflicts = [];
    for (const s of this.statuses.values()) {
      if (isConflict(s.code)) conflicts.push(this.resourceState(s.path, s.code, 'conflicted'));
      else if (s.code === 'N') changes.push(this.resourceState(s.path, s.code, 'incomplete'));
      else if (s.code === '?') unversioned.push(this.resourceState(s.path, s.code, 'unversioned'));
      else if (this.isStaged(s.path)) staged.push(this.resourceState(s.path, s.code, 'staged'));
      else changes.push(this.resourceState(s.path, s.code, 'changed'));
    }
    const byPath = (a, b) => a.resourceUri.fsPath.localeCompare(b.resourceUri.fsPath);
    this.stagedGroup.resourceStates = staged.sort(byPath);
    this.changes.resourceStates = changes.sort(byPath);
    this.unversioned.resourceStates = unversioned.sort(byPath);
    this.conflicts.resourceStates = conflicts.sort(byPath);
    this.sourceControl.count = staged.length + changes.length + conflicts.length;
    this.onDidChange();
  }

  // contextValue: staged | changed | unversioned | conflicted | incomplete (메뉴 조건 scmResourceState에 쓴다)
  resourceState(p, code, group) {
    const uri = vscode.Uri.file(this.toUi(p));
    const deleted = code === 'D' || code === '!';
    const fade = vscode.workspace.getConfiguration('svnTools').get('scm.fadeUnversioned', true);
    return {
      resourceUri: uri,
      contextValue: group,
      decorations: { strikeThrough: deleted, faded: fade && code === '?', tooltip: code },
      command: { command: 'svnTools.openChange', title: 'Open', arguments: [uri] },
    };
  }

  // 탐색기 우클릭 메뉴 조건(resourcePath in ...)에 넘길 경로 목록. 경로는 VS Code가 쓰는 표기(toUi)로 만든다.
  //   addable:   미등록 항목과 새 폴더 안의 항목 → SVN Add
  //   stageable: 스테이징 안 된 변경과 그 상위 폴더, 새 항목을 품은 관리 폴더 → SVN Stage
  //   staged:    스테이징된 항목과 그 상위 폴더 → SVN Unstage
  //   renamable: svn 없이 이름을 바꾼 항목(새 이름) → SVN 이름 바꾸기로 적용
  contextLists() {
    const addable = new Set();
    const stageable = new Set();
    const staged = new Set();
    const renamable = [...this.renames.values()].filter((r) => this.renameOf(r.to)).map((r) => this.toUi(r.to));
    const ui = (p) => this.toUi(p);
    const withParents = (set, p) => {
      for (let cur = p; isInside(cur, this.folder); cur = path.dirname(cur)) {
        set.add(ui(cur));
        if (key(cur) === key(this.folder) || path.dirname(cur) === cur) break;
      }
    };
    let walked = 0;
    const walk = (dir) => {
      let names;
      try {
        names = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of names) {
        if (walked >= MAX_WALK) return;
        const p = path.join(dir, d.name);
        walked++;
        addable.add(ui(p));
        if (d.isDirectory()) walk(p);
      }
    };
    for (const s of this.statuses.values()) {
      if (s.code === '?') {
        addable.add(ui(s.path));
        // 새 항목을 품은 관리 폴더에도 SVN Stage ▸가 뜨게 한다(스테이징하면 안의 새 항목은 add된다). 수정 파일을 품은 폴더와 같게.
        if (key(path.dirname(s.path)) !== key(s.path)) withParents(stageable, path.dirname(s.path));
        if (walked < MAX_WALK && fs.existsSync(s.path) && fs.statSync(s.path).isDirectory()) walk(s.path);
      } else if (isConflict(s.code) || s.code === 'N') {
        continue;
      } else if (this.isStaged(s.path)) {
        withParents(staged, s.path);
      } else {
        withParents(stageable, s.path);
      }
    }
    return { addable: [...addable], stageable: [...stageable], staged: [...staged], renamable };
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

module.exports = { Repository, baseUri, isInside, key, isPlainAdd };
