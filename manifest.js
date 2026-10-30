'use strict';
// package.json 생성기. `node manifest.js`로 다시 만든다(package.json을 직접 고치지 않는다).
//
// 언어는 전체(svnTools.language)와 영역별(메뉴·Source Control 패널·문구, 기본은 전체를 따름)로 고른다(사용자 결정 2026-10-24).
// VS Code는 메뉴 이름을 package.json에 고정 문자열로만 받아서, 명령 하나를 svnTools.<id>.en / svnTools.<id>.ko
// 두 개로 펼치고 메뉴에는 그 영역 언어와 맞는 쪽만 보이게 when 조건을 붙인다. 처리 함수는 extension.js가 같은 것을 묶는다.
const fs = require('fs');
const path = require('path');
const { LANGUAGES } = require('./src/languages');

const pkg = {
  name: 'svn-tools',
  displayName: 'SVN Tools',
  description: 'SVN Source Control panel, explorer context menu (SVN / TortoiseSVN) and status decorations including ignored files.',
  version: '1.0.1',
  publisher: 'khoon',
  // 마켓플레이스는 SVG 아이콘을 받지 않아 256px PNG를 쓴다.
  icon: 'images/icon.png',
  license: 'MIT',
  repository: { type: 'git', url: 'https://github.com/pugi-kh/vscode-svn-tools.git' },
  bugs: { url: 'https://github.com/pugi-kh/vscode-svn-tools/issues' },
  homepage: 'https://github.com/pugi-kh/vscode-svn-tools#readme',
  private: true,
  engines: { vscode: '^1.80.0' },
  categories: ['SCM Providers'],
  // 마켓플레이스·확장 검색어(최대 30개). git 확장이 아니므로 git은 넣지 않는다.
  keywords: [
    'svn', 'subversion', 'tortoisesvn', 'tortoise', 'scm', 'source control', 'version control',
    'svn ignore', 'staging', 'commit', 'diff', 'blame', 'log',
  ],
  extensionKind: ['workspace'],
  // 제한 모드(신뢰하지 않은 폴더)에서는 svn을 실행하지 않는다. 선언해 두면 VS Code가 꺼진 이유를 화면에 안내한다.
  capabilities: {
    untrustedWorkspaces: { supported: false, description: 'SVN Tools runs svn commands in the opened folder, so it needs a trusted workspace.' },
    virtualWorkspaces: false,
  },
  activationEvents: ['onStartupFinished'],
  main: './src/extension.js',
  scripts: {
    manifest: 'node manifest.js',
    test: 'node manifest.js && node test/svn-paths.js && node test/manifest-check.js',
    package: 'node manifest.js && npx --yes @vscode/vsce package',
    'install-vscode': 'node install.js',
  },
};

// [id, 영어, 한국어, 아이콘]
// 탐색기 우클릭 최상위에 바로 보이는 명령(update·add·stage·unstage·ignore)은 이름 앞에 SVN을 붙여 다른 메뉴와 구분한다.
const COMMANDS = [
  ['refresh', 'Refresh', '새로고침', '$(refresh)'],
  ['commitAll', 'Commit', '커밋', '$(check)'],
  ['commit', 'Commit…', '커밋…'],
  ['update', 'SVN Update', 'SVN 업데이트', '$(arrow-down)'],
  ['add', 'SVN Add', 'SVN 추가', '$(add)'],
  ['addInclude', 'Include Contents', '하위 항목 포함'],
  ['addExclude', 'Exclude Contents', '하위 항목 제외'],
  ['stage', 'SVN Stage', 'SVN 스테이징', '$(add)'],
  ['stageInclude', 'Include Contents', '하위 항목 포함'],
  ['stageExclude', 'Exclude Contents', '하위 항목 제외'],
  ['unstage', 'SVN Unstage', 'SVN 스테이징 취소', '$(remove)'],
  ['stageAll', 'Stage All', '모두 스테이징', '$(add)'],
  ['unstageAll', 'Unstage All', '모두 스테이징 취소', '$(remove)'],
  ['ignore', 'SVN Ignore…', 'SVN 무시 목록에 추가…'],
  ['diff', 'Compare with BASE', 'BASE와 비교', '$(diff)'],
  ['diffRevision', 'Compare with Revision…', '리비전과 비교…'],
  ['openFile', 'Open File', '파일 열기', '$(go-to-file)'],
  ['revert', 'Revert', '되돌리기', '$(discard)'],
  ['revertAll', 'Revert All', '모두 되돌리기', '$(discard)'],
  ['deleteKeepLocal', 'Keep Local File', '로컬 파일은 유지'],
  ['deleteLocal', 'Delete Local File Too', '로컬 파일도 삭제'],
  ['rename', 'Rename (keep history)', '이름 바꾸기 (이력 유지)'],
  ['applyRename', 'SVN Apply Rename', 'SVN 이름 바꾸기로 적용'],
  ['ignoreReason', 'Show Ignore Reason…', '무시된 원인 보기…'],
  ['editIgnores', 'Edit Ignore Lists…', '무시 목록 편집…', '$(eye-closed)'],
  ['editColors', 'Edit Status Colors…', '상태 색 편집…', '$(symbol-color)'],
  ['log', 'Show Log', '로그 보기', '$(history)'],
  ['resolve', 'Resolve Conflict…', '충돌 해결…'],
  ['cleanup', 'Clean Up', '정리 (Cleanup)'],
  ['copyUrl', 'Copy SVN URL', 'SVN URL 복사'],
  ['historyRefresh', 'Refresh History', '이력 새로고침', '$(refresh)'],
  ['historyCopyMessage', 'Copy Commit Message', '커밋 메시지 복사', '$(copy)'],
  ['setupSvn', 'Install svn Command Line Tools…', 'svn 명령줄 도구 설치…'],
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
  ['addMenu', 'SVN Add', 'SVN 추가'],
  ['stageMenu', 'SVN Stage', 'SVN 스테이징'],
];

// 탐색기 우클릭 최상위: 항목 상태에 맞는 것만 보인다. [id, group, 조건]
// 상태는 확장이 새로고침마다 넘기는 경로 목록으로 안다(extension.js onRepoChange, repository.js contextLists):
//   svnTools.addable(새 파일) → SVN Add, svnTools.stageable(수정 파일) → SVN Stage, svnTools.staged → SVN Unstage,
//   svnTools.renamable(svn 없이 이름을 바꾼 새 이름) → SVN Apply Rename(맨 위).
// 메뉴 조건은 우클릭한 항목 하나만 본다. 여러 개를 고르면 상태를 알 수 없어서 SVN Stage ▸ 하나로 보이고,
// 누른 뒤 항목별로 add할지 스테이징할지 나눠 처리한다(commands.js stageItems). 폴더면 하위 항목 포함·제외를 고른다.
const ADDABLE = 'resourcePath in svnTools.addable';
const STAGEABLE = 'resourcePath in svnTools.stageable';
const STAGED = 'resourcePath in svnTools.staged';
const RENAMABLE = 'resourcePath in svnTools.renamable';
const SINGLE = '!listMultiSelection';
const TOP_LEVEL = [
  ['applyRename', '7_svn@0', RENAMABLE],
  ['update', '7_svn@1'],
  ['add', '7_svn@2', `${ADDABLE} && !explorerResourceIsFolder && ${SINGLE}`],
  ['submenu:addMenu', '7_svn@2', `${ADDABLE} && explorerResourceIsFolder && ${SINGLE}`],
  ['stage', '7_svn@3', `${STAGEABLE} && !explorerResourceIsFolder && ${SINGLE}`],
  ['submenu:stageMenu', '7_svn@3', `(listMultiSelection || ${STAGEABLE} && explorerResourceIsFolder)`],
  ['unstage', '7_svn@4', STAGED],
  ['ignore', '7_svn@5', `(${ADDABLE} || listMultiSelection)`],
];

// 탐색기 "SVN" 하위 메뉴(최상위에 있는 것은 빼서 중복을 없앤다): [id 또는 submenu:<id>, group]
const SVN_SUBMENU = [
  ['commit', '1_sync@1'],
  ['diff', '2_view@1'], ['diffRevision', '2_view@2'], ['log', '2_view@3'],
  ['submenu:delete', '3_edit@1'], ['rename', '3_edit@2'], ['revert', '3_edit@3'], ['resolve', '3_edit@4'],
  ['ignoreReason', '4_ignore@1'], ['editIgnores', '4_ignore@2'],
  ['cleanup', '5_misc@1'], ['copyUrl', '5_misc@2'],
];

// 하위 메뉴는 기본·자주 쓰는 동작을 위에 둔다.
const DELETE_SUBMENU = [['deleteKeepLocal', '1@1'], ['deleteLocal', '1@2']];
const ADD_SUBMENU = [['addInclude', '1@1'], ['addExclude', '1@2']];
const STAGE_SUBMENU = [['stageInclude', '1@1'], ['stageExclude', '1@2']];

// 명령 팔레트에 보일 명령. 인자 없이 부르면 열린 편집기 파일(없으면 작업 폴더)이 대상이고,
// Commit은 패널 Commit과 같이 스테이징된 것을 커밋한다(commands.js commitAll).
const PALETTE = ['commitAll', 'update', 'refresh', 'stage', 'unstage', 'stageAll', 'unstageAll', 'diff', 'diffRevision', 'log', 'revert', 'editIgnores', 'editColors', 'cleanup'];

const SCM = 'scmProvider == svnTools';
const HISTORY = 'view == svnTools.history';
// 영역 언어가 lang인가: 영역 설정이 lang이거나, default면서 전체 언어가 lang. area: 'menu' | 'scm'
const langWhen = (lang, area = 'menu') => {
  const k = `config.svnTools.${area}Language`;
  return `(${k} == '${lang}' || ${k} == 'default' && config.svnTools.language == '${lang}')`;
};
const and = (...parts) => parts.filter(Boolean).join(' && ');

// ---- 명령 ----
const commands = [];
for (const lang of LANGUAGES) {
  const pick = (en, ko) => (lang === 'ko' ? ko : en);
  for (const [id, en, ko, icon] of COMMANDS) {
    // 제목이 이미 "SVN …"이면 category를 빼서 팔레트에 "SVN: SVN Update"처럼 겹쳐 보이지 않게 한다.
    const category = en.startsWith('SVN ') ? undefined : 'SVN';
    commands.push({ command: `svnTools.${id}.${lang}`, title: pick(en, ko), ...(category && { category }), ...(icon && { icon }) });
  }
  for (const [id, en, ko] of TORTOISE) {
    commands.push({ command: `svnTools.tortoise.${id}.${lang}`, title: pick(en, ko), category: 'TortoiseSVN' });
  }
}

// 메뉴 항목 하나를 언어별로 펼친다. 'submenu:<id>'는 언어별 하위 메뉴(svnTools.<id>.<lang>)를 가리킨다.
function target(id, lang) {
  return id.startsWith('submenu:') ? { submenu: `svnTools.${id.slice(8)}.${lang}` } : { command: `svnTools.${id}.${lang}` };
}
function item(id, group, when, area = 'menu') {
  return LANGUAGES.map((lang) => ({ ...target(id, lang), group, when: and(langWhen(lang, area), when) }));
}
// 패널(scm/*) 메뉴는 패널 언어를 따른다.
const scmItem = (id, group, when) => item(id, group, when, 'scm');

// ---- 메뉴 ----
const fileWhen = 'svnTools.active && resourceScheme == file';
const contextMenu = (when) => [
  ...TOP_LEVEL.flatMap(([id, group, extra]) => item(id, group, and(when, extra))),
  ...item('submenu:svn', '7_svn@6', when),
  ...item('submenu:tortoise', '7_svn@7', when),
];
// Source Control 패널 항목의 상태(repository.js resourceState의 contextValue): staged | changed | unversioned | conflicted
const st = (...names) => `(${names.map((n) => `scmResourceState == ${n}`).join(' || ')})`;
const grp = (...names) => `(${names.map((n) => `scmResourceGroup == ${n}`).join(' || ')})`;
const menus = {
  'explorer/context': contextMenu('svnTools.active'),
  'editor/title/context': contextMenu(fileWhen),
  'scm/title': [
    ...scmItem('commitAll', 'navigation@1', SCM),
    ...scmItem('update', 'navigation@2', SCM),
    ...scmItem('refresh', 'navigation@3', SCM),
    ...scmItem('log', '1_misc@1', SCM),
    ...scmItem('cleanup', '1_misc@2', SCM),
    ...scmItem('editIgnores', '1_misc@3', SCM),
    ...scmItem('submenu:tortoise', '2_tortoise@1', SCM),
  ],
  'scm/resourceGroup/context': [
    ...scmItem('unstageAll', 'inline', and(SCM, grp('staged'))),
    ...scmItem('revertAll', 'inline', and(SCM, grp('changes'))),
    ...scmItem('stageAll', 'inline', and(SCM, grp('changes', 'unversioned'))),
    ...scmItem('unstageAll', '1_edit', and(SCM, grp('staged'))),
    ...scmItem('stageAll', '1_edit', and(SCM, grp('changes', 'unversioned'))),
    ...scmItem('revertAll', '1_edit', and(SCM, grp('changes'))),
  ],
  'scm/resourceState/context': [
    ...scmItem('openFile', 'inline@1', SCM),
    ...scmItem('revert', 'inline@2', and(SCM, st('changed'))),
    ...scmItem('stage', 'inline@3', and(SCM, st('changed', 'unversioned'))),
    ...scmItem('unstage', 'inline@3', and(SCM, st('staged'))),
    ...scmItem('stage', '1_stage@1', and(SCM, st('changed', 'unversioned'))),
    ...scmItem('unstage', '1_stage@2', and(SCM, st('staged'))),
    ...scmItem('diff', '2_view@1', and(SCM, st('changed', 'staged'))),
    ...scmItem('diffRevision', '2_view@2', and(SCM, st('changed', 'staged'))),
    ...scmItem('log', '2_view@3', and(SCM, st('changed', 'staged'))),
    ...scmItem('revert', '3_edit@1', and(SCM, st('changed', 'staged'))),
    ...scmItem('resolve', '3_edit@2', and(SCM, st('conflicted'))),
    ...scmItem('submenu:delete', '3_edit@3', and(SCM, st('changed', 'staged'))),
    ...scmItem('ignore', '3_edit@4', and(SCM, st('unversioned'))),
    ...scmItem('submenu:tortoise', '4_tortoise@1', SCM),
  ],
  // SVN 이력 뷰(src/historyView.js). 패널 아래에 있어서 패널 언어를 따른다.
  'view/title': [
    ...scmItem('update', 'navigation@1', HISTORY),
    ...scmItem('historyRefresh', 'navigation@2', HISTORY),
  ],
  'view/item/context': [
    ...scmItem('historyCopyMessage', 'inline', and(HISTORY, 'viewItem == commit')),
    ...scmItem('historyCopyMessage', '1_copy', and(HISTORY, 'viewItem == commit')),
  ],
  // 팔레트에는 설정 언어 쪽의 PALETTE 명령과 TortoiseSVN 명령만 보인다. 나머지는 고른 항목이 있어야 뜻이 있다.
  commandPalette: commands.map((c) => {
    const [, id, lang] = /^svnTools\.(.+)\.(\w+)$/.exec(c.command);
    // svn 설치는 svn이 없어 작업 사본을 못 연 상태(svnTools.active 거짓)에서 쓴다
    if (id === 'setupSvn') return { command: c.command, when: langWhen(lang) };
    const shown = PALETTE.includes(id) || id.startsWith('tortoise.');
    return { command: c.command, when: shown ? and(langWhen(lang), 'svnTools.active') : 'false' };
  }),
};

// 언어별 하위 메뉴의 내용. 하위 메뉴 자체가 언어별이라 안쪽 항목에는 언어 조건을 붙이지 않는다
// (같은 TortoiseSVN 하위 메뉴를 탐색기는 메뉴 언어로, 패널은 패널 언어로 연다).
for (const lang of LANGUAGES) {
  const inner = (list) => list.map(([id, group]) => ({ ...target(id, lang), group }));
  menus[`svnTools.svn.${lang}`] = inner(SVN_SUBMENU);
  menus[`svnTools.tortoise.${lang}`] = inner(TORTOISE.map(([id], i) => [`tortoise.${id}`, `${TORTOISE_GROUPS[id]}@${i}`]));
  menus[`svnTools.delete.${lang}`] = inner(DELETE_SUBMENU);
  menus[`svnTools.addMenu.${lang}`] = inner(ADD_SUBMENU);
  menus[`svnTools.stageMenu.${lang}`] = inner(STAGE_SUBMENU);
}

// 설정 화면은 묶음(title)별로 나뉜다. 언어 묶음은 전체 → 영역별 순서(order)로 위계가 보이게 한다.
// VS Code 설정 화면에는 "다른 설정 값에 따라 칸을 켜고 끄는" 기능이 없어서, 영역별 설정은 default(전체를 따름)를 둔다.
const AREA = ['default', 'en', 'ko'];
const AREA_DESCRIPTIONS = ['전체 언어를 따름 / Same as Language (all)', 'English', '한국어'];
const languageConfiguration = {
  title: 'Language / 언어',
  properties: {
    'svnTools.language': {
      type: 'string', enum: ['en', 'ko'], default: 'en', order: 0,
      enumDescriptions: ['English', '한국어'],
      markdownDescription: '**전체 언어.** 아래 세 영역 중 "전체 언어를 따름"으로 둔 곳에 쓰인다.\n\n'
        + '**Language for everything.** Used by each area below that is set to "Same as Language (all)".',
    },
    'svnTools.menuLanguage': {
      type: 'string', enum: AREA, default: 'default', order: 1,
      enumDescriptions: AREA_DESCRIPTIONS,
      markdownDescription: '└ **우클릭 메뉴 언어** — 탐색기·편집기 탭 우클릭의 SVN Add / SVN Stage 등과 SVN ▸, TortoiseSVN ▸ 하위 메뉴, '
        + '명령 팔레트(Ctrl+Shift+P)의 명령 이름.\n\n'
        + '└ **Context menu language** — SVN items and the SVN ▸ / TortoiseSVN ▸ submenus in the explorer and editor tab context menus, '
        + 'and command names in the Command Palette.',
    },
    'svnTools.scmLanguage': {
      type: 'string', enum: AREA, default: 'default', order: 2,
      enumDescriptions: AREA_DESCRIPTIONS,
      markdownDescription: '└ **Source Control 패널 언어** — 그룹 이름(Staged Changes / Changes …), 패널 위쪽·항목 옆 버튼과 패널 우클릭 메뉴, '
        + '커밋 메시지 입력칸의 안내 문구.\n\n'
        + '└ **Source Control panel language** — group names, the buttons and context menus in the panel, and the commit message hint.',
    },
    'svnTools.messageLanguage': {
      type: 'string', enum: AREA, default: 'default', order: 3,
      enumDescriptions: AREA_DESCRIPTIONS,
      markdownDescription: '└ **알림·창 언어** — 오른쪽 아래 알림, 확인 창, 입력·선택 창, 무시 목록 편집·무시된 원인·커밋 확인 탭, '
        + '탐색기 상태 툴팁.\n\n'
        + '└ **Notification and view language** — notifications, dialogs, input and pick boxes, the ignore list / ignore reason / '
        + 'commit review tabs, and explorer status tooltips.',
    },
  },
};

const configuration = {
  title: 'SVN Tools',
  properties: {
    'svnTools.commit.smartCommit': {
      type: 'string', enum: ['ask', 'always', 'never'], default: 'ask',
      enumDescriptions: ['물어본다 / Ask', '항상 변경을 모두 스테이징하고 이어서 커밋 / Always stage all changes and continue', '스테이징하지 않는다 / Never'],
      markdownDescription: '스테이징된 변경이 없을 때 Commit을 누르면. 확인 창의 "다시 묻지 않음"은 `never`로 바꾼다.\n\n'
        + 'When committing with nothing staged. "Never" in the dialog sets this to `never`.',
    },
    'svnTools.rename.askOnRename': {
      type: 'boolean', default: true,
      markdownDescription: '**이름 바꾸기 알림 사용.** 탐색기(F2 등)에서 관리 중인 파일·폴더 이름을 바꾸면 SVN 이름 바꾸기(이력 유지)로 적용할지 '
        + '묻는다. 알림의 "다시 묻지 않음"은 이 설정을 끈다. 꺼도 우클릭 SVN Apply Rename은 쓸 수 있다.\n\n'
        + '**Rename notification.** Ask whether to apply explorer renames of versioned items as SVN renames (history kept). '
        + '"Don\'t Ask Again" turns this off. SVN Apply Rename in the context menu still works.',
    },
    // 켜기와 간격을 따로 둔다 — "0이면 끔"은 설정 화면에서 알아보기 어렵다(사용자 의견)
    'svnTools.history.autoRefresh': {
      type: 'boolean', default: true,
      description: 'SVN 이력 칸 자동 확인: 칸이 보이고 VS Code 창이 앞에 있을 때 서버의 새 커밋을 주기적으로 확인한다 / '
        + 'Check for new commits periodically while the SVN History view is visible and the window is focused',
    },
    'svnTools.history.autoRefreshMinutes': {
      type: 'number', default: 5, minimum: 1,
      description: 'SVN 이력 칸 자동 확인 간격(분). 자동 확인이 켜져 있을 때 쓴다 / Minutes between checks, when automatic check is on',
    },
    'svnTools.commit.review': {
      type: 'boolean', default: true,
      description: '커밋 확인 탭 사용: 커밋 직전에 메시지와 올라갈 항목을 한 번 더 보여 준다 / Use the commit review tab: show the message and items right before committing',
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
      markdownDescription: '탐색기에 SVN 상태(배지·색, 무시된 파일 회색)를 표시한다. 무시 목록은 [무시 목록 편집 열기](command:svnTools.editIgnores), 색은 [상태 색 편집 열기](command:svnTools.editColors)에서 고친다.\n\n'
        + 'Show SVN status in the explorer (badges, colors, ignored files in grey). [Edit Ignore Lists](command:svnTools.editIgnores) · [Edit Status Colors](command:svnTools.editColors)',
    },
    'svnTools.svnPath': {
      type: 'string', default: '',
      description: 'svn.exe 경로. 비우거나 없는 경로면 PATH → TortoiseSVN 폴더 → SlikSVN 폴더 → 시스템 PATH(레지스트리) 순서로 찾는다 / '
        + 'Path to svn.exe. If empty or missing: PATH, TortoiseSVN folder, SlikSVN folder, then the system PATH from the registry',
    },
    'svnTools.tortoiseProcPath': {
      type: 'string', default: '',
      description: 'TortoiseProc.exe 경로. 비우면 C:\\Program Files\\TortoiseSVN\\bin\\TortoiseProc.exe / Path to TortoiseProc.exe',
    },
  },
};

// 상태별 색. 사용자가 settings.json의 workbench.colorCustomizations로 git 색과 따로 바꿀 수 있다(상태 색 편집 화면 src/colorView.js도 같은 곳에 쓴다).
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
  // 제목은 historyView.js가 언어 설정에 맞춰 바꾼다(여기 이름은 처음 그릴 때만 보인다)
  views: { scm: [{ id: 'svnTools.history', name: 'SVN History', when: 'svnTools.active' }] },
  configuration: [configuration, languageConfiguration],
};

fs.writeFileSync(path.join(__dirname, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`package.json: commands ${commands.length}`);
