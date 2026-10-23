'use strict';
// svn 실행과 XML 출력 해석. 외부 패키지 없이 Node 기본 기능만 쓴다.
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const FALLBACK_SVN = 'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe';
// E155004: 작업 사본 잠김, E200033/E200030: 작업 사본 DB(sqlite) 사용 중
const LOCK_ERROR = /E155004|E200033|E200030/;
const LOCK_RETRIES = 4;
const LOCK_RETRY_MS = 250;

class SvnError extends Error {
  constructor(message, stderr, code) {
    super(message);
    this.stderr = stderr || '';
    this.code = code;
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

function svnPath() {
  const configured = vscode.workspace.getConfiguration('svnTools').get('svnPath', '');
  if (configured) return configured;
  return 'svn';
}

function run(file, args, cwd) {
  return new Promise((resolve, reject) => {
    cp.execFile(file, args, { cwd, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const out = decode(stdout);
        const errText = decode(stderr).trim();
        if (err) {
          if (err.code === 'ENOENT') return reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
          return reject(new SvnError(errText || err.message, errText, err.code));
        }
        resolve({ stdout: out, stderr: errText });
      });
  });
}

// PATH에 svn이 없으면 TortoiseSVN에 딸린 svn.exe로 한 번 더 시도한다.
//
// 한글·공백 경로 규칙: 경로·커밋 메시지·속성 값은 **모두 인자로 직접** 넘긴다. Node가 윈도우에 인자를
// UTF-16으로 넘기고 svn이 그대로 받으므로 깨지지 않는다(2026-10-23 한글·공백 경로 테스트 저장소로 확인).
// **-F 파일 + --encoding utf-8은 쓰지 않는다** — svn 1.14는 --encoding을 붙이면 경로 인자까지 그 인코딩으로
// 다시 해석해 한글 경로가 '???'가 된다. --encoding 없이 -F만 쓰면 이번엔 파일 내용을 CP949로 읽어 한글 값이 깨진다.
async function exec(args, cwd) {
  const full = ['--non-interactive', ...args];
  let file = svnPath();
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(file, full, cwd);
    } catch (e) {
      if (e.code === 'ENOENT' && file === 'svn' && fs.existsSync(FALLBACK_SVN)) {
        file = FALLBACK_SVN;
        attempt--;
        continue;
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
      reposItem: repos ? attr(repos[0], 'item') : undefined,
    });
  }
  return out;
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

module.exports = {
  exec, realPath, decode, parseStatus, parseInfo, parseLog, parsePropget, parseInheritedProps, lastRevision, SvnError,
};
