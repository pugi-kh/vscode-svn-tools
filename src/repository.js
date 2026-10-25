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

// p 또는 그 상위 폴더 중 하나가 keys(Set of key)에 있는가. 연 폴더(stopKey)에서 멈춘다.
// "목록 전체와 하나씩 비교"하면 무시 항목이 수천 개인 작업 사본에서 탐색기 표시가 파일마다 ms 단위로 느려진다(검토로 측정).
function hitAncestor(p, keys, stopKey) {
  if (keys.size === 0) return false;
  for (let cur = p; ;) {
    const k = key(cur);
    if (keys.has(k)) return true;
    if (k === stopKey) return false;
    const up = path.dirname(cur);
    if (up === cur) return false;
    cur = up;
  }
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
    this.folderKey = key(this.folder);
    // 조회용: 무시된 경로, 미등록 경로, 충돌 경로의 key
    this.ignoredKeys = new Set();
    this.unversionedKeys = new Set();
    this.conflictKeys = new Set();
    this.walkCache = new Map();  // 미등록 폴더 key → 그 안 항목의 VS Code 표기 목록(contextLists의 폴더 훑기 결과)
    this.lists = { addable: [], stageable: [], staged: [], renamable: [] };
    this.decoSig = '';
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
      // 미등록 폴더 안이 바뀌면 그 폴더의 훑기 결과를 버린다(다음 contextLists에서 다시 훑는다). 상위로 올라가며 찾는다.
      for (let cur = this.toReal(p); this.walkCache.size;) {
        this.walkCache.delete(key(cur));
        const up = path.dirname(cur);
        if (up === cur || key(cur) === this.folderKey) break;
        cur = up;
      }
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
    return hitAncestor(this.toReal(p), this.ignoredKeys, this.folderKey);
  }

  // 미등록 폴더 안의 항목도 미등록이다(svn status는 미등록 폴더 안으로 들어가지 않는다).
  isUnversioned(p) {
    return hitAncestor(this.toReal(p), this.unversionedKeys, this.folderKey);
  }

  isStaged(p) {
    const k = key(this.toReal(p));
    const s = this.statuses.get(k);
    return this.staged.has(k) || (!!s && isPlainAdd(s));
  }

  hasLocks() {
    return this.lockCount > 0;
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
    return this.conflictKeys.has(key(p.replace(LEFTOVER, '')));
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

  // 아직 적용할 수 있는 이름 바꾸기 기록(옛 경로는 누락, 새 경로는 미등록이거나 무시될 때만). 사용자가 그사이 직접 고쳤으면 없다.
  // 새 이름이 무시 규칙에 걸려도(base.txt → base.bak) 되돌리거나 적용할 수 있어야 한다.
  renameOf(p) {
    const r = this.renames.get(key(this.toReal(p)));
    const fresh = r && (this.isUnversioned(r.to) || this.statusOf(r.to) === 'I');
    return fresh && this.statusOf(r.from) === '!' ? r : undefined;
  }

  // 미등록 폴더 훑기 결과를 버린다. 파일 감시가 놓치는 변경(감시 제외 폴더, 네트워크 드라이브 등)이 있어서, 창으로 돌아올 때와
  // Refresh 명령에서는 다시 훑는다.
  forgetWalk() {
    this.walkCache.clear();
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
    this.lockCount = entries.filter((e) => e.lockToken).length;
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
    const keysOf = (pred) => new Set([...statuses.values()].filter(pred).map((s) => key(s.path)));
    const incomplete = keysOf((s) => s.code === 'N');
    for (const s of statuses.values()) if (s.code === '!' && hitAncestor(s.path, incomplete, this.folderKey)) s.code = 'N';
    this.statuses = statuses;
    this.ignored = ignored;
    this.ignoredKeys = new Set(ignored.map(key));
    this.unversionedKeys = keysOf((s) => s.code === '?');
    this.conflictKeys = keysOf((s) => isConflict(s.code));

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

  // 패널 그룹을 다시 나누고, 탐색기 메뉴 조건 목록(lists)과 탐색기 표시용 요약(decoSig)을 새로 만든다.
  // extension.js onRepoChange는 둘을 이전 값과 비교해 바뀐 것만 UI로 보낸다.
  render() {
    const staged = [];
    const changes = [];
    const unversioned = [];
    const conflicts = [];
    const fade = vscode.workspace.getConfiguration('svnTools').get('scm.fadeUnversioned', true);
    const state = (s, group) => this.resourceState(s.path, s.code, group, fade);
    const sig = [];
    for (const s of this.statuses.values()) {
      const isStaged = this.isStaged(s.path);
      sig.push(`${key(s.path)}|${s.code}|${isStaged ? 1 : 0}`);
      if (isConflict(s.code)) conflicts.push(state(s, 'conflicted'));
      else if (s.code === 'N') changes.push(state(s, 'incomplete'));
      else if (s.code === '?') unversioned.push(state(s, 'unversioned'));
      else if (isStaged) staged.push(state(s, 'staged'));
      else changes.push(state(s, 'changed'));
    }
    this.decoSig = sig.join('\n') + '\n#' + [...this.ignoredKeys].join('\n');
    this.lists = this.contextLists();
    const byPath = (a, b) => a.resourceUri.fsPath.localeCompare(b.resourceUri.fsPath);
    this.stagedGroup.resourceStates = staged.sort(byPath);
    this.changes.resourceStates = changes.sort(byPath);
    this.unversioned.resourceStates = unversioned.sort(byPath);
    this.conflicts.resourceStates = conflicts.sort(byPath);
    this.sourceControl.count = staged.length + changes.length + conflicts.length;
    this.onDidChange(this);
  }

  // contextValue: staged | changed | unversioned | conflicted | incomplete (메뉴 조건 scmResourceState에 쓴다)
  resourceState(p, code, group, fade) {
    const uri = vscode.Uri.file(this.toUi(p));
    const deleted = code === 'D' || code === '!';
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
    // 상위 폴더는 늘 통째로 들어가므로, 이미 들어간 폴더를 만나면 그 위도 들어 있다.
    const withParents = (set, p) => {
      for (let cur = p; isInside(cur, this.folder); cur = path.dirname(cur)) {
        const u = ui(cur);
        if (set.has(u)) break;
        set.add(u);
        if (key(cur) === this.folderKey || path.dirname(cur) === cur) break;
      }
    };
    // 미등록 폴더 안 훑기는 폴더별로 기억해 두고(walkCache), 그 안에서 파일 감시 이벤트가 나면 버린다.
    // 상한(MAX_WALK)에 걸려 덜 훑은 결과는 기억하지 않는다(다른 폴더가 줄어 여유가 생기면 다음에 다시 훑게).
    let walked = 0;
    let truncated = false;
    const walk = (dir, out) => {
      let names;
      try {
        names = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of names) {
        if (walked >= MAX_WALK) {
          truncated = true;
          return;
        }
        const p = path.join(dir, d.name);
        walked++;
        out.push(ui(p));
        if (d.isDirectory()) walk(p, out);
      }
    };
    const cache = new Map();
    for (const s of this.statuses.values()) {
      if (s.code === '?') {
        addable.add(ui(s.path));
        // 새 항목을 품은 관리 폴더에도 SVN Stage ▸가 뜨게 한다(스테이징하면 안의 새 항목은 add된다). 수정 파일을 품은 폴더와 같게.
        if (key(path.dirname(s.path)) !== key(s.path)) withParents(stageable, path.dirname(s.path));
        const k = key(s.path);
        let items = this.walkCache.get(k);
        let complete = !!items;
        if (items) {
          walked += items.length;
        } else {
          let isDir = false;
          try {
            isDir = fs.statSync(s.path).isDirectory();
          } catch {
            // 사라진 항목
          }
          if (!isDir) continue;
          items = [];
          truncated = walked >= MAX_WALK;
          if (!truncated) walk(s.path, items);
          complete = !truncated;
        }
        if (complete) cache.set(k, items);
        for (const u of items) addable.add(u);
      } else if (isConflict(s.code) || s.code === 'N') {
        continue;
      } else if (this.isStaged(s.path)) {
        withParents(staged, s.path);
      } else {
        withParents(stageable, s.path);
      }
    }
    this.walkCache = cache;
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

module.exports = { Repository, baseUri, isInside, key, isPlainAdd, hitAncestor };
