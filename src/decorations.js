'use strict';
// 탐색기·Source Control 패널의 파일 표시(배지와 색).
// 색은 이 확장의 색상 ID(svnTools.*, manifest.js의 colors)를 쓴다 — 사용자가 workbench.colorCustomizations로
// git 색과 따로 바꿀 수 있게. 기본값은 git 색을 그대로 가리킨다.
const vscode = require('vscode');
const { t } = require('./i18n');

const STYLE = {
  M: { badge: 'M', color: 'svnTools.modifiedForeground', tip: 'tipModified' },
  R: { badge: 'R', color: 'svnTools.modifiedForeground', tip: 'tipReplaced' },
  A: { badge: 'A', color: 'svnTools.addedForeground', tip: 'tipAdded' },
  D: { badge: 'D', color: 'svnTools.deletedForeground', tip: 'tipDeleted' },
  '!': { badge: '!', color: 'svnTools.deletedForeground', tip: 'tipMissing' },
  C: { badge: 'C', color: 'svnTools.conflictedForeground', tip: 'tipConflict' },
  '~': { badge: '~', color: 'svnTools.conflictedForeground', tip: 'tipObstructed' },
  N: { badge: '!', color: 'svnTools.conflictedForeground', tip: 'tipIncomplete' },
  // 미등록 폴더 안의 파일도 U(provideFileDecoration에서 상위를 따라 올라가 판정).
  '?': { badge: 'U', color: 'svnTools.unversionedForeground', tip: 'tipUnversioned' },
  // 무시된 파일은 배지 없이 색만. 무시된 폴더 안의 파일도 Repository.statusOf가 'I'를 돌려준다.
  I: { badge: undefined, color: 'svnTools.ignoredForeground', tip: 'tipIgnored' },
};

// 폴더 안 상태 표시(●)의 우선순위(고정, 사용자 결정): 충돌 > 삭제·누락 > 수정 > 추가 > 미등록. 점 색은 맨 앞 상태를 따른다.
const INSIDE_ORDER = ['C', '~', 'N', 'D', '!', 'M', 'R', 'A', '?'];

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
    const own = code && STYLE[code];
    const inside = insideTip(repo.insideOf(uri.fsPath));
    if (own) {
      // 스테이징된 항목은 이니셜·색은 그대로 두고 배지 뒤에 +를 붙인다(패널의 + 버튼과 같은 기호).
      const staged = own.badge && repo.isStaged(uri.fsPath);
      return {
        badge: staged ? `${own.badge}+` : own.badge,
        color: new vscode.ThemeColor(own.color),
        tooltip: `SVN: ${t(own.tip)}${staged ? ` (${t('tipStaged')})` : ''}${inside ? `\n${inside.tip}` : ''}`,
      };
    }
    if (!inside) return undefined;
    return { badge: '●', color: new vscode.ThemeColor(inside.color), tooltip: inside.tip };
  }

  refresh() {
    this.emitter.fire(undefined);
  }
}

// 하위 상태별 개수 → 툴팁 "SVN 하위: 충돌 1 · 수정됨 3"과 점 색.
function insideTip(counts) {
  if (!counts) return undefined;
  const codes = INSIDE_ORDER.filter((c) => counts[c]);
  if (!codes.length) return undefined;
  const parts = codes.map((c) => `${t(STYLE[c].tip)} ${counts[c]}`);
  return { color: STYLE[codes[0]].color, tip: `SVN ${t('tipInside')}: ${parts.join(' · ')}` };
}

module.exports = { DecorationProvider };
