# OTA 업데이트 — 계획

앱을 업데이트할 때마다 디자이너가 dmg를 새로 받아 설치해야 한다. 자주 바뀌는 것(에이전트 규칙·스킬·엔진·도구·UI)은
실행 파일과 따로 받아 오게 해서, 대부분의 업데이트가 앱을 다시 열기만 하면 반영되게 한다.

## 정한 것

| 항목 | 결정 |
|---|---|
| 1단계 | **콘텐츠 OTA** + **새 버전 안내**. Apple 계정 없이 지금 할 수 있다 |
| 2단계 | Developer ID 서명·공증이 생기면 electron-updater로 **앱 전체 자동 업데이트**. 1단계는 빠른 업데이트용으로 그대로 둔다 |
| 받는 곳 | GitHub Releases (`kimtaeho-dev/motion-studio`). 별도 서버를 두지 않는다 |
| 무결성 | ed25519 서명. 공개키는 앱 실행 파일에 박고, 개인키는 GitHub Actions 시크릿에만 둔다 |
| 실패하면 | 언제나 앱 번들에 든 내용물로 돌아간다. 네트워크가 없거나 검증에 실패해도 앱은 지금처럼 뜬다 |
| 필름 | 콘텐츠 OTA는 `films/`·`out/`·`.mailbox`를 건드리지 않는다. 전달한 필름은 `tools/engine.mjs` 고정으로 결과가 그대로다 |

## 왜 두 단계인가

- `package.json`의 `"identity": null` + `scripts/after-pack.cjs`의 ad-hoc 서명으로 배포한다.
- Squirrel.Mac(electron-updater의 맥 구현)은 새 앱이 기존 앱과 **같은 Developer ID로 서명됐는지** 확인한다.
  ad-hoc 서명은 빌드마다 달라서 이 검사를 통과하지 못한다. 앱 전체 자동 업데이트에는 Apple Developer Program(연 $99)이 필요하다.
- 그런데 업데이트의 큰 부분은 실행 파일이 아니다. `server/workspace.ts`의 `seedWorkspace`가 이미
  **실행할 때마다** `AGENT_ASSETS`(`CLAUDE.md`, `.claude/skills`, `prompts`, `lib`, `tools`, `assets`, `examples`,
  `films/_template*`)를 번들의 `Resources/seed`에서 작업공간으로 새로 복사하고, UI는 `Resources/dist`에서 읽는다
  (`electron/main.ts`의 `seedRoot()`·`distRoot()`). 출처만 바꾸면 OTA가 된다.

## 무엇이 OTA로 되고 무엇이 안 되나

| 바뀐 곳 | 들어 있는 곳 | OTA |
|---|---|---|
| `CLAUDE.md`, `.claude/skills`, `prompts/` | `Resources/seed` | 된다 |
| `lib/`(엔진), `tools/`, `examples/`, `assets/`, `films/_template*` | `Resources/seed` | 된다 |
| UI (`src/` → `dist/`) | `Resources/dist` | 된다 — 단 셸의 API와 맞아야 한다(아래 `shell` 호환) |
| `server/`, `electron/` | `app.asar`의 `dist-electron/main.cjs`(esbuild 번들) | **안 된다** → 새 버전 안내 |
| ffmpeg, Electron 버전, `package.json` build 설정 | 실행 파일 | **안 된다** → 새 버전 안내 |

0.6.0 → 0.6.1 사이만 봐도 `server/` 6개, `electron/` 3개 파일이 바뀌었다. 셸 업데이트는 계속 있으니
"새 버전 안내"가 1단계에 함께 들어가야 한다.

## 1단계 설계

### 묶음(content bundle)

릴리스 때 CI가 만든다.

```
content-<contentVersion>.tar.gz
  seed/   CLAUDE.md .claude/skills prompts lib tools assets examples films/_template films/_template-lottie
  dist/   vite 빌드 결과
content-<contentVersion>.json   # 매니페스트
content-<contentVersion>.json.sig  # 매니페스트의 ed25519 서명 (base64)
```

매니페스트:

```json
{
  "contentVersion": "0.6.1+3",
  "appVersion": "0.6.1",
  "shell": 4,
  "minShell": 4,
  "sha256": "<tar.gz의 sha256>",
  "size": 12345678,
  "url": "https://github.com/kimtaeho-dev/motion-studio/releases/download/content-0.6.1+3/content-0.6.1+3.tar.gz",
  "notes": "한 줄 요약 (설정 창·업데이트 토스트에 보인다)",
  "createdAt": "2026-10-14T00:00:00Z"
}
```

- `shell`은 셸(서버 API·preload·렌더 워커)의 호환 번호다. `server/`·`electron/`이 UI나 seed와 맞물리는 방식을
  바꾸면 올린다. 셸 쪽은 `electron/main.ts`에 상수 `SHELL_API`로 박는다.
- 앱은 `minShell <= SHELL_API`인 묶음만 받는다. 아니면 콘텐츠는 그대로 두고 "새 버전이 있어요" 안내만 한다.
- 최신 묶음을 찾는 고정 주소: 릴리스 태그 `content-latest`에 `latest.json`(+`.sig`)을 덮어써서 가리킨다
  (`https://github.com/kimtaeho-dev/motion-studio/releases/download/content-latest/latest.json`).
  latest.json = 위 매니페스트 그대로. 셸 업데이트 안내용으로 `latestApp: { version, url }`도 넣는다.

### 앱 쪽 흐름 (`electron/ota.ts` 새 파일)

```
boot()
  └ contentRoot = pickContent()          # 동기, 네트워크 없음
      ├ ~/Library/Application Support/Motion Studio/content/current → <버전 폴더>
      ├ 폴더의 manifest.json 서명 재검증 + minShell 확인 + 완료 표시(.ok) 확인
      └ 하나라도 실패하면 번들(Resources/seed, Resources/dist)
  ├ seedWorkspace(contentRoot.seed, workspace)
  ├ startStudioServer({ distDir: contentRoot.dist, ... })
  └ 창이 뜬 뒤 백그라운드로 checkForContent()
        ├ latest.json + .sig 받기 → 공개키로 검증
        ├ 지금보다 새것이고 minShell 맞으면 tar.gz 받기 → sha256 확인
        ├ content/<버전>.partial/ 에 풀기 → .ok 쓰기 → content/<버전>/ 로 rename
        ├ current 포인터 교체(원자적: 임시 파일 쓰고 rename), 이전 1개만 남기고 지운다
        └ UI에 알림: "업데이트를 받았어요. 다시 열면 적용돼요" [지금 다시 열기]
```

- **적용 시점은 다음 실행.** 실행 중에 `lib/`·`tools/`를 바꾸면 돌고 있는 에이전트·렌더와 어긋난다.
  "지금 다시 열기"는 에이전트가 일하는 중이면 숨긴다(작업이 끝나면 보인다).
- **되돌리기:** 새 콘텐츠로 뜬 직후 서버 시작이나 UI 첫 로드가 실패하면 `content/bad`에 버전을 적고
  이전 버전(없으면 번들)으로 다시 띄운다. `bad`에 있는 버전은 다시 받지 않는다.
- **번들이 더 새로우면 번들.** 디자이너가 dmg로 새 버전을 깔면 그 안의 콘텐츠가 받아 둔 것보다 새로울 수 있다.
  `contentVersion`을 비교해서 더 새로운 쪽을 쓴다. 번들에도 같은 형식의 `manifest.json`을 넣는다(빌드 때 생성).
- 확인 주기: 실행할 때 1번 + 열려 있으면 6시간마다. 설정 창에 "업데이트 확인" 버튼.
- 네트워크: Electron `net`(시스템 프록시를 따른다). 타임아웃 넉넉히, 실패는 조용히 로그만.
- 서명 검증: Node `crypto.verify(null, data, publicKey, sig)`(ed25519). 의존성을 늘리지 않는다.
- 압축 풀기: 의존성 없이 하려면 시스템 `/usr/bin/tar`를 쓴다(맥에 늘 있다). 풀기 전에 항목 경로에
  `..`·절대 경로·심볼릭 링크가 없는지 목록(`tar -tzf`)으로 먼저 본다.

### 보안 — 반드시 지킬 것

- 받은 `tools/`·`lib/`은 **에이전트가 실행하는 코드**다. 서명 확인 없이 적용하면 원격 코드 실행 통로가 된다.
- 서명은 매니페스트에, 매니페스트가 tar.gz의 sha256을 담는다. 둘 다 맞아야 적용한다.
- `pickContent()`도 실행할 때마다 디스크의 매니페스트 서명과 `.ok`를 다시 본다(받은 뒤 누가 고쳤을 경우).
  tar.gz 전체 해시까지 매번 보면 느리니, 풀 때 파일 목록+해시를 `files.sha256`로 남기고 그 파일만 서명 범위에 넣는 방안도 검토.
- 다운그레이드 막기: `contentVersion`이 지금보다 낮은 매니페스트는 서명이 맞아도 버린다.
- 개인키는 GitHub Actions 시크릿 `OTA_SIGNING_KEY`에만. 공개키는 `electron/ota-key.ts`에 상수로.
  키를 바꿔야 하면 셸 업데이트(새 dmg)로만 바꾼다.

### 셸 업데이트 안내

- `latest.json`의 `latestApp.version`이 `app.getVersion()`보다 높으면 설정 창과 사이드바 아래에 표시:
  "새 버전 0.7.0이 있어요 · 다운로드" → 릴리스 페이지(또는 아키텍처에 맞는 dmg)를 기본 브라우저로 연다.
- `minShell`이 맞지 않아 콘텐츠를 못 받는 경우에도 같은 안내를 쓴다(이유: "이번 업데이트는 앱을 새로 받아야 해요").

### UI

- 설정 창(⚙): "콘텐츠 버전 0.6.1+3 · 앱 0.6.1", "업데이트 확인", 최근 업데이트 한 줄(`notes`).
- 토스트: 받기 완료 시 1번. 셸 새 버전은 토스트 없이 설정 창·사이드바 점으로만(매번 띄우면 시끄럽다).

### 릴리스 워크플로 (`.github/workflows/content.yml`)

- 트리거: `workflow_dispatch`(수동) + 태그 `content-*` 푸시. 콘텐츠만 바뀐 릴리스는 이걸로, 셸이 바뀌면 지금처럼 dmg 릴리스 + 콘텐츠 릴리스 둘 다.
- 단계: `npm ci` → `npm run build`(dist) → 묶음 만들기(`scripts/pack-content.mjs` 새 파일, `package.json`의
  `extraResources` 목록과 같은 목록을 쓴다 — 한 곳에서 읽게 해서 어긋나지 않게) → 서명 → Release 업로드 →
  `content-latest`의 `latest.json` 교체.
- 맥 러너가 필요 없다(ffmpeg·서명 없음). ubuntu에서 돈다.
- 검사: 묶음을 임시 작업공간에 풀어 `node tools/render.mjs examples/sample-morph --check` 같은 스모크를
  돌릴 수 있으면 돌린다(브라우저가 필요하면 다음 차례로).

### 버전 규칙

- `contentVersion = <appVersion>+<n>`. 셸 릴리스 때 `n=0`(dmg 안 번들과 같은 내용), 그 뒤 콘텐츠만 바뀌면 `+1, +2…`.
- `docs/RELEASE_NOTES.md`에 콘텐츠 릴리스도 한 줄씩 적는다.
- `SHELL_API`를 올리는 경우: 서버 HTTP/WebSocket API 모양, preload가 노출하는 함수, 렌더 워커 인자,
  `seedWorkspace`가 기대하는 폴더 구조가 바뀔 때. `docs/RELEASE_CHECK.md`에 체크 항목으로 넣는다.

## 할 일 (1단계)

1. [ ] `electron/ota.ts`: `pickContent()`, `checkForContent()`, 검증·풀기·포인터 교체·되돌리기
2. [ ] `electron/ota-key.ts`: 공개키 상수. 키 쌍 만들기는 `scripts/ota-keygen.mjs`(개인키는 출력만, 레포에 저장 안 함)
3. [ ] `electron/main.ts`: `seedRoot()`·`distRoot()`를 `pickContent()` 결과로, `SHELL_API` 상수, 첫 로드 실패 시 되돌리기
4. [ ] 번들에도 `manifest.json`(빌드 때 생성) — `scripts/pack-content.mjs`를 `dist:mac`에서도 불러 같은 매니페스트를 만든다
5. [ ] `scripts/pack-content.mjs`: 묶음·매니페스트·서명. 목록은 `package.json` `extraResources`의 seed 항목에서 읽는다
6. [ ] `.github/workflows/content.yml`: 빌드 → 묶음 → 서명 → Releases 업로드 → `content-latest` 갱신
7. [ ] 서버 API: `/api/update`(상태 조회, 확인 요청, 다시 열기) — `server/`에 추가하고 preload에 연결
8. [ ] UI: 설정 창의 버전·확인 버튼, 받기 완료 토스트, 새 셸 버전 표시
9. [ ] `docs/RELEASE_CHECK.md`: 콘텐츠 릴리스 순서, `SHELL_API` 올릴 때, 서명 키 관리
10. [ ] 점검: 오프라인 실행 / 서명 깨진 매니페스트 / sha 불일치 / 반쯤 풀린 폴더 / minShell 불일치 / 다운그레이드 시도 /
    새 콘텐츠로 서버 시작 실패 → 되돌리기 / dmg로 더 새 버전 설치 시 번들 우선 / 받는 중 앱 종료

## 2단계 (Apple Developer ID가 생기면)

1. `electron-builder` `mac.identity`, `hardenedRuntime`, `notarize` 설정. `after-pack.cjs`의 ad-hoc 서명은 걷어낸다
   (ffmpeg 아키텍처·서명 확인은 남긴다).
2. `mac.target`에 `zip` 추가(electron-updater는 맥에서 zip으로 업데이트), `publish: { provider: "github" }` → `latest-mac.yml`.
3. `electron-updater` 의존성, `electron/main.ts`에서 `autoUpdater.checkForUpdates()` → 받으면 "재시작해서 업데이트".
   1단계의 셸 안내를 이것으로 바꾼다.
4. `.github/workflows/release.yml`: macOS 러너에서 arm64·x64 빌드, 인증서·공증 자격은 시크릿으로.
5. 공증이 되면 "확인되지 않은 개발자" 경고와 `site/guide.html`의 우회 안내도 정리한다.

## 열린 질문

- 콘텐츠 릴리스를 main 푸시마다 자동으로 낼지, 수동(태그)으로만 낼지. → 기본은 수동 권장(디자이너 앱에 바로 간다)
- 베타 채널(`content-beta`)이 필요한지.
- `examples/`처럼 큰 폴더는 변경이 없을 때 다시 받지 않도록 폴더별 묶음/차분으로 나눌지 — 크기를 재 보고 정한다.
