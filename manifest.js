'use strict';
// package.json 생성기. `node manifest.js`로 다시 만든다(package.json을 직접 고치지 않는다).
//
// 메뉴 이름을 설정(svnTools.language)으로 바꾸려면 명령을 언어마다 따로 등록해야 한다 — VS Code는
// 메뉴 이름을 package.json에 고정 문자열로만 받기 때문이다. 그래서 명령 하나를 svnTools.<id>.ko /
// svnTools.<id>.en 두 개로 펼치고, 메뉴에는 설정 언어와 맞는 쪽만 보이게 when 조건을 붙인다.
const fs = require('fs');
const path = require('path');
const { LANGUAGES } = require('./src/languages');

const pkg = {
  name: 'vscode-svn-tools',
  displayName: 'SVN Tools',
  description: 'SVN Source Control panel, explorer context menu (SVN / TortoiseSVN) and status decorations including ignored files.',
  version: '0.3.1',
  publisher: 'khoon',
  private: true,
  engines: { vscode: '^1.80.0' },
  categories: ['SCM Providers'],
  extensionKind: ['workspace'],
  activationEvents: ['onStartupFinished'],
  main: './src/extension.js',
  scripts: {
    manifest: 'node manifest.js',
    package: 'node manifest.js && npx --yes @vscode/vsce package --skip-license --allow-missing-repository',
  },
};

// [id, 한글, 영어, 아이콘]
const COMMANDS = [
  ['refresh', '새로고침', 'Refresh', '$(refresh)'],
  ['commitAll', '커밋', 'Commit', '$(check)'],
  ['commit', '커밋…', 'Commit…'],
  ['update', '업데이트', 'Update', '$(arrow-down)'],
  ['diff', 'BASE와 비교', 'Compare with BASE', '$(diff)'],
  ['openFile', '파일 열기', 'Open File', '$(go-to-file)'],
  ['revert', '되돌리기', 'Revert', '$(discard)'],
  ['revertAll', '모두 되돌리기', 'Revert All', '$(discard)'],
  ['add', 'SVN에 추가', 'Add', '$(add)'],
  ['addAll', '모두 추가', 'Add All', '$(add)'],
  ['delete', 'SVN에서 삭제', 'Delete'],
  ['rename', '이름 바꾸기 (이력 유지)', 'Rename (keep history)'],
  ['ignore', '무시 목록에 추가…', 'Add to Ignore List…'],
  ['editIgnores', '무시 목록 편집…', 'Edit Ignore Lists…', '$(eye-closed)'],
  ['log', '로그 보기', 'Show Log', '$(history)'],
  ['resolve', '충돌 해결…', 'Resolve Conflict…'],
  ['cleanup', '정리 (Cleanup)', 'Clean Up'],
  ['copyUrl', 'SVN URL 복사', 'Copy SVN URL'],
];

// TortoiseSVN 창으로 여는 명령. id는 src/tortoise.js의 COMMANDS 키와 같다.
const TORTOISE = [
  ['update', '업데이트', 'Update'],
  ['commit', '커밋', 'Commit'],
  ['log', '로그 보기', 'Show Log'],
  ['diff', '비교', 'Diff'],
  ['revisiongraph', '리비전 그래프', 'Revision Graph'],
  ['repobrowser', '저장소 브라우저', 'Repo-browser'],
  ['blame', 'Blame', 'Blame'],
  ['add', '추가', 'Add'],
  ['remove', '삭제', 'Delete'],
  ['rename', '이름 바꾸기', 'Rename'],
  ['revert', '되돌리기', 'Revert'],
  ['conflicteditor', '충돌 편집', 'Edit Conflicts'],
  ['resolve', '해결됨으로 표시', 'Resolved'],
  ['ignore', '무시 목록에 추가', 'Add to Ignore List'],
  ['properties', '속성', 'Properties'],
  ['merge', '병합', 'Merge'],
  ['switch', '전환 (Switch)', 'Switch'],
  ['lock', '잠금', 'Get Lock'],
  ['unlock', '잠금 해제', 'Release Lock'],
  ['cleanup', '정리 (Cleanup)', 'Clean Up'],
  ['settings', '설정', 'Settings'],
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
  ['ignore', '4_ignore@1'], ['editIgnores', '4_ignore@2'],
  ['cleanup', '5_misc@1'], ['copyUrl', '5_misc@2'],
];

const SCM = "scmProvider == svnTools";
const langWhen = (lang) => `config.svnTools.language == '${lang}'`;
const and = (...parts) => parts.filter(Boolean).join(' && ');

// ---- 명령 ----
const commands = [];
for (const lang of LANGUAGES) {
  const pick = (ko, en) => (lang === 'ko' ? ko : en);
  for (const [id, ko, en, icon] of COMMANDS) {
    commands.push({ command: `svnTools.${id}.${lang}`, title: pick(ko, en), category: 'SVN', ...(icon && { icon }) });
  }
  for (const [id, ko, en] of TORTOISE) {
    commands.push({ command: `svnTools.tortoise.${id}.${lang}`, title: pick(ko, en), category: 'TortoiseSVN' });
  }
}

// 메뉴 항목 하나를 언어별로 펼친다.
function item(id, group, when) {
  return LANGUAGES.map((lang) => ({ command: `svnTools.${id}.${lang}`, group, when: and(langWhen(lang), when) }));
}

// ---- 메뉴 ----
const svnSubmenu = SVN_SUBMENU.flatMap(([id, group]) => item(id, group));
const tortoiseSubmenu = TORTOISE.flatMap(([id], i) => item(`tortoise.${id}`, `${TORTOISE_GROUPS[id]}@${i}`));

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
  'svnTools.svn': svnSubmenu,
  'svnTools.tortoise': tortoiseSubmenu,
  'scm/title': [
    ...item('commitAll', 'navigation@1', SCM),
    ...item('update', 'navigation@2', SCM),
    ...item('refresh', 'navigation@3', SCM),
    ...item('log', '1_misc@1', SCM),
    ...item('cleanup', '1_misc@2', SCM),
    ...item('editIgnores', '1_misc@3', SCM),
    { submenu: 'svnTools.tortoise', group: '2_tortoise@1', when: SCM },
  ],
  'scm/resourceGroup/context': [
    ...item('revertAll', 'inline', and(SCM, "scmResourceGroup == changes")),
    ...item('addAll', 'inline', and(SCM, "scmResourceGroup == unversioned")),
    ...item('revertAll', '1_edit', and(SCM, "scmResourceGroup == changes")),
    ...item('addAll', '1_edit', and(SCM, "scmResourceGroup == unversioned")),
  ],
  'scm/resourceState/context': [
    ...item('openFile', 'inline@1', SCM),
    ...item('revert', 'inline@2', and(SCM, "scmResourceState != unversioned")),
    ...item('add', 'inline@2', and(SCM, "scmResourceState == unversioned")),
    ...item('commit', '1_commit@1', and(SCM, "scmResourceState != unversioned")),
    ...item('diff', '2_view@1', and(SCM, "scmResourceState != unversioned")),
    ...item('log', '2_view@2', and(SCM, "scmResourceState != unversioned")),
    ...item('add', '3_edit@1', and(SCM, "scmResourceState == unversioned")),
    ...item('revert', '3_edit@2', and(SCM, "scmResourceState != unversioned")),
    ...item('resolve', '3_edit@3', and(SCM, "scmResourceState == conflicted")),
    ...item('delete', '3_edit@4', SCM),
    ...item('ignore', '3_edit@5', and(SCM, "scmResourceState == unversioned")),
    { submenu: 'svnTools.tortoise', group: '4_tortoise@1', when: SCM },
  ],
  // 팔레트에는 설정 언어 쪽만 보인다. 그룹·패널 전용 명령은 숨긴다.
  commandPalette: commands.map((c) => {
    const lang = c.command.split('.').pop();
    const hidden = /\.(revertAll|addAll|openFile|commitAll)\.\w+$/.test(c.command);
    return { command: c.command, when: hidden ? 'false' : and(langWhen(lang), 'svnTools.active') };
  }),
};

const configuration = {
  title: 'SVN Tools',
  properties: {
    'svnTools.language': {
      type: 'string', enum: ['ko', 'en'], default: 'ko',
      enumDescriptions: ['한국어', 'English'],
      description: '메뉴와 메시지 언어 / Language of menus and messages',
    },
    'svnTools.delete.keepLocal': {
      type: 'boolean', default: true,
      description: 'SVN에서 삭제할 때 로컬 파일은 남긴다(svn delete --keep-local) / Keep local files when deleting from SVN',
    },
    'svnTools.commit.checkOutOfDate': {
      type: 'boolean', default: true,
      description: '커밋 전에 서버에 더 새 버전이 있는지 확인한다(svn status -u) / Check the server for newer versions before committing',
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

pkg.contributes = {
  commands,
  submenus: [
    { id: 'svnTools.svn', label: 'SVN' },
    { id: 'svnTools.tortoise', label: 'TortoiseSVN' },
  ],
  menus,
  configuration,
};

fs.writeFileSync(path.join(__dirname, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`package.json: commands ${commands.length}`);
