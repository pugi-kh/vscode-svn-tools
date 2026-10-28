'use strict';
// 탐색기·Source Control 패널의 파일 표시(배지와 색).
// 색은 이 확장의 색상 ID(svnTools.*, manifest.js의 colors)를 쓴다 — 사용자가 workbench.colorCustomizations로
// git 색과 따로 바꿀 수 있게. 기본값은 git 색을 그대로 가리킨다.
const vscode = require('vscode');
const { t } = require('./i18n');

const STYLE = {
  M: { badge: 'M', color: 'svnTools.modifiedForeground', tip: 'tipModified', propagate: true },
  R: { badge: 'R', color: 'svnTools.modifiedForeground', tip: 'tipReplaced', propagate: true },
  A: { badge: 'A', color: 'svnTools.addedForeground', tip: 'tipAdded', propagate: true },
  D: { badge: 'D', color: 'svnTools.deletedForeground', tip: 'tipDeleted', propagate: true },
  '!': { badge: '!', color: 'svnTools.deletedForeground', tip: 'tipMissing', propagate: true },
  C: { badge: 'C', color: 'svnTools.conflictedForeground', tip: 'tipConflict', propagate: true },
  '~': { badge: '~', color: 'svnTools.conflictedForeground', tip: 'tipObstructed', propagate: true },
  N: { badge: '!', color: 'svnTools.conflictedForeground', tip: 'tipIncomplete', propagate: true },
  // 미등록 폴더 안의 파일도 U(provideFileDecoration에서 상위를 따라 올라가 판정).
  '?': { badge: 'U', color: 'svnTools.unversionedForeground', tip: 'tipUnversioned', propagate: false },
  // 무시된 파일은 배지 없이 색만. 무시된 폴더 안의 파일도 Repository.statusOf가 'I'를 돌려준다.
  I: { badge: undefined, color: 'svnTools.ignoredForeground', tip: 'tipIgnored', propagate: false },
};

class DecorationProvider {
  constructor(getRepositories) {
    this.getRepositories = getRepositories;
    this.reloadConfig();
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this.emitter.event;
  }

  // 설정은 바뀔 때만 읽는다(extension.js의 설정 변경 처리). 표시는 보이는 파일마다 불려서 매번 읽으면 비싸다.
  reloadConfig() {
    this.enabled = vscode.workspace.getConfiguration('svnTools').get('decorations.enabled', true);
  }

  provideFileDecoration(uri) {
    if (uri.scheme !== 'file' || !this.enabled) return undefined;
    const repo = this.getRepositories().find((r) => r.contains(uri.fsPath));
    if (!repo) return undefined;
    // 미등록 폴더 안의 항목은 svn status에 나오지 않으므로 상위를 따라 올라가 U로 표시한다.
    // statusOf는 그대로 둔다 — commands.js가 "미등록 폴더 안은 undefined"를 전제로 판정한다.
    const code = repo.statusOf(uri.fsPath) || (repo.isUnversioned(uri.fsPath) ? '?' : undefined);
    const style = code && STYLE[code];
    if (!style) return undefined;
    // 스테이징된 항목은 이니셜·색은 그대로 두고 배지 뒤에 +를 붙인다(패널의 + 버튼과 같은 기호).
    const staged = style.badge && repo.isStaged(uri.fsPath);
    return {
      badge: staged ? `${style.badge}+` : style.badge,
      color: new vscode.ThemeColor(style.color),
      tooltip: `SVN: ${t(style.tip)}${staged ? ` (${t('tipStaged')})` : ''}`,
      propagate: style.propagate,
    };
  }

  refresh() {
    this.emitter.fire(undefined);
  }
}

module.exports = { DecorationProvider };
