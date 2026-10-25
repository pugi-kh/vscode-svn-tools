'use strict';
// 생성된 package.json의 메뉴 구조 검사. 실행: npm test (manifest.js를 고친 뒤 node manifest.js 먼저)
//   - 메뉴가 가리키는 명령·하위 메뉴가 모두 정의돼 있는가
//   - 정의된 하위 메뉴마다 내용이 있는가
//   - 언어별 하위 메뉴(.en/.ko) 안에 다른 언어 항목이 섞이지 않았는가
//   - 모든 명령에 처리 함수가 있는가(commands.js의 반환 객체, tortoise.js의 COMMANDS)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const c = pkg.contributes;
const commands = new Set(c.commands.map((x) => x.command));
const submenus = new Set(c.submenus.map((x) => x.id));
const problems = [];

for (const [menu, items] of Object.entries(c.menus)) {
  if (menu !== 'commandPalette' && !menu.includes('/') && !submenus.has(menu)) problems.push(`선언되지 않은 하위 메뉴: ${menu}`);
  const lang = /\.(en|ko)$/.exec(menu);
  for (const it of items) {
    if (it.command && !commands.has(it.command)) problems.push(`${menu}: 없는 명령 ${it.command}`);
    if (it.submenu && !submenus.has(it.submenu)) problems.push(`${menu}: 없는 하위 메뉴 ${it.submenu}`);
    const target = it.command || it.submenu;
    if (lang && target && !target.endsWith('.' + lang[1])) problems.push(`${menu}: 다른 언어 항목 ${target}`);
  }
}
for (const s of submenus) if (!c.menus[s] || c.menus[s].length === 0) problems.push(`내용 없는 하위 메뉴: ${s}`);

const commandsSrc = fs.readFileSync(path.join(root, 'src', 'commands.js'), 'utf8');
const handlers = new Set([...commandsSrc.matchAll(/^    (\w+): (?:command\(|\(name\))/gm)].map((m) => m[1]));
const tortoiseSrc = fs.readFileSync(path.join(root, 'src', 'tortoise.js'), 'utf8');
const tortoise = new Set([...tortoiseSrc.matchAll(/^  (\w+): \{ cmd:/gm)].map((m) => m[1]));
for (const cmd of commands) {
  const base = cmd.replace(/^svnTools\./, '').replace(/\.(en|ko)$/, '');
  const ok = base.startsWith('tortoise.') ? tortoise.has(base.slice('tortoise.'.length)) : handlers.has(base);
  if (!ok) problems.push(`처리 함수 없음: ${cmd}`);
}

// 코드에서 쓰는 메시지 키(t('...'))가 한국어·영어 표에 모두 있는가
const i18nSrc = fs.readFileSync(path.join(root, 'src', 'i18n.js'), 'utf8');
const koBlock = i18nSrc.slice(i18nSrc.indexOf('  ko: {'), i18nSrc.indexOf('  en: {'));
const enBlock = i18nSrc.slice(i18nSrc.indexOf('  en: {'));
const defined = (block) => new Set([...block.matchAll(/^    (\w+): /gm)].map((m) => m[1]));
const koKeys = defined(koBlock);
const enKeys = defined(enBlock);
const used = new Set();
for (const f of fs.readdirSync(path.join(root, 'src'))) {
  const text = fs.readFileSync(path.join(root, 'src', f), 'utf8');
  for (const m of text.matchAll(/\bt\('(\w+)'/g)) used.add(m[1]);
}
for (const k of used) {
  if (!koKeys.has(k)) problems.push(`한국어 문구 없음: ${k}`);
  if (!enKeys.has(k)) problems.push(`영어 문구 없음: ${k}`);
}

// 웹뷰 화면 스크립트: html()이 만드는 <script>를 꺼내 문법을 보고, append/replaceChildren에 null이 들어갈 수 있는
// 모양(`? el(...) : null`을 그대로 넘김)을 잡는다 — DOM은 null을 글자 "null"로 그린다(CLAUDE.md 함정 6, 두 번 겪음).
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'vscode') return { workspace: { getConfiguration: () => ({ get: (_k, d) => d }) } };
  return origLoad.call(this, req, ...rest);
};
const VIEWS = [['commitView', 'CommitView'], ['ignoreView', 'IgnoreView'], ['reasonView', 'ReasonView']];
for (const [file, cls] of VIEWS) {
  const mod = require(path.join(root, 'src', file));
  const html = mod[cls].prototype.html ? mod[cls].prototype.html.call({}) : mod.html();
  const script = html.split(/<script[^>]*>/)[1].split('</script>')[0];
  try {
    new Function(script); // eslint-disable-line no-new-func
  } catch (e) {
    problems.push(`${file} 웹뷰 스크립트 문법 오류: ${e.message}`);
  }
  for (const problem of nullPassing(script)) problems.push(`${file}: ${problem}`);
}

// `const v = 조건 ? ... : null;`로 만든 변수를 replaceChildren/append에 걸러지지 않은 채 넘기는 곳.
// 같은 호출 문장(세미콜론까지) 안에 .filter(Boolean)이 있으면 걸렀다고 본다.
function nullPassing(script) {
  const out = [];
  const nullVars = [...script.matchAll(/const (\w+) = [^;\n]*\? [^;\n]*: null;/g)].map((m) => m[1]);
  for (const call of script.matchAll(/\.(replaceChildren|append)\(([^;]*)\)/g)) {
    const body = call[2];
    if (body.includes('.filter(Boolean)')) continue;
    for (const v of nullVars) if (new RegExp(`\\b${v}\\b`).test(body)) out.push(`${v}(null일 수 있음)를 ${call[1]}에 그대로 넘김`);
  }
  return out;
}
// 검사 자체가 잡는지 확인: 0.10.0 개발 중 실제로 낸 버그 모양
if (nullPassing("const noteBox = note ? el('div') : null;\nroot.replaceChildren(a, noteBox, b);").length !== 1) {
  problems.push('null 검사가 알려진 버그 모양을 잡지 못함');
}

console.log(`\n메뉴 구조: 명령 ${commands.size}, 하위 메뉴 ${submenus.size}, 메시지 키 ${used.size}, 웹뷰 ${VIEWS.length}`);
if (problems.length) {
  console.log(problems.map((p) => `FAIL ${p}`).join('\n'));
  process.exit(1);
}
console.log('OK   메뉴 구조·메시지 키 일관성, 웹뷰 스크립트');
