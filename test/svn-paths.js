'use strict';
// 한글·공백 경로 회귀 검사: 임시 폴더에 한글·공백 이름의 SVN 저장소를 만들고, 확장이 쓰는 svn 명령을
// commands.js와 같은 인자로 돌린다. 실제 작업 사본은 건드리지 않는다. 실행: npm test
//
// 2026-10-23에 찾은 문제 두 가지를 잡는다:
//   - -F 파일 + --encoding utf-8을 쓰면 svn이 경로 인자까지 다시 해석해 한글 경로가 '???'가 된다
//   - 경로의 대소문자가 디스크와 다르면 svn move가 E155004(이미 잠김)로 실패한다
// svn diff 출력의 인코딩 섞임(머리글 CP949 + 내용 UTF-8), 로그 메시지 줄바꿈도 본다.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'vscode') return { workspace: { getConfiguration: () => ({ get: (_k, d) => d }) } };
  return origLoad.call(this, req, ...rest);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const svn = require('../src/svn');
const ignore = require('../src/ignore');
const { applyChange } = require('../src/ignoreView');

const SVNADMIN = ['svnadmin', 'C:\\Program Files\\TortoiseSVN\\bin\\svnadmin.exe'];
const base = path.join(svn.realPath(os.tmpdir()), 'svn-tools-test', '한글 테스트');
const repoDir = path.join(base, '저장소');
const wc = path.join(base, '작업 사본');
const sub = path.join(wc, '하위 폴더');
const file = path.join(sub, '파일 하나.txt');
const renamed = path.join(sub, '바뀐 이름.txt');
const message = 'feat: 한글 메시지 테스트\n\n- 두 번째 줄 "따옴표" 포함';

let failed = 0;
async function check(label, fn, expect) {
  try {
    const got = await fn();
    const ok = expect === undefined || got === expect;
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${got !== undefined ? ` -> ${got}` : ''}${ok ? '' : ` (기대: ${expect})`}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${label}: ${(e.stderr || e.message).split(/\r?\n/)[0]}`);
  }
}

function createRepo() {
  for (const exe of SVNADMIN) {
    try {
      cp.execFileSync(exe, ['create', repoDir]);
      return;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  throw new Error('svnadmin을 찾을 수 없습니다');
}

(async () => {
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  createRepo();
  await svn.exec(['checkout', 'file:///' + repoDir.replace(/\\/g, '/'), wc], base);
  fs.mkdirSync(sub);
  fs.writeFileSync(file, '첫 줄\n', 'utf8');

  await check('add', () => svn.exec(['add', '--force', '--parents', sub], wc).then(() => 'ok'), 'ok');
  await check('propset 한글 값 + 한글 경로', async () => {
    await ignore.setProp('svn:global-ignores', sub, ['*.zztest', '임시']);
    return JSON.stringify(await ignore.getProp('svn:global-ignores', sub));
  }, '["*.zztest","임시"]');
  await check('propget -R', async () => (await ignore.listProp('svn:global-ignores', wc)).map((r) => path.basename(r.dir)).join(','), '하위 폴더');
  await check('commit -m 한글 여러 줄', async () => svn.lastRevision((await svn.exec(['commit', '-m', message, '--force-log', wc], wc)).stdout), '1');
  await check('로그 메시지 왕복', async () => svn.parseLog((await svn.exec(['log', '--xml', '-l', '1', file], wc)).stdout)[0].message === message, true);

  fs.appendFileSync(file, '둘째 줄\n', 'utf8');
  await check('status', async () => svn.parseStatus((await svn.exec(['status', '--xml', '--no-ignore', wc], wc)).stdout).map((e) => `${e.item}:${path.basename(e.path)}`).join(','), 'modified:파일 하나.txt');
  await check('cat -r BASE', async () => (await svn.exec(['cat', '-r', 'BASE', file], sub)).stdout, '첫 줄\n');
  await check('diff (인코딩 섞인 출력)', async () => (await svn.exec(['diff', file], wc)).stdout.includes('+둘째 줄'), true);
  await check('status -u', async () => svn.parseStatus((await svn.exec(['status', '-u', '--xml', file], wc)).stdout).length, 1);
  await check('revert', () => svn.exec(['revert', '--depth', 'infinity', file], wc).then(() => fs.readFileSync(file, 'utf8')), '첫 줄\n');
  await check('move (디스크 표기 경로)', () => svn.exec(['move', file, renamed], wc).then(() => fs.existsSync(renamed)), true);
  await check('commit move', async () => svn.lastRevision((await svn.exec(['commit', '-m', '이름 변경', '--force-log', wc], wc)).stdout), '2');
  await check('delete --keep-local', () => svn.exec(['delete', '--keep-local', '--force', renamed], wc).then(() => fs.existsSync(renamed)), true);
  await check('revert delete', () => svn.exec(['revert', '--depth', 'infinity', renamed], wc).then(() => 'ok'), 'ok');
  await check('propdel (빈 목록)', async () => {
    await ignore.setProp('svn:global-ignores', sub, []);
    return JSON.stringify(await ignore.getProp('svn:global-ignores', sub));
  }, '[]');
  await check('update', async () => svn.lastRevision((await svn.exec(['update', wc], wc)).stdout), '2');
  await check('cleanup', () => svn.exec(['cleanup', wc], wc).then(() => 'ok'), 'ok');
  await check('info url', async () => decodeURI(svn.parseInfo((await svn.exec(['info', '--xml', renamed], sub)).stdout).url).endsWith('하위 폴더/바뀐 이름.txt'), true);
  // 무시 목록에서 제외: 패턴 맞추기와 원인 규칙 찾기
  const m = (pat, name) => ignore.matchPattern(pat, name);
  await check('matchPattern', () => [m('*.log', 'a.log'), m('*.log', 'a.LOG'), m('logs', 'logs'), m('*.so.[0-9]*', 'x.so.1'),
    m('[Tt]humbs.db', 'thumbs.db'), m('[!a]bc', 'abc'), m('?.txt', 'ab.txt'), m('임시*', '임시폴더')].join(','),
  'true,false,true,true,true,false,false,true');
  fs.writeFileSync(path.join(sub, 'ign 파일'), '');
  fs.writeFileSync(path.join(sub, '값.zz'), '');
  await ignore.setProp('svn:ignore', sub, ['ign*']);
  await ignore.setProp('svn:global-ignores', wc, ['*.zz']);
  const describeRules = (rules) => rules.filter((r) => r.kind !== 'local')
    .map((r) => `${r.kind}:${path.basename(r.dir)}:${r.pattern}:${r.editable}`).join(',');
  await check('findRules svn:ignore', async () => describeRules(await ignore.findRules(path.join(sub, 'ign 파일'))), 'svn:ignore:하위 폴더:ign*:true');
  await check('findRules 상속 global-ignores', async () => describeRules(await ignore.findRules(path.join(sub, '값.zz'))), 'svn:global-ignores:작업 사본:*.zz:true');
  await check('removeRule', async () => {
    const [rule] = (await ignore.findRules(path.join(sub, 'ign 파일'))).filter((r) => r.kind === 'svn:ignore');
    await ignore.removeRule(rule);
    return JSON.stringify(await ignore.getProp('svn:ignore', sub));
  }, '[]');
  await check('svn:ignore 공백 포함 패턴(줄 단위)', async () => {
    await ignore.setProp('svn:ignore', sub, ['my file', '*.tmp']);
    const got = JSON.stringify(await ignore.getProp('svn:ignore', sub));
    await ignore.setProp('svn:ignore', sub, []);
    return got;
  }, '["my file","*.tmp"]');
  await check('레지스트리 출력 해석', () => JSON.stringify(ignore.parseRegQuery([
    '',
    'HKEY_CURRENT_USER\\Software\\Tigris.org\\Subversion\\Config\\miscellany',
    '    global-ignores    REG_SZ    *.zz 임시 *.bak',
    '',
  ].join('\r\n'))), '["*.zz","임시","*.bak"]');
  await check('readLocal 출처', () => ['userFile', 'userRegistry', 'systemFile', 'systemRegistry', 'default'].includes(ignore.readLocal().source), true);
  // 레지스트리 쓰기·읽기 왕복: 실제 svn 설정 키 대신 임시 키를 쓰고 지운다.
  if (process.platform === 'win32') {
    const TEST_KEY = 'Software\\svn-tools-test\\miscellany';
    await check('레지스트리 쓰기·읽기(한글)', () => {
      ignore.writeRegistry(['*.zz', '임시'], TEST_KEY);
      return JSON.stringify(ignore.readRegistry('HKCU', TEST_KEY));
    }, '["*.zz","임시"]');
    await check('레지스트리 빈 목록', () => {
      ignore.writeRegistry([], TEST_KEY);
      return JSON.stringify(ignore.readRegistry('HKCU', TEST_KEY));
    }, '[]');
    cp.execFileSync('reg', ['delete', 'HKCU\\Software\\svn-tools-test', '/f'], { stdio: 'ignore' });
  }
  await check('applyChange 병합', () => JSON.stringify(applyChange(['a', 'b', 'c', 'ext'], { edits: [{ old: 'b', new: 'B' }], removed: ['c'], added: ['d', 'a'] })), '["a","B","ext","d"]');

  fs.rmSync(path.dirname(base), { recursive: true, force: true });
  console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log('중단:', e.stderr || e.message);
  process.exit(1);
});
