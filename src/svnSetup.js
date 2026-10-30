'use strict';
// svn 명령줄 도구가 없을 때의 안내와 설치. TortoiseSVN 기본 설치에는 svn.exe가 빠져 있어서(명령줄 도구 항목이 기본 꺼짐)
// 처음 쓰는 사람이 "아무 변화가 없다"고 겪었다(사용자 동료 제보).
//   - TortoiseSVN이 있으면 명령줄 도구 추가, 또는 기존 설치를 건드리지 않는 SlikSVN 중에서 고른다.
//     MSI에서 CLI는 TortoiseSVN 본체의 하위 항목이라 CLI만 따로 설치할 수는 없다.
//   - 없으면 SlikSVN(svn만)과 TortoiseSVN(탐색기 메뉴 포함) 중 고른다.
// 설치는 winget을 작업(Task)으로 터미널에 보이게 실행한다. 끝나면 종료 코드와 상관없이 svn을 다시 찾는다
// (winget은 "이미 설치됨"·재부팅 필요에도 0이 아닌 값을 돌려준다).
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const svn = require('./svn');
const tortoise = require('./tortoise');
const { t } = require('./i18n');

const GUIDE_URL = 'https://github.com/pugi-kh/vscode-svn-tools#시작하기';
const AGREE = ['--exact', '--accept-source-agreements', '--accept-package-agreements'];
const WINGET = {
  // --override는 winget 기본 인자(/norestart 포함)를 대신하므로 /norestart를 직접 넣는다 — 빠지면 묻지 않고 재부팅될 수 있다.
  // ADDLOCAL=ALL: 같은 버전이면 빠진 항목(명령줄 도구)을 채우고, 버전이 달라 업그레이드가 되면 적지 않은 항목이 빠지므로 전부 켠다.
  tortoise: ['install', '--id', 'TortoiseSVN.TortoiseSVN', ...AGREE, '--force', '--override', 'ADDLOCAL=ALL /passive /norestart'],
  slik: ['install', '--id', 'Slik.Subversion', ...AGREE],
};

// 폴더나 그 상위에 .svn이 있는가. svn이 없어 svn info를 못 해도 작업 사본인지는 알 수 있다
// (SVN과 상관없는 폴더를 열 때마다 설치 안내를 띄우지 않게).
function looksLikeWorkingCopy(dir) {
  for (let cur = dir; ;) {
    if (fs.existsSync(path.join(cur, '.svn'))) return true;
    const up = path.dirname(cur);
    if (up === cur) return false;
    cur = up;
  }
}

function hasTortoise() {
  return fs.existsSync(tortoise.procPath());
}

// 고른 파일이 svn인가: svn --version --quiet는 "1.14.5" 같은 버전만 출력한다
function isSvn(file) {
  return new Promise((resolve) => {
    cp.execFile(file, ['--version', '--quiet'], { timeout: 10000, windowsHide: true },
      (err, stdout) => resolve(!err && /^\d+\.\d+/.test(String(stdout).trim())));
  });
}

class SvnSetup {
  // onFound: svn을 새로 찾았을 때(작업 폴더를 다시 연다)
  constructor(output, onFound) {
    this.output = output;
    this.onFound = onFound;
    this.asked = false;
    this.running = false;
  }

  fail(e) {
    const text = (e && (e.stderr || e.message)) || String(e);
    this.output.appendLine(`svn setup: ${text}`);
    vscode.window.showErrorMessage(t('svnError', text.split(/\r?\n/)[0]));
  }

  async openGuide() {
    await vscode.env.openExternal(vscode.Uri.parse(GUIDE_URL));
  }

  // 작업 폴더를 열다가 svn이 없을 때. 한 세션에 한 번만 묻는다(닫았으면 명령 팔레트로 다시 할 수 있다).
  missing(dir) {
    if (this.asked || !looksLikeWorkingCopy(dir)) return;
    this.asked = true;
    this.output.appendLine(`svn search: ${svn.searchReport()}`);
    (async () => {
      const install = t('svnSetupInstall');
      const locate = t('svnSetupLocate');
      const guide = t('svnSetupGuide');
      const pick = await vscode.window.showWarningMessage(t('svnSetupMissing'), install, locate, guide);
      if (pick === install) await this.install();
      if (pick === locate) await this.locate();
      if (pick === guide) await this.openGuide();
    })().catch((e) => this.fail(e));
  }

  async install() {
    if (this.running) {
      vscode.window.showInformationMessage(t('svnSetupRunning'));
      return;
    }
    svn.resetSvn();
    const existing = svn.findSvn();
    if (existing) {
      vscode.window.showInformationMessage(t('svnSetupAlready', existing));
      return;
    }
    const items = hasTortoise()
      ? [
        { label: t('svnSetupAddCli'), detail: t('svnSetupAddCliDetail'), id: 'tortoise' },
        { label: t('svnSetupSlik'), detail: t('svnSetupSlikKeepDetail'), id: 'slik' },
      ]
      : [
        { label: t('svnSetupSlik'), detail: t('svnSetupSlikDetail'), id: 'slik' },
        { label: t('svnSetupTortoise'), detail: t('svnSetupTortoiseDetail'), id: 'tortoise' },
      ];
    const pick = await vscode.window.showQuickPick(items, { title: t('svnSetupPickTitle') });
    if (!pick) return;
    this.running = true;
    try {
      // 셸을 거치지 않고 winget을 직접 실행한다 — PowerShell을 거치면 종료 코드가 0/1로 뭉개지고, 셸마다 따옴표 처리가 다르다
      const task = new vscode.Task({ type: 'svnTools.setup' }, vscode.TaskScope.Global, t('svnSetupTaskName'), 'SVN Tools',
        new vscode.ProcessExecution('winget', WINGET[pick.id]));
      task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated };
      // 이 설치 작업의 끝만 본다(작업 종류로 구별 — executeTask가 돌아오기 전에 다른 작업이 끝날 수 있다).
      // winget이 없으면 프로세스 종료 이벤트 없이 작업만 끝날 수 있어 onDidEndTask도 함께 듣는다(그때 종료 코드는 undefined).
      const mine = (e) => e.execution.task.definition.type === 'svnTools.setup';
      const subs = [];
      const ended = new Promise((resolve) => {
        let code;
        subs.push(vscode.tasks.onDidEndTaskProcess((e) => { if (mine(e)) code = e.exitCode; }));
        subs.push(vscode.tasks.onDidEndTask((e) => { if (mine(e)) resolve(code); }));
      });
      let code;
      try {
        await vscode.tasks.executeTask(task);
        code = await ended;
      } finally {
        subs.forEach((s) => s.dispose());
      }
      this.output.appendLine(`svn setup: winget ${WINGET[pick.id].join(' ')} → exit ${code}`);
      await this.afterInstall(code, pick.id);
    } finally {
      this.running = false;
    }
  }

  // 종료 코드와 상관없이 먼저 다시 찾는다. 못 찾았을 때만 원인을 안내한다.
  async afterInstall(code, kind) {
    if (await this.recheck()) {
      const file = svn.findSvn();
      vscode.window.showInformationMessage(t(kind === 'tortoise' ? 'svnSetupDoneTortoise' : 'svnSetupDone', file));
      return;
    }
    this.output.appendLine(`svn search: ${svn.searchReport()}`);
    const message = code === undefined ? t('svnSetupCancelled')
      : code === 0 ? t('svnSetupNotFoundAfter') : t('svnSetupFailed', code);
    const locate = t('svnSetupLocate');
    const guide = t('svnSetupGuide');
    const pick = await vscode.window.showWarningMessage(message, locate, guide);
    if (pick === locate) await this.locate();
    if (pick === guide) await this.openGuide();
  }

  async locate() {
    const files = await vscode.window.showOpenDialog({
      title: t('svnSetupLocateTitle'), canSelectMany: false,
      filters: process.platform === 'win32' ? { 'svn.exe': ['exe'] } : undefined,
    });
    if (!files || !files.length) return;
    const file = files[0].fsPath;
    if (!(await isSvn(file))) {
      vscode.window.showErrorMessage(t('svnSetupNotSvn', file));
      return;
    }
    // 직접 고른 경로만 설정에 쓴다. 설정 변경 처리(extension.js)가 다시 찾고 작업 폴더를 연다.
    const config = vscode.workspace.getConfiguration('svnTools');
    await config.update('svnPath', file, vscode.ConfigurationTarget.Global);
    if ((config.inspect('svnPath') || {}).workspaceValue) vscode.window.showWarningMessage(t('svnSetupWorkspaceWins'));
  }

  // svn을 다시 찾고, 찾으면 작업 폴더를 연다. 반환: 찾았는가
  async recheck() {
    svn.resetSvn();
    const file = svn.findSvn();
    this.output.appendLine(`svn: ${file || 'not found'}`);
    if (!file) return false;
    this.asked = false;
    await this.onFound();
    return true;
  }
}

module.exports = { SvnSetup };
