# SVN Tools

VS Code에서 **Subversion(SVN)** 작업 사본을 다루는 확장입니다. 변경 확인, 커밋, 업데이트, 무시 목록 관리를
VS Code 안에서 하고, 필요하면 우클릭 한 번으로 TortoiseSVN 창을 엽니다.

**주요 기능**
- **Source Control 패널**: 변경·미등록·충돌을 그룹으로 보고, 파일을 누르면 바로 비교합니다.
- **커밋 탭**: 메시지를 쓰고, 올릴 파일을 폴더 트리에서 체크해 커밋합니다. 미등록 파일도 체크하면 함께 추가됩니다.
- **상황에 맞는 우클릭 메뉴**: 새 파일에는 SVN Add, 새 항목에는 SVN Ignore…처럼 그 항목에 필요한 것만 보입니다.
- **무시 목록 관리**: `svn:ignore`·`svn:global-ignores`·PC 전역 목록을 한 화면에서 고치고, 어떤 규칙 때문에 무시되는지 보여 줍니다.
- **이름 바꾸기 이력 유지**: 탐색기에서 F2로 이름을 바꿔도 SVN 이름 바꾸기(이력 유지)로 적용할 수 있습니다.
- **TortoiseSVN 메뉴**: Log, Revision Graph, Blame, Merge 등 TortoiseSVN 창을 바로 엽니다.
- **탐색기 상태 표시**: 수정·추가·충돌 배지와 색, 무시된 파일은 회색으로 표시합니다.

메뉴와 알림은 영어와 한국어를 지원합니다(기본 영어, 아래 [언어](#언어)).

---

## 시작하기

**필요한 것**
- **SVN 명령줄 클라이언트** `svn`. PATH, TortoiseSVN(`C:\Program Files\TortoiseSVN\bin`), SlikSVN 순서로 찾습니다.
  **TortoiseSVN 기본 설치에는 들어 있지 않습니다**("command line client tools" 항목이 기본으로 꺼져 있음).
  - 없으면 작업 사본을 열 때 알림이 뜹니다. **[설치…]** 를 누르면 winget으로 설치합니다(관리자 권한 필요).
    TortoiseSVN이 있으면 명령줄 도구만 추가하고, 없으면 SlikSVN(svn만)과 TortoiseSVN(탐색기 메뉴 포함) 중에서 고릅니다.
    설치가 끝나면 다시 시작하지 않아도 바로 동작합니다. 알림을 닫았으면 명령 팔레트의 **SVN: svn 명령줄 도구 설치…**(영어 메뉴: Install svn Command Line Tools…).
  - 직접 설치하려면: TortoiseSVN 설치 파일을 다시 실행해 **Modify** → "command line client tools"를 추가하거나,
    `winget install Slik.Subversion`. 다른 곳에 있는 svn은 알림의 **[svn.exe 위치 지정]** 이나 설정 `svnTools.svnPath`로 지정합니다.
- TortoiseSVN 메뉴를 쓰려면 **TortoiseSVN**이 설치돼 있어야 합니다(없어도 나머지 기능은 동작합니다).

**처음 쓸 때**
1. SVN 작업 사본(체크아웃한 폴더)이나 그 안의 폴더를 VS Code로 엽니다.
2. 왼쪽 **Source Control**(Ctrl+Shift+G)에 `SVN: <폴더 이름>`이 나타나면 준비된 것입니다.
3. 다른 SVN 확장(예: "SVN", "SVN - Subversion Support")이 켜져 있으면 패널과 메뉴가 겹칩니다. 그 확장은 꺼 주세요.
   줄 단위 이력을 보여 주는 SVN Lens는 겹치지 않습니다.
4. 한국어로 쓰려면 설정에서 `svnTools.language`를 `ko`로 바꿉니다.

---

## 기본 사용 흐름

1. 파일을 고치면 Source Control 패널의 **Modified**(수정됨)에 나타납니다. 새 파일은 **Unversioned**(미등록)에 나타납니다.
2. 패널 입력칸에 메시지를 쓰고 Ctrl+Enter를 누르거나, 패널 위쪽 **✓**(Commit)·상태 표시줄의 **SVN Commit**을 누르면 **커밋 탭**이 열립니다.
   입력칸과 커밋 탭은 같은 메시지를 씁니다.
3. 메시지를 확인하고, 올릴 항목을 체크한 뒤 [커밋](또는 Ctrl+Enter)을 누릅니다.
4. 다른 사람의 변경은 패널 위쪽 **Update** 버튼으로 받습니다.

새 파일을 미리 추가해 두려면 패널의 **`+`**나 탐색기 우클릭 **SVN Add**를 씁니다(커밋 탭에서 체크해도 됩니다).

---

## 기능 안내

### Source Control 패널
| 위치 | 내용 |
|---|---|
| 그룹 | **Modified**(수정됨 — 수정·추가·삭제) · **Unversioned**(미등록) · **Conflicts**(충돌). 바깥의 "Changes"는 VS Code가 붙이는 섹션 제목입니다 |
| 커밋 | 위쪽 ✓ 버튼이나 상태 표시줄의 **SVN Commit**을 누르면 커밋 탭이 열립니다 |
| 파일 클릭 | 수정한 파일은 BASE(마지막으로 받은 버전)와 비교, 그 밖은 파일 열기 |
| 파일 옆 버튼 | Open File, Revert, 새로 추가한 항목은 `−`(추가 취소), 미등록 항목은 `+`(svn add). 여러 개를 골라 한꺼번에 누를 수 있습니다 |
| 그룹 옆 버튼 | Revert All(변경) / Add All(미등록) |
| 위쪽 버튼 | Commit(커밋 탭 열기), Update, Refresh. `…` 안에 Show Log, Clean Up, Edit Ignore Lists…, TortoiseSVN 메뉴 |
| 편집기 | 줄 번호 옆에 바뀐 줄 표시(BASE 기준) |

### 커밋 탭
패널의 **✓ Commit**, 패널 입력칸의 Ctrl+Enter, 명령 팔레트 **SVN: Commit**으로 엽니다. 메시지를 쓰고 올릴 항목을 체크해 커밋합니다.

| 위치 | 내용 |
|---|---|
| 커밋 메시지 | 탭을 닫아도 남아 있고, 커밋하면 지워집니다. 비워 두고 커밋하면 한 번 확인합니다 |
| [커밋] 버튼 | 화면 아래에 붙어 있어 목록을 스크롤해도 바로 누를 수 있습니다(Ctrl+Enter도 됨) |
| **변경** | 수정·추가·삭제한 항목을 작업 폴더부터 시작하는 폴더 트리로 보입니다(탐색기처럼 폴더 먼저, 이름순). 처음에는 모두 체크돼 있고, 맨 위 작업 폴더 줄로 전체를 켜고 끕니다 |
| **미등록** | 새 파일·폴더. 처음에는 체크가 꺼져 있고, 체크하면 커밋할 때 `svn add` 됩니다(폴더는 하위 항목 포함, 무시 규칙에 걸린 것은 빠짐) |
| 항목 클릭 | 수정한 파일은 BASE와 비교, 그 밖은 파일 열기 |
| 항목 우클릭 | Compare with BASE, Open File, Show Log, Revert, 미등록 항목은 SVN Ignore…, 이름을 바꾼 항목은 SVN Apply Rename |

- **폴더를 체크하면 하위 항목이 모두 체크**되고, 끄면 모두 꺼집니다. 일부만 체크된 폴더는 `−` 모양으로 보입니다.
- **새 폴더 안의 항목을 체크하면 그 폴더도 자동으로 체크**됩니다. svn은 새 폴더 없이 그 안의 항목만 올리지 못합니다.
  반대로 새 폴더를 끄면 그 안의 항목도 꺼집니다.
- **이름을 바꾼(이동한) 항목**은 새 이름 한 줄로 보이고 "← 원래 이름에서 이름 바꿈"이 붙습니다. 원래 위치의 삭제는 함께 올라갑니다.
- 사라진 파일(누락 `!`)은 "디스크에 없음 — 삭제로 커밋"으로 보이고, 체크한 채 커밋하면 삭제로 올라갑니다.
- 충돌이 있거나 Update가 끝나지 않은 항목은 커밋할 수 없어 목록에서 빠지고 안내만 보입니다.
- 탭을 연 채로 파일을 고치거나 TortoiseSVN으로 바꾸면 목록이 따라 바뀝니다. 고른 체크는 그대로 남습니다.
- **고른 것만 커밋**: 탐색기 우클릭 **SVN ▸ Commit…**은 같은 탭을 열고, 고른 파일·폴더 안의 항목만 체크해 둡니다.
- 커밋 전에 **서버에 더 새 버전**이 있으면 알려 주고 "Update 먼저 / 그대로 커밋"을 고르게 합니다
  (설정 `svnTools.commit.checkOutOfDate`).
- **충돌**이 남은 항목은 svn이 커밋을 받지 않습니다. [충돌 해결…] 버튼으로 바로 해결 메뉴를 엽니다.

### SVN 이력
Source Control 화면 아래의 **SVN 이력** 칸에 최근 커밋 50개가 나옵니다(맨 아래 "더 보기…").

| 표시 | 뜻 |
|---|---|
| 초록 ● **현재 위치** | 내 작업 사본이 받은 가장 새 커밋 |
| 파란 ↓ **받지 않음** | 서버에만 있는 커밋. 맨 위 "서버의 새 커밋 N개" 줄은 알림만 하고, 받을 때는 칸 제목줄의 ↓(SVN Update) 버튼을 누릅니다 |
| 커밋 펼치기 | 바뀐 파일(A/M/D/R). 작업 폴더 밖 경로는 "(작업 폴더 밖)"으로 표시 |
| 파일 클릭 | 그 커밋 직전 ↔ 직후 비교 |

- 이력 칸의 줄을 눌러서는 작업 사본이 바뀌지 않습니다. 업데이트는 제목줄의 ↓ 버튼으로만 합니다.
- 서버는 이력 칸이 보일 때만 읽습니다: 칸을 열 때, 커밋·업데이트 뒤, 커밋 전 확인에서 새 버전이 있을 때, [새로고침],
  VS Code로 돌아올 때(30초 간격), 그리고 창이 앞에 있는 동안 자동 확인(기본 5분, 설정 `svnTools.history.*`).

### 탐색기 우클릭
항목 상태에 맞는 것만 바로 보이고, 나머지는 **SVN ▸**, **TortoiseSVN ▸** 하위 메뉴에 있습니다. 편집기 탭 우클릭에도 같은 메뉴가 있습니다.

| 메뉴 | 언제 보이나 | 하는 일 |
|---|---|---|
| SVN Update | 항상 | 고른 파일·폴더만 업데이트 |
| SVN Add | 새 파일 | `svn add` |
| SVN Add ▸ Include / Exclude Contents | 새 폴더, 여러 개 선택 | 하위 항목 포함 여부를 골라 `svn add` |
| SVN Undo Add (Revert) | 새로 추가(A)한 항목 | 추가 취소. 파일은 그대로 남고 다시 미등록이 됩니다(폴더는 안의 추가도 함께 취소). 복사·이동한 항목은 제외 |
| SVN Ignore… | 새 파일·폴더, 여러 개 선택 | 무시 목록에 추가(아래 [무시 목록](#무시-목록)) |
| SVN Apply Rename | F2로 이름을 바꾼 관리 파일 | SVN 이름 바꾸기로 적용하거나 원래 이름으로 되돌리기 |
| SVN ▸ Commit… | 항상 | 고른 것만 체크한 커밋 탭 열기 |
| SVN ▸ Compare with BASE / Compare with Revision… | 항상 | 마지막으로 받은 버전 또는 고른 리비전(번호, `HEAD`, `PREV`, 로그에서 선택)과 비교 |
| SVN ▸ Show Log | 항상 | 이력 목록에서 리비전을 골라 비교, 바뀐 파일 목록, 메시지 복사 |
| SVN ▸ Delete ▸ Keep Local File / Delete Local File Too | 항상 | SVN에서 빼기(파일은 남김 / 파일도 삭제) |
| SVN ▸ Rename (keep history) | 항상 | `svn move`로 이름 바꾸기(이력 유지) |
| SVN ▸ Revert | 항상 | 변경 되돌리기(복구 불가, 확인 후) |
| Resolve Conflict… | 충돌 파일과 그 부산물(`파일.mine`, `파일.r12` 등) | VS Code 병합 편집기 / 지금 파일 그대로 / 내 것 / 서버 것 / 충돌 부분만 / TortoiseSVN 충돌 편집기(아래 [충돌 해결](#충돌-해결)) |
| SVN ▸ Show Ignore Reason… / Edit Ignore Lists… | 항상 | 무시된 원인 보기 / 무시 목록 편집 화면 |
| SVN ▸ Clean Up / Copy SVN URL | 항상 | 작업 사본 정리 / 저장소 주소 복사 |

### 충돌 해결
**Resolve Conflict…**(패널의 충돌 항목, 탐색기에서 충돌 파일이나 `파일.mine` 같은 부산물을 우클릭)에서 고릅니다.

- **VS Code 병합 편집기**: 텍스트 충돌 파일 하나를 골랐을 때 맨 위에 나옵니다. 내 변경 · 서버 변경 · 결과를 나란히 보고 고칩니다.
  병합을 마치면 **[해결됨으로 표시]**를 누릅니다. 병합 편집기를 열 때 뜨는 알림, 충돌 파일을 보고 있는 동안 아래 상태 표시줄의
  **✓ 해결됨으로 표시 (파일 이름)**, 충돌 파일 탭 제목줄의 ✓ 중 아무거나 누르면 됩니다. 저장 안 한 내용은 먼저 저장하고,
  충돌 표시가 남아 있으면 한 번 더 묻습니다. 겹치는 변경이 없어 "0 Conflicts Remaining"이면 결과만 확인하고 누르면 됩니다.
  VS Code 내부 명령을 쓰기 때문에 열지 못하는 버전에서는 파일을 열고, 충돌 표시 위의 버튼으로 고르게 안내합니다.
- **로컬 미등록 파일 + 서버에서 같은 이름 추가**(예: 직접 만든 `package-lock.json`을 다른 사람이 먼저 올림): update 뒤
  이 항목은 이미 **삭제 예약** 상태라, "지금 파일 그대로"로 해결하고 커밋하면 서버 파일이 지워집니다. 그래서 따로 고르게 합니다.
  - **서버 파일 받고 내 파일은 변경으로 남기기**: 서버 파일이 기준이 되고 내 내용은 수정(M)으로 남아 비교 화면이 열립니다.
  - **서버 파일로 바꾸기**: 내 파일은 휴지통으로 옮깁니다.

**명령 팔레트**(Ctrl+Shift+P)에는 "SVN"으로 시작하는 명령이 있습니다: Commit(커밋 탭), Update, Add All(미등록 전부 추가),
Compare, Show Log, Revert, Resolve Conflict…(열린 파일, 아니면 충돌 파일 목록에서 고르기), Mark as Resolved, Edit Ignore Lists…, Edit Status Colors…, Clean Up, TortoiseSVN 명령.

### 탐색기에서 이름을 바꿨을 때
F2로 관리 중인 파일·폴더의 이름을 바꾸면 svn은 "원래 파일이 사라지고 새 파일이 생겼다"로만 압니다. 그대로 두면 이력이 끊깁니다.
그래서 알림으로 묻습니다.
- **[SVN에 적용]**: SVN 이름 바꾸기로 바꿔 이력이 이어집니다. 수정 내용은 그대로입니다.
- **[이름 되돌리기]**: 실수로 바꿨을 때 원래 이름으로 돌립니다(열린 탭도 따라갑니다).
- **[다시 묻지 않음]**: 알림을 끕니다(설정 `svnTools.rename.askOnRename`).

알림을 닫았어도, 그 파일을 우클릭하면 맨 위에 **SVN Apply Rename**이 뜹니다. VS Code 밖(윈도우 탐색기 등)에서 바꾼 이름은
알 수 없고, 대소문자만 바꾼 경우는 svn 명령줄이 지원하지 않아 **TortoiseSVN ▸ Rename**을 쓰세요.

### 무시 목록
**추가**: 새 파일·폴더를 우클릭해 **SVN Ignore…**를 누르고, 무엇을(이 이름 / 이 확장자 / 직접 입력) 어디에 적용할지 고릅니다.

| 적용 범위 | 대상 | 다른 사람과 공유 |
|---|---|---|
| `svn:ignore` | 그 폴더의 바로 아래 항목만 | 커밋하면 공유 |
| `svn:global-ignores` | 그 폴더와 아래 모든 폴더 | 커밋하면 공유 |
| 내 PC 전역 (global-ignores) | 이 PC의 모든 작업 사본(TortoiseSVN 포함) | 공유 안 됨 |

**패턴**: `*` 여러 글자, `?` 한 글자, `[abc]` 괄호 안 한 글자, `[!abc]` 괄호 안 글자를 제외한 한 글자입니다. 정규식이 아니고
대소문자를 구분합니다. **공백은 `svn:ignore`에서만** 쓸 수 있습니다. 나머지 둘은 공백으로 패턴을 나누므로 공백 대신 `?`를 씁니다.
이름을 골라 추가하면 확장이 알아서 맞춰 줍니다.

**편집 화면**: **SVN ▸ Edit Ignore Lists…**(또는 패널 `…`, 명령 팔레트). 프로젝트 안의 모든 무시 규칙과 내 PC 전역 목록을
카드로 보여 줍니다. 추가·수정·삭제한 뒤 **[저장]**을 눌러야 적용됩니다. 아직 규칙이 없는 폴더는 아래 "다른 폴더에 규칙 추가"에서
폴더(작업 폴더 기준 경로, 또는 [폴더 선택…])와 종류를 골라 만듭니다.

**무시된 원인 보기**: 회색으로 보이는 파일을 우클릭해 **SVN ▸ Show Ignore Reason…**. 어떤 규칙 때문에 무시되는지 보여 주고,
고칠 수 있는 규칙은 그 자리에서 지울 수 있습니다.

폴더 규칙(`svn:ignore`, `svn:global-ignores`)은 바꾼 뒤 **커밋해야** 다른 사람에게 적용됩니다.

<details>
<summary>내 PC 전역 목록은 어디에 저장되나</summary>

svn은 아래 순서로 찾아 **처음 값이 있는 곳 하나만** 씁니다. 이 확장은 같은 순서로 읽고, 고칠 때는 지금 값이 있는 곳을 고칩니다.
그래서 TortoiseSVN 설정 화면과 항상 같은 값을 보여 줍니다.

| 순서 | 위치 | 고칠 때 |
|---|---|---|
| 1 | 내 설정 파일 `%APPDATA%\Subversion\config` | 이 파일을 고친다 |
| 2 | 내 레지스트리 `HKCU\Software\Tigris.org\Subversion\Config` (TortoiseSVN 설정의 "전역 무시 패턴") | 레지스트리를 고친다 |
| 3·4 | 시스템 설정 파일·시스템 레지스트리 (이 PC의 모든 사용자) | 관리자 권한이 필요해 직접 고치지 않고, 지금 값을 내 레지스트리에 옮겨 적고 고친다 |
| 5 | svn 내장 기본값 | 위와 같음 |

처음 고치기 전의 원래 값은 백업합니다: 설정 파일은 `config.svn-tools.bak`, 레지스트리는
`%APPDATA%\Subversion\svn-tools-registry-global-ignores.bak`.
</details>

### TortoiseSVN 메뉴
탐색기 우클릭 **TortoiseSVN ▸**에서 TortoiseSVN 창을 바로 엽니다: Update, Commit, Show Log, Diff, Revision Graph, Repo-browser,
Blame, Add, Delete, Rename, Revert, Edit Conflicts, Resolved, Add to Ignore List, Properties, Merge, Switch, Get Lock / Release Lock,
Clean Up, Settings. 창을 닫으면 상태를 새로고침합니다.

### 탐색기 표시
| 배지 | 뜻 |
|---|---|
| `M` | 수정 |
| `A` | 추가 |
| `D` | 삭제 |
| `U` | 미등록(새 파일, 미등록 폴더 안의 파일 포함) |
| `C` | 충돌 |
| `!` | 누락 또는 덜 받음(아래 [문제 해결](#문제-해결)) |
| 회색 | 무시됨(무시된 폴더 안의 파일 포함) |
| `●` (폴더) | 안에 변경이 있음. 색은 충돌 > 삭제·누락 > 수정 > 추가 > 미등록 순으로 가장 앞선 상태를 따르고, 툴팁에 상태별 개수 표시 |

색은 지금 테마의 git 색을 따릅니다. 바꾸려면 명령 팔레트의 **SVN: Edit Status Colors…**(또는 설정 화면 "탐색기 표시"
설명의 링크)를 엽니다. 상태마다 탐색기 한 줄 미리보기와 색 견본이 있고, 견본을 눌러 색을 고르면 바로 적용됩니다.
[기본값]을 누르면 다시 테마의 git 색을 따릅니다.

- 고른 색은 사용자 설정 `workbench.colorCustomizations`에 저장되며 모든 테마에 적용됩니다.
- 테마마다 다른 색을 주거나 투명도를 넣으려면 `settings.json`에 직접 씁니다. 테마별 설정(`"[테마 이름]": {...}`)이나
  작업 공간 설정에 같은 색이 있으면 그쪽이 우선합니다(화면에 경고로 표시).

```json
"workbench.colorCustomizations": {
  "svnTools.ignoredForeground": "#6e6e6e",
  "svnTools.unversionedForeground": "#4ec9b0"
}
```

색상 ID: `svnTools.modifiedForeground`(수정·교체), `svnTools.addedForeground`, `svnTools.deletedForeground`(삭제·누락),
`svnTools.conflictedForeground`, `svnTools.unversionedForeground`, `svnTools.ignoredForeground`.

---

## 설정

### 언어
`svnTools.language` 하나로 전체를 바꾸고, 필요하면 영역별로 따로 고릅니다. 영역별 설정의 기본값은 "전체 언어를 따름"입니다.

| 설정 | 기본값 | 적용되는 곳 |
|---|---|---|
| `svnTools.language` | `en` | 전체 (`en` / `ko`) |
| `svnTools.menuLanguage` | 전체를 따름 | 우클릭 메뉴, 명령 팔레트 |
| `svnTools.scmLanguage` | 전체를 따름 | Source Control 패널(그룹 이름, 버튼), SVN 이력 칸 |
| `svnTools.messageLanguage` | 전체를 따름 | 알림, 확인 창, 무시 목록 화면, 커밋 탭(우클릭 메뉴 포함), 탐색기 툴팁 |

### 그 밖의 설정
| 설정 | 기본값 | 설명 |
|---|---|---|
| `svnTools.commit.checkOutOfDate` | `true` | 커밋 전에 서버에 더 새 버전이 있는지 확인 |
| `svnTools.rename.askOnRename` | `true` | 탐색기에서 이름을 바꾸면 SVN 이름 바꾸기로 적용할지 묻기 |
| `svnTools.history.autoRefresh` | `true` | SVN 이력 칸이 보이고 창이 앞에 있을 때 새 커밋을 주기적으로 확인 |
| `svnTools.history.autoRefreshMinutes` | `5` | 위 자동 확인 간격(분, 최소 1) |
| `svnTools.scm.fadeUnversioned` | `true` | 패널에서 미등록 파일을 흐리게 |
| `svnTools.decorations.enabled` | `true` | 탐색기 상태 표시 |
| `svnTools.svnPath` | (비움) | `svn.exe` 경로. 비우거나 없는 경로면 PATH → TortoiseSVN 폴더 → SlikSVN 폴더 → 시스템 PATH 순서로 찾음 |
| `svnTools.tortoiseProcPath` | (비움) | `TortoiseProc.exe` 경로. 비우면 기본 설치 위치 |

---

## 문제 해결

**Source Control 패널에 SVN이 안 나와요.**
연 폴더가 SVN 작업 사본(또는 그 안)인지 확인하세요. `svn`을 찾지 못해도 패널이 나타나지 않습니다 — 출력 창 "SVN Tools"의
첫 줄 `svn: …`에서 어느 svn을 쓰는지(또는 `not found`) 볼 수 있습니다. 설치는 위 [시작하기](#시작하기)를 보세요.
폴더를 열 때 "신뢰하지 않음"을 골랐으면(제한 모드) 이 확장은 동작하지 않습니다.

**우클릭 메뉴가 두 벌로 보이거나 패널이 두 개예요.**
다른 SVN 확장이 켜져 있는 것입니다. 그 확장을 꺼 주세요.

**1.x에서 쓰던 스테이징(Staged Changes)이 없어졌어요.**
2.0.0부터 스테이징을 없애고 커밋 탭에서 올릴 항목을 고르게 바꿨습니다. 1.x에서 스테이징해 둔 목록은 쓰지 않습니다.
설정 `svnTools.commit.review`·`svnTools.commit.smartCommit`도 없어졌습니다.

**폴더에 `!` 배지가 붙고 커밋이 안 돼요.**
Update가 중간에 끊겨(네트워크, 강제 종료) 그 폴더를 다 받지 못한 상태입니다. 아직 못 받은 파일이 사라진 것처럼 보여서 커밋을
막습니다. **Update**를 다시 하면 풀립니다. "작업 사본이 잠겨 있다"고 나오면 **Clean Up** 후 Update 하세요.

**"나눠서 진행하세요"라고 나와요.**
윈도우 명령줄은 길이 제한(약 32,000자)이 있어서, 한 번에 넘기는 파일이 수백 개를 넘으면 svn을 실행할 수 없습니다.
폴더 단위로 나눠서 추가·커밋하세요.

**밖에서(TortoiseSVN 등) 바꾼 것이 늦게 보여요.**
VS Code 창으로 돌아오면 새로고침합니다. 바로 보려면 패널의 Refresh를 누르세요.

**알아 둘 점**
- 작업 사본 루트가 연 폴더보다 위에 있어도 패널과 표시는 **연 폴더 안**만 다룹니다. Clean Up만 작업 사본 전체에서 돕니다.
- 무시된 폴더 안의 변경(로그 등)은 새로고침을 일으키지 않습니다.

---

## 테스트한 환경
아래 환경에서 개발·확인했습니다(2026-10). 다른 버전에서도 동작할 수 있지만 확인하지 않았습니다.

| 항목 | 버전 |
|---|---|
| Windows | 10 Pro 22H2 (빌드 19045) |
| VS Code | 1.141.1 (최소 요구: 1.80) |
| Subversion 명령줄 클라이언트 | 1.14.5 (TortoiseSVN에 포함된 `svn.exe`) |
| TortoiseSVN | 1.14.9 |

## 요청과 기여
- **기능 요청·버그 신고**: [GitHub 이슈](https://github.com/pugi-kh/vscode-svn-tools/issues)
  - 문제가 생긴 화면을 **캡처해서 함께 올려 주세요.** 어떤 메뉴를 눌렀고 어떤 알림·오류가 떴는지 화면으로 보이면 상황을 훨씬 정확히 알 수 있습니다.
  - 가능하면 다음도 적어 주세요: 무엇을 했는지(순서대로), 기대한 결과와 실제 결과, 출력 창 **SVN Tools**의 내용
    (보기 → 출력 → 오른쪽 목록에서 SVN Tools), 확장·VS Code·svn 버전.
  - 이슈는 공개됩니다. 캡처와 로그에 회사 이름, 서버 주소, 내부 프로젝트 경로처럼 드러나면 안 되는 정보가 있으면 가린 뒤 올려 주세요.
- **직접 고쳐서 보내기**: 저장소를 fork해서 고친 뒤 Pull Request를 보냅니다. 보낸 수정은 이 저장소와 같은 MIT 라이선스로 들어옵니다.
  개발 방법은 아래 [개발](#개발)을 보세요.

## 개발
외부 패키지가 없어서 `npm install` 없이 Node.js(v20에서 확인)만 있으면 됩니다. 처음 빌드할 때 `npx`가 패키징 도구
`@vscode/vsce`를 받습니다.

```
npm test                 # 한글·공백 경로 회귀 검사 + 메뉴·메시지·웹뷰 검사
npm run install-vscode   # 빌드하고 VS Code에 설치(Insiders는 node install.js --insiders)
npm run package          # .vsix만 만들기
```

설치 뒤 **Developer: Reload Window**를 해야 새 버전이 적용됩니다.

- **`package.json`은 직접 고치지 않습니다.** `manifest.js`가 만듭니다. 명령·메뉴·설정·버전은 `manifest.js`에서 고칩니다.
- 고치기 전에 **`CLAUDE.md`**를 먼저 보세요. 한글 경로·인코딩 등 실제로 겪은 함정, 설계 이유, 파일 구조, 명령 추가 절차가 있습니다.
- 메뉴 이름(한/영)은 `manifest.js`, 알림·화면 문구(한/영)는 `src/i18n.js`에 있습니다.

## 라이선스와 출처
**라이선스**: [MIT](LICENSE), Copyright (c) 2026 Kihoon Kwon (권기훈). 누구나 쓰고 고치고 배포할 수 있습니다.
가져다 쓸 때는 저작권 표시와 MIT 문구(`LICENSE`)를 남겨 주세요.

**다른 SVN 확장의 코드는 쓰지 않았습니다.** 모든 코드는 VS Code 공개 API로 새로 작성했습니다.

| 대상 | 관계 | 라이선스·비고 |
|---|---|---|
| Apache Subversion (`svn`) | 설치된 명령줄 클라이언트를 별도 프로세스로 실행합니다. 포함하지 않습니다 | Apache License 2.0 |
| svn 기본 무시 목록 | `src/ignore.js`의 `SVN_DEFAULT_GLOBAL_IGNORES`는 Subversion 1.14 기본 클라이언트 설정의 `global-ignores` 값입니다 | Apache License 2.0, © The Apache Software Foundation |
| TortoiseSVN | 설치된 `TortoiseProc.exe`를 별도 프로세스로 실행합니다. 포함하거나 연결하지 않습니다 | GPL. 사용자가 따로 설치합니다 |
| VS Code 아이콘(`$(check)` 등) | VS Code 내장 아이콘을 API로 참조할 뿐 파일을 포함하지 않습니다 | — |
| `@vscode/vsce` | `.vsix`를 만들 때만 씁니다. 결과물에 들어가지 않습니다 | MIT |

**상표**: Apache Subversion, Subversion, SVN은 The Apache Software Foundation의 상표입니다. TortoiseSVN은 TortoiseSVN 프로젝트의
이름입니다. 이 확장은 두 프로젝트와 관계없는 비공식 도구이며, 이름은 무엇과 함께 쓰는 도구인지 설명하려고 씁니다.
