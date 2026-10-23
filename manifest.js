'use strict';
// package.json 생성기. `node manifest.js`로 다시 만든다(package.json을 직접 고치지 않는다).
//
// 메뉴 이름 언어(svnTools.menuLanguage)와 문구 언어(svnTools.language)는 따로 고른다(사용자 결정 2026-10-23).
// VS Code는 메뉴 이름을 package.json에 고정 문자열로만 받아서, 명령 하나를 svnTools.<id>.en / svnTools.<id>.ko
// 두 개로 펼치고 메뉴에는 설정 언어와 맞는 쪽만 보이게 when 조건을 붙인다. 처리 함수는 extension.js가 같은 것을 묶는다.
const fs = require('fs');
const path = require('path');
const { LANGUAGES } = require('./src/languages');

const pkg = {
  name: 'vscode-svn-tools',
  displayName: 'SVN Tools',
  description: 'SVN Source Control panel, explorer context menu (SVN / TortoiseSVN) and status decorations including ignored files.',
  version: '0.8.0',
  publisher: 'khoon',
  license: 'MIT',
  repository: { type: 'git', url: 'https://github.com/pugi-kh/vscode-svn-tools.git' },
  bugs: { url: 'https://github.com/pugi-kh/vscode-svn-tools/issues' },
  homepage: 'https://github.com/pugi-kh/vscode-svn-tools#readme',
  private: true,
  engines: { vscode: '^1.80.0' },
  categories: ['SCM Providers'],
  extensionKind: ['workspace'],
  activationEvents: ['onStartupFinished'],
  main: './src/extension.js',
  scripts: {
    manifest: 'node manifest.js',
    test: 'node manifest.js && node test/svn-paths.js && node test/manifest-check.js',
    package: 'node manifest.js && npx --yes @vscode/vsce package',
  },
};

// [id, 영어, 한국어, 아이콘]
// update·commit·add·ignore는 탐색기 우클릭 최상위에 바로 보이므로 이름 앞에 SVN을 붙여 다른 메뉴와 구분한다.
const COMMANDS = [
  ['refresh', 'Refresh', '새로고침', '$(refresh)'],
  ['commitAll', 'Commit', '커밋', '$(check)'],
  ['commit', 'SVN Commit…', 'SVN 커밋…'],
  ['update', 'SVN Update', 'SVN 업데이트', '$(arrow-down)'],
  ['add', 'SVN Add', 'SVN 추가', '$(add)'],
  ['ignore', 'SVN Ignore…', 'SVN 무시 목록에 추가…'],
  ['diff', 'Compare with BASE', 'BASE와 비교', '$(diff)'],
  ['diffRevision', 'Compare with Revision…', '리비전과 비교…'],
  ['openFile', 'Open File', '파일 열기', '$(go-to-file)'],
  ['revert', 'Revert', '되돌리기', '$(discard)'],
  ['revertAll', 'Revert All', '모두 되돌리기', '$(discard)'],
  ['addAll', 'Add All', '모두 추가', '$(add)'],
  ['deleteKeepLocal', 'Keep Local File', '로컬 파일은 유지'],
  ['deleteLocal', 'Delete Local File Too', '로컬 파일도 삭제'],
  ['rename', 'Rename (keep history)', '이름 바꾸기 (이력 유지)'],
  ['ignoreReason', 'Show Ignore Reason…', '무시된 원인 보기…'],
  ['editIgnores', 'Edit Ignore Lists…', '무시 목록 편집…', '$(eye-closed)'],
  ['log', 'Show Log', '로그 보기', '$(history)'],
  ['resolve', 'Resolve Conflict…', '충돌 해결…'],
  ['cleanup', 'Clean Up', '정리 (Cleanup)'],
  ['copyUrl', 'Copy SVN URL', 'SVN URL 복사'],
];

// TortoiseSVN 창으로 여는 명령. id는 src/tortoise.js의 COMMANDS 키와 같다. 영어 이름은 TortoiseSVN 메뉴와 맞춘다.
const TORTOISE = [
  ['update', 'Update', '업데이트'],
  ['commit', 'Commit', '커밋'],
  ['log', 'Show Log', '로그 보기'],
  ['diff', 'Diff', '비교'],
  ['revisiongraph', 'Revision Graph', '리비전 그래프'],
  ['repobrowser', 'Repo-browser', '저장소 탐색기'],
  ['blame', 'Blame', 'Blame'],
  ['add', 'Add', '추가'],
  ['remove', 'Delete', '삭제'],
  ['rename', 'Rename', '이름 바꾸기'],
  ['revert', 'Revert', '되돌리기'],
  ['conflicteditor', 'Edit Conflicts', '충돌 편집'],
  ['resolve', 'Resolved', '해결됨으로 표시'],
  ['ignore', 'Add to Ignore List', '무시 목록에 추가'],
  ['properties', 'Properties', '속성'],
  ['merge', 'Merge', '병합'],
  ['switch', 'Switch', '전환'],
  ['lock', 'Get Lock', '잠금'],
  ['unlock', 'Release Lock', '잠금 해제'],
  ['cleanup', 'Clean Up', '정리'],
  ['settings', 'Settings', '설정'],
];

// TortoiseSVN 하위 메뉴의 묶음(구분선 단위)
const TORTOISE_GROUPS = {
  update: '1_sync', commit: '1_sync',
  log: '2_view', diff: '2_view', revisiongraph: '2_view', repobrowser: '2_view', blame: '2_view',
  add: '3_edit', remove: '3_edit', rename: '3_edit', revert: '3_edit', conflicteditor: '3_edit', resolve: '3_edit',
  ignore: '4_props', properties: '4_props',
  merge: '5_branch', switch: '5_branch', lock: '5_branch', unlock: '5_branch',
  cleanup: '6_misc', settings: '6_misc',
};

// 하위 메뉴 이름: [id, 영어, 한국어]
const SUBMENUS = [
  ['svn', 'SVN', 'SVN'],
  ['tortoise', 'TortoiseSVN', 'TortoiseSVN'],
  ['delete', 'Delete', 'SVN에서 삭제'],
];

// 탐색기 우클릭 최상위에 바로 보이는 자주 쓰는 명령: [id, group]
const TOP_LEVEL = [['update', '7_svn@1'], ['commit', '7_svn@2'], ['add', '7_svn@3'], ['ignore', '7_svn@4']];

// 탐색기 "SVN" 하위 메뉴(최상위에 있는 것은 빼서 중복을 없앤다): [id 또는 submenu:<id>, group]
const SVN_SUBMENU = [
  ['diff', '2_view@1'], ['diffRevision', '2_view@2'], ['log', '2_view@3'],
  ['submenu:delete', '3_edit@1'], ['rename', '3_edit@2'], ['revert', '3_edit@3'], ['resolve', '3_edit@4'],
  ['ignoreReason', '4_ignore@1'], ['editIgnores', '4_ignore@2'],
  ['cleanup', '5_misc@1'], ['copyUrl', '5_misc@2'],
];

const DELETE_SUBMENU = [['deleteKeepLocal', '1@1'], ['deleteLocal', '1@2']];

const SCM = 'scmProvider == svnTools';
const langWhen = (lang) => `config.svnTools.menuLanguage == '${lang}'`;
const and = (...parts) => parts.filter(Boolean).join(' && ');

// ---- 명령 ----
const commands = [];
for (const lang of LANGUAGES) {
  const pick = (en, ko) => (lang === 'ko' ? ko : en);
  for (const [id, en, ko, icon] of COMMANDS) {
    commands.push({ command: `svnTools.${id}.${lang}`, title: pick(en, ko), category: 'SVN', ...(icon && { icon }) });
  }
  for (const [id, en, ko] of TORTOISE) {
    commands.push({ command: `svnTools.tortoise.${id}.${lang}`, title: pick(en, ko), category: 'TortoiseSVN' });
  }
}

// 메뉴 항목 하나를 언어별로 펼친다. 'submenu:<id>'는 언어별 하위 메뉴(svnTools.<id>.<lang>)를 가리킨다.
function item(id, group, when) {
  return LANGUAGES.map((lang) => {
    const target = id.startsWith('submenu:')
      ? { submenu: `svnTools.${id.slice(8)}.${lang}` }
      : { command: `svnTools.${id}.${lang}` };
    return { ...target, group, when: and(langWhen(lang), when) };
  });
}

// ---- 메뉴 ----
const fileWhen = 'svnTools.active && resourceScheme == file';
const contextMenu = (when) => [
  ...TOP_LEVEL.flatMap(([id, group]) => item(id, group, when)),
  ...item('submenu:svn', '7_svn@5', when),
  ...item('submenu:tortoise', '7_svn@6', when),
];
const menus = {
  'explorer/context': contextMenu('svnTools.active'),
  'editor/title/context': contextMenu(fileWhen),
  'scm/title': [
    ...item('commitAll', 'navigation@1', SCM),
    ...item('update', 'navigation@2', SCM),
    ...item('refresh', 'navigation@3', SCM),
    ...item('log', '1_misc@1', SCM),
    ...item('cleanup', '1_misc@2', SCM),
    ...item('editIgnores', '1_misc@3', SCM),
    ...item('submenu:tortoise', '2_tortoise@1', SCM),
  ],
  'scm/resourceGroup/context': [
    ...item('revertAll', 'inline', and(SCM, 'scmResourceGroup == changes')),
    ...item('addAll', 'inline', and(SCM, 'scmResourceGroup == unversioned')),
    ...item('revertAll', '1_edit', and(SCM, 'scmResourceGroup == changes')),
    ...item('addAll', '1_edit', and(SCM, 'scmResourceGroup == unversioned')),
  ],
  'scm/resourceState/context': [
    ...item('openFile', 'inline@1', SCM),
    ...item('revert', 'inline@2', and(SCM, 'scmResourceState != unversioned')),
    ...item('add', 'inline@2', and(SCM, 'scmResourceState == unversioned')),
    ...item('commit', '1_commit@1', and(SCM, 'scmResourceState != unversioned')),
    ...item('diff', '2_view@1', and(SCM, 'scmResourceState != unversioned')),
    ...item('diffRevision', '2_view@2', and(SCM, 'scmResourceState != unversioned')),
    ...item('log', '2_view@3', and(SCM, 'scmResourceState != unversioned')),
    ...item('add', '3_edit@1', and(SCM, 'scmResourceState == unversioned')),
    ...item('revert', '3_edit@2', and(SCM, 'scmResourceState != unversioned')),
    ...item('resolve', '3_edit@3', and(SCM, 'scmResourceState == conflicted')),
    ...item('submenu:delete', '3_edit@4', SCM),
    ...item('ignore', '3_edit@5', and(SCM, 'scmResourceState == unversioned')),
    ...item('submenu:tortoise', '4_tortoise@1', SCM),
  ],
  // 팔레트에는 설정 언어 쪽만 보인다. 그룹·패널 전용 명령은 숨긴다.
  commandPalette: commands.map((c) => {
    const lang = c.command.split('.').pop();
    const hidden = /\.(revertAll|addAll|openFile|commitAll)\.\w+$/.test(c.command);
    return { command: c.command, when: hidden ? 'false' : and(langWhen(lang), 'svnTools.active') };
  }),
};
// 언어별 하위 메뉴의 내용
for (const lang of LANGUAGES) {
  const only = (items) => items.filter((x) => x.when.startsWith(langWhen(lang)));
  menus[`svnTools.svn.${lang}`] = only(SVN_SUBMENU.flatMap(([id, group]) => item(id, group)));
  menus[`svnTools.tortoise.${lang}`] = only(TORTOISE.flatMap(([id], i) => item(`tortoise.${id}`, `${TORTOISE_GROUPS[id]}@${i}`)));
  menus[`svnTools.delete.${lang}`] = only(DELETE_SUBMENU.flatMap(([id, group]) => item(id, group)));
}

const configuration = {
  title: 'SVN Tools',
  properties: {
    'svnTools.menuLanguage': {
      type: 'string', enum: ['en', 'ko'], default: 'en',
      enumDescriptions: ['English', '한국어'],
      description: '메뉴·버튼·Source Control 그룹 이름의 언어 / Language of menus, buttons and Source Control group names',
    },
    'svnTools.language': {
      type: 'string', enum: ['en', 'ko'], default: 'en',
      enumDescriptions: ['English', '한국어'],
      description: '알림·확인 창·화면 문구의 언어 / Language of messages, dialogs and views',
    },
    'svnTools.commit.checkOutOfDate': {
      type: 'boolean', default: true,
      description: '커밋 전에 서버에 더 새 버전이 있는지 확인한다(svn status -u) / Check the server for newer versions before committing',
    },
    'svnTools.scm.fadeUnversioned': {
      type: 'boolean', default: true,
      description: 'Source Control 패널에서 미등록 파일을 흐리게 표시한다 / Fade unversioned files in the Source Control panel',
    },
    'svnTools.decorations.enabled': {
      type: 'boolean', default: true,
      description: '탐색기에 SVN 상태(배지·색, 무시된 파일 회색)를 표시한다 / Show SVN status in the explorer',
    },
    'svnTools.svnPath': {
      type: 'string', default: '',
      description: 'svn.exe 경로. 비우면 PATH의 svn, 없으면 TortoiseSVN의 svn.exe / Path to svn.exe',
    },
    'svnTools.tortoiseProcPath': {
      type: 'string', default: '',
      description: 'TortoiseProc.exe 경로. 비우면 C:\\Program Files\\TortoiseSVN\\bin\\TortoiseProc.exe / Path to TortoiseProc.exe',
    },
  },
};

// 상태별 색. 사용자가 settings.json의 workbench.colorCustomizations로 git 색과 따로 바꿀 수 있다.
// 기본값은 git 색 ID를 가리켜 지금 테마의 git 표시와 같은 색이 된다.
const COLORS = [
  ['modifiedForeground', 'gitDecoration.modifiedResourceForeground', '수정·교체된 파일 / Modified or replaced'],
  ['addedForeground', 'gitDecoration.addedResourceForeground', '추가된 파일 / Added'],
  ['deletedForeground', 'gitDecoration.deletedResourceForeground', '삭제·누락된 파일 / Deleted or missing'],
  ['conflictedForeground', 'gitDecoration.conflictingResourceForeground', '충돌 파일 / Conflicted'],
  ['unversionedForeground', 'gitDecoration.untrackedResourceForeground', '미등록 파일 / Unversioned'],
  ['ignoredForeground', 'gitDecoration.ignoredResourceForeground', '무시된 파일 / Ignored'],
];
const colors = COLORS.map(([id, base, description]) => ({
  id: `svnTools.${id}`,
  description: `SVN: ${description}`,
  defaults: { dark: base, light: base, highContrast: base, highContrastLight: base },
}));

pkg.contributes = {
  commands,
  colors,
  submenus: LANGUAGES.flatMap((lang) => SUBMENUS.map(([id, en, ko]) => ({ id: `svnTools.${id}.${lang}`, label: lang === 'ko' ? ko : en }))),
  menus,
  configuration,
};

fs.writeFileSync(path.join(__dirname, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`package.json: commands ${commands.length}`);
