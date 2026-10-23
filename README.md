# SVN Tools

VS Code에서 SVN을 쓰기 위한 확장. Source Control 패널, 탐색기 우클릭 메뉴(SVN / TortoiseSVN),
탐색기 상태 표시(무시된 파일 회색 포함)를 한 확장으로 제공한다.

- ID: `khoon.vscode-svn-tools`
- 필요: SVN 명령줄 클라이언트(`svn`). PATH에 없으면 TortoiseSVN에 딸린 `svn.exe`를 쓴다.
  TortoiseSVN 메뉴를 쓰려면 TortoiseSVN이 설치돼 있어야 한다.

## 기능

### Source Control 패널
- 변경 목록을 **충돌 / 변경 / 미등록** 세 그룹으로 보여 준다. 파일을 누르면 BASE와 비교한다.
- 메시지 입력 → 커밋(✓ 또는 Ctrl+Enter). 위쪽 버튼: 커밋, 업데이트, 새로고침. `…`에 로그, 정리, TortoiseSVN 메뉴.
- 파일 옆 버튼: 열기, 되돌리기(미등록이면 추가). 그룹 옆 버튼: 모두 되돌리기 / 모두 추가.
- 편집기 줄 번호 옆에 바뀐 줄 표시(BASE 기준).

### 탐색기 우클릭 → SVN
| 메뉴 | 동작 |
|---|---|
| 업데이트 / 커밋… | 선택한 파일·폴더만 |
| BASE와 비교 | 파일은 비교 화면, 폴더는 `svn diff` 결과 |
| 로그 보기 | 이력 목록 → 리비전을 고르면 작업본과 비교 / 그 리비전의 변경 보기 / 바뀐 파일 목록 / 메시지 복사 |
| SVN에 추가 | 폴더를 고르면 안의 미등록 항목까지(무시된 것은 제외) |
| SVN에서 삭제 | 기본은 **로컬 파일 유지**(`--keep-local`). 설정으로 바꾼다 |
| 이름 바꾸기 | `svn move`라 이력이 이어진다 |
| 되돌리기 | 확인 후 되돌린다(복구 불가) |
| 충돌 해결… | 지금 파일 그대로 / 내 것 / 서버 것 / 충돌 부분만 내 것·서버 것 / TortoiseSVN 충돌 편집기 |
| 무시 목록에 추가… | 이름·확장자·직접 입력 → 적용 범위(아래) |
| 정리 (Cleanup) | 작업 사본 루트에서 실행 |
| SVN URL 복사 | 저장소 주소를 클립보드로 |

**무시 목록 적용 범위**

| 종류 | 범위 | 공유 |
|---|---|---|
| `svn:ignore` | 그 폴더의 바로 아래 항목만 | 커밋하면 공유 |
| `svn:global-ignores` | 그 폴더와 아래 모든 폴더 | 커밋하면 공유 |
| 내 PC 전체 | 이 PC의 모든 작업 사본 (`%APPDATA%\Subversion\config`) | 공유 안 됨 |

내 PC 전체에 처음 추가할 때는 svn 기본 무시 목록(`*.pyc`, `__pycache__` 등)을 함께 적는다 — 설정 파일에
`global-ignores` 줄이 생기면 기본값을 대신하기 때문이다. 처음 고치기 전 원본은 `config.svn-tools.bak`으로 남긴다.

### 무시 목록 편집 화면
탐색기 우클릭 SVN → **무시 목록 편집…**, Source Control 패널 `…`, 명령 팔레트("SVN: 무시 목록 편집")에서 연다.
VS Code 설정 화면에는 확장이 이런 편집 화면을 넣을 수 없어서 별도 탭으로 연다.

- **이 프로젝트의 무시 규칙**: 열린 폴더 아래에서 `svn:ignore`·`svn:global-ignores`가 걸린 폴더를 모두 찾아
  폴더·종류별 카드로 보여 준다. **작업 폴더(루트)는 규칙이 없어도 두 종류 카드를 항상 보인다** — 프로젝트 전체에
  적용할 패턴은 루트의 `svn:global-ignores` 카드에 넣는다. 커밋 안 된 속성 변경은 "커밋 필요"로 표시한다.
- **다른 폴더에 규칙 추가**: 아직 규칙이 없는 폴더에 새로 걸 때. 폴더(열린 폴더 기준 상대 경로)와 종류를 고르면
  빈 카드가 생긴다. 폴더에서 열면 그 폴더가 미리 채워진다.
- **내 PC 전체**: 클라이언트 global-ignores. 설정 파일에 없으면 svn 기본값을 보여 주고, 고치면 기본값과 함께 적는다.

**고친 내용은 [저장]을 눌러야 적용된다.** 저장 전에는 추가·수정·삭제 예정이 표시되고, 삭제는 복구할 수 있다.
[변경 취소]로 모두 버린다. 저장은 svn에서 현재 값을 다시 읽고 바꾼 부분만 얹는다(화면을 연 뒤 밖에서 바뀐 패턴을
덮어쓰지 않는다). 저장하지 않고 탭을 닫으면 버렸다고 알린다. 패턴에 공백은 넣을 수 없다.

### 탐색기 우클릭 → TortoiseSVN
TortoiseSVN 창을 바로 연다: 업데이트, 커밋, 로그, 비교, 리비전 그래프, 저장소 브라우저, Blame, 추가, 삭제,
이름 바꾸기, 되돌리기, 충돌 편집, 해결됨으로 표시, 무시 목록, 속성, 병합, 전환, 잠금/해제, 정리, 설정.
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
| `svnTools.language` | `ko` | 메뉴·메시지 언어 (`ko` / `en`) |
| `svnTools.delete.keepLocal` | `true` | 삭제 시 로컬 파일 유지 |
| `svnTools.commit.checkOutOfDate` | `true` | 커밋 전 서버 변경 확인 |
| `svnTools.decorations.enabled` | `true` | 탐색기 상태 표시 |
| `svnTools.svnPath` | (비움) | `svn.exe` 경로 |
| `svnTools.tortoiseProcPath` | (비움) | `TortoiseProc.exe` 경로 |

## 동작 범위
작업 사본 루트가 VS Code에서 연 폴더보다 위에 있어도, 패널과 표시는 **연 폴더 안**만 다룬다(같은 작업 사본의
다른 프로젝트 변경이 섞이지 않게). 정리(Cleanup)만 작업 사본 루트에서 돈다.

파일이 바뀌면 자동으로 새로고침한다. 무시된 폴더 안의 변경(수집 로그 등)은 새로고침을 일으키지 않는다.
VS Code 밖(TortoiseSVN 등)에서 바꾼 것은 창으로 돌아올 때 반영된다.

## 다른 SVN 확장과 같이 쓰지 말 것
같은 역할을 하는 확장(예: Chris Johnston의 "SVN", "SVN - Subversion Support")이 켜져 있으면 Source Control
패널과 우클릭 메뉴가 겹친다. 이 확장을 쓰면 그것들은 끈다. 줄 단위 이력(SVN Lens)은 겹치지 않는다.

## 개발

```
node manifest.js     # package.json 생성 (직접 고치지 않는다 — 메뉴는 manifest.js에서)
npm run package      # .vsix 생성
code --install-extension vscode-svn-tools-<버전>.vsix
```

메뉴 이름을 설정 언어로 바꾸기 위해 명령을 `svnTools.<id>.ko` / `svnTools.<id>.en`으로 나눠 등록한다
(VS Code는 메뉴 이름을 package.json의 고정 문자열로만 받는다). 실행 중 메시지는 `src/i18n.js`에 있다.

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
| `src/tortoise.js` | TortoiseSVN 창 열기 |
| `src/i18n.js` | 메시지 한글/영어 |
