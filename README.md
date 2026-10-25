# SVN Tools

VS Code에서 SVN을 쓰기 위한 확장. Source Control 패널, 탐색기 우클릭 메뉴(SVN / TortoiseSVN),
탐색기 상태 표시(무시된 파일 회색 포함)를 한 확장으로 제공한다.

- ID: `khoon.vscode-svn-tools`
- 언어: `svnTools.language`(전체, 기본 영어)로 한 번에 바꾸고, 필요하면 영역별로 따로 고른다 — 우클릭 메뉴
  (`svnTools.menuLanguage`), Source Control 패널(`svnTools.scmLanguage`), 알림·확인 창·화면(`svnTools.messageLanguage`).
  영역별 설정의 기본값은 "전체 언어를 따름"이다. 설정 화면의 "Language / 언어" 묶음에 전체 → 영역별 순서로 있고, 각 설명에 그 언어가 쓰이는 곳을 적어 두었다.
  이 문서는 메뉴를 영어 이름으로 적는다.
- 필요: SVN 명령줄 클라이언트(`svn`). PATH에 없으면 TortoiseSVN에 딸린 `svn.exe`를 쓴다.
  TortoiseSVN 메뉴를 쓰려면 TortoiseSVN이 설치돼 있어야 한다.

## 기능

### 스테이징 (git 방식)
svn에는 스테이징이 없어서 이 확장이 "다음 커밋에 넣을 항목"을 기억한다. VS Code를 다시 켜도 유지되지만 TortoiseSVN·명령줄에서는
보이지 않는다. **패널의 Commit(✓)은 스테이징된 것만 커밋한다.**

| 항목 상태 | 스테이징(`+`, SVN Add / SVN Stage) | 스테이징 취소(`−`, SVN Unstage) |
|---|---|---|
| 미등록(새 파일) | `svn add` 후 스테이징 | add도 취소(`svn revert`, 파일은 남음) → 다시 미등록 |
| 추가됨(A, 다른 도구로 add한 것 포함) | **add = 스테이징**이라 처음부터 스테이징돼 있다 | add 취소 → 다시 미등록. 새 폴더면 안의 add도 함께 취소 |
| 수정·삭제·속성 변경 | 스테이징만 | 스테이징만 취소(변경은 그대로) |
| 이동·복사된 항목(A +) | 스테이징만. 이동이면 **반대쪽(원래 위치의 삭제)도 함께** | 스테이징만 취소(파일은 그대로) |
| 누락(파일이 사라짐) | `svn delete` 후 스테이징 | 스테이징만 취소 |

- 폴더를 스테이징할 때는 **Include Contents / Exclude Contents**(하위 항목 포함 / 제외)를 고른다. 관리 중인 폴더를 하위 포함으로
  고르면 그 안의 새 파일도 추가된다(git의 `git add 폴더`와 같다). 무시 규칙에 걸린 항목, Keep Local File로 삭제 예약한 항목,
  충돌 때 생긴 부산물(`파일.mine`, `파일.r12` 등)은 빠진다.
- svn은 이동(이름 바꾸기)의 양쪽을 한 커밋에 요구한다. 스테이징·커밋·되돌리기는 이동의 반대쪽을 자동으로 함께 다룬다.
- 스테이징하는 항목의 **상위 폴더가 새 폴더인데 스테이징되지 않았으면** 안내 창을 띄운다. 승인하면 각 상위 폴더 **자신만**
  함께 스테이징한다(svn은 상위 새 폴더가 함께 커밋되지 않으면 그 안의 항목을 올리지 못한다).
- 커밋은 스테이징된 경로만 `--depth empty`로 정확히 넘긴다. 같은 새 폴더 안의 다른 파일이 딸려 가지 않는다.
- 스테이징이 비었는데 Commit을 누르면 "변경사항을 모두 스테이징할까요?"라고 묻는다([모두 스테이징] [항상] [다시 묻지 않음],
  설정 `svnTools.commit.smartCommit`). 스테이징한 뒤 커밋을 이어서 한다(미등록 항목 제외).
- **커밋 확인 탭**(설정 `svnTools.commit.review`, 기본 사용): 커밋 직전에 메시지와 올라갈 항목을 탭으로 한 번 더 보여 준다.
  메시지를 고칠 수 있고(패널 입력칸과 같이 바뀐다), 항목 체크를 끄면 이번 커밋에서만 빠진다(스테이징은 그대로). 새 상위 폴더와
  이동의 반대쪽은 svn이 함께 올리라고 요구해서 잠겨 있고, 이동 양쪽은 같이 켜지고 꺼진다. 수정 파일은 [비교]로 바로 본다.
  Ctrl+Enter로 커밋, 취소하면 아무것도 바뀌지 않는다. [커밋]을 누르면 상태를 다시 읽어 확인한다 — 탭을 연 사이 스테이징이나 작업
  사본이 바뀌었으면 목록을 새로 보여 주고, 끈 항목이 남은 항목과 함께 올라가야 하면 이유를 보여 준다. 끄면 예전처럼 메시지 입력 → 확인 창 순서다. 탐색기 SVN ▸ Commit…도 같은 탭을 쓴다.
- 변경이 하나도 없으면 Commit을 눌러도 확인 창 없이 "커밋할 변경이 없습니다"라고만 알린다. 충돌 상태인 항목은 svn이 커밋을
  거부하므로 [충돌 해결…] 버튼이 있는 알림을 띄운다. Update가 중간에 끊긴 폴더(아래)가 있으면 커밋하지 않는다.
- 탐색기에서 스테이징된 항목은 이니셜·색은 그대로이고 배지 뒤에 `+`가 붙는다(`M` → `M+`, `A` → `A+`).

### 탐색기에서 이름을 바꿨을 때
F2 등으로 관리 중인 파일·폴더의 이름을 svn 없이 바꾸면 "SVN 이름 바꾸기로 적용할까요?"를 묻는다(설정
`svnTools.rename.askOnRename`). 적용하면 원래 이름으로 되돌린 뒤 `svn move`해서 이력이 이어진다(TortoiseSVN의 Repair Move와 같다).
알림은 작업을 막지 않는 방식이고 버튼은 [SVN에 적용] [이름 되돌리기] [다시 묻지 않음]이다. 실수로 바꿨으면 [이름 되돌리기]로
원래 이름으로 돌린다(열린 편집기 탭도 따라간다). 알림을 닫았으면 그 항목을 우클릭했을 때 맨 위에 **SVN Apply Rename**이 뜨고
(적용 / 되돌리기), SVN Add·`+`를 누르면 새 파일로 추가할지 이름 바꾸기로 적용할지 묻는다. "옛 이름 → 새 이름" 기록은 VS Code를
다시 켜도 남고, 적용 전에 또 바꾸면(A→B→C) 처음 이름에 이어 붙는다. [다시 묻지 않음]은 설정 `svnTools.rename.askOnRename`을 끈다
(꺼도 기록과 SVN Apply Rename은 그대로). VS Code 밖(윈도우 탐색기 등)에서 바꾼 이름은 알 수 없어 기록되지 않는다. 대소문자만 바꾼 경우는 svn 명령줄이
지원하지 않아 다루지 않는다(TortoiseSVN ▸ Rename을 쓴다).

### Update가 중간에 끊긴 폴더
네트워크가 끊기거나 Update를 강제로 멈추면 svn은 그 폴더를 "덜 받음(incomplete)"으로 표시한다. 아직 못 받은 파일이 누락처럼
보이므로, 이 확장은 이런 폴더를 Changes에 `!` 배지로만 보이고 스테이징·커밋에서 뺀다. Update를 다시 하면 풀린다
(작업 사본이 잠겨 있다고 나오면 Clean Up 먼저).

### Source Control 패널
- 그룹: **Staged Changes / Changes / Unversioned / Conflicts**(패널 언어가 한국어면 스테이징된 변경 / 변경 / 미등록 / 충돌).
  파일을 누르면 BASE와 비교한다.
- 메시지 입력 → Commit(✓ 또는 Ctrl+Enter). 위쪽 버튼: Commit, Update, Refresh. `…`에 Show Log, Clean Up, Edit Ignore Lists…,
  TortoiseSVN 메뉴.
- 파일 옆 버튼: Open File, Revert, `+`(스테이징) / `−`(스테이징 취소). 여러 개를 고르고 `+`·`−` 하나로 한꺼번에.
- 그룹 옆 버튼: Stage All / Unstage All / Revert All. Revert All은 나열된 항목 각자만 되돌린다(속성만 바뀐 폴더를 되돌려도 그
  아래 스테이징된 수정은 남는다). 추가·삭제된 폴더는 svn이 폴더째로만 되돌릴 수 있어서, 그 아래 스테이징된 항목이 있으면 확인 창에 알린다.
- 편집기 줄 번호 옆에 바뀐 줄 표시(BASE 기준).

### 탐색기 우클릭
**항목 상태에 맞는 것만** 바로 보인다. 나머지는 **SVN**, **TortoiseSVN** 하위 메뉴에 있다.

| 메뉴 | 언제 보이나 | 동작 |
|---|---|---|
| SVN Apply Rename | svn 없이 이름을 바꾼 항목 | 기록해 둔 "옛 이름 → 새 이름"을 확인 후 SVN 이름 바꾸기로 적용 |
| SVN Update | 항상 | 선택한 파일·폴더만 업데이트 |
| SVN Add | 새 파일 하나 | add 후 스테이징 |
| SVN Add ▸ Include / Exclude Contents | 새 폴더 하나 | 하위 항목 포함·제외를 골라 add 후 스테이징 |
| SVN Stage | 수정된 파일 하나 | 스테이징 |
| SVN Stage ▸ Include / Exclude Contents | 변경이나 새 항목이 있는 관리 폴더 하나, **또는 여러 개 선택** | 새 파일은 add, 관리 중인 파일은 스테이징으로 항목별로 나눠 처리 |
| SVN Unstage | 스테이징된 항목(또는 그런 항목을 품은 폴더) | 스테이징 취소(새로 add한 것은 add도 취소) |
| SVN Ignore… | 새 파일·폴더, 또는 여러 개 선택 | 이름·확장자·직접 입력 → 적용 범위(아래). 여러 개면 항목마다 패턴을 만들고 각 상위 폴더에 건다 |
| SVN ▸ Commit… | 항상 | **고른 것만 바로 커밋**(스테이징을 거치지 않음). 미등록·무시된 항목을 골랐으면 [추가해서 함께 커밋] [빼고 커밋]을 묻고, 새 상위 폴더가 있으면 각 폴더 자신만 함께 올린다 |
| SVN ▸ Compare with BASE | | 파일은 비교 화면, 폴더는 `svn diff` 결과 |
| SVN ▸ Compare with Revision… | | 맨 위 "리비전 직접 입력…"(숫자, `HEAD`·`PREV`·`BASE`·`COMMITTED`·`{날짜}`) 또는 최근 로그에서 골라 작업본과 비교 |
| SVN ▸ Show Log | | 이력 목록 → 리비전을 고르면 작업본과 비교 / 그 리비전의 변경 보기 / 바뀐 파일 목록 / 메시지 복사 |
| SVN ▸ Delete ▸ | | Keep Local File / Delete Local File Too |
| SVN ▸ Rename (keep history) | | `svn move`라 이력이 이어진다 |
| SVN ▸ Revert | | 확인 후 되돌린다(복구 불가). 이동이면 반대쪽도 함께 |
| SVN ▸ Resolve Conflict… | | 지금 파일 그대로 / 내 것 / 서버 것 / 충돌 부분만 내 것·서버 것 / TortoiseSVN 충돌 편집기 |
| SVN ▸ Show Ignore Reason… | | 어떤 규칙(패턴) 때문에 무시되는지 카드로 보여 주고, 고칠 수 있는 규칙은 그 자리에서 지운다(아래) |
| SVN ▸ Edit Ignore Lists… | | 무시 목록 편집 화면(아래) |
| SVN ▸ Clean Up / Copy SVN URL | | 작업 사본 정리 / 저장소 주소 복사 |

메뉴 조건은 우클릭한 항목 하나만 본다. 그래서 여러 개를 고르면 상태와 상관없이 SVN Stage ▸가 보이고, 누른 뒤 항목별로 나눠 처리한다.
편집기 탭 우클릭에도 같은 메뉴가 있다.

**명령 팔레트**에는 고른 항목 없이도 뜻이 있는 명령만 있다: SVN: Commit(패널 Commit과 같이 스테이징된 것), SVN Update,
SVN Stage / SVN Unstage(열린 파일), SVN: Stage All / Unstage All, Compare, Show Log, Revert, Edit Ignore Lists…, Clean Up,
TortoiseSVN 명령. 작업 폴더가 여럿이면 어느 것인지 고른다.

**한 번에 너무 많은 경로**: 윈도우 명령줄은 약 32,000자까지라, 경로를 하나하나 넘기는 작업(정확한 커밋, 여러 항목 스테이징 등)에서
항목이 수백 개를 넘으면 "나눠서 진행하세요"라고 안내한다. 파일 하나의 경로가 긴 것은 문제가 아니다.

**무시 목록 적용 범위**

| 종류 | 범위 | 공유 |
|---|---|---|
| `svn:ignore` | 그 폴더의 바로 아래 항목만 | 커밋하면 공유 |
| `svn:global-ignores` | 그 폴더와 아래 모든 폴더 | 커밋하면 공유 |
| 내 PC 전역 | 이 PC의 모든 svn 클라이언트(명령줄, TortoiseSVN 포함) | 공유 안 됨 |

**패턴 작성법**: `*` 여러 글자, `?` 한 글자, `[abc]` 괄호 안 한 글자, `[!abc]` 괄호 안 글자를 제외한 한 글자.
정규식이 아니다(예: `.*`는 "점으로 시작하는 이름"). 대소문자를 구분한다. **공백은 `svn:ignore`에서만 쓸 수 있다** — svn:ignore는
한 줄에 패턴 하나라 `my file`도 그대로 저장되지만, `svn:global-ignores`와 내 PC 전역 목록은 공백으로 패턴을 나눠서 공백이 든
이름은 `?`로 맞춘다(`my?file`은 `my file`에 맞음). SVN Ignore…에서 이름을 고르면 적용 범위에 맞게 알아서 바꾸고, 직접 입력한
패턴에 공백이 있는데 global-ignores를 고르면 `?`로 바꿔 넣을지 묻는다. 무시 목록 편집 화면도 카드 종류에 따라 막고 이유를 보여 준다.

**내 PC 전역 목록**은 svn 명령이 아니라 설정을 직접 고친다. svn은 아래 순서로 찾아 **처음 값이 있는 곳 하나만** 쓴다.
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
내 PC 전역 목록을 svn과 같은 방식으로 맞춰 본다.

- 무시된 폴더 안의 파일이면 그 폴더가 대상이다(예: `logs/a.log` → `logs`). 화면 위에 그렇게 표시한다.
- **규칙마다 카드 하나**: 종류와 위치, 패턴, 어떤 설정인지 한 줄 설명.
- 고칠 수 있는 카드에만 **[패턴 삭제]**. 누르면 확인 창에 **같은 패턴으로 무시되던 다른 항목**을 보여 준 뒤 지운다.
  삭제할 수 있는 규칙이 둘 이상이면 위에 **[삭제할 수 있는 패턴 모두 삭제]**.
- 내 PC 전역 카드에는 **[TortoiseSVN 설정 열기]**.
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
- **내 PC 전역**: 지금 쓰이는 값과 출처, 저장하면 쓰는 곳을 표시한다. [TortoiseSVN 설정 열기] 버튼이 있다.

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
| `svnTools.language` | `en` | 전체 언어 (`en` / `ko`) |
| `svnTools.menuLanguage` | `default` | 우클릭 메뉴·명령 팔레트 언어 (`default` = 전체를 따름 / `en` / `ko`) |
| `svnTools.scmLanguage` | `default` | Source Control 패널(그룹 이름·버튼·입력칸 안내) 언어 |
| `svnTools.messageLanguage` | `default` | 알림·확인 창·화면·탐색기 툴팁 언어 |
| `svnTools.commit.review` | `true` | 커밋 확인 탭 사용 |
| `svnTools.commit.smartCommit` | `ask` | 스테이징이 비었을 때 Commit: `ask` 물어봄 / `always` 모두 스테이징하고 커밋 / `never` 커밋 안 함 |
| `svnTools.commit.checkOutOfDate` | `true` | 커밋 전 서버 변경 확인 |
| `svnTools.rename.askOnRename` | `true` | 이름 바꾸기 알림 사용(탐색기에서 관리 중인 항목 이름을 바꾸면 SVN 이름 바꾸기로 적용할지 묻기) |
| `svnTools.scm.fadeUnversioned` | `true` | Source Control 패널에서 미등록 파일을 흐리게 |
| `svnTools.decorations.enabled` | `true` | 탐색기 상태 표시. 설명에 **무시 목록 편집 열기** 링크가 있다 |
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
npm run install-vscode                               # 아래 두 줄을 한 번에(빌드 + 설치). Insiders는 node install.js --insiders
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
| `install.js` | 빌드 + VS Code 설치 (`npm run install-vscode`) |
| `src/extension.js` | 시작, 작업 사본 찾기, 명령 등록, 이전 버전 내용 제공 |
| `src/repository.js` | 작업 폴더 하나의 상태와 Source Control 패널 |
| `src/commands.js` | 명령 처리 |
| `src/decorations.js` | 탐색기 표시 |
| `src/svn.js` | svn 실행과 XML 해석 |
| `src/ignore.js` | 무시 패턴 읽기·쓰기 |
| `src/ignoreView.js` | 무시 목록 편집 화면(웹뷰) |
| `src/reasonView.js` | 무시된 원인 화면(웹뷰) |
| `src/commitView.js` | 커밋 확인 탭 |
| `src/tortoise.js` | TortoiseSVN 창 열기 |
| `src/i18n.js` | 메시지 한글/영어 |
| `src/languages.js` | 메뉴 언어 목록(`en`, `ko`) |
| `test/svn-paths.js` | 한글·공백 경로 회귀 검사 (`npm test`) |
| `test/manifest-check.js` | 메뉴 구조·메시지 키·웹뷰 스크립트 검사 (`npm test`) |

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
