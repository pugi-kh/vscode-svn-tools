'use strict';
const vscode = require('vscode');
const svn = require('./svn');
const { Repository } = require('./repository');
const { DecorationProvider } = require('./decorations');
const { createCommands } = require('./commands');
const { COMMANDS: TORTOISE_COMMANDS } = require('./tortoise');
const { LANGUAGES } = require('./languages');

let repositories = [];

function activate(context) {
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
      const repo = new Repository(folder, svn.parseInfo(stdout), () => decorations.refresh());
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
    decorations.refresh();
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
  // 메뉴 이름은 package.json 고정이라, 메뉴 언어(svnTools.menuLanguage)에 맞는 ID만 메뉴에 보이게 manifest.js가 나눠 둔다.
  const handlers = createCommands(ctx);
  const register = (id, fn) => {
    context.subscriptions.push(vscode.commands.registerCommand(`svnTools.${id}`, fn));
    for (const lang of LANGUAGES) {
      context.subscriptions.push(vscode.commands.registerCommand(`svnTools.${id}.${lang}`, fn));
    }
  };
  for (const [id, fn] of Object.entries(handlers)) {
    if (id !== 'tortoise') register(id, fn);
  }
  for (const name of Object.keys(TORTOISE_COMMANDS)) {
    register(`tortoise.${name}`, handlers.tortoise(name));
  }

  // ---- 새로고침: 창으로 돌아올 때(밖에서 TortoiseSVN 등으로 바꿨을 수 있다) ----
  let lastFocus = 0;
  context.subscriptions.push(vscode.window.onDidChangeWindowState((s) => {
    if (s.focused && Date.now() - lastFocus > 2000) {
      lastFocus = Date.now();
      refreshAll();
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('svnTools.language') || e.affectsConfiguration('svnTools.menuLanguage')) {
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
