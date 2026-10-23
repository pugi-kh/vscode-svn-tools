# SVN Tools

VS Code에서 SVN을 쓰기 위한 확장. Source Control 패널, 탐색기 우클릭 메뉴(SVN / TortoiseSVN),
탐색기 상태 표시(무시된 파일 회색 포함)를 한 확장으로 제공한다.

- ID: `khoon.vscode-svn-tools`
- 언어는 두 가지를 따로 고른다: 메뉴·버튼·Source Control 그룹 이름은 `svnTools.menuLanguage`, 알림·확인 창·화면 문구는
  `svnTools.language`. 둘 다 기본 영어이고 한국어는 `ko`. 이 문서는 메뉴를 영어 이름으로 적는다.
- 필요: SVN 명령줄 클라이언트(`svn`). PATH에 없으면 TortoiseSVN에 딸린 `svn.exe`를 쓴다.
  TortoiseSVN 메뉴를 쓰려면 TortoiseSVN이 설치돼 있어야 한다.

## 기능

### Source Control 패널
- 변경 목록을 **Conflicts / Changes / Unversioned**(메뉴 언어가 한국어면 충돌 / 변경 / 미등록) 세 그룹으로 보여 준다. 파일을 누르면 BASE와 비교한다.
- 메시지 입력 → 커밋(✓ 또는 Ctrl+Enter). 위쪽 버튼: Commit, Update, Refresh. `…`에 Show Log, Clean Up,
  Edit Ignore Lists…, TortoiseSVN 메뉴.
- 파일 옆 버튼: Open File, Revert(미등록이면 Add). 그룹 옆 버튼: Revert All / Add All.
- 편집기 줄 번호 옆에 바뀐 줄 표시(BASE 기준).

### 탐색기 우클릭
자주 쓰는 네 가지는 하위 메뉴 없이 바로 보인다. 나머지는 **SVN**, **TortoiseSVN** 하위 메뉴에 있다.

| 위치 | 메뉴 | 동작 |
|---|---|---|
| 바로 | SVN Update / SVN Commit… | 선택한 파일·폴더만 업데이트·커밋 |
| 바로 | SVN Add | 폴더를 고르면 안의 미등록 항목까지(무시된 것은 제외) |
| 바로 | SVN Ignore… | 이름·확장자·직접 입력 → 적용 범위(아래) |
| SVN ▸ | Compare with BASE | 파일은 비교 화면, 폴더는 `svn diff` 결과 |
| SVN ▸ | Compare with Revision… | 맨 위 "리비전 직접 입력…"(숫자, `HEAD`·`PREV`·`BASE`·`COMMITTED`·`{날짜}`) 또는 아래 최근 로그에서 골라 작업본과 비교 |
| SVN ▸ | Show Log | 이력 목록 → 리비전을 고르면 작업본과 비교 / 그 리비전의 변경 보기 / 바뀐 파일 목록 / 메시지 복사 |
| SVN ▸ Delete ▸ | Keep Local File / Delete Local File Too | SVN에서 빼면서 로컬 파일을 남길지(`--keep-local`) 지울지 고른다 |
| SVN ▸ | Rename (keep history) | `svn move`라 이력이 이어진다 |
| SVN ▸ | Revert | 확인 후 되돌린다(복구 불가) |
| SVN ▸ | Resolve Conflict… | 지금 파일 그대로 / 내 것 / 서버 것 / 충돌 부분만 내 것·서버 것 / TortoiseSVN 충돌 편집기 |
| SVN ▸ | Show Ignore Reason… | 어떤 규칙(패턴) 때문에 무시되는지 카드로 보여 주고, 고칠 수 있는 규칙은 그 자리에서 지운다(아래) |
| SVN ▸ | Edit Ignore Lists… | 무시 목록 편집 화면(아래) |
| SVN ▸ | Clean Up | 작업 사본 루트에서 실행 |
| SVN ▸ | Copy SVN URL | 저장소 주소를 클립보드로 |

편집기 탭 우클릭에도 같은 메뉴가 있다. Source Control 패널의 파일 우클릭에도 Commit, Compare, Show Log, Revert, Delete ▸ 등이 있다.

**무시 목록 적용 범위**

| 종류 | 범위 | 공유 |
|---|---|---|
| `svn:ignore` | 그 폴더의 바로 아래 항목만 | 커밋하면 공유 |
| `svn:global-ignores` | 그 폴더와 아래 모든 폴더 | 커밋하면 공유 |
| 내 PC 전체 | 이 PC의 모든 svn 클라이언트(명령줄, TortoiseSVN 포함) | 공유 안 됨 |

**패턴 작성법**: `*` 여러 글자, `?` 한 글자, `[abc]` 괄호 안 한 글자, `[!abc]` 괄호 안 글자를 제외한 한 글자.
정규식이 아니다(예: `.*`는 "점으로 시작하는 이름"). 대소문자를 구분한다. **공백은 쓸 수 없다** — 공백이 든 이름은 `?`로 맞춘다
(`my?file`은 `my file`에 맞음). 다른 도구로 만든 공백 포함 `svn:ignore` 패턴은 그대로 읽고 삭제할 수 있다.

**내 PC 전체 목록**은 svn 명령이 아니라 설정을 직접 고친다. svn은 아래 순서로 찾아 **처음 값이 있는 곳 하나만** 쓴다.
이 확장은 같은 순서로 읽어 실제로 쓰이는 값과 출처를 보여 주고, **고칠 때는 지금 값이 있는 곳을 그대로 고친다.**

| 순서 | 위치 | 고칠 때 |
|---|---|---|
| 1 | 내 설정 파일 `%APPDATA%\Subversion\config` | 이 파일을 고친다 |
| 2 | 내 레지스트리 `HKCU\Software\Tigris.org\Subversion\Config` — **TortoiseSVN 설정의 "전역 무시 패턴"이 고치는 곳** | 레지스트리를 고친다 |
| 3 | 시스템 설정 파일 `%ALLUSERSPROFILE%\Subversion\config` (이 PC의 모든 사용자) | 지금 값을 내 레지스트리에 옮겨 적고 고친다 |
| 4 | 시스템 레지스트리 | 위와 같음 |
| 5 | svn 내장 기본값 | 위와 같음 |

그래서 TortoiseSVN 설정 화면과 이 확장은 항상 같은 값을 보여 준다(1번 설정 파일에 값이 있는 경우는 svn 규칙상 그 파일이 우선한다).
처음 고치기 전 원래 값은 백업한다: 설정 파일은 `config.svn-tools.bak`, 레지스트리는 `%APPDATA%\Subversion\svn-tools-registry-global-ignores.bak`.
3·4번(시스템 설정)은 관리자 권한이 필요해 직접 고치지 않는다.

### 무시된 원인 보기
탐색기 우클릭 SVN → **Show Ignore Reason…**. 무시된 파일·폴더가 **어떤 규칙 때문에** 무시되는지
탭으로 보여 준다. svn은 원인을 알려 주지 않아서, 확장이 상위 폴더의 `svn:ignore`, 위로 물려받는 `svn:global-ignores`,
내 PC 전체 목록을 svn과 같은 방식으로 맞춰 본다.

- 무시된 폴더 안의 파일이면 그 폴더가 대상이다(예: `logs/a.log` → `logs`). 화면 위에 그렇게 표시한다.
- **규칙마다 카드 하나**: 종류와 위치, 패턴, 어떤 설정인지 한 줄 설명.
- 고칠 수 있는 카드에만 **[패턴 삭제]**. 누르면 확인 창에 **같은 패턴으로 무시되던 다른 항목**을 보여 준 뒤 지운다.
  삭제할 수 있는 규칙이 둘 이상이면 위에 **[삭제할 수 있는 패턴 모두 삭제]**.
- 내 PC 전체 카드에는 **[TortoiseSVN 설정 열기]**.
- 작업 사본보다 위(저장소)에 걸린 규칙은 설명만 보여 준다(여기서 바꿀 수 없다 — 그 폴더를 체크아웃한 곳에서 고친다).

폴더 규칙은 작업 사본에만 바뀌고 커밋해야 서버에 반영된다.

### 무시 목록 편집 화면
탐색기 우클릭 SVN → **Edit Ignore Lists…**, Source Control 패널 `…`, 명령 팔레트("SVN: Edit Ignore Lists…")에서 연다.
VS Code 설정 화면에는 확장이 이런 편집 화면을 넣을 수 없어서 별도 탭으로 연다. 위에 패턴 작성법 한 줄이 있다.

- **이 프로젝트의 무시 규칙**: 열린 폴더 아래에서 `svn:ignore`·`svn:global-ignores`가 걸린 폴더를 모두 찾아
  폴더·종류별 카드로 보여 준다. **작업 폴더(루트)는 규칙이 없어도 두 종류 카드를 항상 보인다** — 프로젝트 전체에
  적용할 패턴은 루트의 `svn:global-ignores` 카드에 넣는다. 커밋 안 된 속성 변경은 "커밋 필요"로 표시한다.
- **다른 폴더에 규칙 추가**: 아직 규칙이 없는 폴더에 새로 걸 때. 폴더(열린 폴더 기준 상대 경로)와 종류를 고르면
  빈 카드가 생긴다. 폴더에서 열면 그 폴더가 미리 채워진다.
- **내 PC 전체**: 지금 쓰이는 값과 출처, 저장하면 쓰는 곳을 표시한다. [TortoiseSVN 설정 열기] 버튼이 있다.

**고친 내용은 [저장]을 눌러야 적용된다.** 저장 전에는 추가·수정·삭제 예정이 표시되고, 삭제는 복구할 수 있다.
[변경 취소]로 모두 버린다. 저장은 현재 값을 다시 읽고 바꾼 부분만 얹는다(화면을 연 뒤 밖에서 바뀐 패턴을
덮어쓰지 않는다). 저장하지 않고 탭을 닫으면 버렸다고 알린다.

### 탐색기 우클릭 → TortoiseSVN
TortoiseSVN 창을 바로 연다(메뉴 이름은 TortoiseSVN과 같다): Update, Commit, Show Log, Diff, Revision Graph, Repo-browser,
Blame, Add, Delete, Rename, Revert, Edit Conflicts, Resolved, Add to Ignore List, Properties, Merge, Switch,
Get Lock / Release Lock, Clean Up, Settings.
창을 닫으면 상태를 새로고침한다.

### 탐색기 표시
`M` 수정, `A` 추가, `D` 삭제, `U` 미등록, `C` 충돌, `!` 누락. **무시된 파일은 회색**이고, 무시된 폴더 안의
파일도 회색이다.

### 커밋 전 서버 확인
커밋할 때 서버에 더 새 버전이 있으면 알려 주고 "Update 먼저 / 그대로 커밋"을 고르게 한다.
누락(`!`) 파일이 있으면 삭제로 처리할지 묻는다.

## 설정

| 설정 | 기본값 | 설명 |
|---|---|---|
| `svnTools.menuLanguage` | `en` | 메뉴·버튼·Source Control 그룹 이름 언어 (`en` / `ko`) |
| `svnTools.language` | `en` | 알림·확인 창·화면 문구 언어 (`en` / `ko`) |
| `svnTools.commit.checkOutOfDate` | `true` | 커밋 전 서버 변경 확인 |
| `svnTools.scm.fadeUnversioned` | `true` | Source Control 패널에서 미등록 파일을 흐리게 |
| `svnTools.decorations.enabled` | `true` | 탐색기 상태 표시 |
| `svnTools.svnPath` | (비움) | `svn.exe` 경로 |
| `svnTools.tortoiseProcPath` | (비움) | `TortoiseProc.exe` 경로 |

## 색상 바꾸기
상태별 색은 이 확장의 색상 ID라서 git 색과 따로 바꿀 수 있다. 기본값은 지금 테마의 git 색과 같다.
`settings.json`에 넣는다:

```json
"workbench.colorCustomizations": {
  "svnTools.ignoredForeground": "#6e6e6e",
  "svnTools.unversionedForeground": "#4ec9b0"
}
```

| 색상 ID | 대상 |
|---|---|
| `svnTools.modifiedForeground` | 수정(M)·교체(R) |
| `svnTools.addedForeground` | 추가(A) |
| `svnTools.deletedForeground` | 삭제(D)·누락(!) |
| `svnTools.conflictedForeground` | 충돌(C)·막힘(~) |
| `svnTools.unversionedForeground` | 미등록(U) |
| `svnTools.ignoredForeground` | 무시된 파일 |

## 동작 범위
작업 사본 루트가 VS Code에서 연 폴더보다 위에 있어도, 패널과 표시는 **연 폴더 안**만 다룬다(같은 작업 사본의
다른 프로젝트 변경이 섞이지 않게). 정리(Cleanup)만 작업 사본 루트에서 돈다.

파일이 바뀌면 자동으로 새로고침한다. 무시된 폴더 안의 변경(수집 로그 등)은 새로고침을 일으키지 않는다.
VS Code 밖(TortoiseSVN 등)에서 바꾼 것은 창으로 돌아올 때 반영된다.

## 테스트한 환경

아래 환경에서 개발·확인했다(2026-10-23). 다른 버전에서도 동작할 수 있지만 확인하지 않았다.

| 항목 | 버전 |
|---|---|
| Windows | 10 Pro 22H2 (빌드 19045) |
| VS Code | 1.141.1 (확장이 요구하는 최소 버전: 1.80) |
| Subversion 명령줄 클라이언트 | 1.14.5 (TortoiseSVN에 포함된 `svn.exe`) |
| TortoiseSVN | 1.14.9 (빌드 29743) |
| Node.js (빌드·테스트용) | 20.19.6 |

한글·공백이 들어간 경로는 `npm test`로 확인한다(아래 "개발").

## 요청과 기여

- **기능 요청·버그 신고**: [GitHub 이슈](https://github.com/pugi-kh/vscode-svn-tools/issues)
- **직접 고쳐서 보내기**: 저장소를 fork해서 고친 뒤 Pull Request를 보낸다. 고치기 전에 `CLAUDE.md`(함정·절차)를 보고,
  svn에 쓰는 명령을 고쳤다면 `npm test`를 통과시킨다. 보낸 수정은 이 저장소와 같은 MIT 라이선스로 들어온다.

## 다른 SVN 확장과 같이 쓰지 말 것
같은 역할을 하는 확장(예: Chris Johnston의 "SVN", "SVN - Subversion Support")이 켜져 있으면 Source Control
패널과 우클릭 메뉴가 겹친다. 이 확장을 쓰면 그것들은 끈다. 줄 단위 이력(SVN Lens)은 겹치지 않는다.

## 개발

### 준비물
- **Node.js** (v20에서 확인). 외부 패키지가 없어서 `npm install`은 필요 없다 — clone하면 바로 빌드된다.
- 처음 빌드할 때 `npx`가 패키징 도구 `@vscode/vsce`를 인터넷에서 받는다.

### 빌드와 설치

```
npm test                                             # 한글·공백 경로 회귀 검사 + 메뉴 구조 검사
npm run package                                      # package.json 생성 + vscode-svn-tools-<버전>.vsix 생성
code --install-extension vscode-svn-tools-<버전>.vsix   # 설치(같은 ID면 덮어쓴다)
```

설치 뒤 VS Code에서 **Developer: Reload Window**를 해야 새 버전이 적용된다. 웹뷰(무시 목록 편집)는 열려 있던
탭을 닫고 다시 연다. `.vsix`는 빌드 결과물이라 git에 넣지 않는다.

### 고칠 때
고치기 전에 **`CLAUDE.md`** 를 먼저 본다 — 한글 경로·인코딩 등 실제로 겪은 함정과 설계 이유, 명령 추가 절차가 있다.

- **`package.json`은 직접 고치지 않는다.** `manifest.js`가 만든다 — 명령·메뉴·설정·버전은 `manifest.js`에서 고친다.
  `node manifest.js`만 따로 돌려 `package.json`을 다시 만들 수도 있다.
- **버전**: `manifest.js`의 `version`을 올리고 `CHANGELOG.md`에 항목을 추가한 뒤 빌드한다.
- 문법만 빠르게 볼 때: `for f in src/*.js; do node --check "$f"; done` (git bash)

메뉴 이름(한/영)은 `manifest.js`에, 알림·확인 창·화면 문구(한/영)는 `src/i18n.js`에 있다. 메뉴 이름을 설정으로 바꾸려고
명령을 `svnTools.<id>.en` / `.ko` 두 벌 등록한다(VS Code는 메뉴 이름을 package.json 고정 문자열로만 받는다).

| 파일 | 역할 |
|---|---|
| `manifest.js` | package.json 생성(명령·메뉴·설정) |
| `src/extension.js` | 시작, 작업 사본 찾기, 명령 등록, 이전 버전 내용 제공 |
| `src/repository.js` | 작업 폴더 하나의 상태와 Source Control 패널 |
| `src/commands.js` | 명령 처리 |
| `src/decorations.js` | 탐색기 표시 |
| `src/svn.js` | svn 실행과 XML 해석 |
| `src/ignore.js` | 무시 패턴 읽기·쓰기 |
| `src/ignoreView.js` | 무시 목록 편집 화면(웹뷰) |
| `src/reasonView.js` | 무시된 원인 화면(웹뷰) |
| `src/tortoise.js` | TortoiseSVN 창 열기 |
| `src/i18n.js` | 메시지 한글/영어 |
| `test/svn-paths.js` | 한글·공백 경로 회귀 검사 (`npm test`) |
| `test/manifest-check.js` | 메뉴 구조 일관성 검사 (`npm test`) |

## 라이선스와 출처

**이 확장의 라이선스**: [MIT](LICENSE), Copyright (c) 2026 Kihoon Kwon (권기훈). 누구나 쓰고 고치고 배포할 수 있다.
가져다 쓸 때는 저작권 표시와 MIT 문구(`LICENSE`)를 남긴다.

**다른 SVN 확장의 코드는 쓰지 않았다.** 모든 코드는 VS Code 공개 API로 새로 작성했다.

| 대상 | 관계 | 라이선스·비고 |
|---|---|---|
| Apache Subversion (`svn`) | 설치된 명령줄 클라이언트를 별도 프로세스로 실행한다. 포함하지 않는다 | Apache License 2.0 |
| svn 기본 무시 목록 | `src/ignore.js`의 `SVN_DEFAULT_GLOBAL_IGNORES`는 Subversion 1.14 기본 클라이언트 설정의 `global-ignores` 값이다 | Apache License 2.0, © The Apache Software Foundation |
| TortoiseSVN | 설치된 `TortoiseProc.exe`를 별도 프로세스로 실행한다. 포함하거나 연결하지 않는다 | GPL. 사용자가 따로 설치한다 |
| VS Code 아이콘(`$(check)` 등) | VS Code 내장 아이콘을 API로 참조할 뿐 파일을 포함하지 않는다 | — |
| `@vscode/vsce` | `.vsix`를 만들 때만 쓴다. 결과물에 들어가지 않는다 | MIT |

**상표**: Apache Subversion, Subversion, SVN은 The Apache Software Foundation의 상표다. TortoiseSVN은 TortoiseSVN 프로젝트의
이름이다. 이 확장은 두 프로젝트와 관계없는 비공식 도구이며, 이름은 무엇과 함께 쓰는 도구인지 설명하려고 쓴다.
