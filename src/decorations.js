'use strict';
// 탐색기·Source Control 패널의 파일 표시(배지와 색).
const vscode = require('vscode');

const STYLE = {
  M: { badge: 'M', color: 'gitDecoration.modifiedResourceForeground', tip: 'Modified', propagate: true },
  R: { badge: 'R', color: 'gitDecoration.modifiedResourceForeground', tip: 'Replaced', propagate: true },
  A: { badge: 'A', color: 'gitDecoration.addedResourceForeground', tip: 'Added', propagate: true },
  D: { badge: 'D', color: 'gitDecoration.deletedResourceForeground', tip: 'Deleted', propagate: true },
  '!': { badge: '!', color: 'gitDecoration.deletedResourceForeground', tip: 'Missing', propagate: true },
  C: { badge: 'C', color: 'gitDecoration.conflictingResourceForeground', tip: 'Conflict', propagate: true },
  '~': { badge: '~', color: 'gitDecoration.conflictingResourceForeground', tip: 'Obstructed', propagate: true },
  '?': { badge: 'U', color: 'gitDecoration.untrackedResourceForeground', tip: 'Unversioned', propagate: false },
  // 무시된 파일은 배지 없이 회색만. 무시된 폴더 안의 파일도 Repository.statusOf가 'I'를 돌려준다.
  I: { badge: undefined, color: 'gitDecoration.ignoredResourceForeground', tip: 'Ignored', propagate: false },
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
