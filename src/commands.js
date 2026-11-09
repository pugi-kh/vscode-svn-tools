'use strict';
// 명령 처리. 탐색기 우클릭·Source Control 패널·명령 팔레트가 모두 여기로 들어온다.
const vscode = require('vscode');
const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');
const svn = require('./svn');
const ignore = require('./ignore');
const tortoise = require('./tortoise');
const conflict = require('./conflict');
const { t } = require('./i18n');
const { baseUri, isInside, key, isConflict, isPlainAdd } = require('./repository');
const { IgnoreView } = require('./ignoreView');
const { ReasonView } = require('./reasonView');
const { ColorView } = require('./colorView');
const { CommitView } = require('./commitView');

function createCommands(ctx) {
  // ---- 공통 ----

  // 명령마다 들어오는 인자 모양이 달라서 경로 목록 하나로 맞춘다.
  //   탐색기: (uri, uris[]) / 패널 파일: (state, state, ...) 또는 (state, states[])
  //   패널 그룹: (group) / 패널 상단: (sourceControl) / 커밋 탭 우클릭: ({ svnPath, ... }) / 팔레트: () → 열린 편집기 파일
  function toUris(args) {
    const [first, second] = args;
    if (first && typeof first.svnPath === 'string') return [vscode.Uri.file(first.svnPath)];
    if (first instanceof vscode.Uri) {
      if (Array.isArray(second) && second.length > 0 && second[0] instanceof vscode.Uri) return second;
      return [first];
    }
    if (first && first.resourceUri) {
      const states = [first, ...args.slice(1).flat()].filter((s) => s && s.resourceUri);
      return [...new Map(states.map((s) => [s.resourceUri.fsPath, s.resourceUri])).values()];
    }
    if (first && Array.isArray(first.resourceStates)) return first.resourceStates.map((s) => s.resourceUri);
    if (first && first.rootUri) return [first.rootUri];
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file') return [editor.document.uri];
    return [];
  }

  // svn에 넘길 경로는 디스크 표기(대소문자)로 맞춘다 — svn.realPath 설명 참고.
  function paths(args) {
    return toUris(args).map((u) => svn.realPath(u.fsPath));
  }

  // 명령이 다룬 저장소. 명령이 끝나면 이 저장소만 새로고침한다(작업 폴더가 여럿이어도 전부 돌리지 않게). 하나도 없으면 전부.
  // 명령마다 따로 모은다(AsyncLocalStorage) — 커밋 탭처럼 오래 떠 있는 명령이 다른 명령의 새로고침을 미루지 않게.
  const scope = new AsyncLocalStorage();
  const use = (repo) => {
    const used = scope.getStore();
    if (repo && used) used.add(repo);
    return repo;
  };

  function repoFor(p) {
    const repo = ctx.repositories().find((r) => r.contains(p));
    if (!repo) vscode.window.showWarningMessage(t('notWorkingCopy', p));
    return use(repo);
  }

  function repoOfArgs(args, list) {
    if (args[0] && args[0].rootUri) {
      const r = ctx.repositories().find((x) => x.sourceControl === args[0]);
      if (r) return use(r);
    }
    if (list.length === 0) {
      const repos = ctx.repositories();
      return repos.length === 1 ? repos[0] : undefined;
    }
    return repoFor(list[0]);
  }

  // 인자로 저장소를 알 수 없을 때(명령 팔레트) 저장소가 여럿이면 고르게 한다.
  async function pickRepo(args) {
    const repo = repoOfArgs(args, []);
    if (repo) return repo;
    const repos = ctx.repositories();
    if (repos.length === 0) return undefined;
    if (repos.length === 1) return use(repos[0]);
    const pick = await vscode.window.showQuickPick(repos.map((r) => ({ label: r.name, description: r.folder, repo: r })),
      { title: t('pickRepoTitle') });
    return use(pick && pick.repo);
  }

  function showError(e) {
    if (e && e.code === 'ENOENT') {
      vscode.window.showErrorMessage(t('svnNotFound'));
      return;
    }
    if (e && e.code === 'TOOLONG') {
      vscode.window.showWarningMessage(t('commandTooLong', e.count));
      return;
    }
    const text = (e && (e.stderr || e.message)) || String(e);
    ctx.output.appendLine(text);
    // 알림에는 오류 줄만 짧게 보인다. 전체는 출력 창(SVN Tools)에 있다.
    const short = text.split(/\r?\n/).filter((l) => /^svn: E\d+/.test(l)).join(' ') || text.split(/\r?\n/)[0];
    vscode.window.showErrorMessage(t('svnError', short));
  }

  async function step(title, fn) {
    return vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl, title: t('running', title) }, fn);
  }

  // 오류를 잡아 알리고, 끝나면 상태를 새로고침한다.
  function command(fn) {
    return (...args) => scope.run(new Set(), async () => {
      const used = scope.getStore();
      try {
        await fn(...args);
      } catch (e) {
        showError(e);
      } finally {
        const repos = [...used].filter((r) => ctx.repositories().includes(r));
        if (repos.length) repos.forEach((r) => r.refresh());
        else ctx.refreshAll();
      }
    });
  }

  // "다시 묻지 않음"을 누른 뒤 어디서 다시 켜는지 알린다.
  async function tellSettingOff(id) {
    const open = t('openSetting');
    if (await vscode.window.showInformationMessage(t('settingTurnedOff', id), open) === open) {
      vscode.commands.executeCommand('workbench.action.openSettings', id);
    }
  }

  async function confirm(message, yes, detail) {
    const pick = await vscode.window.showWarningMessage(message, { modal: true, detail }, yes);
    return pick === yes;
  }

  function isDir(p) {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }

  // ---- 커밋 ----

  // 커밋하려는 경로들의 상위 폴더 중 "새로 추가됐는데(A) 목록에 없는" 폴더. svn은 상위 폴더가 함께 커밋되지 않으면
  // 그 안의 항목을 올리지 못한다(E200009). 미등록(?) 상위 폴더도 함께 돌려준다(커밋 전에 add --parents로 추가된다).
  function newParents(repo, list) {
    const inList = new Set(list.map(key));
    const found = new Map();
    for (const p of list) {
      for (let cur = path.dirname(p); isInside(cur, repo.wcRoot) && key(cur) !== key(repo.wcRoot); cur = path.dirname(cur)) {
        const code = repo.statusOf(cur);
        const isNew = code === 'A' || code === 'R' || code === '?' || (code === undefined && repo.isUnversioned(cur));
        if (!isNew) break;
        if (!inList.has(key(cur))) found.set(key(cur), cur);
      }
    }
    return [...found.values()];
  }

  // 폴더 자신(변경이 있으면) + 그 아래 변경 항목 전부. 미등록 폴더를 add한 뒤 안의 새 항목을 커밋에 넣을 때 쓴다.
  function changedInside(repo, dir) {
    return [...repo.statuses.values()]
      .filter((s) => !['?', 'C', '~', 'N'].includes(s.code) && isInside(s.path, dir))
      .map((s) => s.path);
  }

  // 커밋에 함께 넣어야 하는 항목을 더 늘지 않을 때까지 모은다: 이동의 반대쪽(svn은 이동 양쪽을 한 커밋에 요구한다, E200009)과
  // 새 상위 폴더(withParents). 반대쪽의 상위 폴더가 또 이동된 폴더일 수 있어서 한 번으로 끝나지 않는다.
  // 반대쪽이 연 폴더 밖에 있어도 경로를 그대로 넣는다(같은 작업 사본이면 svn이 받는다).
  function closure(repo, list, withParents) {
    const out = new Map(list.map((p) => [key(p), p]));
    for (let grew = true; grew;) {
      grew = false;
      const add = (p) => {
        if (!out.has(key(p))) {
          out.set(key(p), p);
          grew = true;
        }
      };
      for (const p of [...out.values()]) {
        const pair = repo.movePair(p);
        if (pair) add(pair);
      }
      if (withParents) newParents(repo, [...out.values()]).forEach(add);
    }
    return [...out.values()];
  }

  // 커밋 탭에 보일 항목. 충돌·덜 받은 항목은 커밋할 수 없어 빼고 안내만 한다.
  // 이동(이름 바꾸기)은 새 경로 한 줄로 보이고, 옛 경로(D)는 커밋할 때 closure가 함께 넣는다.
  // requires: 이 항목을 올리려면 함께 올라가야 하는 새 상위 폴더(웹뷰가 자동으로 켠다).
  // def: 처음 체크 상태. 범위(scope, 탐색기에서 고른 것)가 없으면 관리 중인 변경 전부, 있으면 그 안의 것만.
  function commitItems(repo, scope) {
    const items = [];
    let skipped = 0;
    const NEW = ['A', 'R', '?'];
    for (const s of repo.statuses.values()) {
      if (isConflict(s.code) || s.code === 'N') {
        skipped++;
        continue;
      }
      if (s.code === '?' && repo.isLeftover(s.path)) continue;
      if (s.code === 'D' && s.movedTo && repo.entry(s.movedTo)) continue;
      const requires = [];
      for (let cur = path.dirname(s.path); repo.contains(cur) && key(cur) !== repo.folderKey; cur = path.dirname(cur)) {
        const e = repo.entry(cur);
        if (!e || !NEW.includes(e.code)) break;
        requires.push(cur);
      }
      const unversioned = s.code === '?';
      let def = !unversioned;
      if (scope) def = unversioned ? scope.some((sel) => isInside(sel, s.path)) : scope.some((sel) => isInside(s.path, sel));
      items.push({
        path: s.path,
        rel: path.relative(repo.folder, s.path) || '.',
        code: s.code,
        unversioned,
        dir: unversioned && isDir(s.path),
        props: s.code === 'M' && isDir(s.path),
        movedFrom: s.movedFrom ? path.relative(repo.folder, s.movedFrom) : undefined,
        renamable: unversioned && !!repo.renameOf(s.path),
        requires,
        def,
      });
    }
    return { items, note: skipped ? t('reviewSkippedNote', skipped) : '' };
  }

  // 커밋 탭을 연다. scope: 탐색기에서 고른 경로(그 안의 것만 처음에 체크). 없으면 변경 전부.
  async function openCommit(repo, scope) {
    await repo.refresh();
    const first = commitItems(repo, scope);
    if (first.items.length === 0 || (scope && !first.items.some((x) => x.def))) {
      return vscode.window.showInformationMessage(first.note || t('commitNothing'));
    }
    // 웹뷰가 고른 경로로 커밋할 경로를 정한다(상태는 CommitView가 방금 다시 읽었다).
    // 끈 항목이 남은 항목과 함께 올라가야 하면(이동 짝·새 상위 폴더) 조용히 넣지 않고 알린다.
    const validate = (paths) => {
      const shown = new Map(commitItems(repo, scope).items.map((x) => [key(x.path), x]));
      const chosen = paths.map((p) => shown.get(key(p))).filter(Boolean);
      if (chosen.length === 0) return { error: t('reviewNoItems') };
      const on = new Set(chosen.map((x) => key(x.path)));
      const all = closure(repo, chosen.map((x) => x.path), true);
      const revived = all.filter((p) => shown.has(key(p)) && !on.has(key(p)));
      if (revived.length) return { error: t('reviewRevived', revived.map((p) => path.relative(repo.folder, p) || p).join(', ')) };
      return { paths: all, add: chosen.filter((x) => x.unversioned).map((x) => x.path) };
    };
    const r = await CommitView.open(repo, { build: () => commitItems(repo, scope), validate });
    if (!r) return;
    let targets = r.paths;
    if (r.add.length) {
      // svn은 이름을 직접 준 항목이면 무시 규칙에 걸려 있어도 추가한다(테스트로 확인). --no-ignore를 붙이면
      // 고른 폴더 안의 무시 대상(__pycache__ 등)까지 전부 추가되므로 붙이지 않는다 — 안쪽은 무시 규칙을 따른다.
      await step('add', () => svn.exec(['add', '--force', '--parents', ...r.add], repo.folder));
      await repo.refresh();
      // 폴더를 add하면 안의 항목도 A가 된다. --depth empty 커밋은 폴더 자신만 올리므로 안의 항목을 넣는다.
      const inner = r.add.filter(isDir).flatMap((d) => changedInside(repo, d));
      targets = [...new Map([...targets, ...inner].map((p) => [key(p), p])).values()];
    }
    // 올릴 것이 연 폴더 안의 변경 전부면 작업 폴더 하나를 기본 깊이로 넘긴다(항목이 많아도 명령줄이 길어지지 않는다).
    // 잠근(svn lock) 파일이 있으면 폴더 커밋이 수정하지 않은 파일의 잠금까지 풀어서(검토로 재현) 항목별로 넘긴다.
    const chosen = new Set(targets.map(key));
    const covers = targets.every((p) => repo.contains(p))
      && [...repo.statuses.values()].every((s) => s.code === '?' || chosen.has(key(s.path)))
      && !repo.hasLocks();
    await commitPaths(repo, covers ? [repo.folder] : targets, r.message, !covers);
  }

  // 커밋. exact=true면 targets만 정확히(--depth empty) 올리고, false면 targets를 기본 깊이로 넘긴다(폴더는 하위 전체).
  // 누락 파일 처리 → 서버 변경 확인 → 커밋 순서.
  // 빈 메시지는 커밋 탭이 이미 확인을 받았다.
  async function commitPaths(repo, targets, message, exact) {
    const targetKeys = new Set(targets.map(key));
    const inScope = [...repo.statuses.values()]
      .filter((s) => (exact ? targetKeys.has(key(s.path)) : targets.some((p) => isInside(s.path, p))));
    const committable = inScope.filter((s) => s.code !== '?');
    // Update가 중간에 끊긴 폴더가 있으면 커밋하지 않는다(받지 못한 파일이 누락으로 보여 삭제가 커밋될 수 있다).
    const incomplete = committable.filter((s) => s.code === 'N');
    if (incomplete.length) {
      const locked = incomplete.some((s) => s.locked);
      vscode.window.showWarningMessage(t(locked ? 'commitIncompleteLocked' : 'commitIncomplete', incomplete.length));
      return false;
    }
    if (committable.length === 0) {
      vscode.window.showInformationMessage(t('commitNothing'));
      return false;
    }
    // svn은 충돌 상태 항목의 커밋을 거부한다(E155015). 해결 메뉴로 바로 이어 준다.
    const conflicted = committable.filter((s) => isConflict(s.code));
    if (conflicted.length) {
      const resolveNow = t('commitConflictsResolve');
      const pick = await vscode.window.showWarningMessage(t('commitConflicts', conflicted.length), resolveNow);
      if (pick === resolveNow) {
        const uris = conflicted.map((s) => vscode.Uri.file(s.path));
        await vscode.commands.executeCommand('svnTools.resolve', uris[0], uris);
      }
      return false;
    }
    // 누락(!)은 삭제로 예약해야 커밋된다. 커밋 탭에서 "누락 — 삭제로 커밋"을 보고 골랐으므로 다시 묻지 않는다.
    const missing = committable.filter((s) => s.code === '!');
    if (missing.length > 0) await svn.exec(['delete', ...missing.map((s) => s.path)], repo.folder);

    if (vscode.workspace.getConfiguration('svnTools').get('commit.checkOutOfDate', true)) {
      const outdated = await outOfDateCount(repo, targets);
      if (outdated > 0) {
        ctx.history.refresh(repo);  // 확인 창을 보는 동안 이력 칸에서 새 커밋을 볼 수 있게
        const updateFirst = t('outOfDateUpdateFirst');
        const anyway = t('outOfDateCommitAnyway');
        const pick = await vscode.window.showWarningMessage(t('outOfDateAsk', outdated), { modal: true }, updateFirst, anyway);
        if (!pick) return false;
        if (pick === updateFirst) {
          await runUpdate(repo, targets);
          await repo.refresh();
          if ([...repo.statuses.values()].some((s) => isConflict(s.code))) {
            vscode.window.showWarningMessage(t('updateConflicts', repo.conflicts.label));
            return false;
          }
        }
      }
    }

    // 메시지는 -m 인자로 넘긴다(-F + --encoding은 한글 경로를 깨뜨린다, svn.js의 exec 설명 참고).
    // --force-log: 메시지가 우연히 파일 경로와 같아도 svn이 거부하지 않게 한다.
    const depth = exact ? ['--depth', 'empty'] : [];
    const { stdout } = await step('commit', () =>
      svn.exec(['commit', '-m', message, '--force-log', ...depth, ...targets], repo.folder));
    ctx.output.appendLine(stdout);
    repo.draft = '';
    const rev = svn.lastRevision(stdout);
    vscode.window.showInformationMessage(rev ? t('commitDone', rev) : t('commitDoneNoRev'));
    ctx.history.refresh(repo);
    return true;
  }

  async function outOfDateCount(repo, targets) {
    try {
      const { stdout } = await step('status -u', () => svn.exec(['status', '-u', '--xml', ...targets], repo.folder));
      return svn.parseStatus(stdout).filter((e) => e.reposItem && e.reposItem !== 'none' && e.reposItem !== 'normal').length;
    } catch (e) {
      vscode.window.showWarningMessage(t('outOfDateCheckFailed', (e.stderr || e.message).split(/\r?\n/)[0]));
      return 0;
    }
  }

  async function runUpdate(repo, targets) {
    const { stdout } = await step('update', () => svn.exec(['update', ...targets], repo.folder));
    ctx.output.appendLine(stdout);
    ctx.history.refresh(repo);
    return stdout;
  }

  // ---- 비교·열기 ----

  async function diffBase(uri) {
    const p = svn.realPath(uri.fsPath);
    const repo = repoFor(p);
    if (!repo) return;
    if (isDir(p)) return showTextDiff(repo, [p]);
    const code = repo.statusOf(p);
    if (code === '?' || code === 'A' || code === 'I') {
      vscode.window.showInformationMessage(t('diffNotVersioned'));
      return;
    }
    if (code === 'D' || code === '!') {
      await vscode.window.showTextDocument(baseUri(p, 'BASE'), { preview: true });
      return;
    }
    await vscode.commands.executeCommand('vscode.diff', baseUri(p, 'BASE'), uri, t('diffBase', path.basename(p)));
  }

  // 폴더 비교는 svn diff 텍스트를 diff 문서로 보여 준다. rev를 주면 그 리비전과 작업본을 비교한다.
  async function showTextDiff(repo, targets, rev) {
    const { stdout } = await svn.exec(['diff', ...(rev ? ['-r', String(rev)] : []), ...targets], repo.folder);
    const doc = await vscode.workspace.openTextDocument({ content: stdout || '(no changes)', language: 'diff' });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  // 리비전 지정 비교: 맨 위 "직접 입력", 그 아래 최근 로그. 고른 리비전과 작업본을 비교한다.
  const REV_PATTERN = /^(\d+|HEAD|BASE|COMMITTED|PREV|\{[^}]+\})$/i;

  async function diffRevision(uri) {
    const p = svn.realPath(uri.fsPath);
    const repo = repoFor(p);
    if (!repo) return;
    const entries = await step('log', () => fetchLog(repo, p)).catch(() => []);
    const enter = { label: `$(edit) ${t('diffRevEnter')}`, enter: true };
    const items = entries.map((e) => ({
      label: `r${e.revision}`,
      description: `${e.author}  ${e.date.replace('T', ' ').slice(0, 16)}`,
      detail: e.message.split(/\r?\n/)[0],
      rev: String(e.revision),
    }));
    const pick = await vscode.window.showQuickPick([enter, ...items], {
      title: t('diffRevPickTitle', path.basename(p)), matchOnDescription: true, matchOnDetail: true,
    });
    if (!pick) return;
    let rev = pick.rev;
    if (pick.enter) {
      rev = await vscode.window.showInputBox({
        prompt: t('diffRevPrompt'),
        validateInput: (v) => (REV_PATTERN.test(v.trim()) ? undefined : t('diffRevInvalid')),
      });
      if (!rev) return;
      rev = rev.trim();
    }
    if (isDir(p)) return showTextDiff(repo, [p], rev);
    await vscode.commands.executeCommand('vscode.diff', baseUri(p, rev), vscode.Uri.file(p),
      t('diffRevWorking', path.basename(p), rev));
  }

  // ---- 추가(svn add) ----
  //   withContents: 폴더 안의 항목까지 추가할지(탐색기 SVN Add ▸에서 고른다).

  async function addItems(repo, list, withContents) {
    if (list.length === 0) return vscode.window.showWarningMessage(t('noSelection'));
    await repo.refresh();

    const ignoredSel = list.filter((p) => repo.statusOf(p) === 'I');
    if (ignoredSel.length) {
      vscode.window.showInformationMessage(t('addIgnoredSkipped', ignoredSel.map((p) => path.basename(p)).join(', ')));
      list = list.filter((p) => !ignoredSel.includes(p));
      if (list.length === 0) return;
    }

    // svn 없이 이름을 바꾼 항목이면 새 파일로 추가할지, SVN 이름 바꾸기로 적용할지 묻는다.
    const renamed = list.map((p) => repo.renameOf(p)).filter(Boolean);
    if (renamed.length) {
      const apply = t('renameDetectedApply');
      const asNew = t('renameAddAsNew');
      const detail = renamed.map((r) => `${path.relative(repo.folder, r.from)} → ${path.relative(repo.folder, r.to)}`).join('\n');
      const pick = await vscode.window.showWarningMessage(t('renameAddAsk', renamed.length), { modal: true, detail }, apply, asNew);
      if (!pick) return;
      if (pick === apply) {
        for (const r of renamed) await applyRename(repo, r);
        await repo.refresh();
        list = list.filter((p) => !renamed.some((r) => key(r.to) === key(p)));
      } else {
        renamed.forEach((r) => repo.forgetRename(r.to));
      }
    }

    // 미등록 항목을 추가한다. 폴더는 하위 포함 여부에 따라 깊이를 정한다. --parents로 미등록 상위 폴더도 함께(폴더 자신만).
    // 이미 관리 중인 폴더를 하위 포함으로 고르면 그 안의 미등록 항목도 추가한다.
    // 관리 중인 폴더는 폴더째 svn add --force 하지 않는다 — keep-local로 삭제 예약한(D) 항목까지 다시 추가돼 교체(R)가 된다.
    // status에 미등록(?)으로 나온 항목만 골라 넘긴다. 충돌 부산물(파일.mine 등)은 뺀다.
    list = list.filter((p) => !repo.isLeftover(p));
    const toAdd = list.filter((p) => repo.isUnversioned(p));
    const versionedDirs = withContents ? list.filter((p) => !toAdd.includes(p) && isDir(p)) : [];
    const inside = [...repo.statuses.values()]
      .filter((s) => s.code === '?' && versionedDirs.some((d) => isInside(s.path, d)) && !repo.isLeftover(s.path))
      .map((s) => s.path);
    if (toAdd.length + inside.length === 0) return vscode.window.showInformationMessage(t('addNothing'));
    // svn은 이름을 직접 준 항목이면 무시 규칙에 걸려 있어도 추가한다. --no-ignore를 붙이면 폴더 안의 무시 대상까지 추가된다.
    const depth = withContents ? [] : ['--depth', 'empty'];
    if (toAdd.length) await step('add', () => svn.exec(['add', ...depth, '--force', '--parents', ...toAdd], repo.folder));
    if (inside.length) await step('add', () => svn.exec(['add', '--force', ...inside], repo.folder));
    vscode.window.setStatusBarMessage(t('addDone', toAdd.length + inside.length), 3000);
  }

  // 탐색기·패널 인자에서 저장소와 경로를 꺼낸다(패널 그룹 버튼이면 그 그룹의 항목 전부).
  function repoAndPaths(args) {
    const list = paths(args);
    const repo = repoOfArgs(args, list);
    return { repo, list };
  }

  // SVN에서 삭제. keepLocal: 로컬 파일을 남길지(메뉴에서 고른다, 설정은 두지 않는다).
  async function deleteItems(args, keepLocal) {
    const list = paths(args);
    if (list.length === 0) return vscode.window.showWarningMessage(t('noSelection'));
    const repo = repoFor(list[0]);
    if (!repo) return;
    const unversioned = list.filter((p) => ['?', 'I'].includes(repo.statusOf(p)));
    const versioned = list.filter((p) => !unversioned.includes(p));

    if (versioned.length > 0) {
      const ask = keepLocal ? t('deleteAskKeep', versioned.length) : t('deleteAskLocal', versioned.length);
      if (await confirm(ask, keepLocal ? t('deleteYesKeep') : t('deleteYesLocal'), versioned.map((p) => path.basename(p)).join('\n'))) {
        // --force: 수정·추가 상태도 뺀다. 로컬 유지면 파일은 그대로 남는다.
        const flags = keepLocal ? ['--keep-local', '--force'] : ['--force'];
        await step('delete', () => svn.exec(['delete', ...flags, ...versioned], repo.folder));
        vscode.window.showInformationMessage(keepLocal ? t('deleteDoneKeep') : t('deleteDoneLocal'));
      }
    }
    if (unversioned.length > 0) {
      if (keepLocal) {
        vscode.window.showInformationMessage(t('deleteUnversionedKeep', unversioned.map((p) => path.basename(p)).join(', ')));
      } else if (await confirm(t('deleteUnversionedLocalAsk', unversioned.length), t('deleteYes'))) {
        for (const p of unversioned) {
          await vscode.workspace.fs.delete(vscode.Uri.file(p), { recursive: true, useTrash: true });
        }
      }
    }
  }

  async function openChange(uri) {
    const repo = repoFor(uri.fsPath);
    if (!repo) return;
    const code = repo.statusOf(uri.fsPath);
    if (code === 'M' || code === 'R' || code === 'C') return diffBase(uri);
    if (code === 'D' || code === '!') return vscode.window.showTextDocument(baseUri(svn.realPath(uri.fsPath), 'BASE'), { preview: true });
    return vscode.window.showTextDocument(uri, { preview: true });
  }

  // ---- 충돌 ----

  // VS Code 병합 편집기(3-way). 공개 API가 없어 git 확장과 같은 내부 명령을 쓴다 — 없어지면 마커가 든 파일을 연다.
  async function openMergeEditor(file, text, repo) {
    const sides = conflict.mergeSides(text);
    const name = path.basename(file);
    const input = (p, title, detail) => ({ uri: vscode.Uri.file(p), title, description: path.basename(p), detail });
    const rev = (r) => (r ? `r${r}` : undefined);
    try {
      await vscode.commands.executeCommand('_open.mergeEditor', {
        base: vscode.Uri.file(sides.base),
        input1: input(sides.mine, t('mergeMine'), sides.swapped ? undefined : t('mergeWorkingCopy')),
        input2: input(sides.theirs, t('mergeTheirs'), sides.swapped ? undefined : rev(text.rightRev)),
        output: vscode.Uri.file(file),
      });
    } catch (e) {
      ctx.output.appendLine(`_open.mergeEditor: ${e && e.message}`);
      await vscode.window.showTextDocument(vscode.Uri.file(file));
      vscode.window.showWarningMessage(t('mergeEditorFailed'));
      return;
    }
    // 병합 편집기의 [병합 완료] 버튼은 git만 붙일 수 있다(제안 API). 해결 표시는 이 알림과, 알림이 묻혀도 보이는
    // 상태 표시줄·편집기 제목줄 버튼(markResolved, extension.js)으로 한다.
    const done = t('mergeMarkResolved');
    if (await vscode.window.showInformationMessage(t('mergeEditorOpened', name), done) === done) await markResolvedFile(repo, file);
  }

  // 저장 안 했으면 저장하고, 충돌 표시가 남았으면 한 번 더 묻고, svn resolve --accept working.
  async function markResolvedFile(repo, file) {
    const name = path.basename(file);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && key(svn.realPath(d.uri.fsPath)) === key(file));
    if (doc && doc.isDirty) await doc.save();
    if (conflict.hasMarkers(fs.readFileSync(file, 'utf8')) && !(await confirm(t('mergeMarkersLeft', name), t('mergeResolveAnyway')))) return;
    await step('resolve', () => svn.exec(['resolve', '--accept', 'working', file], repo.folder));
    vscode.window.showInformationMessage(t('resolveDone'));
  }

  // 지금 보고 있는 파일. 병합 편집기 탭이면 결과 파일(TabInputTextMerge.result).
  function activeFileUri() {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = tab && tab.input;
    if (input instanceof vscode.TabInputTextMerge) return input.result;
    if (input instanceof vscode.TabInputText) return input.uri;
    const editor = vscode.window.activeTextEditor;
    return editor && editor.document.uri;
  }

  // 모든 작업 폴더의 충돌 파일에서 고른다(여러 개 가능, 한 저장소 안에서). 없으면 알리고 undefined.
  async function pickConflicts() {
    const items = [];
    for (const r of ctx.repositories()) {
      await r.refresh();
      for (const s of r.statuses.values()) {
        if (!isConflict(s.code)) continue;
        items.push({ label: path.basename(s.path), description: path.relative(r.folder, path.dirname(s.path)) || r.name, repo: r, path: s.path });
      }
    }
    if (items.length === 0) {
      vscode.window.showInformationMessage(t('resolveNoConflicts'));
      return undefined;
    }
    const picks = items.length === 1 ? items : await vscode.window.showQuickPick(items, { title: t('resolvePickTitle'), canPickMany: true });
    if (!picks || picks.length === 0) return undefined;
    const repo = picks[0].repo;
    return { repo, files: picks.filter((p) => p.repo === repo).map((p) => p.path) };
  }

  // 로컬 미등록 파일 + 서버에서 추가된 같은 이름 파일(conflict.isLocalAdd)
  async function resolveLocalAdd(files, repo) {
    const name = files.length === 1 ? path.basename(files[0]) : t('itemsCount', files.length);
    const pick = await vscode.window.showQuickPick([
      { label: t('localAddKeep'), detail: t('localAddKeepDetail'), keep: true },
      { label: t('localAddTake'), detail: t('localAddTakeDetail'), take: true },
      { label: t('resolveTortoise'), tortoise: true },
    ], { title: t('localAddTitle', name) });
    if (!pick) return;
    if (pick.tortoise) {
      tortoise.open('conflicteditor', files, () => ctx.refreshAll());
      return;
    }
    if (pick.keep) {
      await step('resolve', async () => {
        for (const f of files) await conflict.keepLocal(f, repo.folder);
      });
      if (files.length === 1) {
        await vscode.commands.executeCommand('vscode.diff', baseUri(files[0], 'BASE'), vscode.Uri.file(files[0]),
          t('diffBase', path.basename(files[0])));
      }
      vscode.window.showInformationMessage(t('localAddKept'));
      return;
    }
    if (!await confirm(t('localAddTakeAsk', name), t('localAddTakeYes'))) return;
    const trash = (f) => vscode.workspace.fs.delete(vscode.Uri.file(f), { useTrash: true });
    await step('resolve', async () => {
      for (const f of files) await conflict.takeIncoming(f, repo.folder, trash);
    });
    vscode.window.showInformationMessage(t('localAddTaken'));
  }

  // ---- 로그 ----

  async function fetchLog(repo, p, olderThan) {
    const args = ['log', '--xml', '-l', '50'];
    if (olderThan) args.push('-r', `${olderThan - 1}:1`);
    const { stdout } = await svn.exec([...args, p], repo.folder);
    return svn.parseLog(stdout);
  }

  async function showLog(uri) {
    const p = svn.realPath(uri.fsPath);
    const repo = repoFor(p);
    if (!repo) return;
    let entries = await step('log', () => fetchLog(repo, p));
    if (entries.length === 0) {
      vscode.window.showInformationMessage(t('logEmpty'));
      return;
    }
    const more = { label: `$(ellipsis) ${t('logMore')}`, more: true };
    for (;;) {
      const items = entries.map((e) => ({
        label: `r${e.revision}`,
        description: `${e.author}  ${e.date.replace('T', ' ').slice(0, 16)}`,
        detail: e.message.split(/\r?\n/)[0],
        entry: e,
      }));
      const pick = await vscode.window.showQuickPick(entries.length % 50 === 0 ? [...items, more] : items, {
        title: t('logTitle', path.basename(p)), matchOnDescription: true, matchOnDetail: true,
      });
      if (!pick) return;
      if (pick.more) {
        const older = await fetchLog(repo, p, entries[entries.length - 1].revision);
        if (older.length === 0) return;
        entries = entries.concat(older);
        continue;
      }
      const index = entries.indexOf(pick.entry);
      const prev = entries[index + 1] ? entries[index + 1].revision : pick.entry.revision - 1;
      await logAction(repo, p, pick.entry, prev);
      return;
    }
  }

  async function logAction(repo, p, entry, prev) {
    const file = !isDir(p);
    const actions = [];
    if (file) {
      actions.push({ label: t('logActionDiffWorking'), id: 'working' });
      actions.push({ label: t('logActionDiffChange', prev, entry.revision), id: 'change' });
    }
    actions.push({ label: t('logActionShowDetails'), id: 'details' });
    actions.push({ label: t('logActionCopyMessage'), id: 'copy' });
    const pick = await vscode.window.showQuickPick(actions, { title: t('logActionTitle', entry.revision) });
    if (!pick) return;
    const name = path.basename(p);
    if (pick.id === 'working') {
      await vscode.commands.executeCommand('vscode.diff', baseUri(p, entry.revision), vscode.Uri.file(p),
        t('diffRevWorking', name, entry.revision));
    } else if (pick.id === 'change') {
      await vscode.commands.executeCommand('vscode.diff', baseUri(p, prev), baseUri(p, entry.revision),
        t('diffRevs', name, prev, entry.revision));
    } else if (pick.id === 'details') {
      const { stdout } = await svn.exec(['log', '--xml', '-v', '-r', String(entry.revision), p], repo.folder);
      const [full] = svn.parseLog(stdout);
      const e = full || entry;
      const lines = [`r${e.revision} | ${e.author} | ${e.date}`, '', ...e.paths.map((x) => `  ${x.action} ${x.path}`), '', e.message];
      const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n') });
      await vscode.window.showTextDocument(doc, { preview: true });
    } else if (pick.id === 'copy') {
      await vscode.env.clipboard.writeText(entry.message);
    }
  }

  // ---- svn 없이 바꾼 이름을 SVN 이름 바꾸기로 적용 ----
  // 파일은 이미 새 이름에 있다. 원래 이름으로 되돌린 뒤 svn move 한다(TortoiseSVN의 Repair Move와 같은 방식).
  // svn move가 실패하면 사용자의 이름 바꾸기가 사라지지 않게 다시 새 이름으로 돌려놓는다.
  async function applyRename(repo, { from, to }) {
    // 오래 떠 있던 알림을 늦게 눌렀을 수 있다 — 아직 "옛 이름 누락 + 새 이름 미등록"인지 다시 본다(호출하는 쪽이 새로고침한 뒤).
    if (!repo.renameOf(to)) throw new Error(t('renameRepairStale', path.basename(to)));
    if (fs.existsSync(from)) throw new Error(t('renameRepairExists', path.basename(from)));
    if (!fs.existsSync(to)) throw new Error(t('renameRepairGone', path.basename(to)));
    if (vscode.workspace.textDocuments.some((d) => d.isDirty && d.uri.scheme === 'file' && isInside(repo.toReal(d.uri.fsPath), to))) {
      throw new Error(t('renameRepairDirty', path.basename(to)));
    }
    fs.renameSync(to, from);
    try {
      // --parents: 새 위치의 상위 폴더가 미등록이면 함께 추가한다.
      await step('move', () => svn.exec(['move', '--parents', from, to], repo.folder));
    } catch (e) {
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
      throw e;
    }
    repo.forgetRename(to);
  }

  // 의도하지 않은 이름 바꾸기를 되돌린다. 편집기 탭도 따라오도록 VS Code의 이름 바꾸기(WorkspaceEdit)로 한다.
  // 이때 다시 이름 바꾸기 이벤트가 오지만, 새 이름 쪽은 svn이 모르는 경로라 onRenamed가 건너뛴다.
  async function undoRename(repo, { from, to }) {
    if (!repo.renameOf(to)) throw new Error(t('renameRepairStale', path.basename(to)));
    if (fs.existsSync(from)) throw new Error(t('renameRepairExists', path.basename(from)));
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(vscode.Uri.file(repo.toUi(to)), vscode.Uri.file(repo.toUi(from)));
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error(t('renameUndoFailed', path.basename(to)));
    repo.forgetRename(to);
  }

  // 경로들 중 관리 중인 것(key Set). svn info는 관리 대상이 아닌 것이 섞이면 경고 후 실패로 끝나지만, 나머지 결과는 stdout에 나온다.
  // 수백 개면 명령줄 길이 제한(함정 12)에 걸리지 않게 100개씩 나눠 묻는다.
  async function versionedOf(repo, list) {
    const found = new Set();
    for (let i = 0; i < list.length; i += 100) {
      let out;
      try {
        out = (await svn.exec(['info', '--xml', ...list.slice(i, i + 100)], repo.folder)).stdout;
      } catch (e) {
        if (e.code === 'ENOENT') return found;
        out = e.stdout || '';
      }
      for (const p of svn.parseInfoPaths(out)) found.add(key(p));
    }
    return found;
  }

  async function onRenamed(e) {
    const found = [];
    const candidates = [];
    for (const f of e.files) {
      if (f.oldUri.scheme !== 'file' || f.newUri.scheme !== 'file') continue;
      const to = svn.realPath(f.newUri.fsPath);
      const repo = ctx.repositories().find((r) => r.contains(to));
      if (!repo) continue;
      const from = svn.realPath(f.oldUri.fsPath);
      // 대소문자만 바뀐 경우는 svn move가 거부하고, 상태 표에서 두 경로를 구분하지 못해 다루지 않는다(TortoiseSVN Rename을 쓴다).
      if (!repo.contains(from) || key(from) === key(to)) continue;
      // 적용하기 전에 또 바꿨으면(A→B→C) 처음 이름(A)에 이어 붙인다. 처음 이름으로 되돌렸으면 기록만 지운다.
      const prev = repo.renameRecord(from);
      if (prev) {
        repo.forgetRename(from);
        if (key(prev.from) === key(to)) continue;
        repo.recordRename(prev.from, to);
        found.push({ repo, from: prev.from, to });
        continue;
      }
      // 이미 아는 상태로 먼저 거른다. 변경 목록에 있으면 관리 중, 미등록·무시 폴더 안이면 관리 대상이 아니다.
      // 나머지(변경 없는 관리 파일)는 아래에서 svn info 한 번으로 모아 확인한다(리팩터로 수십 개를 바꿔도 하나씩 부르지 않게).
      const known = repo.entry(from);
      if (known ? known.code === '?' : (repo.isUnversioned(from) || repo.isIgnored(from))) continue;
      candidates.push({ repo, from, to, known: !!known });
    }
    for (const repo of new Set(candidates.map((c) => c.repo))) {
      const mine = candidates.filter((c) => c.repo === repo);
      const versioned = await versionedOf(repo, mine.filter((c) => !c.known).map((c) => c.from));
      for (const c of mine) {
        if (!c.known && !versioned.has(key(c.from))) continue;
        repo.recordRename(c.from, c.to);
        found.push(c);
      }
    }
    if (found.length === 0) return;
    const touched = [...new Set(found.map((x) => x.repo))];
    touched.forEach((r) => r.refresh());
    const config = vscode.workspace.getConfiguration('svnTools');
    if (!config.get('rename.askOnRename', true)) return;
    // 작업을 막지 않는 알림으로 묻는다(여러 파일을 한꺼번에 바꾸는 리팩터 중에도 끊기지 않게). 닫으면 "이번엔 안 함"이고,
    // 놓쳐도 우클릭 SVN Apply Rename으로 다시 할 수 있다.
    const apply = t('renameDetectedApply');
    const undo = t('renameUndo');
    const never = t('renameDetectedNever');
    const msg = found.length === 1
      ? t('renameDetectedAsk', path.basename(found[0].from), path.basename(found[0].to))
      : t('renameDetectedAskMany', found.length);
    const pick = await vscode.window.showInformationMessage(msg, apply, undo, never);
    if (pick === never) {
      await config.update('rename.askOnRename', false, vscode.ConfigurationTarget.Global);
      tellSettingOff('svnTools.rename.askOnRename');
    }
    if (pick !== apply && pick !== undo) return;
    try {
      for (const r of new Set(found.map((x) => x.repo))) await r.refresh();
      for (const r of found) await (pick === apply ? applyRename(r.repo, r) : undoRename(r.repo, r));
      vscode.window.showInformationMessage(pick === apply ? t('renameRepairDone') : t('renameUndoDone'));
    } catch (err) {
      showError(err);
    } finally {
      touched.forEach((r) => r.refresh());
    }
  }

  // ---- 명령 표 ----

  return {
    onRenamed,

    // 탐색기 우클릭 "SVN 이름 바꾸기로 적용": 기록해 둔 이름 바꾸기(옛 이름 → 새 이름)를 확인 후 적용한다.
    applyRename: command(async (...args) => {
      const list = paths(args);
      const repo = list.length ? repoFor(list[0]) : undefined;
      if (!repo) return;
      await repo.refresh();
      const found = list.map((p) => repo.renameOf(p)).filter(Boolean);
      if (found.length === 0) return vscode.window.showInformationMessage(t('renameRepairNone'));
      const detail = found.map((r) => `${path.relative(repo.folder, r.from)} → ${path.relative(repo.folder, r.to)}`).join('\n');
      const apply = t('renameDetectedApply');
      const undo = t('renameUndo');
      const pick = await vscode.window.showWarningMessage(t('renameRepairAsk', found.length), { modal: true, detail }, apply, undo);
      if (!pick) return;
      for (const r of found) await (pick === apply ? applyRename(repo, r) : undoRename(repo, r));
      vscode.window.showInformationMessage(pick === apply ? t('renameRepairDone') : t('renameUndoDone'));
    }),

    refresh: command(async () => ctx.rescanAll()),

    // 패널 ✓ / 팔레트: 커밋 탭을 연다(변경 전부 체크).
    commitAll: command(async (sc) => {
      const repo = await pickRepo([sc]);
      if (!repo) return;
      await openCommit(repo);
    }),

    // 탐색기 SVN ▸ Commit…: 고른 것(폴더면 그 안의 것)만 체크한 커밋 탭을 연다.
    commit: command(async (...args) => {
      const list = paths(args);
      const repo = repoOfArgs(args, list);
      if (repo) await openCommit(repo, list.length ? list : undefined);
    }),

    update: command(async (...args) => {
      const list = paths(args);
      const repo = repoOfArgs(args, list);
      if (!repo) return;
      const out = await runUpdate(repo, list.length ? list : [repo.folder]);
      await repo.refresh();
      if ([...repo.statuses.values()].some((s) => s.code === 'C' || s.code === '~')) {
        vscode.window.showWarningMessage(t('updateConflicts', repo.conflicts.label));
      } else {
        const rev = svn.lastRevision(out);
        vscode.window.showInformationMessage(rev ? t('updateDone', rev) : t('updateDoneNoRev'));
      }
    }),

    diff: command(async (...args) => {
      const uris = toUris(args);
      if (uris.length === 0) return vscode.window.showWarningMessage(t('noSelection'));
      for (const u of uris) await diffBase(u);
    }),

    diffRevision: command(async (...args) => {
      const [uri] = toUris(args);
      if (!uri) return vscode.window.showWarningMessage(t('noSelection'));
      await diffRevision(uri);
    }),

    openChange: command(async (uri) => openChange(uri)),

    openFile: command(async (...args) => {
      for (const u of toUris(args)) {
        if (!fs.existsSync(u.fsPath)) vscode.window.showInformationMessage(t('openFileMissing', path.basename(u.fsPath)));
        else if (!isDir(u.fsPath)) await vscode.window.showTextDocument(u, { preview: false });
      }
    }),

    revert: command(async (...args) => {
      const list = paths(args);
      if (list.length === 0) return vscode.window.showWarningMessage(t('noSelection'));
      const repo = repoFor(list[0]);
      if (!repo) return;
      await repo.refresh();
      // 이동은 양쪽을 함께 되돌린다 — 이동된 쪽(A +)만 되돌리면 파일이 지워지고, 원래 쪽(D)만 되돌리면 복사가 된다.
      const targets = closure(repo, list, false);
      const notes = [list.some(isDir) && t('revertAskFolder'), targets.length > list.length && t('revertPairNote', targets.length - list.length)];
      const detail = notes.filter(Boolean).join('\n') || undefined;
      if (!(await confirm(t('revertAsk', list.length), t('revertYes'), detail))) return;
      await step('revert', () => svn.exec(['revert', '--depth', 'infinity', ...targets], repo.folder));
    }),

    // 그룹의 항목은 svn status가 하나씩 나열한 것이라 각자 자기만 되돌린다(--depth empty). 그래야 속성만 바뀐 폴더를 되돌릴 때
    // 그 아래 수정까지 날아가지 않는다. 단 추가·교체·삭제된 폴더는 svn이 자식 없이 되돌리지 못해(E155038) 폴더째(infinity)
    // 되돌린다. 이동은 양쪽을 함께 되돌린다.
    revertAll: command(async (group) => {
      const list = (group && group.resourceStates ? group.resourceStates : []).map((s) => svn.realPath(s.resourceUri.fsPath));
      if (list.length === 0) return;
      const repo = repoFor(list[0]);
      if (!repo) return;
      await repo.refresh();
      const targets = closure(repo, list, false);
      const deep = targets.filter((p) => ['A', 'R', 'D'].includes(repo.statusOf(p)) && (isDir(p) || repo.statusOf(p) === 'D'));
      const shallow = targets.filter((p) => !deep.includes(p));
      if (!(await confirm(t('revertAllAsk', list.length), t('revertYes')))) return;
      if (deep.length) await step('revert', () => svn.exec(['revert', '--depth', 'infinity', ...deep], repo.folder));
      if (shallow.length) await step('revert', () => svn.exec(['revert', '--depth', 'empty', ...shallow], repo.folder));
    }),

    // 새 파일 추가(파일 하나는 바로, 폴더는 하위 포함·제외를 메뉴에서 고른다). 패널 +는 하위 포함.
    add: command(async (...args) => { const { repo, list } = repoAndPaths(args); if (repo) await addItems(repo, list, true); }),
    addInclude: command(async (...args) => { const { repo, list } = repoAndPaths(args); if (repo) await addItems(repo, list, true); }),
    addExclude: command(async (...args) => { const { repo, list } = repoAndPaths(args); if (repo) await addItems(repo, list, false); }),

    // 추가 취소(사용자 요청): 일반 add만 svn revert로 되돌린다. 파일은 남고 다시 미등록이 된다.
    // 새 폴더는 안의 add도 함께 취소된다(svn이 자식 없이 폴더만 되돌리지 못한다, E155038).
    // 복사·이동으로 생긴 A(+)는 revert하면 작업 파일이 지워지므로 빼고, 그런 항목을 품은 새 폴더도 뺀다.
    undoAdd: command(async (...args) => {
      const { repo, list } = repoAndPaths(args);
      if (!repo) return;
      await repo.refresh();
      const plain = list.filter((p) => { const e = repo.entry(p); return !!e && isPlainAdd(e); });
      const hasCopied = (dir) => [...repo.statuses.values()].some((s) => s.copied && isInside(s.path, dir));
      const blocked = plain.filter(hasCopied);
      if (blocked.length) vscode.window.showWarningMessage(t('undoAddBlockedCopied', blocked.map((p) => path.basename(p)).join(', ')));
      const targets = plain.filter((p) => !blocked.includes(p));
      if (targets.length === 0) {
        if (!blocked.length) vscode.window.showInformationMessage(t('undoAddNone'));
        return;
      }
      await step('revert', () => svn.exec(['revert', '--depth', 'infinity', ...targets], repo.folder));
      vscode.window.setStatusBarMessage(t('undoAddDone', targets.length), 3000);
    }),

    // 미등록 그룹 버튼. 팔레트에서는 그룹 없이 들어와 저장소를 고른다.
    addAll: command(async (group) => {
      const repo = group && group.resourceStates ? undefined : await pickRepo([]);
      const states = repo ? repo.unversioned.resourceStates : (group && group.resourceStates) || [];
      const list = states.map((s) => svn.realPath(s.resourceUri.fsPath));
      if (list.length === 0) return vscode.window.showInformationMessage(t('addNothing'));
      const target = repo || repoFor(list[0]);
      if (target) await addItems(target, list, true);
    }),

    deleteKeepLocal: command(async (...args) => deleteItems(args, true)),
    deleteLocal: command(async (...args) => deleteItems(args, false)),

    rename: command(async (...args) => {
      const [uri] = toUris(args);
      if (!uri) return vscode.window.showWarningMessage(t('noSelection'));
      const p = svn.realPath(uri.fsPath);
      const repo = repoFor(p);
      if (!repo) return;
      if (['?', 'I'].includes(repo.statusOf(p))) return vscode.window.showWarningMessage(t('renameUnversioned'));
      const name = path.basename(p);
      const dot = isDir(p) ? -1 : name.lastIndexOf('.');
      const next = await vscode.window.showInputBox({
        prompt: t('renamePrompt'), value: name, valueSelection: [0, dot > 0 ? dot : name.length],
      });
      if (!next || !next.trim()) return;
      if (next === name) return vscode.window.showInformationMessage(t('renameSame'));
      const target = path.join(path.dirname(p), next.trim());
      // svn 1.14 명령줄은 대소문자만 바꾸는 이동을 거부한다(E155010). TortoiseSVN Rename은 된다.
      if (target.toLowerCase() === p.toLowerCase()) return vscode.window.showWarningMessage(t('renameCaseOnly'));
      if (fs.existsSync(target)) return vscode.window.showWarningMessage(t('renameExists', next));
      await step('move', () => svn.exec(['move', p, target], repo.folder));
      vscode.window.showInformationMessage(t('renameDone'));
    }),

    // 여러 개를 골랐으면 패턴(이름·확장자)은 항목마다 만들고, 폴더 속성은 각 항목의 상위 폴더에 건다.
    ignore: command(async (...args) => {
      const list = paths(args);
      if (list.length === 0) return vscode.window.showWarningMessage(t('noSelection'));
      const repo = repoFor(list[0]);
      if (!repo) return;
      await repo.refresh();
      // 이미 관리 중인 항목은 svn이 무시 규칙을 적용하지 않는다 — 빼고 알린다.
      const inRepo = list.filter((p) => repo.contains(p));
      const versioned = inRepo.filter((p) => !repo.isUnversioned(p) && repo.statusOf(p) !== 'I');
      if (versioned.length) vscode.window.showInformationMessage(t('ignoreVersionedSkipped', versioned.map((p) => path.basename(p)).join(', ')));
      const items = inRepo.filter((p) => !versioned.includes(p));
      if (items.length === 0) return;
      // 공백: svn:ignore는 한 줄에 패턴 하나라 이름 그대로 쓴다. global-ignores(폴더 속성·내 PC 전역)는 공백으로 패턴을 나눠서
      // 공백을 ?(아무 한 글자)로 바꿔 같은 이름에 맞게 한다. 그래서 패턴은 적용 범위를 고른 뒤에 정한다.
      const names = items.map((p) => path.basename(p));
      const exts = items.map((p) => (!isDir(p) && path.extname(p) ? `*${path.extname(p)}` : undefined));
      const one = items.length === 1;
      const short = (arr) => [...new Set(arr)].join(', ');
      const whatItems = [{ label: one ? t('ignoreWhatName', names[0]) : t('ignoreWhatNames', short(names)), by: 'name' }];
      if (exts.every(Boolean)) whatItems.push({ label: one ? t('ignoreWhatExt', exts[0]) : t('ignoreWhatExts', short(exts)), by: 'ext' });
      whatItems.push({ label: t('ignoreWhatCustom'), by: 'custom' });
      const what = await vscode.window.showQuickPick(whatItems, { title: t('ignoreWhatTitle') });
      if (!what) return;
      let custom;
      if (what.by === 'custom') {
        custom = await vscode.window.showInputBox({ prompt: t('ignoreCustomPrompt'), value: one ? names[0] : '' });
        if (!custom || !custom.trim()) return;
        custom = custom.trim();
      }

      // 상위 폴더별로 항목을 모은다.
      const byParent = new Map();
      items.forEach((p, i) => {
        const dir = path.dirname(p);
        const entry = byParent.get(key(dir)) || { dir, index: [] };
        entry.index.push(i);
        byParent.set(key(dir), entry);
      });
      const parents = [...byParent.values()];
      const parentLabel = parents.length === 1
        ? path.relative(repo.folder, parents[0].dir) || path.basename(repo.folder)
        : t('ignoreParentsEach', parents.length);
      const kinds = [
        { label: t('ignoreKindIgnore', parentLabel), description: t('ignoreKindIgnoreDesc'), prop: 'svn:ignore' },
        { label: t('ignoreKindGlobal', parentLabel), description: t('ignoreKindGlobalDesc'), prop: 'svn:global-ignores' },
      ];
      if (parents.some((x) => key(x.dir) !== key(repo.folder))) {
        kinds.push({ label: t('ignoreKindGlobalRoot', repo.name), description: t('ignoreKindGlobalDesc'), prop: 'svn:global-ignores', root: true });
      }
      const localTarget = ignore.localWriteTarget() === 'userFile' ? t('sourceUserFile') : t('targetUserRegistry');
      kinds.push({ label: t('ignoreKindLocal'), description: t('ignoreKindLocalDesc', localTarget), local: true });
      const kind = await vscode.window.showQuickPick(kinds, { title: t('ignoreKindTitle') });
      if (!kind) return;

      const spaced = kind.prop === 'svn:ignore';
      if (!spaced && custom && /\s/.test(custom)) {
        const replace = t('ignoreSpaceReplace');
        const pick = await vscode.window.showWarningMessage(t('ignoreSpaceGlobal', custom), { modal: true }, replace);
        if (pick !== replace) return;
        custom = custom.replace(/\s/g, '?');
      }
      const patternOf = (i) => {
        if (what.by === 'ext') return exts[i];
        if (what.by === 'custom') return custom;
        return spaced ? names[i] : names[i].replace(/\s/g, '?');
      };
      const all = [...new Set(items.map((_, i) => patternOf(i)))];

      if (kind.local) {
        const added = ignore.addToLocal(all);
        vscode.window.showInformationMessage(added ? t('ignoreDoneLocal', all.join(' ')) : t('ignoreAlready', all.join(' ')));
        return;
      }
      const targets = kind.root
        ? [{ dir: repo.folder, patterns: all }]
        : parents.map((x) => ({ dir: x.dir, patterns: x.index.map(patternOf) }));
      // 상위 폴더가 미등록이면 속성을 걸 수 없다 — 그 폴더만 빼고 나머지에는 적용한다.
      const unversioned = targets.filter((x) => repo.statusOf(x.dir) === 'I' || repo.isUnversioned(x.dir));
      if (unversioned.length) {
        vscode.window.showWarningMessage(t('ignoreUnversionedParent', unversioned.map((x) => path.relative(repo.folder, x.dir) || x.dir).join(', ')));
      }
      const usable = targets.filter((x) => !unversioned.includes(x));
      if (usable.length === 0) return;
      let added = 0;
      for (const x of usable) added += await ignore.addToProp(kind.prop, x.dir, x.patterns);
      const where = usable.map((x) => path.basename(x.dir)).join(', ');
      vscode.window.showInformationMessage(added ? t('ignoreDoneProp', `${kind.prop} (${where})`, all.join(', ')) : t('ignoreAlready', all.join(', ')));
    }),

    // 무시된 원인 보기. 원인 규칙을 카드로 보여 주고 고칠 수 있는 규칙은 거기서 지운다(reasonView.js).
    ignoreReason: command(async (...args) => {
      const [p] = paths(args);
      if (!p) return vscode.window.showWarningMessage(t('noSelection'));
      const repo = repoFor(p);
      if (!repo) return;
      await repo.refresh();
      if (!repo.ignored.some((ig) => isInside(p, ig))) {
        return vscode.window.showInformationMessage(t('unignoreNotIgnored', path.basename(p)));
      }
      ReasonView.show(repo, p, () => ctx.refreshAll());
    }),

    // 무시 목록 편집 화면. 폴더에서 열면 그 폴더, 파일에서 열면 그 파일의 폴더를 먼저 보여 준다.
    editIgnores: command(async (...args) => {
      const list = paths(args);
      const repo = repoOfArgs(args, list);
      if (!repo) return;
      const target = list[0];
      const focusDir = target && repo.contains(target) ? (isDir(target) ? target : path.dirname(target)) : undefined;
      IgnoreView.show(repo, focusDir, () => ctx.refreshAll());
    }),

    // 상태 색 편집 화면(colorView.js). 설정 화면에는 색 고르기 입력이 없다.
    editColors: command(async () => ColorView.show()),

    // SVN 이력 뷰(historyView.js)의 제목줄·항목 메뉴
    historyRefresh: command(async () => ctx.history.refresh()),
    historyCopyMessage: command(async (node) => ctx.history.copyMessage(node)),

    // svn 명령줄 도구 설치(svnSetup.js). svn이 없을 때의 알림을 닫았어도 팔레트에서 다시 할 수 있게.
    setupSvn: command(async () => ctx.setupSvn()),

    log: command(async (...args) => {
      const list = toUris(args);
      const repo = repoOfArgs(args, list.map((u) => u.fsPath));
      const uri = list[0] || (repo && vscode.Uri.file(repo.folder));
      if (!uri) return vscode.window.showWarningMessage(t('noSelection'));
      await showLog(uri);
    }),

    // 해결됨으로 표시: 상태 표시줄·편집기 제목줄 버튼(인자 uri), 팔레트(인자 없음 → 지금 보고 있는 파일, 병합 편집기면 결과 파일).
    markResolved: command(async (arg) => {
      const uri = arg instanceof vscode.Uri ? arg : activeFileUri();
      if (!uri || uri.scheme !== 'file') return vscode.window.showInformationMessage(t('resolveNone'));
      const p = svn.realPath(uri.fsPath);
      const repo = repoFor(p);
      if (!repo) return;
      await repo.refresh();
      if (!isConflict(repo.statusOf(p))) return vscode.window.showInformationMessage(t('resolveNone'));
      await markResolvedFile(repo, p);
    }),

    // 지금 보고 있는 파일(병합 편집기면 결과 파일)이 충돌 중이면 그 파일 경로. 상태 표시줄 버튼에 쓴다(extension.js).
    activeConflict: () => {
      const uri = activeFileUri();
      if (!uri || uri.scheme !== 'file') return undefined;
      const repo = ctx.repositories().find((r) => r.contains(uri.fsPath));
      return repo && isConflict(repo.statusOf(uri.fsPath)) ? uri : undefined;
    },

    // 명령 팔레트에서는 인자 없이 들어온다: 열린 편집기 파일이 충돌이면 그 파일, 아니면 충돌 파일 목록에서 고른다.
    resolve: command(async (...args) => {
      const fromPalette = !args[0];
      const list = paths(args);
      let repo = list.length ? ctx.repositories().find((r) => r.contains(list[0])) : undefined;
      if (!repo && !fromPalette) return list.length ? repoFor(list[0]) : vscode.window.showWarningMessage(t('noSelection'));
      // 부산물(파일.mine, 파일.r12)을 골랐으면 원래 충돌 파일로 바꾼다
      const owners = repo ? list.map((p) => repo.leftoverOwner(p) || p) : [];
      let conflicted = [...new Map(owners.map((p) => [key(p), p])).values()].filter((p) => isConflict(repo.statusOf(p)));
      if (conflicted.length === 0 && fromPalette) {
        const picked = await pickConflicts();
        if (!picked) return;
        ({ repo, files: conflicted } = picked);
      }
      use(repo);
      if (conflicted.length === 0) return vscode.window.showInformationMessage(t('resolveNone'));
      const details = await conflict.read(conflicted, repo.folder);
      if (details.every(conflict.isLocalAdd)) return resolveLocalAdd(conflicted, repo);
      const text = conflicted.length === 1 && details[0] && details[0].text;
      const options = [
        ...(text ? [{ label: t('resolveMergeEditor'), merge: true }] : []),
        {
          label: t('resolveWorking'), accept: 'working',
          // 로컬 미등록 + 서버 추가 충돌은 working으로 해결하면 삭제 예약(D)이 남는다(conflict.isLocalAdd).
          ...(details.some(conflict.isLocalAdd) ? { description: t('resolveWorkingDeletes') } : {}),
        },
        { label: t('resolveMineFull'), accept: 'mine-full' },
        { label: t('resolveTheirsFull'), accept: 'theirs-full' },
        { label: t('resolveMineConflict'), accept: 'mine-conflict' },
        { label: t('resolveTheirsConflict'), accept: 'theirs-conflict' },
        { label: t('resolveTortoise'), tortoise: true },
      ];
      const pick = await vscode.window.showQuickPick(options, { title: t('resolveTitle') });
      if (!pick) return;
      if (pick.merge) return openMergeEditor(conflicted[0], text, repo);
      if (pick.tortoise) {
        tortoise.open('conflicteditor', conflicted, () => ctx.refreshAll());
        return;
      }
      await step('resolve', () => svn.exec(['resolve', '--accept', pick.accept, ...conflicted], repo.folder));
      vscode.window.showInformationMessage(t('resolveDone'));
    }),

    cleanup: command(async (...args) => {
      const list = paths(args);
      const repo = repoOfArgs(args, list);
      if (!repo) return;
      // cleanup은 작업 사본 전체에 걸리는 잠금을 푸는 것이라 작업 사본 루트에서 돌린다.
      await step('cleanup', () => svn.exec(['cleanup', repo.wcRoot], repo.wcRoot));
      vscode.window.showInformationMessage(t('cleanupDone'));
    }),

    copyUrl: command(async (...args) => {
      const [uri] = toUris(args);
      if (!uri) return vscode.window.showWarningMessage(t('noSelection'));
      const p = svn.realPath(uri.fsPath);
      const { stdout } = await svn.exec(['info', '--xml', p], path.dirname(p));
      let { url } = svn.parseInfo(stdout);
      if (!url) return;
      // svn은 한글을 %XX로 인코딩해 준다. 사람이 읽게 풀어서 복사한다(svn도 풀린 주소를 받는다).
      try {
        url = decodeURI(url);
      } catch {
        // 풀 수 없는 주소면 그대로 쓴다.
      }
      await vscode.env.clipboard.writeText(url);
      vscode.window.showInformationMessage(t('copyUrlDone', url));
    }),

    // TortoiseSVN 창. 창이 닫히면 상태를 새로고침한다.
    tortoise: (name) => (...args) => {
      let list = paths(args);
      if (list.length === 0) {
        const repo = repoOfArgs(args, list);
        if (repo) list = [repo.folder];
      }
      // TortoiseSVN 창에서 커밋·업데이트했을 수 있어 이력도 다시 읽는다
      tortoise.open(name, list, () => {
        ctx.refreshAll();
        ctx.history.refresh();
      });
    },
  };
}

module.exports = { createCommands };
