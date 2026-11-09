# svn-tools (SVN Tools) — 개발 안내

VS Code용 SVN 확장. Source Control 패널, 탐색기 우클릭(SVN / TortoiseSVN), 탐색기 상태 표시(무시된 파일 회색 포함),
무시 목록 편집 화면을 한 확장으로 제공한다. ID `khoon.svn-tools`(저장소 이름은 vscode-svn-tools). 사용법은 `README.md`, 변경 이력은 `CHANGELOG.md`.

**이 문서는 고치는 사람용이다.** "주제별 설계와 함정"의 **[함정]** 항목은 실제로 겪은 문제다 — 코드만 보고 되돌리지 말 것.

## 편집 전 필독

파일을 고치기 전에 아래 표에서 그 파일이 걸리는 절을 먼저 읽는다. **한 줄짜리 수정도 예외 없다.**

| 편집 대상 | 먼저 읽을 절 (모두 "주제별 설계와 함정" 아래) |
|---|---|
| `src/svn.js` | svn 실행과 인코딩 · svn 찾기와 설치 |
| `src/svnSetup.js` | svn 찾기와 설치 |
| `src/extension.js` | 상태 읽기와 새로고침 · svn 찾기와 설치 · 언어와 매니페스트 |
| `src/repository.js` | 상태 읽기와 새로고침 · 커밋 |
| `src/commands.js` | 커밋 · 탐색기 메뉴와 이름 바꾸기 · svn 실행과 인코딩 · 충돌 해결 |
| `src/conflict.js` | 충돌 해결 · svn 실행과 인코딩 |
| `src/commitView.js` | 커밋 · 웹뷰 공통 |
| `src/decorations.js` | 상태 읽기와 새로고침 · 색상 |
| `src/colorView.js` | 색상 · 웹뷰 공통 |
| `src/ignore.js`, `src/ignoreView.js`, `src/reasonView.js` | 무시 목록 · 웹뷰 공통 |
| `src/historyView.js` | SVN 이력 칸 |
| `src/tortoise.js` | TortoiseSVN 연동 |
| `manifest.js`, `src/i18n.js`, `src/languages.js` | 언어와 매니페스트 · 탐색기 메뉴와 이름 바꾸기 |
| `test/*` | 작업 절차 |
| `README.md`, `CHANGELOG.md`, 버전 | 작업 절차 · 규칙 |

## 만든 배경
- 기존 확장 "SVN - Subversion Support"(Shellback)는 무시된 파일을 표시하지 못한다. 그런데 **독점 라이선스라 수정·복사·역설계가
  금지**돼 있어서 고치지 않고 새로 만들었다. **그 확장의 코드를 참고하거나 옮겨 오지 않는다.**
- Chris Johnston의 "SVN"(MIT)은 패널은 있지만 탐색기 Add·Delete와 무시 파일 표시가 없고, 같이 쓰면 메뉴가 겹친다.
  사용자는 이 확장 하나만 쓴다(나머지 둘은 끈다). 줄 단위 이력은 SVN Lens(MIT)가 맡는다 — 메뉴가 겹치지 않는다.

## 구조

| 파일 | 역할 |
|---|---|
| `manifest.js` | **package.json 생성기.** 명령·메뉴·설정·색상·버전은 여기서 고친다 |
| `install.js` | 빌드 + VS Code 설치(`npm run install-vscode`). `.vsix`에는 들어가지 않는다 |
| `package.json` | 생성물. **직접 고치지 않는다** |
| `src/extension.js` | 시작, 작업 사본 찾기, 명령 등록(기본 ID + `.en`/`.ko`), 이전 버전 내용 제공(`svn-tools:` 스킴) |
| `src/repository.js` | 작업 폴더 하나의 상태(`svn status --no-ignore`)와 Source Control 패널, 파일 감시 |
| `src/commands.js` | 명령 처리. 인자 모양 맞추기(`toUris`), 커밋 흐름, 로그, ignore 추가 등 |
| `src/decorations.js` | 탐색기 배지·색 |
| `src/svn.js` | svn 찾기(`findSvn`), svn 실행(`exec`), 경로 표기 맞추기(`realPath`), 출력 디코딩, XML 해석 |
| `src/svnSetup.js` | svn 명령줄 도구가 없을 때 안내·winget 설치·위치 지정 |
| `src/ignore.js` | 무시 패턴 읽기·쓰기(폴더 속성, `%APPDATA%\Subversion\config`) |
| `src/ignoreView.js` | 무시 목록 편집 화면(웹뷰, 저장 버튼 방식) |
| `src/reasonView.js` | 무시된 원인 화면(웹뷰, 규칙 카드) |
| `src/colorView.js` | 상태 색 편집 화면(웹뷰, 색 고르기 → `workbench.colorCustomizations`) |
| `src/commitView.js` | 커밋 탭(웹뷰, 메시지 + 올릴 항목을 트리에서 체크, 항목 우클릭 메뉴) |
| `src/historyView.js` | SVN 이력 칸(Source Control 아래 트리 뷰, 커밋 목록·바뀐 파일·비교) |
| `src/conflict.js` | 충돌 정보 읽기, "로컬 미등록 + 서버 추가" 충돌 처리, 병합 편집기 좌우 정하기 (vscode 없이 동작 — 테스트에서 직접 부른다) |
| `src/tortoise.js` | TortoiseProc.exe 실행 |
| `src/i18n.js` | 알림·확인 창·웹뷰 문구 한/영 (메뉴 이름은 manifest.js) |
| `src/languages.js` | 메뉴 언어 목록(`en`, `ko`) |
| `images/icon.png` | 확장 아이콘(256px PNG, 마켓플레이스는 SVG를 받지 않는다) |
| `test/svn-paths.js` | 한글·공백 경로 회귀 검사 + 충돌 처리(두 번째 작업 사본으로 서버 변경을 만든다) |
| `test/manifest-check.js` | 메뉴 구조 일관성 검사(명령·하위 메뉴·처리 함수·언어 섞임) + 코드에서 쓰는 메시지 키가 한/영 모두 있는지 + 웹뷰 스크립트(문법, null을 DOM에 넘기는지) |

외부 패키지가 없다(Node 기본 모듈만). 빌드 단계도 없다 — `manifest.js`가 package.json만 만든다.

## 자주 쓰는 명령

```
npm test                                             # 한글·공백 경로 회귀 검사(실제 작업 사본은 안 건드림) + 메뉴 구조 검사
npm run install-vscode                               # 빌드 + 설치 한 번에(install.js)
npm run package                                      # package.json 생성 + .vsix
code --install-extension svn-tools-<버전>.vsix       # 설치 → VS Code에서 Developer: Reload Window
for f in src/*.js; do node --check "$f"; done        # 문법만 빠르게 (git bash)
```

**개발 환경 주의**: git bash에서 `reg` 명령을 직접 치지 않는다 — `/v`, `/f` 옵션을 경로로 바꿔 버린다(확장은 Node에서 실행하므로
문제없다). 셸 heredoc으로 JS를 만들면 `\r\n` 같은 이스케이프가 실제 줄바꿈으로 바뀌는 일도 있었다 — 테스트·코드는 파일로 직접 쓴다.

## 작업 절차

**명령을 추가할 때**
1. `src/commands.js`의 반환 객체에 처리 함수를 추가한다. 알림·확인 창 문구는 `src/i18n.js`에 **ko·en 둘 다** 넣는다.
2. `manifest.js`의 `COMMANDS`에 `[id, 영어, 한국어, 아이콘]`을 넣고, 보일 메뉴(`TOP_LEVEL`, `SVN_SUBMENU`, `menus`)에 추가한다.
   `npm test`의 메뉴 구조 검사가 빠진 명령·처리 함수·언어 섞임을 잡는다.
3. svn에 넘기는 경로는 `paths(args)` 또는 `svn.realPath()`를 거친다. 값·메시지는 인자로 넘긴다("svn 실행과 인코딩").
4. svn에 쓰는 명령이면 `test/svn-paths.js`에 한 줄 추가하고 `npm test`.

**설정·색상을 추가할 때**: `manifest.js`의 `configuration` / `COLORS`. README의 설정 표도 같이 고친다.

**버전을 올릴 때**: `manifest.js`의 `version` + `CHANGELOG.md` 맨 위 항목 → `npm run package` → 설치.
- 새 기능은 마이너(x.Y.0), 버그 수정은 패치(x.y.Z).
- **마켓플레이스는 한 번 올렸다 지운 버전 번호를 다시 받지 않는다**("previously deleted, and cannot be recreated").
  1.0.1을 올렸다 지워서 1.1.0으로 다시 게시했다. 게시 전에 버전을 확정한다.
- CHANGELOG는 짧은 명사형으로 끝낸다("~ 수정", "~ 추가", "~ 변경", "~ 표시"). "~했다" 같은 서술형은 쓰지 않는다.
  버그 수정은 "무엇이 어떻게 되던 문제 수정" + 원인·조치를 한 문장씩.
- 한 버전의 항목이 많으면(대략 8개 이상, 또는 기능 영역이 셋 이상) 기능별로 묶는다. 제목(`###`)은 쓰지 않고, 굵은 글씨 목록
  `- **기능 이름**` 아래에 항목을 한 단계 들여 넣으며, 묶음 사이는 빈 줄로 띄운다(예: 2.0.0의 "스테이징 제거 / 커밋 탭 /
  Source Control 패널과 탐색기 메뉴 / 충돌 해결 / SVN 이력 칸"). 설정 추가·제거는 관련 기능 묶음에 넣는다.
  항목이 적으면 지금처럼 목록만 쓴다. 이미 커밋된 이전 버전 기록은 이 방식으로 고치지 않는다.

**작업을 마치면**: README(기능·설정 표·문제 해결)와 이 문서(구조 표·편집 전 필독 표·주제별 설계와 함정)가 코드와 맞는지 확인한다.
README는 확장 사용자용(마켓플레이스 Details 탭에 그대로 보인다)이라 파일 구조·내부 동작은 이 문서에만 둔다.

## 주제별 설계와 함정

### svn 실행과 인코딩
- **[함정] svn에 값을 넘길 때 `-F 파일 + --encoding utf-8`을 쓰지 않는다.** svn 1.14는 `--encoding`을 붙이면 **경로 인자까지**
  그 인코딩으로 다시 해석해 한글 경로가 `???`가 되고 "is not a working copy"로 실패한다. `--encoding` 없이 `-F`만 쓰면
  파일 내용을 CP949로 읽어 한글 값이 깨진다. **경로·커밋 메시지·속성 값은 모두 인자로 직접 넘긴다** — Node가 UTF-16으로
  넘기고 svn이 그대로 받는다. 커밋은 `-m 메시지 --force-log`(메시지가 우연히 경로와 같아도 거부하지 않게).
- **[함정] svn에 넘기는 경로는 `svn.realPath()`로 디스크 표기(대소문자)를 맞춘다.** 중간 폴더 대소문자가 디스크와 다르면
  `svn move`가 같은 폴더를 두 번 잠그려다 E155004("already locked")로 실패한다. 드라이브 문자 대소문자는 괜찮다.
  새 명령에서 `uri.fsPath`를 svn에 바로 넘기지 말 것(`commands.js`의 `paths()`는 이미 맞춘다).
- **[함정] svn 출력은 인코딩이 섞인다.** `svn diff`는 머리글(`Index: 경로`)을 CP949로, 파일 내용은 원래 바이트(UTF-8)로 낸다.
  `svn.js`의 `decode()`는 전체가 UTF-8이 아니면 **줄 단위로** UTF-8 → EUC-KR로 읽는다. 전체를 한 인코딩으로 바꾸지 말 것.
- **[함정] 잠금 오류(E155004/E200033/E200030)는 몇 번 다시 시도한다.** TortoiseSVN 상태 캐시(TSVNCache)가 작업 사본 DB를
  잠깐 잡는다. 재시도 뒤에도 실패하면 진짜 잠금이고 Cleanup이 필요하다.
- **[함정] 명령줄 길이**: 윈도우 명령줄은 약 32,767자다. 경로를 하나하나 넘기는 작업이 수백 개를 넘으면 실패하므로 `svn.exec`가 미리
  재서 `TOOLONG`으로 막고 "나눠서 진행하라"고 안내한다. `--targets` 파일은 svn이 CP949로 읽어 한글 경로가 깨져서 쓰지 않는다.
  변경 전체 커밋처럼 폴더 하나로 끝나는 작업은 길이 문제가 없다.

### svn 찾기와 설치
- **찾는 순서**(`svn.findSvn`): 설정 값 → PATH → TortoiseSVN 폴더(`tortoiseProcPath` 포함)·SlikSVN 기본 위치 → 레지스트리의 최신 PATH.
  설정 값이 디스크에 없으면 건너뛴다(남은 설정 때문에 설치 후에도 "이미 있음"·못 찾음이 됐다).
- **[함정] 외부 프로그램은 전체 경로로만 실행하고, svn 찾기는 비동기로 한다**(1.2.0). 윈도우에서 `execFile('svn')`처럼 이름만 주면
  Node(libuv)가 PATH를 **메인 스레드에서 동기로** 뒤진다. PATH에 끊긴 네트워크 경로가 있으면 확장 호스트가 약 26초 멈췄다(테스트로 재현).
  svn이 없으면 PATH 끝까지 뒤지므로 끊긴 경로가 있으면 반드시 걸린다. 동료 PC(1.0.0, svn 없음 추정)에서 Codex 화면이 30초 안에
  뜨지 못해 "Codex could not start"가 났고 우리 확장을 끄면 정상이었다 — 그 PC의 PATH는 확인 못 했지만 가장 유력한 원인. 그래서 svn을 못 찾았으면 실행하지 않고 ENOENT로 처리하고,
  `reg`도 System32 전체 경로(`svn.REG`)로 실행한다. 찾기의 파일 확인은 `fs.promises`로 **하나씩** 한다 — 한꺼번에 보면 다른 확장과
  함께 쓰는 Node 파일 작업 스레드(기본 4개)를 끊긴 경로가 모두 붙잡는다.
- **찾은 경로를 설정에 써 두지 않는다**. svn을 지우거나 옮기면 남은 설정 때문에 오히려 못 찾는다. 사용자가 직접 고른 경로만 쓴다.
- **설치 안내**(`svnSetup.js`): TortoiseSVN 기본 설치에는 svn.exe가 없다(MSI의 `CLI` 항목이 설치 수준 200, 기본 꺼짐). 그래서 처음 쓰는
  사람이 "설치했는데 아무 변화가 없다"를 겪었다(사용자 동료). 작업 사본(`.svn`이 있는 폴더)을 열 때 svn이 없으면 한 번 알리고 winget
  설치를 제안한다.
- CLI는 TortoiseSVN 본체(`DefaultFeature`, 제외 불가)의 하위 항목이라 CLI만 설치할 수는 없다. TortoiseSVN이 있으면
  `ADDLOCAL=ALL`로 빠진 항목을 채우고(버전이 달라 업그레이드가 돼도 기존 항목이 빠지지 않게 ALL), 없으면 SlikSVN·TortoiseSVN 중 고른다.
  같은 버전이면 `--force`는 재설치가 아니라 기능 추가(유지 관리 설치)다. 대신 꺼 둔 선택 항목도 켜지고, 버전이 다르면 업그레이드라
  탐색기가 다시 시작될 수 있어 항목 설명에 적고, TortoiseSVN이 있어도 기존 설치를 건드리지 않는 SlikSVN을 함께 보인다.
- **[함정] `--override`에는 `/norestart`를 반드시 넣는다.** override는 winget 기본 인자(`/norestart` 포함)를 통째로 대신해서, 빠지면
  TortoiseSVN(탐색기에 올라가 있는 DLL) 설치가 묻지 않고 재부팅할 수 있다(검토로 지적).
- **[함정] 설치는 작업(Task)으로 터미널에 보이게 실행하되 셸을 거치지 않는다**(`ProcessExecution`) — PowerShell을 거치면 종료 코드가 0/1로
  뭉개진다. 끝나면 **종료 코드와 상관없이 먼저 다시 찾는다**(winget은 "이미 설치됨"·재부팅 필요에도 0이 아니다). 못 찾았을 때만
  원인을 안내하고, 찾아본 위치를 출력 창에 남긴다.
- 레지스트리 PATH를 보는 이유: VS Code는 시작할 때의 PATH를 계속 써서, SlikSVN이 PATH에 추가돼도 재시작 전에는 안 보인다.
  레지스트리 출력은 CP949라 `decode()`로 읽고, 보이지 않는 방향 문자를 지운다(실제 PC의 PATH에 U+202A가 붙은 항목이 있었다).
- **[함정] 실행 실패(ENOENT) 때의 다시 찾기는 한 번, 10초에 한 번까지**(`rescanAfterFailure`) — svn이 없으면 명령마다 레지스트리를 동기로
  읽었다. 설치·설정 변경 후의 다시 찾기(`recheck`)는 제한하지 않는다.
- **[함정] 작업 폴더 열기는 여는 중인 폴더를 기억해 겹치면 건너뛴다**(`extension.js opening`). 시작·폴더 추가·설치 후 다시 열기가 겹치면
  같은 폴더의 패널이 둘 생겼다.
- **제한 모드에서는 동작하지 않는다**(`capabilities.untrustedWorkspaces.supported: false`): 연 폴더에서 svn을 실행하기 때문.
  선언이 없으면 VS Code가 이유 없이 확장을 꺼서 "아무 변화가 없다"로 보인다.

### 상태 읽기와 새로고침
- **패널 범위 = VS Code에서 연 폴더**: 작업 사본 루트가 위에 있어도(예: 여러 프로젝트를 담은 상위 폴더) 연 폴더 안만 본다.
  다른 프로젝트 변경이 섞이지 않게. Cleanup만 작업 사본 루트(`wcRoot`)에서 돈다.
- **새로고침 시점**: 파일 감시(무시된 경로·`.svn`·`.git` 안의 변경은 건너뜀 — 수집 로그처럼 계속 바뀌는 폴더가 status를 계속
  돌리지 않게), 창으로 돌아올 때, TortoiseSVN 창이 닫힐 때, 명령이 끝날 때. 명령이 끝나면 **그 명령이 다룬 저장소만** 새로고침한다
  (`commands.js use` — 명령마다 `AsyncLocalStorage`로 따로 모은다. 한곳에 모으면 커밋 탭처럼 오래 떠 있는 명령이 끝날 때까지
  다른 명령의 새로고침이 밀렸다. 다룬 저장소가 없으면 전부). 창으로 돌아올 때와 Refresh 명령은 미등록 폴더 안까지 다시 훑는다
  (`rescanAll` — 파일 감시가 놓치는 변경이 있다).
- **[함정] 새로고침이 도는 중에 부르면 끝난 뒤 새로 한 번 더 돌린 결과를 기다린다**(`Repository.refresh`). 도는 중인 것을 돌려주면 svn 작업
  전에 시작된 결과라, 방금 add한 항목이 아직 `?`로 보였다(1.x 스테이징에서 겪음).
- **[함정] 경로 조회는 목록을 처음부터 훑지 않는다**(`hitAncestor`). 무시·미등록·충돌 경로를 Set(key)으로 두고 상위 폴더로 올라가며 찾는다.
  목록과 하나씩 `isInside`로 비교하던 때는 무시 항목 2000개인 작업 사본에서 탐색기 표시가 파일 1개당 약 2ms였다(검토로 측정).
  `provideFileDecoration`은 보이는 파일마다 불려서 여기가 느리면 확장 호스트 전체가 멈춘다.
- **[함정] 새로고침마다 UI로 보내는 것은 바뀐 것만**(`extension.js onRepoChange`): 메뉴 조건 목록(수십 KB)은 키별로 이전 값과 비교해 setContext하고,
  탐색기 표시는 `decoSig`(상태·무시 요약)가 바뀌었을 때만 다시 그린다. 단 contextLists 계산 자체는 매번 한다 — status가 같아도
  미등록 폴더 안에 새 파일이 생기면 SVN Add 목록이 바뀐다(훑기 결과는 `walkCache`에 두고 그 폴더 안 파일 감시 이벤트로 버린다).
  설정 값도 표시마다 읽지 않는다(`decorations.reloadConfig`, `i18n.resetLanguageCache`).
- **무시된 폴더 안의 파일도 회색**: `svn status --no-ignore`는 무시된 폴더 자체만 알려 준다. `Repository.statusOf()`가 상위
  폴더 중 무시된 것이 있으면 `'I'`를 돌려준다.
- **미등록 폴더 안의 파일도 U**: svn status는 미등록 폴더 안으로 들어가지 않아 폴더 한 줄만 준다. 탐색기 표시
  (`decorations.js`)에서만 `isUnversioned`로 상위를 따라 올라가 `?`로 본다. `statusOf`는 바꾸지 않는다 — `commands.js`가
  "미등록 폴더 안은 `undefined`"를 전제로 판정한다. Source Control 패널은 지금처럼 폴더 한 줄만 둔다.
- **[함정] 폴더 안 상태 표시(`●`)는 확장이 직접 계산한다**(사용자 결정 2026-11-02, `Repository.insideSummary` → `decorations.js`).
  VS Code의 `propagate`는 탐색기가 한 번 그린 파일만 상위로 올리는데, 우리는 새로고침마다 `fire(undefined)`로 캐시를 비워서
  펼친 적 없는 접힌 폴더에는 점이 나오지 않았다(추정). 섞였을 때 어느 색이 이길지도 정할 수 없었다. 그래서 `propagate`는 쓰지 않고,
  render 때 "폴더 → 하위 상태별 개수"를 만들어 둔다. 점 색 우선순위는 고정이다(충돌 > 덜 받음 > 삭제·누락 > 수정 > 추가 > 미등록,
  `INSIDE_ORDER`, 사용자 결정). 무시된 항목은 세지 않는다. 폴더 자신의 상태가 있으면 그 배지가 우선이고 요약은 툴팁에만 붙는다.
  배지와 이름 색은 API상 한 색이라 "점만 색칠"은 불가능하다(폴더 이름도 같은 색).
- **Update가 끊긴 폴더(incomplete)는 `N`**: svn status의 `item="incomplete"`. 그 안의 누락(`!`)도 아직 못 받은 것일 수 있어
  `N`으로 묶고 커밋 탭에서 뺀다(커밋하면 삭제가 올라갈 수 있다). `wc-locked`면 Clean Up 후 Update를 안내한다.

### 커밋
- **스테이징은 없다**(사용자 결정 2026-11-06, 2.0.0). 0.10\~1.3은 git처럼 스테이징을 workspaceState로 흉내 냈지만, TortoiseSVN·명령줄에서
  안 보이고 "add = 스테이징", 이동 짝의 스테이징 취소, 새로고침 때 정리 같은 함정이 많아서 걷어냈다. svn 기본대로 add만 하고,
  **커밋할 항목은 커밋 탭에서 고른다**(TortoiseSVN 커밋 창과 같은 모델). 설정 `commit.review`·`commit.smartCommit`은 없앴다. 1.x의 스테이징 기록(`svnTools.staged:*`)은 저장소를 열 때 지운다.
- **패널 입력칸은 커밋 탭 메시지와 같은 값**(사용자 결정, 2.0.0에서 숨겼다가 되살림): `Repository.draft`가 `inputBox.value`를 원본으로 읽고 쓰며,
  창을 다시 열어도 남게 workspaceState에도 둔다. 입력칸에는 변경 이벤트가 없어서 읽을 때·닫을 때 저장하고, 탭을 연 뒤 입력칸에서 고친 값은
  다시 열 때(`retarget`) 탭에 넘긴다. Ctrl+Enter(`acceptInputCommand`)는 바로 커밋하지 않고 커밋 탭을 연다 — 올릴 항목은 탭에서만 고른다.
- **커밋 버튼**(사용자 결정): git의 큰 커밋 버튼(`SourceControl.actionButton`)은 제안 API라 마켓플레이스 확장은 못 쓴다.
  그래서 패널 위쪽 ✓(`scm/title`)와 상태 표시줄(`statusBarCommands`)로 커밋 탭을 연다. 시도했다가 버린 것(사용자 결정):
  Source Control 화면에 따로 칸(뷰) 두기 — 확장 뷰는 순서(`order`)·높이(`initialSize`)를 정할 수 없어 늘 Changes 아래에 접힌 채로 생긴다
  (VS Code `viewsExtensionPoint.ts`로 확인). 맨 위 그룹에 "✓ 커밋" 항목 하나 두기 — 파일 줄처럼 보이고 개수 1이 붙어 어색했다.
- **패널 그룹 이름은 Modified(수정됨) / Unversioned / Conflicts**(사용자 결정): 바깥 섹션 제목이 VS Code 고정 "Changes"라 "Changes 안의 Changes"로 보였다.
- **커밋 탭**(`commitView.js`, 여는 곳: 패널 ✓·팔레트 Commit → 변경 전부 체크, 탐색기 SVN ▸ Commit… → 고른 범위 안만 체크, `openCommit`):
  - 묶음은 **변경 / 미등록**(사용자 결정). 둘 다 작업 폴더를 뿌리로 하는 폴더 트리다(사용자 결정 — 작업 폴더 자신의 속성 변경도
    그 뿌리 줄에 붙고, 뿌리 체크박스가 묶음 전체 선택을 겸한다). 변경 없는 폴더가 이어지면 `a\b` 한 줄로 합치고, 정렬은 탐색기처럼
    폴더 먼저·숫자 크기순(`Intl.Collator` numeric). 미등록은 처음에 꺼져 있고,
    체크하면 커밋 직전에 `svn add --force --parents`(폴더는 하위 포함, 무시 규칙은 따름)한다.
  - 체크 규칙(사용자 결정, 웹뷰 `turnOn`/`turnOff`): 폴더를 켜고 끄면 하위 전부, 항목을 켜면 svn이 요구하는 새 상위 폴더(`requires`,
    A·R·? 상위)도 켜고, 새 폴더를 끄면 그것을 요구하는 항목도 끈다. 새 상위가 아닌 폴더(속성만 바뀐 M 등)는 자동으로 켜지 않는다 —
    관계없는 속성 변경이 딸려 가지 않게. 일부만 켜진 폴더는 indeterminate.
  - **이동(이름 바꾸기)은 새 경로 한 줄만 보인다**(사용자 결정): 반대쪽이 상태 표에 있는 `D`(moved-to)는 목록에서 빼고, 커밋 때 `closure`가
    넣는다. svn의 `R`은 교체(Replaced)라 이름 바꾸기 표시로 쓰지 않는다 — `A` + "← 원래 이름에서 이름 바꿈".
  - 충돌·덜 받은(N) 항목은 커밋할 수 없어 목록에서 빼고 안내만 한다. 누락(`!`)은 "삭제로 커밋"으로 보이고, 고른 채 커밋하면 다시 묻지 않고 `svn delete`.
  - 메시지는 저장소별 workspaceState(`Repository.draft`)에 두어 탭을 닫아도 남고, 커밋하면 지운다.
  - 저장소가 새로고침되면(`Repository.onDidRender`) 목록을 다시 보내고, 웹뷰는 체크를 경로로 유지한다(새 항목만 기본값 `def`).
    같은 저장소로 다시 열면 기존 탭을 앞으로 가져와 범위만 바꾼다(두 번 기다리면 두 번 커밋한다 — 처음 연 쪽이 커밋한다).
  - 항목 우클릭은 VS Code 메뉴다(`webview/context`, 행의 `data-vscode-context`의 `svnKind`·`svnCode`·`svnPath`). 명령은 `{ svnPath }`를
    받아 `toUris`가 경로로 바꾼다. 무시 추가·Revert 뒤에는 새로고침으로 탭 목록이 따라 바뀐다.
- **[함정] [커밋]은 확장이 상태를 다시 읽고, 사용자가 본 목록(`version`)과 같을 때만 커밋한다**(`CommitView.handle`). 다르면 새 목록을 보이고 머문다.
  끈 항목이 고른 항목과 함께 올라가야 하면(이동 짝·새 상위 폴더) 조용히 넣지 않고 알린다(`openCommit`의 `validate`).
  "변경 전부라서 폴더 하나로 커밋"(covers) 판단도 add 뒤 다시 읽은 상태로 한다. 오래된 상태로 판단하면 확인하지 않은 변경이 올라갔다(1.x 검토로 지적).
- **이동은 짝으로 다룬다**(`commands.js` `closure`): status의 `moved-from`/`moved-to`로 반대쪽을 알고, 커밋·Revert·Revert All에 함께 넣는다.
  한쪽만 커밋하면 E200009, 이동된 쪽만 되돌리면 파일이 지워지고, 원래 쪽만 되돌리면 복사가 된다. 커밋은 "짝 → 새 상위 폴더 → 그 짝…"을
  더 늘지 않을 때까지 모은다. svn 1.14는 이동·삭제된 폴더의 하위 항목을 status에 따로 나열하지 않는다(폴더 한 줄).
- 커밋은 고른 경로만 `--depth empty`로 정확히 넘긴다. 상위 폴더를 기본 깊이로 넘기면 그 안의 다른 새 파일까지 딸려 간다
  (2026-10-23 테스트로 확인). 그래서 **상위 새 폴더는 항상 "그 폴더 자신만"** 넣는다(`newParents`). 미등록 폴더를 add했으면 안의 새 항목을
  따로 넣는다(`changedInside`, `npm test` "미등록 폴더 add 후…"). 올릴 것이 연 폴더 안의 변경 전부면 작업 폴더 하나를 기본 깊이로 넘긴다
  (covers — 항목이 수백 개여도 명령줄이 넘치지 않게).
- **하위 포함 add는 미등록(`?`) 항목만 넘긴다**(`addItems`): 관리 중인 폴더를 `svn add --force 폴더`로 넘기면 Keep Local File로 삭제
  예약한 항목까지 다시 추가돼 교체(R)가 된다(검토로 재현). 충돌 부산물(`파일.mine`, `파일.r12`)은 빼고 넘긴다.
- **추가 취소**(`undoAdd`, 사용자 요청 — 메뉴 이름은 "SVN Undo Add (Revert)"로 무엇을 하는지 먼저 보이고 svn 용어는 괄호에):
  일반 add(`isPlainAdd`, 패널 contextValue `added`)만 `svn revert --depth infinity`. 파일은 남는다(`npm test` "추가 취소…").
  **[함정] 복사·이동으로 생긴 A(+)는 revert하면 작업 파일이 지워지므로**(1.x 검토로 재현) 빼고, 그런 항목을 품은 새 폴더도 뺀다.
- **[함정] 잠근 파일(svn lock)이 있으면 폴더째 커밋하지 않는다**(`Repository.hasLocks`). 폴더 커밋은 그 아래 수정하지 않은 파일의 잠금까지 푼다(검토로 재현).
  잠금은 수정하지 않아도 status에 나온다(`lockToken`, `npm test`).
- **Revert All은 항목마다 자기만**(`--depth empty`): 그룹 항목은 status가 하나씩 나열한 것이라 깊이 없이 되돌려야, 속성만 바뀐
  폴더를 되돌릴 때 그 아래 수정이 날아가지 않는다. 추가·교체·삭제된 폴더만 infinity(자식 없이는 svn이 거부, E155038).
  단일 Revert는 폴더를 고르면 하위 전체를 되돌린다(확인 창에 안내).

### 탐색기 메뉴와 이름 바꾸기
- **자주 쓰는 명령은 우클릭 최상위**(사용자 결정): SVN Update와, 항목 상태에 맞는 SVN Add / SVN Ignore… / SVN Apply Rename이
  하위 메뉴 없이 바로 보인다(Commit…은 SVN ▸ 안 — 파일별로 따로 커밋할 일은 드물다). 다른 확장 메뉴와 섞이므로 이름 앞에 "SVN"을 붙인다.
  SVN 하위 메뉴에서는 빼서 중복을 없앴다.
- **탐색기 우클릭은 상태에 맞는 것만**(사용자 결정): 새 항목 → SVN Add·SVN Ignore…, 새로 추가(A)한 항목 → SVN Undo Add (Revert),
  충돌 파일과 그 부산물(`파일.mine` 등, `leftoverOwner`로 원래 파일을 찾는다) → Resolve Conflict…,
  이름을 바꾼 항목 → SVN Apply Rename. 확장이 새로고침마다 경로 목록(`svnTools.addable`/`undoable`/`conflicted`/`renamable`)을 `setContext`로 넘기고 메뉴는
  `resourcePath in <목록>` 조건을 쓴다. 이 비교는 문자열을 정확히 맞추므로 목록은 **VS Code가 연 폴더 표기**로 만든다
  (`Repository.toUi` — svn에 넘기는 디스크 표기(`realPath`)와 대소문자·junction 경로가 다를 수 있다. 반대 방향은 `toReal`).
  새 폴더 안의 파일도 Add가 보이도록 새 폴더 안을 훑는다(최대 3000개).
  **메뉴 조건은 우클릭한 항목 하나만 본다** — 여러 개를 고르면 우클릭한 항목이 새 항목일 때 SVN Add ▸가 보이고, 누른 뒤 항목별로 처리한다.
- **추가 선택이 필요한 명령은 한 단계 더 들어가서 고른다**(사용자 결정): Delete ▸ Keep Local File / Delete Local File Too.
  설정(`svnTools.delete.keepLocal`, 0.7.0까지)으로 두지 않는다 — 매번 상황에 맞게 고르게.
- **하위 메뉴는 기본·자주 쓰는 동작을 위에 둔다**(사용자 결정): Delete ▸ Keep Local File이 위, Add ▸ Include Contents가 위.
- **Add는 파일 하나면 바로, 폴더·여러 개면 하위 메뉴**(사용자 결정, 0.9.0): SVN Add ▸ Include Contents / Exclude Contents
  (하위 항목 포함 / 하위 항목 제외). 이름은 서브 에이전트와 후보를 교차 검토해 정했다 —
  "Folder Only"는 파일을 섞어 고르면 틀린 말이 되고, 차이는 폴더에만 있으므로 "폴더 안의 항목을 포함하나"로 짓는다.
  영어는 관용적인 Contents(Subitems는 UI에서 거의 안 씀), 한글은 "내용"이 파일 속 내용으로 읽혀서 "하위 항목".
  Delete ▸와 같은 "~은 / ~도" 구조안도 있었지만 짧은 반대말 쌍(제외/포함)을 골랐다(사용자 결정).
  메뉴 조건은 우클릭한 항목 하나가 폴더인지(`explorerResourceIsFolder`)와 여러 개인지(`listMultiSelection`)만 알 수 있어서
  "고른 것 중 폴더가 있는지"는 모른다 — 여러 개면 전부 파일이어도 SVN Add ▸가 보인다(어느 쪽이든 결과는 같다).
  우클릭 메뉴에는 tooltip이 없어서, "무시 규칙에 걸린 항목은 빠진다"는 추가 후 알림으로 알린다.
- **[함정] 무시된 항목을 추가할 때 `--no-ignore`를 붙이지 않는다.** svn은 이름을 직접 준 항목이면 무시 규칙에 걸려도 추가한다(테스트로
  확인). `--no-ignore`를 붙이면 고른 폴더 안의 무시 대상(`__pycache__` 등)까지 전부 추가된다.
- **탐색기 이름 바꾸기 감지**(사용자 요청, `onDidRenameFiles`): 관리 중인 항목(`svn info`가 되는 것)이면 묻고, 적용하면 원래 이름으로
  되돌린 뒤 `svn move --parents`(TortoiseSVN Repair Move와 같다). 기록(새 → 옛)은 workspaceState에 두고 "옛 경로 누락 + 새 경로 미등록"일
  때만 메뉴(`svnTools.renamable`)에 띄운다. 그 밖이 되면 기록을 버린다.
  - 묻는 방식은 **작업을 막지 않는 알림**(모달 아님): 리팩터처럼 여러 파일을 한꺼번에 바꿀 때 끊기지 않게, 닫아도 우클릭으로 다시 할 수
    있어서. 버튼은 [SVN에 적용] [이름 되돌리기] [다시 묻지 않음](사용자 요청: 의도하지 않은 이름 바꾸기를 바로 되돌리기).
  - 되돌리기는 `WorkspaceEdit.renameFile`로 한다(열린 편집기 탭이 따라온다). 이때 반대 방향 이벤트가 다시 오지만 새 이름 쪽은 svn이
    모르는 경로라 `onRenamed`가 건너뛴다.
  - 기록은 **디스크로만 버린다**(새 이름이 없어졌거나 옛 이름이 다시 생김). 상태로 버리면, 이름을 바꾸는 순간 돌고 있던 새로고침
    (바꾸기 전 상태)이 끝나면서 방금 남긴 기록을 지운다. 메뉴에 띄울지는 `renameOf`가 상태까지 본다.
  - 적용 전에 또 바꾸면(A→B→C) 옛 이름이 이미 기록의 새 이름이므로 처음 이름(A)에 이어 붙인다. 처음 이름으로 되돌리면 기록만 지운다.
  - "다시 묻지 않음"류 버튼은 끈 뒤 어느 설정에서 다시 켜는지 [설정 열기]와 함께 알린다(`tellSettingOff`).
- **[함정] 이름 되돌리기 전에 원래 이름이 비어 있는지 확인한다**(`applyRename`). Node `fs.renameSync`는 윈도우에서 이미 있는 파일을
  경고 없이 덮어쓴다(검토로 재현). svn move가 실패하면 새 이름으로 다시 돌려놓는다 — 사용자의 이름 바꾸기가 조용히 사라지지 않게.
  저장 안 한 편집기가 있으면 하지 않는다(되돌린 사이 저장하면 새 경로가 다시 생긴다).
- **[함정] 대소문자만 바꾸는 이름 변경은 다루지 않는다.** svn 1.14 명령줄이 거부하고(E155010), 임시 이름을 거쳐 두 번 move하면 되지만
  status에 `c.txt`(D)와 `C.txt`(A +)가 함께 생겨 소문자 키를 쓰는 상태 표(`key()`)가 하나를 잃는다. TortoiseSVN Rename으로 안내한다.

### 무시 목록
- **[함정] 내 PC 전역 무시 목록은 svn 우선순위대로 읽고, 값이 있는 곳을 그대로 고친다**(`ignore.readLocal`/`writeLocal`).
  순서: 내 설정 파일 → 내 레지스트리(HKCU) → 시스템 설정 파일 → 시스템 레지스트리 → svn 내장 기본값 중 **처음 값이 있는 곳 하나**.
  TortoiseSVN 설정의 "전역 무시 패턴"은 Tortoise 전용이 아니라 svn 표준 위치인 내 레지스트리를 고친다(명령줄 svn도 읽는다).
  쓸 때는 내 설정 파일에 값이 있으면 그 파일, 아니면 **내 레지스트리**에 쓴다 — 설정 파일로 옮겨 쓰면 Tortoise 설정 화면과
  값이 어긋난다(이전 0.5.1 방식). 시스템 설정은 관리자 권한이 필요해 직접 고치지 않고, 현재 값을 내 레지스트리에 옮겨 적고
  고친다. 처음 고치기 전 원래 값을 백업한다. 레지스트리 키는 테스트에서 임시 키로 바꿔 쓸 수 있게 인자로 받는다.
- **[함정] `svn:ignore`는 줄 단위, `global-ignores`(속성·설정)는 공백 단위로 나눈다**(`ignore.splitFor`). svn:ignore 패턴에는 공백이
  들어갈 수 있다(예: `my file`).
- **공백은 `svn:ignore`에서만 허용**(사용자 결정 2026-10-24, 0.9의 "모든 입력에서 막음"을 바꿈): svn:ignore는 줄 단위라 공백이 든
  패턴이 그대로 저장되고(`npm test` "svn:ignore 공백 포함 패턴"), global-ignores(폴더 속성·내 PC 전역)는 공백에서 나뉘어 다른 패턴이
  된다(같은 테스트 파일에서 확인). 그래서 종류에 따라 막고 이유를 정확히 보인다. SVN Ignore…는 패턴을 적용 범위보다 먼저 고르므로,
  이름은 범위를 고른 뒤에 정하고(svn:ignore면 그대로, 아니면 공백 → `?`), 직접 입력한 패턴은 global을 고르면 `?`로 바꿔 넣을지 묻는다.
  앞뒤 공백은 잘라서 저장한다(svn도 줄 앞뒤 공백을 무시한다). 와일드카드 안내 한 줄을 입력 근처에 둔다.
- **여러 개를 골라 SVN Ignore…**: 패턴(이름·확장자)은 항목마다 만들고, 폴더 속성은 각 항목의 상위 폴더별로 모아 건다.
- **무시 목록 편집은 저장 버튼 방식**(`ignoreView.js`): 화면에 편집 사본을 두고, 저장 때 "추가·수정·삭제한 것"만 보낸다. 확장은 svn의
  현재 값을 다시 읽고 그 위에 얹는다(`applyChange`) — 화면을 연 뒤 밖에서 바뀐 패턴을 덮어쓰지 않게. 루트에는 `svn:ignore`·
  `svn:global-ignores` 카드를 규칙이 없어도 항상 보인다(global-ignores를 걸 자리가 안 보이던 문제).
- **무시 목록 화면의 "다른 폴더에 규칙 추가"**: 폴더 칸은 작업 폴더 기준 경로다. 자동완성은 `<datalist>`(관리 중인 폴더 목록)이고,
  [폴더 선택…]은 VS Code 폴더 선택 창을 연다. **칸에 값을 미리 채우지 않는다** — 예전에 `.`을 채워 두었더니 브라우저가 자동완성을
  "`.`이 들어간 이름"으로 걸러서 목록이 비어 보였다(사용자 제보).
- **무시된 원인 보기**(`reasonView.js`): svn은 원인 규칙을 알려 주지 않는다. `ignore.findRules`가 상위 폴더의 `svn:ignore`,
  `propget --show-inherited-props`로 물려받는 `svn:global-ignores`, 내 PC 목록을 모아 `matchPattern`(apr_fnmatch와 같은 규칙,
  대소문자 구분)으로 맞춰 본다. 조회는 무시된 항목의 **상위 폴더**로 한다(무시된 항목 자체는 버전 관리 대상이 아니다).
  - 화면은 규칙마다 카드(패턴 + "어떤 설정인지" 한 줄)만 보이고, "어떻게 하라"는 안내는 하지 않는다(사용자 결정). 고칠 수 있는
    카드에만 삭제 버튼이 있다. 작업 사본보다 위에 걸린 상속 값은 path가 URL로 와서 설명만 보여 준다.
  - "같은 패턴에 걸린 다른 항목"은 삭제를 누른 뒤 확인 창에서만 보여 준다. 현재 status의 무시 목록 중 규칙이 미치는 범위만 본다
    (무시된 폴더 안쪽은 svn이 알려 주지 않으므로 빠질 수 있다).

### 충돌 해결
`commands.js resolve` → `conflict.js`. 사용자 요청(2026-11-05): VS Code 자체 충돌 편집기로 열기 + 아래 트리 충돌 처리.
- **[함정] "로컬 미등록 파일 + 서버에서 추가"(update·switch) 트리 충돌은 update 직후 이미 삭제 예약(`D C`)이다.**
  `--accept working`(TortoiseSVN "Mark as resolved")으로 해결하면 `D`가 남아, 커밋하면 서버 파일이 지워진다(svn 1.14.5로 재현).
  그래서 `conflict.isLocalAdd`면 전용 선택지를 띄운다. 섞여 고르면 기존 목록의 "지금 파일 그대로"에 경고를 붙인다.
  - 내 파일 유지(`keepLocal`): 내용을 메모리에 읽어 두고 → resolve working → revert(서버 파일이 BASE로 되살아나며 작업 파일을 덮음) → 다시 쓴다.
    결과는 서버 기준 수정(M)이라 BASE 비교 화면에서 바로 고칠 수 있다.
  - 서버 파일로(`takeIncoming`): resolve working → 내 파일을 휴지통으로 → revert.
- **[함정] TortoiseSVN "Merge the files"로 바꾼 텍스트 충돌은 좌우가 반대다.** svn이 서버 파일 위에 로컬 파일을 병합해서
  `prev-wc-file`(마커 `.working`)이 서버, `cur-base-file`(`.new`)이 내 파일이고, 리비전 정보가 없고 base는 빈 파일이다(svn 1.14.5 대화형으로 확인).
  `theirs-full`이 내 파일을 남긴다. `conflict.mergeSides`는 "operation=merge + 리비전 없음"이면 좌우를 바꿔 병합 편집기에 넣는다.
  이때 svn은 `파일.tmp`·`파일.2.tmp`를 남겨서 `repository.js LEFTOVER`에 넣었다.
- **[함정] 버전마다 줄 끝(CRLF/LF)이 다르면 svn은 파일 전체를 충돌 하나로 만든다**(실제로 겪음, 2.0.0). svn update의 병합은 줄을 바이트 그대로
  비교하고 `-x --ignore-eol-style`도 받지 않는다. 마지막 줄에 줄바꿈이 없으면 표시가 그 줄 뒤에 붙어(`}=======`) VS Code가 충돌로 알아보지도
  못한다. 그래도 **VS Code 병합 편집기는 결과 칸을 원본 세 파일(base·input1·input2)로 다시 계산하고 줄 끝도 무시한다**(실제 파일로 확인 —
  svn 결과 그대로 열어도 "0 Conflicts Remaining"). 그래서 확장이 따로 다시 병합하지 않는다.
  **[함정] 병합 편집기가 열려 있는 충돌 파일을 확장이 디스크에 덮어쓰지 않는다.** 줄 끝을 맞춰 다시 병합해 쓰는 기능을 넣었다가,
  열린 편집기와 부딪혀 파일 끝부분이 두 번 붙은 채 저장된 일이 있어 걷어냈다(2.0.0 개발 중).
- **해결됨으로 표시는 세 곳**(사용자 결정, 2.0.0): 병합 편집기를 열 때의 알림, 충돌 파일·그 병합 편집기를 보는 동안의 상태 표시줄 버튼
  (`extension.js resolveItem` — 탭 입력이 `TabInputTextMerge`면 `result` 파일로 판단, `commands.js activeFileUri`), 탭 제목줄 ✓(`editor/title`,
  병합 편집기 탭에서는 VS Code에 따라 안 보일 수 있다). 알림만 두었더니 닫히거나 묻혀 마무리 방법을 찾지 못했다.
- **VS Code 병합 편집기는 내부 명령 `_open.mergeEditor`로 연다**(git 확장과 같은 인자 `{ base, input1, input2, output }`). 공개 API가 없어
  실패하면 마커가 든 파일을 연다(VS Code가 충돌 CodeLens를 띄운다). 편집기의 [병합 완료] 버튼은 제안 API(`merge/toolbar`)라 못 붙여서,
  알림의 [해결됨으로 표시]로 resolve하고, 저장 안 했으면 저장, 충돌 표시가 남았으면 한 번 더 묻는다.
- **[함정] `svn info --xml`의 entry path는 절대 경로로 물어도 실행 폴더 기준 상대 경로로 올 수 있다**(테스트로 확인). `parseConflicts(xml, cwd)`가 cwd로 맞춘다.
- svn 명령줄의 대화형 해결(`svn resolve` 메뉴)은 윈도우에서 콘솔을 직접 읽어 파이프 입력이 먹지 않는다. 확인할 때는 pty(예: pywinpty)로 돌린다.

### SVN 이력 칸
`historyView.js`. 사용자 요청 — git 그래프 자리처럼 이력을 보고 싶다.
- **[함정] 현재 위치는 `svnversion`의 최댓값**이다. 폴더의 `svn info` 리비전을 쓰면 안 된다 — 커밋은 올린 파일만 새 리비전으로 바꾸고
  상위 폴더는 그대로라서, 내가 올린 커밋까지 "받지 않음"으로 보였다(사용자가 실제로 겪음). 섞인 리비전이면 툴팁에 범위를 보인다.
- 받지 않은 커밋은 작업 사본 경로에 `-r HEAD:1`로 읽는다(기본 범위는 BASE:1이라 안 나온다). 바뀐 파일은 펼칠 때 `-v -r N`으로 읽고,
  비교는 저장소 URL@리비전을 `svn cat`한다(`svn-tools` 스킴의 `u` 쿼리 — 지금 작업 사본에 없는 파일일 수 있다).
- **[함정] 이력 칸의 줄을 눌러 작업 사본을 바꾸지 않는다.** "서버의 새 커밋 N개" 줄을 누르면 바로 업데이트하던 때, 사용자가 무슨 일이
  일어났는지 몰라 커밋된 줄 알고 놀랐다. 확인 창을 붙인 뒤에도 실수로 누를 수 있다는 의견이 있어(2.0.0) 그 줄은 알림만 하고,
  업데이트는 칸 제목줄의 ↓ 버튼(`svnTools.update`)으로 한다. 이 칸에서 서버로 올리는 동작은 없다.
- svn log는 서버를 부르므로 **칸이 보일 때만** 읽는다: 보이게 될 때, 커밋·업데이트 뒤, 커밋 전 확인에서 새 버전이 있을 때,
  TortoiseSVN 창을 닫을 때, 창으로 돌아올 때(30초 간격), 자동 확인(`history.autoRefresh` + `autoRefreshMinutes`, 창이 앞에 있을 때만).
  켜기와 간격을 따로 둔 건 "0이면 끔"이 설정 화면에서 알아보기 어렵다는 사용자 의견 때문이다.
- 칸 제목은 `TreeView.title`로 패널 언어(`scmLanguage`)에 맞춘다(package.json의 이름은 고정이라).

### 색상
- **색상은 자기 색상 ID**(`svnTools.*Foreground`, 기본값은 git 색 ID): 사용자가 `workbench.colorCustomizations`로 git 색과 따로
  바꿀 수 있게.
- 설정 화면에는 색 고르기 입력이 없어서 **상태 색 편집 화면**(`colorView.js`, 사용자 결정)을 둔다. 사용자(전역)
  `workbench.colorCustomizations`에 쓰고, [기본값]은 키를 지운다(값을 git 색으로 박지 않는다 — 테마를 바꾸면 따라가게).
- 고르는 동안(`input`)은 미리보기만 바꾸고 고르기 창을 닫을 때(`change`) 저장한다. 미리보기와 hex는 웹뷰의 테마 변수
  (`--vscode-svnTools-*`)에서 읽어 지금 실제로 적용된 색을 보인다. 작업 공간·테마별 값이 있으면 그쪽이 이겨서 경고만 띄운다.
- `<input type="color">`는 투명도를 못 다뤄서 테마별 색·투명도는 settings.json 안내로 둔다.

### 웹뷰 공통
`ignoreView.js`·`reasonView.js`·`commitView.js`·`colorView.js`.
- **[함정] 웹뷰 HTML·스크립트는 JS 템플릿 문자열 안에 있다**(각 파일의 `html()`). 스크립트 안에서 백슬래시는 두 번
  (`\\s` → 화면에서 `\s`), `${`는 쓰지 않는다(바깥 템플릿이 먹는다). 고친 뒤에는 생성된 스크립트를 꺼내 `node --check`로 본다.
- **[함정] DOM `append`·`replaceChildren`·`prepend` 등에 `null`을 넘기면 글자 "null"이 찍힌다**(세 번 겪었다: 편집 화면의 꼬리표,
  원인 화면의 안내 자리 등). 조건부 요소는 `el()`(null을 거름)의 자식으로 넣거나, 배열로 모아 `.filter(Boolean)` 뒤 넘긴다.
  세 번째부터는 `npm test`가 잡는다: `const v = 조건 ? ... : null`을 거르지 않고 넘기면 실패한다(`test/manifest-check.js nullPassing`).

### 언어와 매니페스트
- **언어는 전체 + 영역별**(사용자 결정 2026-10-24): `svnTools.language`(전체, 기본 `en` — 마켓플레이스 사용자 대부분이 영어권)와
  영역별 `menuLanguage`(우클릭 메뉴·팔레트) / `scmLanguage`(패널 그룹 이름·버튼·이력 칸) / `messageLanguage`(알림·확인 창·웹뷰와 커밋 탭 우클릭 메뉴·툴팁).
  영역별 기본값은 `default`(전체를 따름, `i18n.languageFor`). VS Code 표시 언어를 따르는 선택지는 두지 않는다(사용자 결정).
  - 설정 화면 위계: VS Code 설정 화면에는 "다른 값에 따라 칸을 켜고 끄는" 기능이 없다. 그래서 `configuration`을 묶음 배열로 나눠
    "Language / 언어" 묶음을 따로 두고, `order`로 전체 → 영역별 순서, 설명 앞 `└`로 하위임을 보인다. 영역별 값이 `default`면 전체를 따른다
    (VS Code 자체 설정의 "상속" 방식과 같다). 전체를 "custom"으로 바꾸는 방식은 값이 두 곳에서 서로를 바꿔 헷갈려서 쓰지 않았다.
  - **[함정]** VS Code는 메뉴 이름을 package.json 고정 문자열로만 받아서, 명령마다 `svnTools.<id>.en` / `.ko`를 등록하고 메뉴에 영역 언어 조건
    (`manifest.js` `langWhen` — "영역 값이 lang이거나, default면서 전체가 lang")을 붙인다. 패널(scm/*) 메뉴는 `scmItem`으로 패널 언어를
    쓴다. 하위 메뉴도 언어별로 두고(`svnTools.svn.en` 등), **하위 메뉴 안쪽 항목에는 언어 조건을 붙이지 않는다** — 같은 TortoiseSVN 하위
    메뉴를 탐색기는 메뉴 언어로, 패널은 패널 언어로 여는데, 안쪽에 메뉴 언어 조건이 있으면 둘이 다를 때 비어 보인다.
  - 0.9까지 `language`는 "문구 언어"였다. 업데이트 후 보이는 언어가 바뀌지 않게 시작할 때 한 번 옮긴다(`extension.js migrateLanguage`:
    전체 = 예전 메뉴 언어, 문구 = 예전 language). 사용자(전역) 설정만 옮기고, "옮김" 표시는 설정 동기화로 다른 PC에 넘긴다
    (`setKeysForSync` — 동기화로 받은 새 뜻의 값을 다시 옮기지 않게). 작업 공간 설정 파일은 팀 공유일 수 있어 고치지 않는다.
  - 0.7.0에서 메뉴를 영어로 고정하며 언어별 명령 장치를 걷어냈다가 0.8.0에서 되살렸다.
- **명령 팔레트에는 고른 항목 없이도 뜻이 있는 명령만**(`manifest.js` `PALETTE`): Commit(=패널 Commit, 커밋 탭), Update,
  Add All(저장소 단위), Resolve Conflict…(열린 파일이 충돌이 아니면 충돌 파일 목록에서 고른다, `pickConflicts`) 등. 빠른 커밋(Commit…)·Include/Exclude Contents·Delete ▸ 항목처럼
  메뉴 맥락이 있어야 하는 명령은 숨긴다. 제목이 "SVN …"인 명령은 category를 빼서 "SVN: SVN Update"처럼 겹치지 않게 한다.
  저장소가 여럿이면 고르게 한다(`pickRepo`).
- **설정 화면에는 버튼을 둘 수 없다**: 대신 설정 설명(`markdownDescription`)에 명령 링크(`command:svnTools.editIgnores`)를 둔다
  (무시 목록 편집·상태 색 편집 열기, `svnTools.decorations.enabled` 설명).

### TortoiseSVN 연동
- **[함정] TortoiseProc 인자는 직접 따옴표로 감싸고 `windowsVerbatimArguments: true` + `argv0: "\"<exe>\""`로 실행한다.**
  Node가 다시 감싸면 `/path:"..."`가 깨지고, verbatim이면 실행 파일 경로도 안 감싸지므로 argv0로 넣는다.
- **Lock/Unlock은 2순위**: 직접 구현하지 않고 TortoiseSVN 메뉴로 쓴다.

## 규칙
- 주석·문서는 한글, 코드·식별자는 영문. 주석은 비자명한 이유만 짧게.
- 커밋 메시지: 타입은 영어(`feat`, `fix`, `docs`, `refactor`, `chore`), 제목·본문은 한글. AI 생성 표시를 넣지 않는다.
- `.vsix`는 빌드 결과물이라 git에 넣지 않는다(`.gitignore`). `test/`와 이 문서는 `.vsix`에 넣지 않는다(`.vscodeignore`).
  `.vscode/`도 커밋하지 않는다.
- **저장소는 GitHub 공개 저장소다.** 회사 이름, 사내 서버 주소(svn URL·IP), 사내 프로젝트명을 코드·문서·테스트에 넣지 않는다.
  README 스크린샷도 회사 작업 사본으로 찍지 않는다(공개용 데모 저장소로 찍는다).
- **라이선스·출처**: 다른 프로젝트의 코드나 데이터(설정 값 목록 포함)를 들이면 README "라이선스와 출처" 표에 출처와 라이선스를
  추가한다. MIT 등 허용형 코드를 가져오면 원본 저작권 줄과 라이선스 문구를 남긴다(파일 머리 주석 또는 README 표).
  독점 라이선스 코드(예: Shellback 확장)는 읽지도 옮기지도 않는다. **이 확장은 MIT**(`LICENSE`, Kihoon Kwon).
- **테스트한 환경**: 다른 버전의 VS Code·svn·TortoiseSVN에서 확인했으면 README "테스트한 환경" 표를 고친다.

## 남은 일
- Lock/Unlock 직접 구현(지금은 TortoiseSVN 메뉴)
- README 스크린샷(공개용 데모 저장소를 만들어 찍는다)
- README 영문화(`README.md` 영문 + `README.ko.md`)
- 실제로 svn이 없는 PC에서 설치 안내 → winget 설치 → 패널 표시까지 확인(1.1.0)
