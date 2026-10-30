'use strict';
const vscode = require('vscode');
const svn = require('./svn');
const { Repository } = require('./repository');
const { DecorationProvider } = require('./decorations');
const { createCommands } = require('./commands');
const { HistoryView } = require('./historyView');
const { COMMANDS: TORTOISE_COMMANDS } = require('./tortoise');
const { LANGUAGES } = require('./languages');
const { resetLanguageCache } = require('./i18n');

let repositories = [];

// 0.9까지 svnTools.language는 "문구 언어"였다. 0.10에서 "전체 언어"가 되면서 영역별 설정이 생겼다.
// 보이는 언어가 업데이트 전과 같도록 한 번만 옮긴다: 전체 = 예전 메뉴 언어, 문구 = 예전 language.
// 사용자(전역) 설정만 한 번 옮긴다. 이전 표시는 설정 동기화로 다른 PC에도 넘겨(setKeysForSync), 동기화로 받은 새 뜻의 값을
// 예전 값으로 오인해 다시 옮기지 않는다. messageLanguage도 같은 값이어도 항상 써서 "옮긴 값"임을 남긴다.
// 작업 공간 설정(.vscode/settings.json)은 고치지 않는다 — 팀이 공유하는 파일일 수 있고, 새 뜻으로 쓴 값과 구별할 수 없다.
const MIGRATED = 'svnTools.languageMigrated';
async function migrateLanguage(context) {
  context.globalState.setKeysForSync([MIGRATED]);
  if (context.globalState.get(MIGRATED)) return;
  const config = vscode.workspace.getConfiguration('svnTools');
  const value = (k) => (config.inspect(k) || {}).globalValue;
  if ((value('language') !== undefined || value('menuLanguage') !== undefined) && value('messageLanguage') === undefined) {
    const target = vscode.ConfigurationTarget.Global;
    const oldMessage = value('language') || 'en';
    await config.update('language', value('menuLanguage') || 'en', target);
    await config.update('menuLanguage', undefined, target);
    await config.update('messageLanguage', oldMessage, target);
  }
  await context.globalState.update(MIGRATED, true);
}

function activate(context) {
  migrateLanguage(context).catch((e) => console.error('[svn-tools] language migration failed', e));
  const output = vscode.window.createOutputChannel('SVN Tools');
  const decorations = new DecorationProvider(() => repositories);
  context.subscriptions.push(output, vscode.window.registerFileDecorationProvider(decorations));

  const refreshAll = () => Promise.all(repositories.map((r) => r.refresh()));
  // 미등록 폴더 안까지 다시 훑는 새로고침(파일 감시가 놓친 변경을 잡는다): 창으로 돌아올 때, Refresh 명령
  const rescanAll = () => Promise.all(repositories.map((r) => { r.forgetWalk(); return r.refresh(); }));
  const ctx = { output, repositories: () => repositories, refreshAll, rescanAll };
  ctx.history = new HistoryView(ctx);
  context.subscriptions.push(ctx.history);

  // ---- 작업 사본 찾기: 작업 폴더마다 svn info가 되는지 본다 ----
  async function openFolder(folder) {
    if (folder.uri.scheme !== 'file') return;
    try {
      const dir = svn.realPath(folder.uri.fsPath);
      const { stdout } = await svn.exec(['info', '--xml', dir], dir);
      const repo = new Repository(folder, svn.parseInfo(stdout), context.workspaceState, onRepoChange);
      repositories.push(repo);
      await repo.refresh();
    } catch (e) {
      if (e.code === 'ENOENT') output.appendLine('svn not found');
      // 작업 사본이 아니면 조용히 넘어간다.
    }
    // 저장소가 생겼으면 첫 새로고침의 render가 이미 onRepoChange를 불렀다 — 여기서는 활성 여부만 알린다.
    vscode.commands.executeCommand('setContext', 'svnTools.active', repositories.length > 0);
    ctx.history.reposChanged();
  }

  function closeFolder(folder) {
    const p = svn.realPath(folder.uri.fsPath);
    repositories.filter((r) => r.folder === p).forEach((r) => {
      lastSig.delete(r);
      r.dispose();
    });
    repositories = repositories.filter((r) => r.folder !== p);
    updateContext();
  }

  function updateContext() {
    vscode.commands.executeCommand('setContext', 'svnTools.active', repositories.length > 0);
    ctx.history.reposChanged();
    onRepoChange();
  }

  // 상태가 바뀌면 탐색기 표시를 새로 그리고, 우클릭 메뉴 조건(resourcePath in ...)에 쓸 경로 목록을 넘긴다.
  // 메뉴는 이 목록으로 항목 상태를 알아서 새 파일엔 SVN Add, 수정 파일엔 SVN Stage, 스테이징된 것엔 SVN Unstage만 보인다.
  // 새로고침마다 부르지만 바뀐 것만 보낸다: 목록은 수십 KB가 UI 스레드로 가고, 탐색기 표시는 보이는 파일 전부를 다시 계산한다.
  // 목록과 요약은 저장소가 render 때 만들어 둔다(repository.js lists, decoSig).
  const lastSig = new Map();
  const lastSent = {};
  function onRepoChange(repo) {
    if (repo && !repositories.includes(repo)) return; // 닫은 뒤 끝난 새로고침
    if (!repo || lastSig.get(repo) !== repo.decoSig) {
      if (repo) lastSig.set(repo, repo.decoSig);
      decorations.refresh();
    }
    const lists = { addable: [], stageable: [], staged: [], renamable: [] };
    for (const r of repositories) for (const k of Object.keys(lists)) lists[k].push(...r.lists[k]);
    for (const [k, v] of Object.entries(lists)) {
      const sig = v.join('\n');
      if (lastSent[k] === sig) continue;
      lastSent[k] = sig;
      vscode.commands.executeCommand('setContext', `svnTools.${k}`, v);
    }
  }

  (vscode.workspace.workspaceFolders || []).forEach(openFolder);
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((e) => {
    e.removed.forEach(closeFolder);
    e.added.forEach(openFolder);
  }));

  // ---- 비교 화면의 이전 버전: svn-tools 스킴 → svn cat ----
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('svn-tools', {
    async provideTextDocumentContent(uri) {
      try {
        const { p, r, u, empty } = JSON.parse(uri.query);
        if (empty) return '';
        // 이력 뷰: 저장소 URL@리비전(작업 사본 밖이거나 지금은 없는 파일일 수 있다)
        if (u) return (await svn.exec(['cat', `${u}@${r}`], require('os').homedir())).stdout;
        const file = svn.realPath(p);
        const { stdout } = await svn.exec(['cat', '-r', r, file], require('path').dirname(file));
        return stdout;
      } catch {
        return '';
      }
    },
  }));

  // ---- 명령: 같은 처리를 기본 ID와 언어별 ID(.en/.ko) 모두에 묶는다 ----
  // 메뉴 이름은 package.json 고정이라, 메뉴·패널 언어에 맞는 ID만 보이게 manifest.js가 when 조건으로 나눠 둔다.
  const handlers = createCommands(ctx);
  const register = (id, fn) => {
    context.subscriptions.push(vscode.commands.registerCommand(`svnTools.${id}`, fn));
    for (const lang of LANGUAGES) {
      context.subscriptions.push(vscode.commands.registerCommand(`svnTools.${id}.${lang}`, fn));
    }
  };
  for (const [id, fn] of Object.entries(handlers)) {
    if (id !== 'tortoise' && id !== 'onRenamed') register(id, fn);
  }
  for (const name of Object.keys(TORTOISE_COMMANDS)) {
    register(`tortoise.${name}`, handlers.tortoise(name));
  }

  // 탐색기 F2 등 svn 없이 이름을 바꾸면 SVN 이름 바꾸기(이력 유지)로 적용할지 묻는다(commands.js onRenamed).
  context.subscriptions.push(vscode.workspace.onDidRenameFiles((e) => handlers.onRenamed(e)));

  // ---- 새로고침: 창으로 돌아올 때(밖에서 TortoiseSVN 등으로 바꿨을 수 있다) ----
  let lastFocus = 0;
  context.subscriptions.push(vscode.window.onDidChangeWindowState((s) => {
    if (s.focused && Date.now() - lastFocus > 2000) {
      lastFocus = Date.now();
      rescanAll();
      ctx.history.refreshOnFocus();
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('svnTools')) {
      resetLanguageCache();
      decorations.reloadConfig();
    }
    if (['language', 'scmLanguage', 'messageLanguage'].some((k) => e.affectsConfiguration(`svnTools.${k}`))) {
      repositories.forEach((r) => r.applyLanguage());
      ctx.history.applyLanguage();
    }
    if (e.affectsConfiguration('svnTools.scm')) refreshAll();
    if (e.affectsConfiguration('svnTools.history')) ctx.history.reloadConfig();
    if (e.affectsConfiguration('svnTools')) decorations.refresh();
  }));
}

function deactivate() {
  repositories.forEach((r) => r.dispose());
  repositories = [];
}

module.exports = { activate, deactivate };
