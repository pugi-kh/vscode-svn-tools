# vscode-svn-tools (SVN Tools) — 개발 안내

VS Code용 SVN 확장. Source Control 패널, 탐색기 우클릭(SVN / TortoiseSVN), 탐색기 상태 표시(무시된 파일 회색 포함),
무시 목록 편집 화면을 한 확장으로 제공한다. ID `khoon.vscode-svn-tools`. 사용법은 `README.md`, 변경 이력은 `CHANGELOG.md`.

**이 문서는 고치는 사람용이다.** 특히 "함정" 절은 실제로 겪은 문제다 — 코드만 보고 되돌리지 말 것.

## 만든 배경
- 기존 확장 "SVN - Subversion Support"(Shellback)는 무시된 파일을 표시하지 못한다. 그런데 **독점 라이선스라 수정·복사·역설계가
  금지**돼 있어서 고치지 않고 새로 만들었다. **그 확장의 코드를 참고하거나 옮겨 오지 않는다.**
- Chris Johnston의 "SVN"(MIT)은 패널은 있지만 탐색기 Add·Delete와 무시 파일 표시가 없고, 같이 쓰면 메뉴가 겹친다.
  사용자는 이 확장 하나만 쓴다(나머지 둘은 끈다). 줄 단위 이력은 SVN Lens(MIT)가 맡는다 — 메뉴가 겹치지 않는다.

## 구조

| 파일 | 역할 |
|---|---|
| `manifest.js` | **package.json 생성기.** 명령·메뉴·설정·색상·버전은 여기서 고친다 |
| `package.json` | 생성물. **직접 고치지 않는다** |
| `src/extension.js` | 시작, 작업 사본 찾기, 명령 등록, 이전 버전 내용 제공(`svn-tools:` 스킴) |
| `src/repository.js` | 작업 폴더 하나의 상태(`svn status --no-ignore`)와 Source Control 패널, 파일 감시 |
| `src/commands.js` | 명령 처리. 인자 모양 맞추기(`toUris`), 커밋 흐름, 로그, ignore 추가 등 |
| `src/decorations.js` | 탐색기 배지·색 |
| `src/svn.js` | svn 실행(`exec`), 경로 표기 맞추기(`realPath`), 출력 디코딩, XML 해석 |
| `src/ignore.js` | 무시 패턴 읽기·쓰기(폴더 속성, `%APPDATA%\Subversion\config`) |
| `src/ignoreView.js` | 무시 목록 편집 화면(웹뷰, 저장 버튼 방식) |
| `src/reasonView.js` | 무시된 원인 화면(웹뷰, 규칙 카드) |
| `src/tortoise.js` | TortoiseProc.exe 실행 |
| `src/i18n.js` | 알림·확인 창·웹뷰 문구 한/영 (메뉴는 영어 고정이라 없음) |
| `test/svn-paths.js` | 한글·공백 경로 회귀 검사 |

외부 패키지가 없다(Node 기본 모듈만). 빌드 단계도 없다 — `manifest.js`가 package.json만 만든다.

## 자주 쓰는 명령

```
npm test                                             # 한글·공백 경로 회귀 검사 (실제 작업 사본은 안 건드림)
npm run package                                      # package.json 생성 + .vsix
code --install-extension vscode-svn-tools-<버전>.vsix   # 설치 → VS Code에서 Developer: Reload Window
for f in src/*.js; do node --check "$f"; done        # 문법만 빠르게 (git bash)
```

## 함정 (실제로 겪은 문제 — 되돌리지 말 것)

1. **svn에 값을 넘길 때 `-F 파일 + --encoding utf-8`을 쓰지 않는다.** svn 1.14는 `--encoding`을 붙이면 **경로 인자까지**
   그 인코딩으로 다시 해석해 한글 경로가 `???`가 되고 "is not a working copy"로 실패한다. `--encoding` 없이 `-F`만 쓰면
   파일 내용을 CP949로 읽어 한글 값이 깨진다. **경로·커밋 메시지·속성 값은 모두 인자로 직접 넘긴다** — Node가 UTF-16으로
   넘기고 svn이 그대로 받는다. 커밋은 `-m 메시지 --force-log`(메시지가 우연히 경로와 같아도 거부하지 않게).
2. **svn에 넘기는 경로는 `svn.realPath()`로 디스크 표기(대소문자)를 맞춘다.** 중간 폴더 대소문자가 디스크와 다르면
   `svn move`가 같은 폴더를 두 번 잠그려다 E155004("already locked")로 실패한다. 드라이브 문자 대소문자는 괜찮다.
   새 명령에서 `uri.fsPath`를 svn에 바로 넘기지 말 것(`commands.js`의 `paths()`는 이미 맞춘다).
3. **svn 출력은 인코딩이 섞인다.** `svn diff`는 머리글(`Index: 경로`)을 CP949로, 파일 내용은 원래 바이트(UTF-8)로 낸다.
   `svn.js`의 `decode()`는 전체가 UTF-8이 아니면 **줄 단위로** UTF-8 → EUC-KR로 읽는다. 전체를 한 인코딩으로 바꾸지 말 것.
4. **잠금 오류(E155004/E200033/E200030)는 몇 번 다시 시도한다.** TortoiseSVN 상태 캐시(TSVNCache)가 작업 사본 DB를
   잠깐 잡는다. 재시도 뒤에도 실패하면 진짜 잠금이고 Cleanup이 필요하다.
5. **웹뷰 HTML·스크립트는 JS 템플릿 문자열 안에 있다**(`ignoreView.js`·`reasonView.js`의 `html()`). 스크립트 안에서 백슬래시는 두 번
   (`\\s` → 화면에서 `\s`), `${`는 쓰지 않는다(바깥 템플릿이 먹는다). 고친 뒤에는 생성된 스크립트를 꺼내 `node --check`로 본다.
6. **웹뷰에서 DOM `append`·`replaceChildren`·`prepend` 등에 `null`을 넘기면 글자 "null"이 찍힌다**(두 번 겪었다: 편집 화면의
   꼬리표, 원인 화면의 안내 자리). 조건부 요소는 `el()`(null을 거름)의 자식으로 넣거나, 배열로 모아 `.filter(Boolean)` 뒤 넘긴다.
   화면을 고친 뒤에는 생성된 스크립트에서 이 함수들을 grep해서 조건부 인자가 없는지 본다.
7. **TortoiseProc 인자는 직접 따옴표로 감싸고 `windowsVerbatimArguments: true` + `argv0: "\"<exe>\""`로 실행한다.**
   Node가 다시 감싸면 `/path:"..."`가 깨지고, verbatim이면 실행 파일 경로도 안 감싸지므로 argv0로 넣는다.
8. **내 PC 전체 무시 목록은 svn 우선순위대로 읽고, 값이 있는 곳을 그대로 고친다**(`ignore.readLocal`/`writeLocal`).
   순서: 내 설정 파일 → 내 레지스트리(HKCU) → 시스템 설정 파일 → 시스템 레지스트리 → svn 내장 기본값 중 **처음 값이 있는 곳 하나**.
   TortoiseSVN 설정의 "전역 무시 패턴"은 Tortoise 전용이 아니라 svn 표준 위치인 내 레지스트리를 고친다(명령줄 svn도 읽는다).
   쓸 때는 내 설정 파일에 값이 있으면 그 파일, 아니면 **내 레지스트리**에 쓴다 — 설정 파일로 옮겨 쓰면 Tortoise 설정 화면과
   값이 어긋난다(이전 0.5.1 방식). 시스템 설정은 관리자 권한이 필요해 직접 고치지 않고, 현재 값을 내 레지스트리에 옮겨 적고
   고친다. 처음 고치기 전 원래 값을 백업한다. 레지스트리 키는 테스트에서 임시 키로 바꿔 쓸 수 있게 인자로 받는다.
9. **`svn:ignore`는 줄 단위, `global-ignores`(속성·설정)는 공백 단위로 나눈다**(`ignore.splitFor`). svn:ignore 패턴에는 공백이
   들어갈 수 있다(예: `my file`).
10. **git bash에서 `reg` 명령을 직접 치지 않는다** — `/v`, `/f` 옵션을 경로로 바꿔 버린다. 확장은 Node에서 실행하므로 문제없다.
    셸 heredoc으로 JS를 만들면 `\r\n` 같은 이스케이프가 실제 줄바꿈으로 바뀌는 일도 있었다 — 테스트·코드는 파일로 직접 쓴다.

## 설계 결정 (왜 이렇게 했나)
- **메뉴는 영어 고정, 문구만 언어 설정**(사용자 결정 2026-10-23): 메뉴·명령 이름과 Source Control 그룹 이름(Conflicts /
  Changes / Unversioned)은 영어로 고정한다 — svn 용어는 영어가 익숙하고 TortoiseSVN 메뉴와 맞는다. 알림·확인 창·웹뷰 문구만
  `svnTools.language`(기본 `en` — 마켓플레이스 사용자 대부분이 영어권이라. 한국어 사용자는 설정에서 `ko`)를 따른다. 예전에는 메뉴까지 언어를 바꾸려고 명령을 `.ko`/`.en` 두 벌 등록했는데(0.6.x까지),
  메뉴를 고정하면서 걷어냈다. **메뉴 이름을 다시 언어별로 바꾸려면 그 장치(명령 두 벌 + `config.svnTools.language` 조건)가
  필요하다** — VS Code는 메뉴 이름을 package.json 고정 문자열로만 받는다.
- **패널 범위 = VS Code에서 연 폴더**: 작업 사본 루트가 위에 있어도(예: 여러 프로젝트를 담은 상위 폴더) 연 폴더 안만 본다.
  다른 프로젝트 변경이 섞이지 않게. Cleanup만 작업 사본 루트(`wcRoot`)에서 돈다.
- **새로고침**: 파일 감시(무시된 경로·`.svn`·`.git` 안의 변경은 건너뜀 — 수집 로그처럼 계속 바뀌는 폴더가 status를 계속
  돌리지 않게), 창으로 돌아올 때, TortoiseSVN 창이 닫힐 때, 명령이 끝날 때.
- **무시된 폴더 안의 파일도 회색**: `svn status --no-ignore`는 무시된 폴더 자체만 알려 준다. `Repository.statusOf()`가 상위
  폴더 중 무시된 것이 있으면 `'I'`를 돌려준다.
- **무시 목록 편집은 저장 버튼 방식**: 화면에 편집 사본을 두고, 저장 때 "추가·수정·삭제한 것"만 보낸다. 확장은 svn의 현재 값을
  다시 읽고 그 위에 얹는다(`applyChange`) — 화면을 연 뒤 밖에서 바뀐 패턴을 덮어쓰지 않게. 루트에는 `svn:ignore`·
  `svn:global-ignores` 카드를 규칙이 없어도 항상 보인다(global-ignores를 걸 자리가 안 보이던 문제).
- **무시된 원인 보기**(`reasonView.js`): svn은 원인 규칙을 알려 주지 않는다. `ignore.findRules`가 상위 폴더의 `svn:ignore`,
  `propget --show-inherited-props`로 물려받는 `svn:global-ignores`, 내 PC 목록을 모아 `matchPattern`(apr_fnmatch와 같은 규칙,
  대소문자 구분)으로 맞춰 본다. 조회는 무시된 항목의 **상위 폴더**로 한다(무시된 항목 자체는 버전 관리 대상이 아니다).
  화면은 규칙마다 카드(패턴 + "어떤 설정인지" 한 줄)만 보이고, "어떻게 하라"는 안내는 하지 않는다(사용자 결정). 고칠 수 있는
  카드에만 삭제 버튼이 있고, "같은 패턴에 걸린 다른 항목"은 삭제를 누른 뒤 확인 창에서만 보여 준다. 작업 사본보다 위에 걸린
  상속 값은 path가 URL로 와서 설명만 보여 준다. "같은 패턴에 걸린 다른 항목"은 현재 status의 무시 목록 중 규칙이 미치는
  범위만 본다(무시된 폴더 안쪽은 svn이 알려 주지 않으므로 빠질 수 있다).
- **패턴에 공백을 쓰지 않는다**(사용자 결정): `svn:ignore`는 줄 단위라 공백이 가능하지만, 종류마다 규칙이 다르면 헷갈려서 모든
  입력에서 막고 `?`를 쓰게 한다. 다른 도구로 만든 공백 패턴은 그대로 읽고 지울 수 있다. 와일드카드 안내 한 줄을 입력 근처에 둔다.
- **삭제 기본값은 로컬 유지**(`--keep-local`): 사용자 결정. 설정 `svnTools.delete.keepLocal`.
- **색상은 자기 색상 ID**(`svnTools.*Foreground`, 기본값은 git 색 ID): 사용자가 `workbench.colorCustomizations`로 git 색과 따로
  바꿀 수 있게. 별도 색 설정 화면은 만들지 않는다.
- **Lock/Unlock은 2순위**: 직접 구현하지 않고 TortoiseSVN 메뉴로 쓴다.

## 고칠 때 절차

**명령을 추가할 때**
1. `src/commands.js`의 반환 객체에 처리 함수를 추가한다. 알림·확인 창 문구는 `src/i18n.js`에 **ko·en 둘 다** 넣는다.
2. `manifest.js`의 `COMMANDS`에 `[id, 영어 이름, 아이콘]`을 넣고, 보일 메뉴(`SVN_SUBMENU`, `menus`)에 추가한다.
3. svn에 넘기는 경로는 `paths(args)` 또는 `svn.realPath()`를 거친다. 값·메시지는 인자로 넘긴다(함정 1·2).
4. svn에 쓰는 명령이면 `test/svn-paths.js`에 한 줄 추가하고 `npm test`.

**설정·색상을 추가할 때**: `manifest.js`의 `configuration` / `COLORS`. README의 설정 표도 같이 고친다.

**버전을 올릴 때**: `manifest.js`의 `version` + `CHANGELOG.md` 맨 위 항목 → `npm run package` → 설치.
CHANGELOG는 짧은 명사형으로 끝낸다("~ 수정", "~ 추가", "~ 변경", "~ 표시"). "~했다" 같은 서술형은 쓰지 않는다.
버그 수정은 "무엇이 어떻게 되던 문제 수정" + 원인·조치를 한 문장씩.
새 기능은 마이너(0.x.0), 버그 수정은 패치(0.x.y).

**작업을 마치면**: README(기능·설정 표·구조 표)와 이 문서(구조 표·함정·설계 결정)가 코드와 맞는지 확인한다.

## 규칙
- 주석·문서는 한글, 코드·식별자는 영문. 주석은 비자명한 이유만 짧게.
- 커밋 메시지: 타입은 영어(`feat`, `fix`, `docs`, `refactor`, `chore`), 제목·본문은 한글. AI 생성 표시를 넣지 않는다.
- `.vsix`는 빌드 결과물이라 git에 넣지 않는다(`.gitignore`). `test/`와 이 문서는 `.vsix`에 넣지 않는다(`.vscodeignore`).
- **저장소는 GitHub 공개 저장소다.** 회사 이름, 사내 서버 주소(svn URL·IP), 사내 프로젝트명을 코드·문서·테스트에 넣지 않는다.
- **라이선스·출처**: 다른 프로젝트의 코드나 데이터(설정 값 목록 포함)를 들이면 README "라이선스와 출처" 표에 출처와 라이선스를
  추가한다. MIT 등 허용형 코드를 가져오면 원본 저작권 줄과 라이선스 문구를 남긴다(파일 머리 주석 또는 README 표).
  독점 라이선스 코드(예: Shellback 확장)는 읽지도 옮기지도 않는다. **이 확장은 MIT**(`LICENSE`, Kihoon Kwon).
- **테스트한 환경**: 다른 버전의 VS Code·svn·TortoiseSVN에서 확인했으면 README "테스트한 환경" 표를 고친다.

## 남은 일
- Lock/Unlock 직접 구현(지금은 TortoiseSVN 메뉴)
- 마켓플레이스 게시: 게시자 ID 확인(`khoon`), 아이콘, 키워드, `private` 제거, README 영문화(`README.md` 영문 + `README.ko.md`)
