'use strict';
// 무시 패턴 읽기·쓰기: svn:ignore / svn:global-ignores(폴더 속성), 클라이언트 global-ignores(내 PC 설정 파일).
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const svn = require('./svn');

// svn 클라이언트의 기본 global-ignores. 설정 파일에 global-ignores 줄을 새로 만들면 이 기본값을
// 대체하므로, 처음 만들 때는 이 목록을 함께 적어 기존 동작을 유지한다.
// 출처: Apache Subversion 1.14의 기본 클라이언트 설정(Apache License 2.0). README의 "라이선스와 출처" 참고.
const SVN_DEFAULT_GLOBAL_IGNORES =
  '*.o *.lo *.la *.al .libs *.so *.so.[0-9]* *.a *.pyc *.pyo __pycache__ *.rej *~ #*# .#* .*.swp .DS_Store [Tt]humbs.db';

// global-ignores(속성·설정 모두)는 공백으로 나눈다.
function splitPatterns(text) {
  return text.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

// svn:ignore는 줄 단위다 — 패턴 안에 공백이 있을 수 있다(예: "my file"). 공백으로 나누면 다른 패턴이 된다.
function splitLines(text) {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function splitFor(prop, text) {
  return prop === 'svn:ignore' ? splitLines(text) : splitPatterns(text);
}

// ---- 폴더 속성 ----

async function getProp(prop, dir) {
  try {
    const { stdout } = await svn.exec(['propget', prop, dir], dir);
    return splitFor(prop, stdout);
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
  // 값은 인자로 직접 넘긴다 — -F 파일 + --encoding utf-8은 svn이 경로 인자까지 다시 해석해 한글 경로가 깨진다.
  await svn.exec(['propset', prop, patterns.join('\n') + '\n', dir], dir);
}

// 반환: true면 추가함, false면 이미 있음
// 반환: 새로 들어간 패턴 수(이미 있던 것은 건너뛴다)
async function addToProp(prop, dir, patterns) {
  const list = await getProp(prop, dir);
  const fresh = [...new Set(patterns)].filter((x) => !list.includes(x));
  if (fresh.length) await setProp(prop, dir, [...list, ...fresh]);
  return fresh.length;
}

// 폴더 아래에서 속성이 걸린 곳을 모두 찾는다. 반환: [{ dir, patterns }]
async function listProp(prop, root) {
  const { stdout } = await svn.exec(['propget', prop, '-R', '--xml', root], root);
  return svn.parsePropget(stdout).map((t) => ({ dir: t.path, patterns: splitFor(prop, t.value) }));
}

// ---- 무시 원인 찾기 ----

// svn과 같은 방식으로 이름 하나가 패턴에 맞는지 본다(apr_fnmatch, 플래그 없음): * ? [...] [!...] \이스케이프.
// 대소문자를 구분한다 — svn이 윈도우에서도 그렇게 맞춘다.
function matchPattern(pattern, name) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) {
      re += escapeRegex(pattern[++i]);
    } else if (c === '*') {
      re += '.*';
    } else if (c === '?') {
      re += '.';
    } else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end < 0) {
        re += '\\[';
        continue;
      }
      let body = pattern.slice(i + 1, end);
      const negate = body[0] === '!' || body[0] === '^';
      if (negate) body = body.slice(1);
      re += `[${negate ? '^' : ''}${body.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')}]`;
      i = end;
    } else {
      re += escapeRegex(c);
    }
  }
  return new RegExp(`^${re}$`).test(name);
}

function escapeRegex(c) {
  return c.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

// 무시된 경로 target(무시된 항목 자체 — 무시된 폴더 안의 파일이면 그 폴더)을 무시하게 만드는 규칙을 모두 찾는다.
// 반환: [{ kind: 'svn:ignore' | 'svn:global-ignores' | 'local', dir, pattern, editable }]
async function findRules(target) {
  const parent = path.dirname(target);
  const name = path.basename(target);
  const rules = [];

  for (const pattern of await getProp('svn:ignore', parent)) {
    if (matchPattern(pattern, name)) rules.push({ kind: 'svn:ignore', dir: parent, pattern, editable: true });
  }

  // global-ignores는 상위 폴더에서 물려받는다. 무시된 항목 자체는 버전 관리 대상이 아니라 상위 폴더로 조회한다.
  try {
    const { stdout } = await svn.exec(['propget', 'svn:global-ignores', '--show-inherited-props', '--xml', parent], parent);
    for (const t of svn.parseInheritedProps(stdout)) {
      for (const pattern of splitPatterns(t.value)) {
        if (matchPattern(pattern, name)) {
          rules.push({ kind: 'svn:global-ignores', dir: t.path, pattern, editable: !t.isUrl });
        }
      }
    }
  } catch (e) {
    if (!/W200017|E200017/.test(e.stderr || e.message)) throw e;
  }

  const local = readLocal();
  for (const pattern of local.patterns) {
    if (matchPattern(pattern, name)) rules.push({ kind: 'local', pattern, editable: true, source: local.source });
  }
  return rules;
}

// 규칙 하나를 지운다. 지울 때 현재 값을 다시 읽는다(그 사이 바뀐 다른 패턴을 덮어쓰지 않게).
async function removeRule(rule) {
  if (rule.kind === 'local') {
    writeLocal(readLocal().patterns.filter((p) => p !== rule.pattern));
    return;
  }
  const fresh = await getProp(rule.kind, rule.dir);
  await setProp(rule.kind, rule.dir, fresh.filter((p) => p !== rule.pattern));
}

// ---- 클라이언트 설정 (내 PC 전역 global-ignores) ----
//
// svn은 아래 순서로 찾아 **처음 값이 있는 곳 하나만** 쓴다(윈도우).
//   1. 내 설정 파일      %APPDATA%\Subversion\config
//   2. 내 레지스트리     HKCU\Software\Tigris.org\Subversion\Config\miscellany  global-ignores
//      ← TortoiseSVN 설정 화면의 "전역 무시 패턴"이 여기를 고친다(Tortoise 전용이 아니라 svn 표준 위치)
//   3. 시스템 설정 파일  %ALLUSERSPROFILE%\Subversion\config      (이 PC의 모든 사용자)
//   4. 시스템 레지스트리 HKLM\Software\Tigris.org\Subversion\Config\miscellany  global-ignores
//   5. svn 내장 기본값
// 쓸 때는 **지금 값이 있는 곳을 그대로 고친다**(writeLocal): 1번이면 설정 파일, 아니면 내 레지스트리.
// 그래서 TortoiseSVN 설정 화면과 항상 같은 값이 보인다. 3~5번은 관리자 권한이 필요하거나 고칠 곳이 없어서,
// 지금 값을 내 레지스트리에 옮겨 적고 고친다(2번이 3~5번보다 우선한다).
const REG_KEY = 'Software\\Tigris.org\\Subversion\\Config\\miscellany';

function configPath() {
  return path.join(process.env.APPDATA || '', 'Subversion', 'config');
}

function systemConfigPath() {
  return path.join(process.env.ALLUSERSPROFILE || 'C:\\ProgramData', 'Subversion', 'config');
}

// 처음 레지스트리를 고치기 전 원래 값을 남기는 파일
function registryBackupPath() {
  return path.join(process.env.APPDATA || '', 'Subversion', 'svn-tools-registry-global-ignores.bak');
}

// 설정 파일의 global-ignores 패턴. 파일이나 줄이 없으면 undefined.
function readConfigFile(file) {
  if (!fs.existsSync(file)) return undefined;
  const found = findGlobalIgnores(fs.readFileSync(file, 'utf8').split(/\r?\n/));
  return found ? found.patterns : undefined;
}

// 레지스트리 값. reg는 키·값이 없으면 종료 코드 1로 끝난다. 출력은 CP949라 svn.decode로 읽는다.
// key는 테스트에서 실제 svn 설정 대신 임시 키를 쓰려고 바꿀 수 있게 둔다.
function readRegistry(hive, key = REG_KEY) {
  if (process.platform !== 'win32') return undefined;
  try {
    const buf = cp.execFileSync('reg', ['query', `${hive}\\${key}`, '/v', 'global-ignores'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return parseRegQuery(svn.decode(buf));
  } catch {
    return undefined;
  }
}

// 내 레지스트리(HKCU)에 쓴다. 값은 인자로 넘긴다(Node가 UTF-16으로 넘겨 한글도 그대로 들어간다).
function writeRegistry(patterns, key = REG_KEY) {
  cp.execFileSync('reg', ['add', `HKCU\\${key}`, '/v', 'global-ignores', '/t', 'REG_SZ', '/d', patterns.join(' '), '/f'],
    { windowsHide: true, stdio: 'ignore' });
}

// "    global-ignores    REG_SZ    *.o *.pyc" → 패턴 목록
function parseRegQuery(text) {
  const m = /^\s*global-ignores\s+REG_(?:EXPAND_)?SZ\s*(.*)$/m.exec(text);
  return m ? splitPatterns(m[1]) : undefined;
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

// 지금 실제로 쓰이는 내 PC 전역 목록과 그 출처.
// source: 'userFile' | 'userRegistry' | 'systemFile' | 'systemRegistry' | 'default'
// set: 내 설정 파일에 값이 있는지
function readLocal() {
  const candidates = [
    ['userFile', () => readConfigFile(configPath())],
    ['userRegistry', () => readRegistry('HKCU')],
    ['systemFile', () => readConfigFile(systemConfigPath())],
    ['systemRegistry', () => readRegistry('HKLM')],
  ];
  for (const [source, read] of candidates) {
    const patterns = read();
    if (patterns) return { source, set: source === 'userFile', patterns };
  }
  return { source: 'default', set: false, patterns: splitPatterns(SVN_DEFAULT_GLOBAL_IGNORES) };
}

// 저장하면 어디에 쓰는지: 지금 값이 내 설정 파일에 있으면 그 파일, 아니면 내 레지스트리(윈도우).
function localWriteTarget() {
  if (process.platform !== 'win32') return 'userFile';
  return readLocal().source === 'userFile' ? 'userFile' : 'userRegistry';
}

// 내 PC 전역 목록을 쓴다. 쓴 곳('userFile' | 'userRegistry')을 돌려준다.
function writeLocal(patterns) {
  const target = localWriteTarget();
  if (target === 'userRegistry') {
    // 처음 고칠 때 원래 레지스트리 값을 한 번 남긴다(값이 없었으면 그렇다고 적는다).
    const backup = registryBackupPath();
    if (!fs.existsSync(backup)) {
      const before = readRegistry('HKCU');
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, before ? before.join(' ') : '(HKCU global-ignores 값 없음)', 'utf8');
    }
    writeRegistry(patterns);
    return target;
  }
  writeConfigFile(patterns);
  return target;
}

function writeConfigFile(patterns) {
  const file = configPath();
  const value = `global-ignores = ${patterns.join(' ')}`;
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
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

function addToLocal(add) {
  const { patterns } = readLocal();
  const fresh = [...new Set(add)].filter((x) => !patterns.includes(x));
  if (fresh.length) writeLocal([...patterns, ...fresh]);
  return fresh.length;
}

module.exports = {
  getProp, setProp, addToProp, listProp, readLocal, writeLocal, addToLocal, localWriteTarget, configPath,
  SVN_DEFAULT_GLOBAL_IGNORES, matchPattern, findRules, removeRule, parseRegQuery, splitLines,
  readRegistry, writeRegistry,
};
