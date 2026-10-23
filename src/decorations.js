'use strict';
// 탐색기·Source Control 패널의 파일 표시(배지와 색).
// 색은 이 확장의 색상 ID(svnTools.*, manifest.js의 colors)를 쓴다 — 사용자가 workbench.colorCustomizations로
// git 색과 따로 바꿀 수 있게. 기본값은 git 색을 그대로 가리킨다.
const vscode = require('vscode');

const STYLE = {
  M: { badge: 'M', color: 'svnTools.modifiedForeground', tip: 'Modified', propagate: true },
  R: { badge: 'R', color: 'svnTools.modifiedForeground', tip: 'Replaced', propagate: true },
  A: { badge: 'A', color: 'svnTools.addedForeground', tip: 'Added', propagate: true },
  D: { badge: 'D', color: 'svnTools.deletedForeground', tip: 'Deleted', propagate: true },
  '!': { badge: '!', color: 'svnTools.deletedForeground', tip: 'Missing', propagate: true },
  C: { badge: 'C', color: 'svnTools.conflictedForeground', tip: 'Conflict', propagate: true },
  '~': { badge: '~', color: 'svnTools.conflictedForeground', tip: 'Obstructed', propagate: true },
  '?': { badge: 'U', color: 'svnTools.unversionedForeground', tip: 'Unversioned', propagate: false },
  // 무시된 파일은 배지 없이 색만. 무시된 폴더 안의 파일도 Repository.statusOf가 'I'를 돌려준다.
  I: { badge: undefined, color: 'svnTools.ignoredForeground', tip: 'Ignored', propagate: false },
};

class DecorationProvider {
  constructor(getRepositories) {
    this.getRepositories = getRepositories;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this.emitter.event;
  }

  provideFileDecoration(uri) {
    if (uri.scheme !== 'file') return undefined;
    if (!vscode.workspace.getConfiguration('svnTools').get('decorations.enabled', true)) return undefined;
    const repo = this.getRepositories().find((r) => r.contains(uri.fsPath));
    if (!repo) return undefined;
    const code = repo.statusOf(uri.fsPath);
    const style = code && STYLE[code];
    if (!style) return undefined;
    return {
      badge: style.badge,
      color: new vscode.ThemeColor(style.color),
      tooltip: `SVN: ${style.tip}`,
      propagate: style.propagate,
    };
  }

  refresh() {
    this.emitter.fire(undefined);
  }
}

module.exports = { DecorationProvider };
