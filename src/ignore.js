'use strict';
// 무시 패턴 읽기·쓰기: svn:ignore / svn:global-ignores(폴더 속성), 클라이언트 global-ignores(내 PC 설정 파일).
const fs = require('fs');
const path = require('path');
const svn = require('./svn');

// svn 클라이언트의 기본 global-ignores. 설정 파일에 global-ignores 줄을 새로 만들면 이 기본값을
// 대체하므로, 처음 만들 때는 이 목록을 함께 적어 기존 동작을 유지한다.
const SVN_DEFAULT_GLOBAL_IGNORES =
  '*.o *.lo *.la *.al .libs *.so *.so.[0-9]* *.a *.pyc *.pyo __pycache__ *.rej *~ #*# .#* .*.swp .DS_Store [Tt]humbs.db';

function splitPatterns(text) {
  return text.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

// ---- 폴더 속성 ----

async function getProp(prop, dir) {
  try {
    const { stdout } = await svn.exec(['propget', prop, dir], dir);
    return splitPatterns(stdout);
  } catch (e) {
    // 속성이 없으면 W200017 경고로 끝난다 — 빈 목록으로 본다.
    if (/W200017|E200017/.test(e.stderr || e.message)) return [];
    throw e;
  }
}

async function setProp(prop, dir, patterns) {
  if (patterns.length === 0) {
    await svn.exec(['propdel', prop, dir], dir);
    return;
  }
  // svn:ignore는 줄마다 패턴 하나가 관례다. global-ignores도 같은 형식을 받는다.
  await svn.withTempFile(patterns.join('\n') + '\n', (file) =>
    svn.exec(['propset', prop, '-F', file, '--encoding', 'utf-8', dir], dir));
}

// 반환: true면 추가함, false면 이미 있음
async function addToProp(prop, dir, pattern) {
  const list = await getProp(prop, dir);
  if (list.includes(pattern)) return false;
  await setProp(prop, dir, [...list, pattern]);
  return true;
}

// 폴더 아래에서 속성이 걸린 곳을 모두 찾는다. 반환: [{ dir, patterns }]
async function listProp(prop, root) {
  const { stdout } = await svn.exec(['propget', prop, '-R', '--xml', root], root);
  return svn.parsePropget(stdout).map((t) => ({ dir: t.path, patterns: splitPatterns(t.value) }));
}

// ---- 클라이언트 설정 파일 (%APPDATA%\Subversion\config) ----

function configPath() {
  return path.join(process.env.APPDATA || '', 'Subversion', 'config');
}

// [miscellany] 섹션의 global-ignores 값 위치를 찾는다. 들여쓴 다음 줄은 이어지는 값이다.
function findGlobalIgnores(lines) {
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const section = /^\s*\[([^\]]+)\]/.exec(line);
    if (section) {
      inSection = section[1].trim() === 'miscellany';
      continue;
    }
    if (!inSection) continue;
    const m = /^global-ignores\s*=(.*)$/.exec(line);
    if (m) {
      let end = i;
      const parts = [m[1]];
      while (end + 1 < lines.length && /^[ \t]+\S/.test(lines[end + 1])) {
        end++;
        parts.push(lines[end]);
      }
      return { start: i, end, patterns: splitPatterns(parts.join(' ')) };
    }
  }
  return undefined;
}

function readLocal() {
  const file = configPath();
  if (!fs.existsSync(file)) return { exists: false, patterns: splitPatterns(SVN_DEFAULT_GLOBAL_IGNORES) };
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const found = findGlobalIgnores(lines);
  return { exists: true, set: !!found, patterns: found ? found.patterns : splitPatterns(SVN_DEFAULT_GLOBAL_IGNORES) };
}

function writeLocal(patterns) {
  const file = configPath();
  const value = `global-ignores = ${patterns.join(' ')}`;
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text ? text.split(/\r?\n/) : [];
  // 처음 고칠 때 원본을 한 번 남긴다.
  const backup = file + '.svn-tools.bak';
  if (text && !fs.existsSync(backup)) fs.writeFileSync(backup, text, 'utf8');

  const found = findGlobalIgnores(lines);
  if (found) {
    lines.splice(found.start, found.end - found.start + 1, value);
  } else {
    const idx = lines.findIndex((l) => /^\s*\[miscellany\]/.test(l));
    if (idx >= 0) lines.splice(idx + 1, 0, value);
    else lines.push('', '[miscellany]', value);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join(eol), 'utf8');
}

function addToLocal(pattern) {
  const { patterns } = readLocal();
  if (patterns.includes(pattern)) return false;
  writeLocal([...patterns, pattern]);
  return true;
}

module.exports = {
  getProp, setProp, addToProp, listProp, readLocal, writeLocal, addToLocal, configPath, SVN_DEFAULT_GLOBAL_IGNORES,
};
