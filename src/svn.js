'use strict';
// svn 실행과 XML 출력 해석. 외부 패키지 없이 Node 기본 기능만 쓴다.
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FALLBACK_SVN = 'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe';

class SvnError extends Error {
  constructor(message, stderr, code) {
    super(message);
    this.stderr = stderr || '';
    this.code = code;
  }
}

// 윈도우 svn은 메시지를 콘솔 코드페이지(CP949)로 낼 수 있다. UTF-8로 안 읽히면 EUC-KR로 다시 읽는다.
function decode(buf) {
  if (!buf || buf.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(buf);
    } catch {
      return buf.toString('latin1');
    }
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
async function exec(args, cwd) {
  const full = ['--non-interactive', ...args];
  const first = svnPath();
  try {
    return await run(first, full, cwd);
  } catch (e) {
    if (e.code === 'ENOENT' && first === 'svn' && fs.existsSync(FALLBACK_SVN)) {
      return run(FALLBACK_SVN, full, cwd);
    }
    throw e;
  }
}

// 커밋 메시지·속성 값은 인자 대신 임시 파일로 넘긴다(한글·여러 줄이 깨지지 않게).
async function withTempFile(text, fn) {
  const file = path.join(os.tmpdir(), `svn-tools-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(file, text, 'utf8');
  try {
    return await fn(file);
  } finally {
    fs.rmSync(file, { force: true });
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
      message: (element(body, 'msg') || '').trim(),
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

// "Committed revision 123." / "Updated to revision 123." / "At revision 123." 의 숫자
function lastRevision(text) {
  const m = /revision (\d+)/i.exec(text) || /리비전 (\d+)/.exec(text);
  return m ? m[1] : undefined;
}

module.exports = { exec, withTempFile, parseStatus, parseInfo, parseLog, parsePropget, lastRevision, SvnError };
