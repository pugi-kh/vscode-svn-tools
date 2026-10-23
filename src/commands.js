'use strict';
// 명령 처리. 탐색기 우클릭·Source Control 패널·명령 팔레트가 모두 여기로 들어온다.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const svn = require('./svn');
const ignore = require('./ignore');
const tortoise = require('./tortoise');
const { t } = require('./i18n');
const { baseUri, isInside, key } = require('./repository');
const { IgnoreView } = require('./ignoreView');
const { ReasonView } = require('./reasonView');

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

  function repoFor(p) {
    const repo = ctx.repositories().find((r) => r.contains(p));
    if (!repo) vscode.window.showWarningMessage(t('notWorkingCopy', p));
    return repo;
  }

  function repoOfArgs(args, list) {
    if (args[0] && args[0].rootUri) {
      const r = ctx.repositories().find((x) => x.sourceControl === args[0]);
      if (r) return r;
    }
    if (list.length === 0) {
      const repos = ctx.repositories();
      return repos.length === 1 ? repos[0] : undefined;
    }
    return repoFor(list[0]);
  }

  function showError(e) {
    if (e && e.code === 'ENOENT') {
      vscode.window.showErrorMessage(t('svnNotFound'));
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
    return async (...args) => {
      try {
        await fn(...args);
      } catch (e) {
        showError(e);
      } finally {
        ctx.refreshAll();
      }
    };
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

  // 지정한 경로들 안의 변경을 커밋한다. 누락 파일 처리 → 서버 변경 확인 → 커밋 순서.
  async function commitPaths(repo, targets, message) {
    if (!message || !message.trim()) {
      vscode.window.showWarningMessage(t('commitEmptyMessage'));
      return;
    }
    await repo.refresh();
    const inScope = [...repo.statuses.values()].filter((s) => targets.some((p) => isInside(s.path, p)));
    const committable = inScope.filter((s) => s.code !== '?');
    if (committable.length === 0) {
      vscode.window.showInformationMessage(t('commitNothing'));
      return;
    }
    const conflicts = committable.filter((s) => s.code === 'C' || s.code === '~');
    if (conflicts.length > 0) {
      vscode.window.showWarningMessage(t('updateConflicts'));
      return;
    }
    const missing = committable.filter((s) => s.code === '!');
    if (missing.length > 0) {
      if (!(await confirm(t('commitMissingAsk', missing.length), t('commitMissingYes')))) return;
      await svn.exec(['delete', ...missing.map((s) => s.path)], repo.folder);
    }

    if (vscode.workspace.getConfiguration('svnTools').get('commit.checkOutOfDate', true)) {
      const outdated = await outOfDateCount(repo, targets);
      if (outdated > 0) {
        const updateFirst = t('outOfDateUpdateFirst');
        const anyway = t('outOfDateCommitAnyway');
        const pick = await vscode.window.showWarningMessage(t('outOfDateAsk', outdated), { modal: true }, updateFirst, anyway);
        if (!pick) return;
        if (pick === updateFirst) {
          await runUpdate(repo, targets);
          await repo.refresh();
          if ([...repo.statuses.values()].some((s) => s.code === 'C' || s.code === '~')) {
            vscode.window.showWarningMessage(t('updateConflicts'));
            return;
          }
        }
      }
    }

    // 메시지는 -m 인자로 넘긴다(-F + --encoding은 한글 경로를 깨뜨린다, svn.js의 exec 설명 참고).
    // --force-log: 메시지가 우연히 파일 경로와 같아도 svn이 거부하지 않게 한다.
    const { stdout } = await step('commit', () =>
      svn.exec(['commit', '-m', message, '--force-log', ...targets], repo.folder));
    ctx.output.appendLine(stdout);
    repo.sourceControl.inputBox.value = '';
    const rev = svn.lastRevision(stdout);
    vscode.window.showInformationMessage(rev ? t('commitDone', rev) : t('commitDoneNoRev'));
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
      if (await confirm(ask, t('deleteYes'), versioned.map((p) => path.basename(p)).join('\n'))) {
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

  // ---- 명령 표 ----

  return {
    refresh: command(async () => {}),

    commitAll: command(async (sc) => {
      const repo = repoOfArgs([sc], []);
      if (!repo) return;
      let message = repo.sourceControl.inputBox.value;
      if (!message.trim()) message = await askMessage(repo);
      if (message === undefined) return;
      await commitPaths(repo, [repo.folder], message);
    }),

    commit: command(async (...args) => {
      const list = paths(args);
      const repo = repoOfArgs(args, list);
      if (!repo) return;
      const targets = list.length ? list : [repo.folder];
      const message = await askMessage(repo);
      if (message === undefined) return;
      await commitPaths(repo, targets, message);
    }),

    update: command(async (...args) => {
      const list = paths(args);
      const repo = repoOfArgs(args, list);
      if (!repo) return;
      const out = await runUpdate(repo, list.length ? list : [repo.folder]);
      await repo.refresh();
      if ([...repo.statuses.values()].some((s) => s.code === 'C' || s.code === '~')) {
        vscode.window.showWarningMessage(t('updateConflicts'));
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
        if (fs.existsSync(u.fsPath) && !isDir(u.fsPath)) await vscode.window.showTextDocument(u, { preview: false });
      }
    }),

    revert: command(async (...args) => {
      const list = paths(args);
      if (list.length === 0) return vscode.window.showWarningMessage(t('noSelection'));
      const repo = repoFor(list[0]);
      if (!repo) return;
      const detail = list.some(isDir) ? t('revertAskFolder') : undefined;
      if (!(await confirm(t('revertAsk', list.length), t('revertYes'), detail))) return;
      await step('revert', () => svn.exec(['revert', '--depth', 'infinity', ...list], repo.folder));
    }),

    revertAll: command(async (group) => {
      const list = (group && group.resourceStates ? group.resourceStates : []).map((s) => s.resourceUri.fsPath);
      if (list.length === 0) return;
      const repo = repoFor(list[0]);
      if (!repo) return;
      if (!(await confirm(t('revertAllAsk', list.length), t('revertYes')))) return;
      await step('revert', () => svn.exec(['revert', '--depth', 'infinity', ...list], repo.folder));
    }),

    add: command(async (...args) => {
      const list = paths(args);
      if (list.length === 0) return vscode.window.showWarningMessage(t('noSelection'));
      const repo = repoFor(list[0]);
      if (!repo) return;
      // --force: 이미 등록된 폴더를 골라도 그 안의 미등록 항목을 추가한다. 무시된 항목은 건너뛴다.
      await step('add', () => svn.exec(['add', '--force', '--parents', ...list], repo.folder));
      vscode.window.showInformationMessage(t('addDone', list.length));
    }),

    addAll: command(async (group) => {
      const list = (group && group.resourceStates ? group.resourceStates : []).map((s) => s.resourceUri.fsPath);
      if (list.length === 0) return;
      const repo = repoFor(list[0]);
      if (!repo) return;
      await step('add', () => svn.exec(['add', '--force', '--parents', ...list], repo.folder));
      vscode.window.showInformationMessage(t('addDone', list.length));
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
      // 대소문자만 바꾸는 경우는 같은 파일이므로 존재 검사에서 뺀다(윈도우).
      if (fs.existsSync(target) && target.toLowerCase() !== p.toLowerCase()) {
        return vscode.window.showWarningMessage(t('renameExists', next));
      }
      await step('move', () => svn.exec(['move', p, target], repo.folder));
      vscode.window.showInformationMessage(t('renameDone'));
    }),

    ignore: command(async (...args) => {
      const [uri] = toUris(args);
      if (!uri) return vscode.window.showWarningMessage(t('noSelection'));
      const p = svn.realPath(uri.fsPath);
      const repo = repoFor(p);
      if (!repo) return;
      const name = path.basename(p);
      const ext = !isDir(p) && path.extname(name) ? `*${path.extname(name)}` : undefined;
      // 패턴에는 공백을 쓰지 않는다 — 이름에 공백이 있으면 ?(아무 한 글자)로 바꿔 같은 이름에 맞게 한다.
      const safeName = name.replace(/\s/g, '?');
      const whatItems = [{ label: t('ignoreWhatName', safeName), value: safeName }];
      if (ext) whatItems.push({ label: t('ignoreWhatExt', ext), value: ext });
      whatItems.push({ label: t('ignoreWhatCustom'), custom: true });
      const what = await vscode.window.showQuickPick(whatItems, { title: t('ignoreWhatTitle') });
      if (!what) return;
      let pattern = what.value;
      if (what.custom) {
        pattern = await vscode.window.showInputBox({
          prompt: t('ignoreCustomPrompt'), value: name.replace(/\s/g, '?'),
          validateInput: (v) => (/\s/.test(v.trim()) ? t('viewInvalidPattern') : undefined),
        });
        if (!pattern || !pattern.trim()) return;
        pattern = pattern.trim();
      }

      const parent = path.dirname(p);
      const parentRel = path.relative(repo.folder, parent) || path.basename(repo.folder);
      const kinds = [
        { label: t('ignoreKindIgnore', parentRel), description: t('ignoreKindIgnoreDesc'), prop: 'svn:ignore', dir: parent },
        { label: t('ignoreKindGlobal', parentRel), description: t('ignoreKindGlobalDesc'), prop: 'svn:global-ignores', dir: parent },
      ];
      if (path.normalize(parent).toLowerCase() !== path.normalize(repo.folder).toLowerCase()) {
        kinds.push({ label: t('ignoreKindGlobalRoot', repo.name), description: t('ignoreKindGlobalDesc'), prop: 'svn:global-ignores', dir: repo.folder });
      }
      kinds.push({ label: t('ignoreKindLocal'), description: t('ignoreKindLocalDesc'), local: true });
      const kind = await vscode.window.showQuickPick(kinds, { title: t('ignoreKindTitle') });
      if (!kind) return;

      if (kind.local) {
        const added = ignore.addToLocal(pattern);
        vscode.window.showInformationMessage(added ? t('ignoreDoneLocal', pattern) : t('ignoreAlready', pattern));
        return;
      }
      if (['?', 'I'].includes(repo.statusOf(kind.dir))) {
        return vscode.window.showWarningMessage(t('ignoreUnversionedParent', kind.dir));
      }
      const added = await ignore.addToProp(kind.prop, kind.dir, pattern);
      vscode.window.showInformationMessage(added ? t('ignoreDoneProp', `${kind.prop} (${path.basename(kind.dir)})`, pattern) : t('ignoreAlready', pattern));
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
      tortoise.open(name, list, () => ctx.refreshAll());
    },
  };
}

module.exports = { createCommands };
