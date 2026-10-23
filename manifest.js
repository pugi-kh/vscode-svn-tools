'use strict';
// package.json 생성기. `node manifest.js`로 다시 만든다(package.json을 직접 고치지 않는다).
//
// 메뉴·명령 이름은 영어로 고정한다(사용자 결정 2026-10-23 — svn 용어는 영어가 익숙하고 TortoiseSVN과 맞는다).
// 알림·확인 창·웹뷰 화면의 문구만 설정 svnTools.language를 따른다(src/i18n.js).
const fs = require('fs');
const path = require('path');

const pkg = {
  name: 'vscode-svn-tools',
  displayName: 'SVN Tools',
  description: 'SVN Source Control panel, explorer context menu (SVN / TortoiseSVN) and status decorations including ignored files.',
  version: '0.7.0',
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
    test: 'node test/svn-paths.js',
    package: 'node manifest.js && npx --yes @vscode/vsce package',
  },
};

// [id, 이름, 아이콘]
const COMMANDS = [
  ['refresh', 'Refresh', '$(refresh)'],
  ['commitAll', 'Commit', '$(check)'],
  ['commit', 'Commit…'],
  ['update', 'Update', '$(arrow-down)'],
  ['diff', 'Compare with BASE', '$(diff)'],
  ['openFile', 'Open File', '$(go-to-file)'],
  ['revert', 'Revert', '$(discard)'],
  ['revertAll', 'Revert All', '$(discard)'],
  ['add', 'Add', '$(add)'],
  ['addAll', 'Add All', '$(add)'],
  ['delete', 'Delete'],
  ['rename', 'Rename (keep history)'],
  ['ignore', 'Add to Ignore List…'],
  ['ignoreReason', 'Show Ignore Reason…'],
  ['editIgnores', 'Edit Ignore Lists…', '$(eye-closed)'],
  ['log', 'Show Log', '$(history)'],
  ['resolve', 'Resolve Conflict…'],
  ['cleanup', 'Clean Up'],
  ['copyUrl', 'Copy SVN URL'],
];

// TortoiseSVN 창으로 여는 명령. id는 src/tortoise.js의 COMMANDS 키와 같다. 이름은 TortoiseSVN 메뉴와 맞춘다.
const TORTOISE = [
  ['update', 'Update'],
  ['commit', 'Commit'],
  ['log', 'Show Log'],
  ['diff', 'Diff'],
  ['revisiongraph', 'Revision Graph'],
  ['repobrowser', 'Repo-browser'],
  ['blame', 'Blame'],
  ['add', 'Add'],
  ['remove', 'Delete'],
  ['rename', 'Rename'],
  ['revert', 'Revert'],
  ['conflicteditor', 'Edit Conflicts'],
  ['resolve', 'Resolved'],
  ['ignore', 'Add to Ignore List'],
  ['properties', 'Properties'],
  ['merge', 'Merge'],
  ['switch', 'Switch'],
  ['lock', 'Get Lock'],
  ['unlock', 'Release Lock'],
  ['cleanup', 'Clean Up'],
  ['settings', 'Settings'],
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

// 탐색기 "SVN" 하위 메뉴: [id, group]
const SVN_SUBMENU = [
  ['update', '1_sync@1'], ['commit', '1_sync@2'],
  ['diff', '2_view@1'], ['log', '2_view@2'],
  ['add', '3_edit@1'], ['delete', '3_edit@2'], ['rename', '3_edit@3'], ['revert', '3_edit@4'], ['resolve', '3_edit@5'],
  ['ignore', '4_ignore@1'], ['ignoreReason', '4_ignore@2'], ['editIgnores', '4_ignore@3'],
  ['cleanup', '5_misc@1'], ['copyUrl', '5_misc@2'],
];

const SCM = 'scmProvider == svnTools';
const and = (...parts) => parts.filter(Boolean).join(' && ');

// ---- 명령 ----
const commands = [
  ...COMMANDS.map(([id, title, icon]) => ({ command: `svnTools.${id}`, title, category: 'SVN', ...(icon && { icon }) })),
  ...TORTOISE.map(([id, title]) => ({ command: `svnTools.tortoise.${id}`, title, category: 'TortoiseSVN' })),
];

function item(id, group, when) {
  return { command: `svnTools.${id}`, group, ...(when && { when }) };
}

// ---- 메뉴 ----
const fileWhen = 'svnTools.active && resourceScheme == file';
const menus = {
  'explorer/context': [
    { submenu: 'svnTools.svn', group: '7_svn@1', when: 'svnTools.active' },
    { submenu: 'svnTools.tortoise', group: '7_svn@2', when: 'svnTools.active' },
  ],
  'editor/title/context': [
    { submenu: 'svnTools.svn', group: '7_svn@1', when: fileWhen },
    { submenu: 'svnTools.tortoise', group: '7_svn@2', when: fileWhen },
  ],
  'svnTools.svn': SVN_SUBMENU.map(([id, group]) => item(id, group)),
  'svnTools.tortoise': TORTOISE.map(([id], i) => item(`tortoise.${id}`, `${TORTOISE_GROUPS[id]}@${i}`)),
  'scm/title': [
    item('commitAll', 'navigation@1', SCM),
    item('update', 'navigation@2', SCM),
    item('refresh', 'navigation@3', SCM),
    item('log', '1_misc@1', SCM),
    item('cleanup', '1_misc@2', SCM),
    item('editIgnores', '1_misc@3', SCM),
    { submenu: 'svnTools.tortoise', group: '2_tortoise@1', when: SCM },
  ],
  'scm/resourceGroup/context': [
    item('revertAll', 'inline', and(SCM, 'scmResourceGroup == changes')),
    item('addAll', 'inline', and(SCM, 'scmResourceGroup == unversioned')),
    item('revertAll', '1_edit', and(SCM, 'scmResourceGroup == changes')),
    item('addAll', '1_edit', and(SCM, 'scmResourceGroup == unversioned')),
  ],
  'scm/resourceState/context': [
    item('openFile', 'inline@1', SCM),
    item('revert', 'inline@2', and(SCM, 'scmResourceState != unversioned')),
    item('add', 'inline@2', and(SCM, 'scmResourceState == unversioned')),
    item('commit', '1_commit@1', and(SCM, 'scmResourceState != unversioned')),
    item('diff', '2_view@1', and(SCM, 'scmResourceState != unversioned')),
    item('log', '2_view@2', and(SCM, 'scmResourceState != unversioned')),
    item('add', '3_edit@1', and(SCM, 'scmResourceState == unversioned')),
    item('revert', '3_edit@2', and(SCM, 'scmResourceState != unversioned')),
    item('resolve', '3_edit@3', and(SCM, 'scmResourceState == conflicted')),
    item('delete', '3_edit@4', SCM),
    item('ignore', '3_edit@5', and(SCM, 'scmResourceState == unversioned')),
    { submenu: 'svnTools.tortoise', group: '4_tortoise@1', when: SCM },
  ],
  // 그룹·패널 전용 명령은 팔레트에서 숨긴다.
  commandPalette: commands.map((c) => ({
    command: c.command,
    when: /\.(revertAll|addAll|openFile|commitAll)$/.test(c.command) ? 'false' : 'svnTools.active',
  })),
};

const configuration = {
  title: 'SVN Tools',
  properties: {
    'svnTools.language': {
      type: 'string', enum: ['en', 'ko'], default: 'en',
      enumDescriptions: ['English', '한국어'],
      description: '알림·확인 창·화면 문구의 언어(메뉴는 영어 고정) / Language of messages, dialogs and views (menus are always English)',
    },
    'svnTools.delete.keepLocal': {
      type: 'boolean', default: true,
      description: 'SVN에서 삭제할 때 로컬 파일은 남긴다(svn delete --keep-local) / Keep local files when deleting from SVN',
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
  submenus: [
    { id: 'svnTools.svn', label: 'SVN' },
    { id: 'svnTools.tortoise', label: 'TortoiseSVN' },
  ],
  menus,
  configuration,
};

fs.writeFileSync(path.join(__dirname, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`package.json: commands ${commands.length}`);
