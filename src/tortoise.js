'use strict';
// TortoiseSVN 창 열기. TortoiseProc.exe /command:<명령> /path:"<경로1>*<경로2>"
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const { t } = require('./i18n');

const DEFAULT_PATH = 'C:\\Program Files\\TortoiseSVN\\bin\\TortoiseProc.exe';

// 메뉴 항목 → TortoiseProc 명령. single은 경로 하나만 받는 명령, noPath는 경로가 필요 없는 명령.
const COMMANDS = {
  update: { cmd: 'update' },
  commit: { cmd: 'commit' },
  log: { cmd: 'log', single: true },
  diff: { cmd: 'diff', single: true },
  revert: { cmd: 'revert' },
  add: { cmd: 'add' },
  ignore: { cmd: 'ignore' },
  rename: { cmd: 'rename', single: true },
  remove: { cmd: 'remove' },
  cleanup: { cmd: 'cleanup', single: true },
  conflicteditor: { cmd: 'conflicteditor', single: true },
  resolve: { cmd: 'resolve' },
  repobrowser: { cmd: 'repobrowser', single: true },
  revisiongraph: { cmd: 'revisiongraph', single: true },
  blame: { cmd: 'blame', single: true },
  properties: { cmd: 'properties' },
  merge: { cmd: 'merge', single: true },
  switch: { cmd: 'switch', single: true },
  lock: { cmd: 'lock' },
  unlock: { cmd: 'unlock' },
  settings: { cmd: 'settings', noPath: true },
};

function procPath() {
  return vscode.workspace.getConfiguration('svnTools').get('tortoiseProcPath', '') || DEFAULT_PATH;
}

// onExit: Tortoise 창이 닫힌 뒤 상태를 새로고침하는 데 쓴다.
function open(name, paths, onExit) {
  const def = COMMANDS[name];
  const exe = procPath();
  if (!fs.existsSync(exe)) {
    vscode.window.showErrorMessage(t('tortoiseNotFound'));
    return;
  }
  const args = [`/command:${def.cmd}`];
  if (!def.noPath) {
    const list = def.single ? paths.slice(0, 1) : paths;
    if (list.length === 0) {
      vscode.window.showWarningMessage(t('noSelection'));
      return;
    }
    args.push(`/path:"${list.join('*')}"`);
  }
  // 인자를 직접 따옴표로 감쌌으므로 Node가 다시 감싸지 않게 한다(공백·한글 경로).
  // 그러면 명령줄 맨 앞의 실행 파일 경로도 감싸지지 않으므로 argv0에 따옴표를 붙여 넣는다.
  const child = cp.spawn(exe, args, { windowsVerbatimArguments: true, argv0: `"${exe}"` });
  child.on('error', (e) => vscode.window.showErrorMessage(t('svnError', e.message)));
  if (onExit) child.on('exit', onExit);
}

module.exports = { open, procPath, COMMANDS };
