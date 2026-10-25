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

console.log(`\n메뉴 구조: 명령 ${commands.size}, 하위 메뉴 ${submenus.size}, 메시지 키 ${used.size}`);
if (problems.length) {
  console.log(problems.map((p) => `FAIL ${p}`).join('\n'));
  process.exit(1);
}
console.log('OK   메뉴 구조·메시지 키 일관성');
