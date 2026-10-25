'use strict';
// 빌드(package.json 생성 + .vsix)부터 VS Code 설치까지 한 번에. 실행: npm run install-vscode
//   node install.js --insiders   VS Code Insiders에 설치
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const code = process.argv.includes('--insiders') ? 'code-insiders' : 'code';

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  // code·npx는 윈도우에서 .cmd라 shell을 거쳐야 실행된다. 인자에 공백이 있을 수 있어 따옴표로 감싼다.
  const q = (a) => (/\s/.test(a) ? `"${a}"` : a);
  const r = spawnSync(q(cmd), args.map(q), { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\n실패: ${cmd} (종료 코드 ${r.status})`);
    process.exit(r.status || 1);
  }
}

run(process.execPath, ['manifest.js']);
const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsix = path.join(root, `${name}-${version}.vsix`);
run('npx', ['--yes', '@vscode/vsce', 'package', '--out', vsix]);
run(code, ['--install-extension', vsix, '--force']);
console.log(`\n설치 완료: ${name} ${version}. VS Code에서 Developer: Reload Window를 실행하세요.`);
