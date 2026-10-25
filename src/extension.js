'use strict';
const vscode = require('vscode');
const svn = require('./svn');
const { Repository } = require('./repository');
const { DecorationProvider } = require('./decorations');
const { createCommands } = require('./commands');
const { COMMANDS: TORTOISE_COMMANDS } = require('./tortoise');
const { LANGUAGES } = require('./languages');

let repositories = [];

// 0.9까지 svnTools.language는 "문구 언어"였다. 0.10에서 "전체 언어"가 되면서 영역별 설정이 생겼다.
// 보이는 언어가 업데이트 전과 같도록 한 번만 옮긴다: 전체 = 예전 메뉴 언어, 문구 = 예전 language.
async function migrateLanguage(context) {
  if (context.globalState.get('svnTools.languageMigrated')) return;
  const config = vscode.workspace.getConfiguration('svnTools');
  const scopes = [['globalValue', vscode.ConfigurationTarget.Global], ['workspaceValue', vscode.ConfigurationTarget.Workspace]];
  for (const [field, target] of scopes) {
    const oldMessage = config.inspect('language')[field];
    const oldMenu = config.inspect('menuLanguage')[field];
    if (oldMessage === undefined && oldMenu === undefined) continue;
    if (config.inspect('messageLanguage')[field] !== undefined) continue;
    const all = oldMenu || 'en';
    await config.update('language', all, target);
    await config.update('menuLanguage', undefined, target);
    if ((oldMessage || 'en') !== all) await config.update('messageLanguage', oldMessage || 'en', target);
  }
  await context.globalState.update('svnTools.languageMigrated', true);
}

function activate(context) {
  migrateLanguage(context).catch((e) => console.error('[svn-tools] language migration failed', e));
  const output = vscode.window.createOutputChannel('SVN Tools');
  const decorations = new DecorationProvider(() => repositories);
  context.subscriptions.push(output, vscode.window.registerFileDecorationProvider(decorations));

  const refreshAll = () => Promise.all(repositories.map((r) => r.refresh()));
  const ctx = { output, repositories: () => repositories, refreshAll };

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
    updateContext();
  }

  function closeFolder(folder) {
    const p = svn.realPath(folder.uri.fsPath);
    repositories.filter((r) => r.folder === p).forEach((r) => r.dispose());
    repositories = repositories.filter((r) => r.folder !== p);
    updateContext();
  }

  function updateContext() {
    vscode.commands.executeCommand('setContext', 'svnTools.active', repositories.length > 0);
    onRepoChange();
  }

  // 상태가 바뀌면 탐색기 표시를 새로 그리고, 우클릭 메뉴 조건(resourcePath in ...)에 쓸 경로 목록을 넘긴다.
  // 메뉴는 이 목록으로 항목 상태를 알아서 새 파일엔 SVN Add, 수정 파일엔 SVN Stage, 스테이징된 것엔 SVN Unstage만 보인다.
  function onRepoChange() {
    decorations.refresh();
    const lists = { addable: [], stageable: [], staged: [], renamable: [] };
    for (const r of repositories) {
      const l = r.contextLists();
      for (const k of Object.keys(lists)) lists[k].push(...l[k]);
    }
    for (const [k, v] of Object.entries(lists)) vscode.commands.executeCommand('setContext', `svnTools.${k}`, v);
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
        const { p, r } = JSON.parse(uri.query);
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
      refreshAll();
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (['language', 'scmLanguage', 'messageLanguage'].some((k) => e.affectsConfiguration(`svnTools.${k}`))) {
      repositories.forEach((r) => r.applyLanguage());
    }
    if (e.affectsConfiguration('svnTools.scm')) refreshAll();
    if (e.affectsConfiguration('svnTools')) decorations.refresh();
  }));
}

function deactivate() {
  repositories.forEach((r) => r.dispose());
  repositories = [];
}

module.exports = { activate, deactivate };
