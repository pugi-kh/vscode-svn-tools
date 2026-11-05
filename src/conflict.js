'use strict';
// 충돌 정보 읽기와 "로컬 미등록 파일 + 서버에서 추가" 트리 충돌 처리. vscode 없이 동작한다(npm test에서 직접 부른다).
const fs = require('fs');
const path = require('path');
const svn = require('./svn');

// 충돌 항목들의 상세 정보. 경로 순서대로 돌려주고, 읽지 못한 항목은 undefined.
async function read(files, cwd) {
  let xml;
  try {
    xml = (await svn.exec(['info', '--xml', ...files], cwd)).stdout;
  } catch (e) {
    xml = e.stdout || '';
  }
  const byKey = new Map(svn.parseConflicts(xml, cwd).map((c) => [c.path.toLowerCase(), c]));
  return files.map((f) => byKey.get(path.normalize(f).toLowerCase()));
}

// update·switch 때 로컬에 같은 이름의 미등록 파일이 있었던 경우("local file unversioned, incoming file add").
// 이 상태는 이미 삭제 예약(D)이라 --accept working만 하면 삭제가 남는다 — 커밋하면 서버 파일이 지워진다(테스트로 확인).
function isLocalAdd(c) {
  const tc = c && c.tree;
  return !!tc && tc.reason === 'unversioned' && tc.action === 'add' && tc.kind === 'file'
    && (tc.operation === 'update' || tc.operation === 'switch');
}

// 병합 편집기에 넣을 세 파일. TortoiseSVN "Merge the files"로 위 트리 충돌을 텍스트 충돌로 바꾸면
// svn이 서버 파일 위에 로컬 파일을 병합해서, prev-wc가 서버·cur-base가 내 파일이 된다(리비전 정보도 없다, 테스트로 확인).
function mergeSides(text) {
  const swapped = text.operation === 'merge' && !text.leftRev && !text.rightRev;
  return swapped
    ? { base: text.base, mine: text.theirs, theirs: text.mine, swapped }
    : { base: text.base, mine: text.mine, theirs: text.theirs, swapped };
}

// 서버 파일을 BASE로 받고 내 파일 내용은 수정(M)으로 남긴다. revert가 작업 파일을 서버 내용으로 덮어서 미리 읽어 둔다.
async function keepLocal(file, cwd) {
  const local = fs.readFileSync(file);
  try {
    await svn.exec(['resolve', '--accept', 'working', file], cwd);
    await svn.exec(['revert', file], cwd);
  } finally {
    fs.writeFileSync(file, local);
  }
}

// 서버 파일로 바꾼다. 내 파일은 discard(휴지통 등)로 치운 뒤 revert가 서버 내용을 되살린다.
async function takeIncoming(file, cwd, discard) {
  await svn.exec(['resolve', '--accept', 'working', file], cwd);
  await discard(file);
  await svn.exec(['revert', file], cwd);
}

// 병합을 마쳤는지: 줄 맨 앞의 충돌 마커가 남았는지 본다.
function hasMarkers(content) {
  return /^(<{7}|>{7})( |\r?$)|^={7}\r?$/m.test(content);
}

module.exports = { read, isLocalAdd, mergeSides, keepLocal, takeIncoming, hasMarkers };
