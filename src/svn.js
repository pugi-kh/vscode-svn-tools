'use strict';
// svn 실행과 XML 출력 해석. 외부 패키지 없이 Node 기본 기능만 쓴다.
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

// PATH에 없을 때 찾아보는 위치: TortoiseSVN(명령줄 도구를 골랐을 때), SlikSVN
const KNOWN_SVN = [
  'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe',
  'C:\\Program Files\\SlikSvn\\bin\\svn.exe',
  'C:\\Program Files (x86)\\SlikSvn\\bin\\svn.exe',
];
// E155004: 작업 사본 잠김, E200033/E200030: 작업 사본 DB(sqlite) 사용 중
const LOCK_ERROR = /E155004|E200033|E200030/;
const LOCK_RETRIES = 4;
const LOCK_RETRY_MS = 250;
const MAX_COMMAND_LINE = 30000;

class SvnError extends Error {
  constructor(message, stderr, code, stdout) {
    super(message);
    this.stderr = stderr || '';
    this.code = code;
    this.stdout = stdout || '';  // 여러 대상 중 일부만 실패해도 나머지 결과는 stdout에 나온다(svn info 등)
  }
}

// 윈도우 svn 출력은 인코딩이 섞인다. 예: svn diff는 머리글(Index: 경로)을 CP949로, 파일 내용은 원래 바이트(UTF-8)로
// 낸다. 그래서 전체가 UTF-8로 안 읽히면 줄마다 UTF-8 → 안 되면 EUC-KR로 읽는다.
const utf8 = new TextDecoder('utf-8', { fatal: true });
const euckr = new TextDecoder('euc-kr');

function decodeLine(buf) {
  try {
    return utf8.decode(buf);
  } catch {
    return euckr.decode(buf);
  }
}

function decode(buf) {
  if (!buf || buf.length === 0) return '';
  try {
    return utf8.decode(buf);
  } catch {
    const lines = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) {
        lines.push(decodeLine(buf.subarray(start, i + 1)));
        start = i + 1;
      }
    }
    if (start < buf.length) lines.push(decodeLine(buf.subarray(start)));
    return lines.join('');
  }
}

// 경로를 디스크에 있는 대소문자 그대로 맞춘다. svn은 경로를 대소문자로 구분해서, 중간 폴더의 대소문자가 실제와
// 다르면 move가 같은 폴더를 두 번 잠그려다 E155004로 실패한다(2026-10-23 테스트 저장소로 확인).
// 아직 없는 경로(이름 바꾸기 대상 등)는 있는 상위 폴더까지만 맞추고 나머지 이름을 붙인다.
function realPath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(realPath(parent), path.basename(p));
  }
}

// svn 실행 파일 찾기: 설정 값 → PATH → TortoiseSVN 폴더(tortoiseProcPath 포함)·SlikSVN 기본 위치 → 레지스트리의 최신 PATH.
// 레지스트리를 보는 이유: VS Code는 시작할 때의 PATH를 계속 써서, 방금 설치한 svn(SlikSVN은 PATH에 추가된다)을 재시작 전에는 못 찾는다.
// 찾은 경로를 설정에 써 두지 않는다 — svn을 지우거나 옮기면 남은 설정 때문에 오히려 못 찾는다.
// 설정 값이 디스크에 없는 경로면 쓰지 않고 자동 찾기로 넘어간다(설정은 그대로 둔다). 남은 설정 하나 때문에 설치 후에도 못 찾았다.
const EXE = process.platform === 'win32' ? 'svn.exe' : 'svn';
let found;  // undefined: 아직 안 찾음, null: 못 찾음
let configuredMissing = '';  // 설정에 있지만 디스크에 없는 경로(출력 창 안내용)

// PATH 항목 정리: 앞뒤 공백·따옴표, 복사해 붙일 때 딸려 오는 보이지 않는 방향 문자(실제 PC의 PATH에서 발견)
const cleanDir = (d) => d.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim().replace(/^"|"$/g, '');

function inDirs(dirs) {
  for (const d of dirs.map(cleanDir)) {
    const f = d && path.join(d, EXE);
    if (f && fs.existsSync(f)) return f;
  }
  return undefined;
}

function registryPathDirs() {
  if (process.platform !== 'win32') return [];
  const keys = ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'HKCU\\Environment'];
  const dirs = [];
  for (const k of keys) {
    try {
      // reg는 콘솔 코드 페이지(CP949)로 출력한다 — 한글 경로가 깨지지 않게 decode()로 읽는다
      const out = decode(cp.execFileSync('reg', ['query', k, '/v', 'Path'], { windowsHide: true, timeout: 5000 }));
      const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(out);
      if (m) dirs.push(...m[1].trim().replace(/%([^%]+)%/g, (all, v) => process.env[v] || all).split(';'));
    } catch {
      // 값이 없는 키
    }
  }
  return dirs;
}

function knownFiles() {
  const proc = vscode.workspace.getConfiguration('svnTools').get('tortoiseProcPath', '');
  return [...new Set([...(proc ? [path.join(path.dirname(proc), EXE)] : []), ...KNOWN_SVN])];
}

function findSvn() {
  const configured = vscode.workspace.getConfiguration('svnTools').get('svnPath', '');
  configuredMissing = configured && path.isAbsolute(configured) && !fs.existsSync(configured) ? configured : '';
  if (configured && !configuredMissing) return configured;
  if (found === undefined) {
    found = inDirs((process.env.PATH || '').split(path.delimiter)) || knownFiles().find((f) => fs.existsSync(f))
      || inDirs(registryPathDirs()) || null;
  }
  return found;
}

// 못 찾았을 때 출력 창에 남길 설명: 어디를 찾아봤는지
function searchReport() {
  return [
    configuredMissing && `svnTools.svnPath (not found): ${configuredMissing}`,
    'PATH', ...knownFiles(), 'PATH (registry)',
  ].filter(Boolean).join(' | ');
}

// 설치 직후나 설정을 바꾼 뒤 다시 찾게 한다
function resetSvn() {
  found = undefined;
}

// 실행 실패(ENOENT) 때의 다시 찾기는 10초에 한 번까지 — svn이 없으면 명령마다 레지스트리를 동기로 읽어 확장이 멈칫했다.
// 설치 직후·설정 변경 때의 다시 찾기(svnSetup.recheck)는 resetSvn을 바로 불러 이 제한을 받지 않는다.
let lastRescan = 0;
function rescanAfterFailure() {
  if (Date.now() - lastRescan < 10000) return;
  lastRescan = Date.now();
  resetSvn();
}

function svnPath() {
  return findSvn() || 'svn';
}

function run(file, args, cwd) {
  return new Promise((resolve, reject) => {
    cp.execFile(file, args, { cwd, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const out = decode(stdout);
        const errText = decode(stderr).trim();
        if (err) {
          if (err.code === 'ENOENT') return reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
          return reject(new SvnError(errText || err.message, errText, err.code, out));
        }
        resolve({ stdout: out, stderr: errText });
      });
  });
}

// svn 실행. 기억해 둔 svn이 없어졌으면(ENOENT) 한 번 다시 찾아 시도한다.
//
// 한글·공백 경로 규칙: 경로·커밋 메시지·속성 값은 **모두 인자로 직접** 넘긴다. Node가 윈도우에 인자를
// UTF-16으로 넘기고 svn이 그대로 받으므로 깨지지 않는다(2026-10-23 한글·공백 경로 테스트 저장소로 확인).
// **-F 파일 + --encoding utf-8은 쓰지 않는다** — svn 1.14는 --encoding을 붙이면 경로 인자까지 그 인코딩으로
// 다시 해석해 한글 경로가 '???'가 된다. --encoding 없이 -F만 쓰면 이번엔 파일 내용을 CP949로 읽어 한글 값이 깨진다.
async function exec(args, cwd) {
  const full = ['--non-interactive', ...args];
  // 윈도우 명령줄은 약 32,767자까지다. 경로를 많이 넘기면(정확한 커밋, 여러 항목 추가 등) 넘을 수 있어 미리 막고
  // "나눠서 진행하라"고 안내한다(commands.js의 showError). 파일 하나의 경로가 긴 것은 문제가 아니다.
  const length = full.reduce((n, a) => n + String(a).length + 3, 0);
  if (length > MAX_COMMAND_LINE) {
    throw Object.assign(new Error('TOOLONG'), { code: 'TOOLONG', count: args.length });
  }
  let file = svnPath();
  let rescanned = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(file, full, cwd);
    } catch (e) {
      // 기억해 둔 svn이 지워졌을 수 있다 — 한 번만 다시 찾아본다. 잠금 재시도 횟수(attempt)는 쓰지 않는다.
      if (e.code === 'ENOENT' && !rescanned) {
        rescanned = true;
        rescanAfterFailure();
        const again = svnPath();
        if (again !== file) {
          file = again;
          attempt--;
          continue;
        }
      }
      // TortoiseSVN 상태 캐시(TSVNCache)가 작업 사본 DB를 잠깐 잡고 있으면 잠금 오류가 난다. 잠시 뒤 다시 한다.
      // 진짜로 잠긴 경우(중단된 작업)는 재시도 뒤에도 실패하고, 그때는 Cleanup이 필요하다.
      if (attempt < LOCK_RETRIES && LOCK_ERROR.test(e.stderr || '')) {
        await new Promise((r) => setTimeout(r, LOCK_RETRY_MS * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

// ---- XML 해석 (svn --xml 출력은 구조가 단순해 정규식으로 충분하다) ----

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : undefined;
}

function element(xml, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? unescapeXml(m[1]) : undefined;
}

// 반환: [{ path, item, props, treeConflict, reposItem }]
function parseStatus(xml) {
  const out = [];
  const re = /<entry\s+path="([^"]*)"\s*>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const body = m[2];
    const wc = /<wc-status\b[^>]*>/.exec(body);
    const repos = /<repos-status\b[^>]*>/.exec(body);
    out.push({
      path: path.normalize(unescapeXml(m[1])),
      item: wc ? attr(wc[0], 'item') : 'none',
      props: wc ? attr(wc[0], 'props') : 'none',
      treeConflict: wc ? attr(wc[0], 'tree-conflicted') === 'true' : false,
      // 복사·이동으로 추가된 항목(A +). 이동이면 반대쪽 경로가 붙는다(절대 경로로 부르면 절대 경로로 온다).
      copied: wc ? attr(wc[0], 'copied') === 'true' : false,
      movedFrom: wc && attr(wc[0], 'moved-from') ? path.normalize(attr(wc[0], 'moved-from')) : undefined,
      movedTo: wc && attr(wc[0], 'moved-to') ? path.normalize(attr(wc[0], 'moved-to')) : undefined,
      locked: wc ? attr(wc[0], 'wc-locked') === 'true' : false,
      // 이 작업 사본이 가진 svn lock 토큰(K). 수정하지 않은 파일도 status에 나온다.
      lockToken: /<wc-status\b[\s\S]*?<lock>[\s\S]*?<\/wc-status>/.test(body),
      reposItem: repos ? attr(repos[0], 'item') : undefined,
    });
  }
  return out;
}

// svn info --xml 대상 여러 개: 관리 중인 대상의 경로 목록(관리 대상이 아닌 것은 경고만 나오고 빠진다)
function parseInfoPaths(xml) {
  return [...xml.matchAll(/<entry\b[^>]*\spath="([^"]*)"/g)].map((m) => path.normalize(unescapeXml(m[1])));
}

function parseInfo(xml) {
  const entry = /<entry\b[^>]*>/.exec(xml);
  return {
    kind: entry ? attr(entry[0], 'kind') : undefined,
    revision: entry ? attr(entry[0], 'revision') : undefined,
    url: element(xml, 'url'),
    root: element(xml, 'root'),
    wcRoot: element(xml, 'wcroot-abspath'),
  };
}

// 반환: [{ revision, author, date, message, paths: [{ action, kind, path }] }]
function parseLog(xml) {
  const out = [];
  const re = /<logentry\s+revision="(\d+)"\s*>([\s\S]*?)<\/logentry>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const body = m[2];
    const paths = [];
    const pre = /<path\b([^>]*)>([\s\S]*?)<\/path>/g;
    let p;
    while ((p = pre.exec(body)) !== null) {
      paths.push({ action: attr(p[1], 'action'), kind: attr(p[1], 'kind'), path: unescapeXml(p[2]) });
    }
    out.push({
      revision: Number(m[1]),
      author: element(body, 'author') || '',
      date: element(body, 'date') || '',
      message: (element(body, 'msg') || '').replace(/\r\n/g, '\n').trim(),
      paths,
    });
  }
  return out;
}

// svn propget <속성> -R --xml 결과 → [{ path, value }]. 커밋 전 바꾼 속성 값도 들어 있다.
function parsePropget(xml) {
  const out = [];
  const re = /<target\s+path="([^"]*)"\s*>([\s\S]*?)<\/target>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const prop = /<property\b[^>]*>([\s\S]*?)<\/property>/.exec(m[2]);
    out.push({ path: path.normalize(unescapeXml(m[1])), value: prop ? unescapeXml(prop[1]) : '' });
  }
  return out;
}

// svn propget <속성> --show-inherited-props --xml 결과 → [{ path, value, inherited, isUrl }]
// 대상 자신의 값은 <property>, 위 폴더에서 물려받은 값은 <inherited_property>로 온다.
// 작업 사본보다 위(저장소)에 걸린 값은 path가 URL이다 — 여기서는 고칠 수 없다.
function parseInheritedProps(xml) {
  const out = [];
  const re = /<target\s+path="([^"]*)"\s*>([\s\S]*?)<\/target>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const raw = unescapeXml(m[1]);
    const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    const prop = /<(inherited_property|property)\b[^>]*>([\s\S]*?)<\/\1>/.exec(m[2]);
    if (!prop) continue;
    out.push({
      path: isUrl ? raw : path.normalize(raw),
      value: unescapeXml(prop[2]),
      inherited: prop[1] === 'inherited_property',
      isUrl,
    });
  }
  return out;
}

// "Committed revision 123." / "Updated to revision 123." / "At revision 123." 의 숫자
function lastRevision(text) {
  const m = /revision (\d+)/i.exec(text) || /리비전 (\d+)/.exec(text);
  return m ? m[1] : undefined;
}

// 작업 사본의 리비전 범위 { min, max } (svnversion "9360:9386M"). 실패하면 undefined.
// 커밋은 올린 파일만 새 리비전으로 바꾸고 상위 폴더는 그대로 둬서, 폴더의 svn info 리비전만 보면 내가 올린 커밋도
// "받지 않음"으로 보인다(이력 뷰에서 실제로 겪음). svnversion은 svn.exe 옆에 있다.
async function wcVersion(dir) {
  const svnFile = svnPath();
  const file = svnFile === 'svn' ? 'svnversion' : path.join(path.dirname(svnFile), 'svnversion.exe');
  try {
    const { stdout } = await run(file, [dir], dir);
    const m = /^(\d+)(?::(\d+))?/.exec(stdout.trim());
    return m ? { min: Number(m[1]), max: Number(m[2] || m[1]) } : undefined;
  } catch {
    return undefined;
  }
}

module.exports = {
  exec, realPath, decode, parseStatus, parseInfo, parseInfoPaths, parseLog, parsePropget, parseInheritedProps, lastRevision, SvnError,
  wcVersion, findSvn, resetSvn, searchReport,
};
