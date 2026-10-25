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
  // global-ignores는 공백에서 나뉜다 — 공백 든 패턴을 그대로 넣으면 다른 패턴 둘이 된다(그래서 global에서는 막는다).
  await check('svn:global-ignores 공백은 패턴을 나눔', async () => {
    await svn.exec(['propset', 'svn:global-ignores', 'my file', sub], wc);
    const got = JSON.stringify(await ignore.getProp('svn:global-ignores', sub));
    await ignore.setProp('svn:global-ignores', sub, []);
    return got;
  }, '["my","file"]');
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
  // Add 하위 항목 제외(--depth empty): 폴더만 등록되고 안의 파일은 미등록으로 남는다
  const emptyDir = path.join(wc, '빈 등록 폴더');
  fs.mkdirSync(emptyDir);
  fs.writeFileSync(path.join(emptyDir, '안의 파일.txt'), 'x');
  await check('add --depth empty', async () => {
    await svn.exec(['add', '--depth', 'empty', '--force', '--parents', emptyDir], wc);
    const st = svn.parseStatus((await svn.exec(['status', '--xml', emptyDir], wc)).stdout);
    return st.map((e) => `${e.item}:${path.basename(e.path)}`).sort().join(',');
  }, 'added:빈 등록 폴더,unversioned:안의 파일.txt');
  await check('add 하위 항목 포함(이미 등록된 폴더)', async () => {
    await svn.exec(['add', '--force', '--parents', emptyDir], wc);
    const st = svn.parseStatus((await svn.exec(['status', '--xml', emptyDir], wc)).stdout);
    return st.map((e) => `${e.item}:${path.basename(e.path)}`).sort().join(',');
  }, 'added:빈 등록 폴더,added:안의 파일.txt');
  // 스테이징 커밋의 핵심: --depth empty로 "새 폴더 + 고른 파일"만 정확히 올리고 같은 폴더의 다른 새 파일은 남긴다.
  // 새 폴더 안의 파일만 넘기면 svn이 거부한다(E200009) — 그래서 상위 새 폴더를 함께 넣는다(commands.js newParents).
  const stageDir = path.join(wc, '스테이징 폴더');
  fs.mkdirSync(stageDir);
  fs.writeFileSync(path.join(stageDir, '올릴 파일.txt'), 'a');
  fs.writeFileSync(path.join(stageDir, '남길 파일.txt'), 'b');
  await svn.exec(['add', stageDir], wc);
  await check('새 폴더 안 파일만 커밋은 거부', async () => {
    try {
      await svn.exec(['commit', '-m', 'x', '--force-log', path.join(stageDir, '올릴 파일.txt')], wc);
      return 'committed';
    } catch (e) {
      return /E200009/.test(e.stderr) ? 'E200009' : (e.stderr || e.message).split(/\r?\n/)[0];
    }
  }, 'E200009');
  await check('--depth empty로 새 폴더 + 파일 하나만 커밋', async () => {
    await svn.exec(['commit', '-m', '정확 커밋', '--force-log', '--depth', 'empty', stageDir, path.join(stageDir, '올릴 파일.txt')], wc);
    const st = svn.parseStatus((await svn.exec(['status', '--xml', stageDir], wc)).stdout);
    return st.map((e) => `${e.item}:${path.basename(e.path)}`).join(',');
  }, 'added:남길 파일.txt');

  // 빠른 커밋에서 무시된 항목을 "추가해서 함께 커밋"할 때: svn은 이름을 직접 준 항목이면 무시 규칙에 걸려도 추가한다.
  // 그래서 --no-ignore를 붙이지 않는다(붙이면 고른 폴더 안의 무시 대상까지 추가된다).
  await ignore.setProp('svn:ignore', stageDir, ['skip*']);
  const skipped = path.join(stageDir, 'skip 파일.txt');
  fs.writeFileSync(skipped, 's');
  await check('무시된 파일도 이름으로 주면 add됨', async () => {
    await svn.exec(['add', '--force', '--parents', skipped], wc);
    return svn.parseStatus((await svn.exec(['status', '--xml', skipped], wc)).stdout).map((e) => e.item).join(',');
  }, 'added');
  // 이동·복사(0.10.0): status의 moved-from/moved-to로 짝을 알고, 되돌리기·커밋은 양쪽을 함께 넘긴다(commands.js closure).
  const mv = path.join(wc, '이동 검사');
  fs.mkdirSync(mv);
  const mvA = path.join(mv, '원래 이름.txt');
  const mvB = path.join(mv, '새 이름.txt');
  const keep = path.join(mv, '남길 파일.txt');
  fs.writeFileSync(mvA, 'a');
  fs.writeFileSync(keep, 'k');
  await svn.exec(['add', mv], wc);
  await svn.exec(['commit', '-m', '이동 검사 준비', '--force-log', mv], wc);
  const stOf = async (dir) => svn.parseStatus((await svn.exec(['status', '--xml', dir], wc)).stdout);
  await check('status moved-from / moved-to', async () => {
    await svn.exec(['move', mvA, mvB], wc);
    const st = await stOf(mv);
    const a = st.find((e) => e.path === mvA);
    const b = st.find((e) => e.path === mvB);
    return `${a.item}:${a.movedTo === mvB},${b.item}:${b.copied}:${b.movedFrom === mvA}`;
  }, 'deleted:true,added:true:true');
  await check('이동 양쪽 revert → 원래대로', async () => {
    await svn.exec(['revert', '--depth', 'infinity', mvA, mvB], wc);
    fs.rmSync(mvB, { force: true });
    return (await stOf(mv)).length;
  }, 0);
  // 하위 포함 스테이징: 폴더째 add --force 하면 keep-local로 지운 항목이 교체(R)가 된다. 미등록(?) 항목만 넘기면 D로 남는다.
  await check('하위 포함 add는 ?만 — keep-local 삭제 유지', async () => {
    await svn.exec(['delete', '--keep-local', '--force', keep], wc);
    fs.writeFileSync(path.join(mv, '새 파일.txt'), 'n');
    const unv = (await stOf(mv)).filter((e) => e.item === 'unversioned').map((e) => e.path);
    await svn.exec(['add', '--force', ...unv], wc);
    return (await stOf(mv)).map((e) => `${e.item}:${path.basename(e.path)}`).sort().join(',');
  }, 'added:새 파일.txt,deleted:남길 파일.txt');
  await svn.exec(['revert', '--depth', 'infinity', mv], wc);
  // 탐색기 F2로 이름을 바꾼 뒤 SVN 이름 바꾸기로 적용: 원래 이름으로 되돌리고 svn move(commands.js applyRename).
  await check('이름 바꾼 뒤 svn move로 적용(수정 내용 유지)', async () => {
    fs.appendFileSync(mvA, ' 수정');
    fs.renameSync(mvA, mvB);
    // 관리 중이었는지는 옛 경로의 svn info로 안다(commands.js isVersioned) — 디스크에 없어도 작업 사본 DB에 남아 있다.
    await svn.exec(['info', '--xml', mvA], wc);
    fs.renameSync(mvB, mvA);
    await svn.exec(['move', '--parents', mvA, mvB], wc);
    const b = (await stOf(mv)).find((e) => e.path === mvB);
    return `${b.item}:${b.movedFrom === mvA}:${fs.readFileSync(mvB, 'utf8')}`;
  }, 'added:true:a 수정');
  // 일반 add 폴더는 자식 add 없이 혼자 되돌릴 수 없다(E155038) — 스테이징 취소·Revert All이 폴더는 infinity로 되돌리는 이유.
  await check('A 폴더 revert --depth empty는 거부', async () => {
    const nd = path.join(mv, '새 폴더');
    fs.mkdirSync(nd);
    fs.writeFileSync(path.join(nd, 'x.txt'), 'x');
    await svn.exec(['add', nd], wc);
    try {
      await svn.exec(['revert', '--depth', 'empty', nd], wc);
      return 'reverted';
    } catch (e) {
      return /E155038/.test(e.stderr) ? 'E155038' : (e.stderr || e.message).split(/\r?\n/)[0];
    }
  }, 'E155038');
  await check('applyChange 병합', () => JSON.stringify(applyChange(['a', 'b', 'c', 'ext'], { edits: [{ old: 'b', new: 'B' }], removed: ['c'], added: ['d', 'a'] })), '["a","B","ext","d"]');

  fs.rmSync(path.dirname(base), { recursive: true, force: true });
  console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log('중단:', e.stderr || e.message);
  process.exit(1);
});
