'use strict';
// 명령 처리. 탐색기 우클릭·Source Control 패널·명령 팔레트가 모두 여기로 들어온다.
const vscode = require('vscode');
const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');
const svn = require('./svn');
const ignore = require('./ignore');
const tortoise = require('./tortoise');
const { t } = require('./i18n');
const { baseUri, isInside, key, isPlainAdd, hitAncestor } = require('./repository');
const { IgnoreView } = require('./ignoreView');
const { ReasonView } = require('./reasonView');
const { ColorView } = require('./colorView');
const { CommitView } = require('./commitView');

function createCommands(ctx) {
  // ---- 공통 ----

  // 명령마다 들어오는 인자 모양이 달라서 경로 목록 하나로 맞춘다.
  //   탐색기: (uri, uris[]) / 패널 파일: (state, state, ...) 또는 (state, states[])
  //   패널 그룹: (group) / 패널 상단: (sourceControl) / 팔레트: () → 열린 편집기 파일
  function toUris(args) {
    const [first, second] = args;
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
  // 명령마다 따로 모은다(AsyncLocalStorage) — 커밋 확인 탭처럼 오래 떠 있는 명령이 다른 명령의 새로고침을 미루지 않게.
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

  async function askMessage(repo) {
    const preset = repo ? repo.sourceControl.inputBox.value : '';
    return vscode.window.showInputBox({ prompt: t('commitInputPrompt'), value: preset, ignoreFocusOut: true });
  }

  // 커밋하려는 경로들의 상위 폴더 중 "새로 추가됐는데(A) 목록에 없는" 폴더. svn은 상위 폴더가 함께 커밋되지 않으면
  // 그 안의 항목을 올리지 못한다(E200009). 미등록(?) 상위 폴더도 함께 돌려준다(스테이징할 때 add --parents로 추가된다).
  function newParents(repo, list) {
    const inList = new Set(list.map(key));
    const found = new Map();
    for (const p of list) {
      for (let cur = path.dirname(p); isInside(cur, repo.wcRoot) && key(cur) !== key(repo.wcRoot); cur = path.dirname(cur)) {
        const code = repo.statusOf(cur);
        const isNew = code === 'A' || code === '?' || (code === undefined && repo.isUnversioned(cur));
        if (!isNew) break;
        if (!inList.has(key(cur))) found.set(key(cur), cur);
      }
    }
    return [...found.values()];
  }

  // 폴더를 "하위 항목 포함"으로 정확히 커밋·스테이징할 때: 폴더 자신(변경이 있으면) + 그 아래 변경 항목 전부.
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

  // 커밋. exact=true면 targets만 정확히(--depth empty) 올리고, false면 targets를 기본 깊이로 넘긴다(폴더는 하위 전체).
  // 누락 파일 처리 → 서버 변경 확인 → 커밋 순서.
  // committed: 커밋 뒤 스테이징에서 뺄 경로(작업 폴더 하나로 커밋할 때는 targets와 다르다)
  async function commitPaths(repo, targets, message, exact, committed = targets) {
    if (!message || !message.trim()) {
      vscode.window.showWarningMessage(t('commitEmptyMessage'));
      return false;
    }
    // 상태는 부르는 쪽(review)이 방금 다시 읽었다.
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
    const conflicted = committable.filter((s) => s.code === 'C' || s.code === '~');
    if (conflicted.length) {
      const resolveNow = t('commitConflictsResolve');
      const pick = await vscode.window.showWarningMessage(t('commitConflicts', conflicted.length), resolveNow);
      if (pick === resolveNow) {
        const uris = conflicted.map((s) => vscode.Uri.file(s.path));
        await vscode.commands.executeCommand('svnTools.resolve', uris[0], uris);
      }
      return false;
    }
    const missing = committable.filter((s) => s.code === '!');
    if (missing.length > 0) {
      if (!(await confirm(t('commitMissingAsk', missing.length), t('commitMissingYes')))) return false;
      await svn.exec(['delete', ...missing.map((s) => s.path)], repo.folder);
    }

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
          if ([...repo.statuses.values()].some((s) => s.code === 'C' || s.code === '~')) {
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
    repo.sourceControl.inputBox.value = '';
    repo.unstage(committed);
    const rev = svn.lastRevision(stdout);
    vscode.window.showInformationMessage(rev ? t('commitDone', rev) : t('commitDoneNoRev'));
    ctx.history.refresh(repo);
    return true;
  }

  // 커밋 직전 확인. 설정(svnTools.commit.review)이 켜져 있으면 커밋 확인 탭, 꺼져 있으면 메시지 입력과 "함께 올라갈 항목" 확인 창.
  //   plan(): 지금 상태로 { picked(올리려고 고른 항목), extras(함께 올라가야 하는 항목 — 탭에서 끌 수 없다) }를 만든다.
  //   탭의 [커밋]을 누르면 상태를 다시 읽고 plan()을 다시 만들어 검증한다(탭을 연 사이 밖에서 바뀐 것을 커밋하지 않게).
  //   반환: { message, paths, all(고른 것을 하나도 빼지 않았는지) } 또는 취소면 undefined
  async function review(repo, message, plan) {
    let current = plan();
    if (vscode.workspace.getConfiguration('svnTools').get('commit.review', true)) {
      const itemsOf = ({ picked, extras }) => [
        ...picked.map((p) => ({ path: p, code: repo.statusOf(p) || '', locked: false, pair: repo.movePair(p) })),
        ...extras.map((p) => ({ path: p, code: repo.statusOf(p) || '', locked: true })),
      ];
      const sameList = (a, b) => a.length === b.length && a.every((x, i) => key(x) === key(b[i]));
      let all = true;
      const validate = async (checked) => {
        await repo.refresh();
        const fresh = plan();
        if (!sameList(fresh.picked, current.picked) || !sameList(fresh.extras, current.extras)) {
          current = fresh;
          if (fresh.picked.length === 0) return { error: t('reviewNothingNow'), items: [] };
          return { error: t('reviewChanged'), items: itemsOf(fresh) };
        }
        const on = new Set(checked.map(key));
        const pickedOn = current.picked.filter((p) => on.has(key(p)));
        if (pickedOn.length === 0) return { error: t('reviewNoItems') };
        all = pickedOn.length === current.picked.length;
        if (all) return { paths: [...current.picked, ...current.extras] };
        // 끈 항목이 남은 항목과 함께 올라가야 하는 것(이동의 반대쪽, 새 상위 폴더)이면 뺄 수 없다 — 조용히 넣지 않고 알린다.
        // 잠긴 항목은 남은 것 기준으로 다시 모은다(필요 없어진 새 상위 폴더가 혼자 올라가지 않게).
        const paths = closure(repo, pickedOn, true);
        const off = new Set(current.picked.filter((p) => !on.has(key(p))).map(key));
        const revived = paths.filter((p) => off.has(key(p)));
        if (revived.length) return { error: t('reviewRevived', revived.map((p) => path.relative(repo.folder, p) || p).join(', ')) };
        return { paths };
      };
      const res = await CommitView.open(repo, message, itemsOf(current), validate);
      if (!res) return undefined;
      return { message: res.message, paths: res.paths, all };
    }
    if (!message.trim()) message = await askMessage(repo);
    if (message === undefined) return undefined;
    await repo.refresh();
    current = plan();
    if (current.picked.length === 0) {
      vscode.window.showInformationMessage(t('commitNothing'));
      return undefined;
    }
    if (current.extras.length) {
      const detail = current.extras.map((p) => path.relative(repo.folder, p) || p).join('\n');
      if (!(await confirm(t('commitParentsAsk', current.extras.length), t('commitParentsYes'), detail))) return undefined;
    }
    return { message, paths: [...current.picked, ...current.extras], all: true };
  }

  // 스테이징된 것만 커밋한다.
  async function commitStaged(repo, message) {
    const plan = () => {
      const picked = repo.stagedPaths();
      return { picked, extras: closure(repo, picked, true).slice(picked.length) };
    };
    const r = await review(repo, message, plan);
    if (!r) return;
    repo.stage(r.paths.filter((p) => repo.contains(p) && !repo.isStaged(p)));
    // 올릴 것이 연 폴더 안의 변경 전부면 작업 폴더 하나를 기본 깊이로 넘긴다(항목이 많아도 명령줄이 길어지지 않는다).
    // 판단은 review가 방금 다시 읽은 상태로 한다. 잠근(svn lock) 파일이 있으면 폴더 커밋이 수정하지 않은 파일의 잠금까지
    // 풀어서(검토로 재현) 항목별로 넘긴다.
    const chosen = new Set(r.paths.map(key));
    const covers = r.paths.every((p) => repo.contains(p))
      && [...repo.statuses.values()].every((s) => s.code === '?' || chosen.has(key(s.path)))
      && !repo.hasLocks();
    await commitPaths(repo, covers ? [repo.folder] : r.paths, r.message, !covers, r.paths);
  }

  // 탐색기 우클릭 SVN ▸ Commit…: 고른 것만 바로 커밋(스테이징을 거치지 않는다).
  //   미등록·무시된 항목을 골랐으면 함께 추가할지 묻고, 새 상위 폴더가 있으면 각 폴더 자신만 함께 올린다.
  async function quickCommit(args) {
    let list = paths(args);
    const repo = repoOfArgs(args, list);
    if (!repo) return;
    if (list.length === 0) list = [repo.folder];
    await repo.refresh();
    // 미등록 항목은 고른 것 자체가 미등록일 때만 뜻이 있다(관리 폴더 안의 미등록 파일만으로는 커밋할 것이 없다).
    const listKeys = new Set(list.map(key));
    const hasChange = [...repo.statuses.values()].some((s) => s.code !== '?' && hitAncestor(s.path, listKeys, ''));
    if (!hasChange && !list.some((p) => repo.isUnversioned(p) || repo.statusOf(p) === 'I')) {
      return vscode.window.showInformationMessage(t('commitNothing'));
    }

    const notVersioned = list.filter((p) => repo.isUnversioned(p) || repo.statusOf(p) === 'I');
    if (notVersioned.length) {
      const addYes = t('quickCommitAddYes');
      const without = t('quickCommitWithout');
      const detail = notVersioned.map((p) => path.relative(repo.folder, p) || p).join('\n');
      const pick = await vscode.window.showWarningMessage(t('quickCommitUnversionedAsk', notVersioned.length),
        { modal: true, detail }, addYes, without);
      if (!pick) return;
      if (pick === addYes) {
        // svn은 이름을 직접 준 항목이면 무시 규칙에 걸려 있어도 추가한다(테스트로 확인). --no-ignore를 붙이면
        // 고른 폴더 안의 무시 대상(__pycache__ 등)까지 전부 추가되므로 붙이지 않는다 — 안쪽은 무시 규칙을 따른다.
        await step('add', () => svn.exec(['add', '--force', '--parents', ...notVersioned], repo.folder));
        await repo.refresh();
      } else {
        list = list.filter((p) => !notVersioned.includes(p));
        if (list.length === 0) return;
      }
    }

    // 고른 것(폴더면 그 안의 변경까지)과 함께 올라가야 할 항목(새 상위 폴더, 이동의 반대쪽)이 고른 범위 밖에 있으면 함께 넣는다.
    // 그대로면 고른 경로를 기본 깊이로 넘기고, 범위 밖 항목이 끼거나 탭에서 뺀 항목이 있으면 경로를 모두 풀어 --depth empty로 넘긴다.
    let extrasNow = [];
    const plan = () => {
      const inner = new Map(list.map((p) => [key(p), p]));
      for (const p of list) if (isDir(p)) for (const c of changedInside(repo, p)) inner.set(key(c), c);
      const full = closure(repo, [...inner.values()], true);
      extrasNow = full.filter((p) => !list.some((l) => isInside(p, l)));
      const picked = [...inner.values()].filter((p) => !['?', 'I', undefined].includes(repo.statusOf(p)));
      return { picked, extras: extrasNow };
    };
    const r = await review(repo, repo.sourceControl.inputBox.value, plan);
    if (!r) return;
    // 잠근 파일이 있으면 폴더째 넘기지 않는다 — 폴더 커밋은 그 아래 수정하지 않은 파일의 잠금까지 푼다.
    if (r.all && extrasNow.length === 0 && !repo.hasLocks()) await commitPaths(repo, list, r.message, false);
    else await commitPaths(repo, r.paths, r.message, true);
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

  // ---- 스테이징 ----
  //   미등록 항목: svn add 후 스테이징 / 누락(!): svn delete 후 스테이징 / 그 밖의 변경: 스테이징만.
  //   withContents: 폴더 안의 항목까지 포함할지. undefined면 폴더가 있을 때 물어본다(패널의 + 버튼).
  //   새 상위 폴더(미등록이거나 추가됐는데 스테이징 안 된 것)가 있으면 안내하고, 승인하면 각 폴더 자신만 함께 스테이징한다.

  async function chooseContents(list) {
    if (!list.some(isDir)) return true;
    const include = { label: t('stageIncludeContents'), value: true };
    const exclude = { label: t('stageExcludeContents'), value: false };
    const pick = await vscode.window.showQuickPick([include, exclude], { title: t('stagePickTitle') });
    return pick ? pick.value : undefined;
  }

  // 스테이징·취소는 저장소별로 하나씩 차례로 처리한다(+를 빠르게 연달아 눌러도 앞 작업이 끝난 상태를 보고 진행한다).
  const queues = new Map();
  function serial(repo, fn) {
    const prev = queues.get(repo) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    queues.set(repo, run);
    return run;
  }

  function stageItems(repo, list, withContents) {
    return serial(repo, () => doStage(repo, list, withContents));
  }

  function unstageItems(repo, list) {
    return serial(repo, () => doUnstage(repo, list));
  }

  async function doStage(repo, list, withContents) {
    if (list.length === 0) return vscode.window.showWarningMessage(t('noSelection'));
    if (withContents === undefined) withContents = await chooseContents(list);
    if (withContents === undefined) return;
    await repo.refresh();

    const ignoredSel = list.filter((p) => repo.statusOf(p) === 'I');
    if (ignoredSel.length) {
      vscode.window.showInformationMessage(t('stageIgnoredSkipped', ignoredSel.map((p) => path.basename(p)).join(', ')));
      list = list.filter((p) => !ignoredSel.includes(p));
      if (list.length === 0) return;
    }

    const parents = newParents(repo, list).filter((p) => !repo.isStaged(p));
    if (parents.length) {
      const detail = parents.map((p) => path.relative(repo.folder, p) || p).join('\n');
      if (!(await confirm(t('stageParentsAsk', parents.length), t('stageParentsYes'), detail))) return;
    }

    // 0) svn 없이 이름을 바꾼 항목이면 새 파일로 추가할지, SVN 이름 바꾸기로 적용할지 묻는다.
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
      } else {
        renamed.forEach((r) => repo.forgetRename(r.to));
      }
    }

    // 1) 미등록 항목은 추가한다. 폴더는 하위 포함 여부에 따라 깊이를 정한다. --parents로 미등록 상위 폴더도 함께(폴더 자신만).
    //    이미 관리 중인 폴더를 하위 포함으로 고르면 그 안의 미등록 항목도 추가한다(git add 폴더와 같다).
    //    관리 중인 폴더는 폴더째 svn add --force 하지 않는다 — keep-local로 삭제 예약한(D) 항목까지 다시 추가돼 교체(R)가 된다.
    //    status에 미등록(?)으로 나온 항목만 골라 넘긴다. 충돌 부산물(파일.mine 등)은 뺀다.
    list = list.filter((p) => !repo.isLeftover(p));
    const toAdd = list.filter((p) => repo.isUnversioned(p));
    const versionedDirs = withContents ? list.filter((p) => !toAdd.includes(p) && isDir(p)) : [];
    const inside = [...repo.statuses.values()]
      .filter((s) => s.code === '?' && versionedDirs.some((d) => isInside(s.path, d)) && !repo.isLeftover(s.path))
      .map((s) => s.path);
    const depth = withContents ? [] : ['--depth', 'empty'];
    if (toAdd.length) await step('add', () => svn.exec(['add', ...depth, '--force', '--parents', ...toAdd], repo.folder));
    if (inside.length) await step('add', () => svn.exec(['add', '--force', ...inside], repo.folder));
    // 2) 누락 파일은 삭제로 예약한다(그래야 커밋된다).
    const missing = list.filter((p) => repo.statusOf(p) === '!');
    if (missing.length) await step('delete', () => svn.exec(['delete', ...missing], repo.folder));
    await repo.refresh();

    // 3) 스테이징할 경로: 고른 항목, 하위 포함 폴더의 변경 전부, 상위 폴더.
    const set = new Map();
    for (const p of [...parents, ...list]) set.set(key(p), p);
    if (withContents) for (const p of list) if (isDir(p)) for (const c of changedInside(repo, p)) set.set(key(c), c);
    // 이동이면 반대쪽도 함께 스테이징한다(한쪽만으로는 커밋이 거부된다).
    const stageable = closure(repo, [...set.values()], false).filter((p) => {
      const code = repo.statusOf(p);
      return repo.contains(p) && code && !['?', 'I', 'C', '~', 'N'].includes(code);
    });
    if (stageable.length === 0) return vscode.window.showInformationMessage(t('stageNothing'));
    repo.stage(stageable);
    vscode.window.setStatusBarMessage(t('stageDone', stageable.length), 3000);
  }

  // 스테이징 취소: 새로 추가한(A) 항목은 추가도 취소하고(svn revert, 파일은 남음), 그 밖의 항목은 스테이징만 뺀다.
  // 폴더를 고르면 그 아래 스테이징된 항목 전부가 대상이다.
  async function doUnstage(repo, list) {
    await repo.refresh();
    const inList = repo.stagedPaths().filter((s) => list.some((p) => isInside(s, p)));
    const all = closure(repo, inList, false).filter((p) => repo.isStaged(p));
    if (all.length === 0) return vscode.window.showInformationMessage(t('unstageNothing'));
    // 일반 add는 add 취소(svn revert, 파일은 남음). 폴더는 하위 add까지 함께 취소된다(svn이 자식 없이 폴더만 되돌리지 못한다).
    // 복사·이동으로 들어온 항목(A +)은 revert하면 파일이 지워지므로 스테이징만 뺀다. 그런 항목을 품은 새 폴더는 add 취소를 거부한다.
    const isAddedEntry = (p) => { const e = repo.entry(p); return !!e && isPlainAdd(e); };
    const hasCopiedInside = (dir) => [...repo.statuses.values()].some((s) => s.copied && isInside(s.path, dir));
    const blocked = all.filter((p) => isAddedEntry(p) && hasCopiedInside(p));
    if (blocked.length) vscode.window.showWarningMessage(t('unstageBlockedCopied', blocked.map((p) => path.basename(p)).join(', ')));
    const listed = all.filter((p) => !blocked.some((b) => isInside(p, b)));
    const added = listed.filter(isAddedEntry);
    if (listed.length === 0) return;
    repo.unstage(listed);
    if (added.length) await step('revert', () => svn.exec(['revert', '--depth', 'infinity', ...added], repo.folder));
    vscode.window.setStatusBarMessage(added.length ? t('unstageDoneAdded', listed.length, added.length) : t('unstageDone', listed.length), 3000);
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

    // 패널 ✓ / Ctrl+Enter. 스테이징된 것만 커밋한다. 스테이징이 비었으면 git처럼 "모두 스테이징하고 커밋할지" 묻는다
    // (svnTools.commit.smartCommit: ask / always / never).
    commitAll: command(async (sc) => {
      const repo = await pickRepo([sc]);
      if (!repo) return;
      await repo.refresh();
      // 커밋할 것이 하나도 없으면 확인 창을 거치지 않고 바로 알린다(미등록 항목은 커밋 대상이 아니다).
      if (!repo.stagedPaths().length && ![...repo.statuses.values()].some((s) => s.code !== '?')) {
        return vscode.window.showInformationMessage(t('commitNothing'));
      }
      if (!repo.stagedPaths().length) {
        const config = vscode.workspace.getConfiguration('svnTools');
        let mode = config.get('commit.smartCommit', 'ask');
        if (mode === 'ask') {
          const yes = t('noStagedYes');
          const always = t('noStagedAlways');
          const never = t('noStagedNever');
          const pick = await vscode.window.showWarningMessage(t('noStagedAsk'), { modal: true }, yes, always, never);
          if (!pick) return;
          if (pick === always) await config.update('commit.smartCommit', 'always', vscode.ConfigurationTarget.Global);
          if (pick === never) {
            await config.update('commit.smartCommit', 'never', vscode.ConfigurationTarget.Global);
            tellSettingOff('svnTools.commit.smartCommit');
          }
          mode = pick === never ? 'never' : 'always';
        }
        if (mode === 'never') return vscode.window.showInformationMessage(t('noStagedInfo'));
        // 변경을 모두 스테이징한다(미등록·충돌·덜 받은 항목은 빼고). 커밋은 이어서 같은 흐름으로 한다.
        const changes = [...repo.statuses.values()].filter((s) => !['?', 'C', '~', 'N'].includes(s.code)).map((s) => s.path);
        if (changes.length === 0) return vscode.window.showInformationMessage(t('commitNothing'));
        repo.stage(closure(repo, changes, false).filter((p) => repo.contains(p)));
      }
      await commitStaged(repo, repo.sourceControl.inputBox.value);
    }),

    commit: command(async (...args) => quickCommit(args)),

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
    // 그 아래 스테이징된 수정까지 날아가지 않는다. 단 추가·교체·삭제된 폴더는 svn이 자식 없이 되돌리지 못해(E155038)
    // 폴더째(infinity) 되돌린다 — 그 아래 스테이징된 항목이 있으면 확인 창에 알린다. 이동은 양쪽을 함께 되돌린다.
    revertAll: command(async (group) => {
      const list = (group && group.resourceStates ? group.resourceStates : []).map((s) => svn.realPath(s.resourceUri.fsPath));
      if (list.length === 0) return;
      const repo = repoFor(list[0]);
      if (!repo) return;
      await repo.refresh();
      const targets = closure(repo, list, false);
      const deep = targets.filter((p) => ['A', 'R', 'D'].includes(repo.statusOf(p)) && (isDir(p) || repo.statusOf(p) === 'D'));
      const shallow = targets.filter((p) => !deep.includes(p));
      const listed = new Set(list.map(key));
      const targetKeys = new Set(targets.map(key));
      const hit = repo.stagedPaths().filter((s) => deep.some((d) => isInside(s, d)) && !targetKeys.has(key(s)));
      // 이동 짝으로 함께 되돌리는 항목 중 스테이징된 것(다른 그룹에 있어 이 목록에는 안 보인다)
      const pairedStaged = targets.filter((p) => !listed.has(key(p)) && repo.isStaged(p));
      const notes = [hit.length && t('revertAllStagedNote', hit.length), pairedStaged.length && t('revertAllPairStaged', pairedStaged.length)];
      const detail = notes.filter(Boolean).join('\n') || undefined;
      if (!(await confirm(t('revertAllAsk', list.length), t('revertYes'), detail))) return;
      if (deep.length) await step('revert', () => svn.exec(['revert', '--depth', 'infinity', ...deep], repo.folder));
      if (shallow.length) await step('revert', () => svn.exec(['revert', '--depth', 'empty', ...shallow], repo.folder));
    }),

    // 새 파일 추가 = add 후 스테이징(파일 하나는 바로, 폴더는 하위 포함·제외를 메뉴에서 고른다).
    add: command(async (...args) => { const { repo, list } = repoAndPaths(args); if (repo) await stageItems(repo, list, true); }),
    addInclude: command(async (...args) => { const { repo, list } = repoAndPaths(args); if (repo) await stageItems(repo, list, true); }),
    addExclude: command(async (...args) => { const { repo, list } = repoAndPaths(args); if (repo) await stageItems(repo, list, false); }),

    // 수정된 파일 스테이징. 패널 + 버튼(stage)은 폴더가 섞여 있으면 하위 포함 여부를 묻는다.
    stage: command(async (...args) => { const { repo, list } = repoAndPaths(args); if (repo) await stageItems(repo, list, undefined); }),
    stageInclude: command(async (...args) => { const { repo, list } = repoAndPaths(args); if (repo) await stageItems(repo, list, true); }),
    stageExclude: command(async (...args) => { const { repo, list } = repoAndPaths(args); if (repo) await stageItems(repo, list, false); }),
    unstage: command(async (...args) => { const { repo, list } = repoAndPaths(args); if (repo) await unstageItems(repo, list); }),

    // 패널 그룹 버튼. Changes의 항목은 하나씩 나열돼 있어 그대로, Unversioned의 폴더는 하위 포함으로 추가한다.
    // 명령 팔레트에서는 그룹 없이 들어온다: Stage All은 Changes와 Unversioned 전부, Unstage All은 스테이징 전부.
    stageAll: command(async (group) => {
      if (!(group && group.resourceStates)) {
        const repo = await pickRepo([]);
        if (!repo) return;
        const all = [...repo.changes.resourceStates, ...repo.unversioned.resourceStates].map((s) => svn.realPath(s.resourceUri.fsPath));
        if (all.length) await stageItems(repo, all, true);
        return;
      }
      const list = group.resourceStates.map((s) => svn.realPath(s.resourceUri.fsPath));
      if (list.length === 0) return;
      const repo = repoFor(list[0]);
      if (repo) await stageItems(repo, list, group.id === 'unversioned');
    }),
    unstageAll: command(async (group) => {
      const repo = group && group.resourceStates ? undefined : await pickRepo([]);
      const states = repo ? repo.stagedGroup.resourceStates : (group && group.resourceStates) || [];
      const list = states.map((s) => svn.realPath(s.resourceUri.fsPath));
      if (list.length === 0) return;
      const target = repo || repoFor(list[0]);
      if (target) await unstageItems(target, list);
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

    resolve: command(async (...args) => {
      const list = paths(args);
      if (list.length === 0) return vscode.window.showWarningMessage(t('noSelection'));
      const repo = repoFor(list[0]);
      if (!repo) return;
      const conflicted = list.filter((p) => ['C', '~'].includes(repo.statusOf(p)));
      if (conflicted.length === 0) return vscode.window.showInformationMessage(t('resolveNone'));
      const options = [
        { label: t('resolveWorking'), accept: 'working' },
        { label: t('resolveMineFull'), accept: 'mine-full' },
        { label: t('resolveTheirsFull'), accept: 'theirs-full' },
        { label: t('resolveMineConflict'), accept: 'mine-conflict' },
        { label: t('resolveTheirsConflict'), accept: 'theirs-conflict' },
        { label: t('resolveTortoise'), tortoise: true },
      ];
      const pick = await vscode.window.showQuickPick(options, { title: t('resolveTitle') });
      if (!pick) return;
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
