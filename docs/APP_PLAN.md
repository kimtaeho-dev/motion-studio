# Motion Studio 앱 — 완성 모습과 계획

## 정한 것

| 항목 | 결정 |
|---|---|
| 형태 | 별도 앱 `Motion Studio.app`. lottie-studio의 셸(온보딩·채팅·작업공간)을 복사해 고친다 |
| 사용자 | 비개발자 디자이너. 터미널·코드·md 파일을 볼 일이 없다 |
| 작업 단계 | 브리프 → 숏리스트 → 스틸 → 초안 → 크리틱 → 전달을 화면에 표시. 승인이 필요한 곳에서 에이전트가 멈추고 사용자가 승인/수정 요청 |
| 크리틱 | 품질 단계 선택: 빠르게(1라운드) / 기본(3라운드) / 런칭용(전 항목 8점 이상까지) |
| 직접 편집 | 재생·스크럽·포맷 전환 + 속성 패널(텍스트·색·숫자) + 타임라인(장면 시각·효과음 cue 드래그, 비트에 스냅) |
| 내보내기 | MP4(H.264+사운드), GIF, 투명 배경(ProRes 4444 .mov / WebM), 포스터·컨택트 시트 PNG |
| 배포 | GitHub Releases, macOS arm64·x64 dmg, ad-hoc 서명 |
| 음악 비트 측정 | 제외. 트랙을 가져오면 BPM·첫 다운비트를 묻는다 (커밋 e5c8e56) |

## 완성된 앱의 모습

### 첫 실행
dmg → 앱 열기 → (Claude Code가 없거나 로그인 안 됐으면) 온보딩 화면에서 설치·로그인 →
`~/Library/Application Support/Motion Studio/workspace`에 작업공간 생성 → 메인 화면.
Node.js, Homebrew, Python, ffmpeg 어느 것도 사용자가 깔 필요 없다.

### 메인 화면
```
┌────────┬──────────────────────────────────┬──────────────────┐
│ 필름   │  플레이어 (포맷: 1x1 9x16 16x9)   │ 단계  ●●●○○○      │
│ 목록   │                                  │ [숏리스트 승인]   │
│        │                                  ├──────────────────┤
│  +     │                                  │ 속성 / 리뷰 탭    │
│        ├──────────────────────────────────┤  텍스트·색·숫자   │
│        │ ▶ 타임라인: 비트 그리드, 장면     │  숏리스트 표      │
│        │   마커, 효과음 cue (드래그)       │  컨택트 시트      │
│        │ 렌더 큐: 초안 9x16 ▓▓▓░ 62% [취소]│  크리틱 점수      │
│        │                                  ├──────────────────┤
│        │                                  │ 에이전트 채팅     │
│        │                                  │ (이미지·영상·음악 │
│        │                                  │  끌어다 놓기)     │
└────────┴──────────────────────────────────┴──────────────────┘
```

### 한 편을 만드는 흐름
1. **새 필름**: 이름, 포맷, 길이, 품질 단계를 고르고 채팅으로 원하는 걸 말한다. 레퍼런스와 음악은 끌어다 놓는다.
2. **브리프**: 에이전트가 빈칸을 질문하고 브리프를 채운다. 리뷰 탭에 요약이 보인다.
3. **숏리스트**: 비트별 표가 리뷰 탭에 뜨고 에이전트가 멈춘다. **승인** 또는 **수정 요청**.
4. **스틸 → 초안**: 컨택트 시트가 뜨고, 초안 렌더가 플레이어에서 재생된다.
5. **크리틱**: 품질 단계만큼 라운드를 돈다. 라운드별 점수표와 고친 점이 쌓인다.
6. **전달**: 내보내기 창에서 형식과 포맷을 골라 폴더나 zip으로 받는다.

중간 어디서든 사용자는 속성 패널과 타임라인을 직접 만질 수 있다. 바뀐 값은 즉시 플레이어에 반영되고, 에이전트는 다음 턴에 그 값을 보고 이어서 일한다.

## 핵심 설계

### 1. 필름 계약 확장: `film.json`
사용자가 만지는 값은 코드가 아니라 `films/<이름>/film.json`에 둔다. 앱은 이 파일만 고치고, 에이전트는 코드를 고친다.

```json
{
  "title": "sample-morph", "dur": 12, "bpm": 120, "beatOffset": 0,
  "formats": { "1x1": [1080, 1080], "9x16": [1080, 1920] }, "transparent": false,
  "params":   { "headline": { "type": "text", "value": "Ship faster", "label": "헤드라인" },
                "accent":   { "type": "color", "value": "#2F6BFF", "label": "포인트 컬러" } },
  "timeline": { "check": { "t": 2.5, "label": "체크로 모핑" } },
  "cues":     [{ "at": "check", "dt": 0.02, "type": "success" }, { "t": 1.0, "type": "click" }]
}
```
- 코드는 `Stage.film((film) => { ...; return { draw(g, t, S) {} }; })`. `film.P`·`film.T`로 상수와 표를 만든다. film.json이 바뀌면 이 함수가 다시 불린다.
- cue는 `at`(timeline 이름) + `dt`로 장면에 붙인다. 장면 시각을 옮기면 효과음이 따라온다. 타이핑처럼 규칙적인 반복만 코드에서 만들고, 앱 타임라인에서는 잠긴 cue로 보여 준다.
- `stage.js`가 로딩 때 `film.json`을 읽고 검사한다. 읽기만 하니 순수 함수 규칙은 그대로다. 형식이 틀리면 `window.LOAD_ERROR`에 항목별 문구가 남고 렌더러는 바로 실패한다.
- 앱 화면에서는 `Stage.reload(json)` 또는 `postMessage({ type: 'motion:film-json', json })`으로 새로고침 없이 다시 적용한다. 틀린 값은 거부하고 마지막 정상 상태를 유지한다.
- 필름은 http로 연다(file://에서는 film.json을 못 읽는다). `render.mjs`가 내장 서버를 띄운다.
- `transparent: true`면 `draw`가 배경을 칠하지 않고 렌더가 알파 채널을 보존한다.
- 샘플 필름 두 편과 `_template`을 이 계약으로 옮긴다.

### 2. 렌더 엔진: 앱 안의 Electron 숨김 창
- 필름을 숨김 창에 열고 `seek(t)` → 캔버스 픽셀(RGBA)을 그대로 읽어 ffmpeg에 rawvideo로 흘린다. 스크린샷이 아니라 캔버스를 직접 읽으므로 빠르고 알파가 보존된다.
- 모션블러(서브프레임 평균), 초안/최종, `--from/--to`, 스틸·컨택트 시트, 전 포맷 등 지금 `render.mjs` 기능은 그대로 유지한다.
- 앱 서버가 렌더 API(`POST /__render`, 진행률 스트림, 취소)를 연다. 렌더는 큐 하나로 돌고 UI에 진행률이 보인다.
- `tools/render.mjs`는 이 API를 부르는 얇은 클라이언트가 된다. 에이전트는 지금처럼 `node tools/render.mjs ...`를 쓰고, 실제 렌더는 앱이 한다. 그래서 사용자는 진행률을 보고 취소할 수 있다.
- 개발 중에는 `npm run app:dev`로 같은 엔진을 쓴다. Playwright는 제거한다.
- **검증**: 기존 Playwright 렌더와 새 엔진으로 같은 프레임을 뽑아 픽셀 비교, `determinism.sh`는 새 엔진으로 다시 쓴다.

### 3. 에이전트가 쓰는 도구를 앱이 제공
사용자 맥에는 node도 ffmpeg도 없다. 앱이 에이전트를 띄울 때 `PATH` 앞에 앱 안의 `bin/`을 붙인다.
- `node` → `ELECTRON_RUN_AS_NODE=1`로 앱 자신의 실행 파일을 Node로 쓰는 shim
- `ffmpeg`, `ffprobe` → 앱에 넣은 정적 빌드 (arm64/x64)
- `critique.sh`, `determinism.sh`는 Node로 옮긴다(`critique.mjs`). bash 의존과 셸 유틸 차이를 없앤다.

### 4. 단계와 승인
- 필름마다 `films/<이름>/state.json`: `{ "stage": "shotlist", "waiting": "approval", "quality": "standard", "round": 1 }`
- 에이전트가 단계를 넘길 때 이 파일을 쓴다(작업공간 `CLAUDE.md` 규칙). 앱은 파일을 지켜보고 단계 표시와 승인 버튼을 바꾼다.
- 승인 버튼은 채팅에 정해진 메시지("숏리스트 승인")를 보내는 것과 같다. 수정 요청은 입력칸으로 이어진다.
- 리뷰 탭은 `shotlist.md`·`review_log.md`·`contact-beats.png`·크리틱 이미지를 읽어 표와 이미지로 보여 준다. md 형식은 앱이 파싱할 수 있게 고정한다.

### 5. 작업공간 시드
앱에 넣어 작업공간에 복사하는 것: `CLAUDE.md`(앱용으로 고친 판), `.claude/skills/`, `prompts/`, `lib/`, `tools/`, `assets/fonts/`, `films/_template`.
앱용 `CLAUDE.md`는 디자이너에게 터미널·파일 경로를 말하지 않고, `state.json` 갱신과 승인 대기 규칙, 품질 단계별 크리틱 라운드 수를 담는다.
앱을 업데이트하면 `lib/`, `tools/`, 규칙 파일은 새 판으로 바꾸고 `films/`는 건드리지 않는다.

## 단계별 계획

각 단계는 끝났을 때 확인할 것(✓)이 있다. 다음 단계로 가기 전에 확인한다.

### 1단계 — 필름 계약 확장 (CLI에서) ✅ 완료
- `stage.js`가 `film.json`을 읽어 `params`·`timeline`·`cues`·`transparent`를 다루게 한다
- `sample-morph`, `_template`을 새 계약으로 옮기고 스킬·CLAUDE.md 갱신
- ✓ 샘플 필름이 바뀌기 전과 같은 프레임을 낸다 (기존 렌더 결과와 픽셀 비교)
- 결과: 샘플 필름 전 포맷 픽셀 일치, cue 목록 일치. 템플릿 렌더·투명 스틸(알파 0)·reload·오류 문구 확인

### 2단계 — 앱 셸 이식 ✅ 완료
- lottie-studio의 `electron/`(main, setup, onboarding, preload, server), `vite-plugins/`(claude-cli, mailbox, workspace)를 가져와 이름·경로·문구를 Motion Studio로 바꾼다
- Solid + Tailwind 프런트 골격, 필름 목록 + 플레이어(iframe에 필름 페이지, 앱 쪽 재생 컨트롤) + 채팅
- ✓ `npm run app`으로 열고 채팅으로 필름 하나를 만들어 플레이어에서 재생
- 결과: `server/`(films·mailbox·workspace·claude-cli)를 개발 서버와 Electron이 같이 쓴다. 플레이어는 iframe(`?embed=1`)에 앱 쪽 시계로 `seek(t)`, film.json 변경은 새로고침 없이 `Stage.reload`, 코드 변경은 시각·재생 상태를 유지한 채 다시 연다. 타임라인에 마디·비트·장면 마커·효과음, 포맷 전환, 단축키(Space, ←/→ 프레임, Shift+←/→ 비트, Home). 채팅은 필름별 세션, 이미지·영상·음악 첨부(refs/·audio/에 저장). Electron 앱이 작업공간을 시드하고 운영 서버로 같은 화면을 띄우는 것 확인
- 화면 배치는 위 "메인 화면" 그대로 잡았다. 지금 채워진 것: 단계 표시(파일로 추정 — 숏리스트·컨택트 시트·초안·검수 기록·완성본), 리뷰 탭(숏리스트 표·컨택트 시트·검수 이미지와 기록·브리프), 속성 탭(film.json 값과 장면 목록, 읽기 전용, 장면을 누르면 그 시각으로), 결과물 줄(포맷별 완성본·초안·포스터를 앱 안 뷰어로), 새 필름 창(이름·포맷·길이·품질 → film.json·state.json). 품질 단계는 매 턴 에이전트 프롬프트에 들어가고 CLAUDE.md 6번이 라운드 수를 정한다
- 나중 단계가 채울 자리: 렌더 진행률·취소(3단계, 결과물 줄), 속성 값·장면 시각·cue 직접 편집(4단계), 에이전트가 state.json에 단계를 기록하고 승인 버튼으로 멈추는 흐름(5단계)
- 남은 것: 패키징된 앱의 에이전트는 아직 node·ffmpeg가 사용자 맥에 있어야 렌더할 수 있다(3단계에서 `MailboxOptions.agentEnv`로 앱의 bin/을 PATH에 붙인다). dmg 빌드 설정은 6단계

### 3단계 — 렌더 엔진 교체 ✅ 완료
- 숨김 창 렌더러, 렌더 API·큐·진행률·취소, `render.mjs` 클라이언트화, `bin/` shim, ffmpeg 번들
- 내보내기 인코더: MP4, GIF(palettegen), ProRes 4444, WebM(VP9 알파), PNG
- `critique.sh`·`determinism.sh` → Node
- ✓ 1단계 기준 렌더와 픽셀 일치, `determinism` 통과, 에이전트가 앱 안에서 스틸·초안·최종을 렌더
- 결과: electron/render-worker.ts(하드웨어 가속 끈 숨김 창 → 캔버스 RGBA → ffmpeg). 기존 렌더와 스틸 77장·영상 3구간·20초 전체 1200프레임 일치, 12초 1x1 최종 3분→22초. server/render.ts 큐(진행률·취소, 클라이언트가 끊기면 취소), 결과물 줄에 진행률·취소. 앱은 작업공간 .bin/에 node(앱 실행 파일, ELECTRON_RUN_AS_NODE)·ffmpeg 링크를 만들어 PATH 앞에 둔다 — 빈 PATH로 띄운 앱에서 에이전트가 스틸·초안 렌더, sound·critique까지 확인. critique·determinism은 Node로, Playwright 제거, --codec prores/webm/gif(알파 확인)

### 4단계 — 편집 UI
- 속성 패널(`params`), 타임라인(비트 그리드, 장면 마커·cue 드래그, 비트 스냅, 되돌리기)
- `film.json` 쓰기와 에이전트 턴이 겹칠 때 처리(에이전트 작업 중엔 편집을 잠그거나 턴 끝에 반영)
- ✓ 색·텍스트·장면 시각을 바꾸면 즉시 반영되고, 렌더 결과에도 들어간다

### 5단계 — 단계 표시·승인·리뷰
- `state.json` 규칙, 단계 표시, 승인/수정 요청, 품질 단계 선택, 리뷰 탭(숏리스트 표, 컨택트 시트, 크리틱 점수)
- ✓ 새 필름 하나를 브리프부터 전달까지 터미널 없이 끝낸다 (품질 '기본')

### 6단계 — 내보내기·패키징·배포
- 내보내기 창(형식 × 포맷 선택, 폴더/zip), electron-builder 설정, ffmpeg 서명을 포함한 after-pack, 작업공간 업데이트 규칙
- 디자이너용 README(lottie-studio README 구조를 따름), 예시 갤러리
- ✓ **node·Homebrew·Python이 없는 새 macOS 사용자 계정**에서 dmg 설치 → 온보딩 → 필름 완성 → 내보내기까지 통과. arm64, x64 둘 다

## 위험과 미리 정해 둘 것
- **ffmpeg 바이너리**: ffmpeg-static의 맥 빌드는 --enable-nonfree라 재배포 불가. 지금 앱은 Homebrew ffmpeg를 찾아 쓴다. 6단계에서 nonfree 없는 GPL 빌드(arm64·x64)를 정해 resources/bin/ffmpeg로 넣는다.
- **개발 환경의 Playwright 불일치**: `playwright` 1.63이 요구하는 Chromium(1243)이 설치돼 있지 않아 `render.mjs`가 기본 설정으로는 실패한다. 지금은 `CHROMIUM_PATH`로 설치된 1228을 지정해 돌린다. 3단계에서 Playwright를 없애면 사라지는 문제라 따로 고치지 않는다.
- **ffmpeg 라이선스**: H.264(libx264)를 쓰려면 GPL 빌드가 필요하다. 별도 실행 파일로 넣고 라이선스 고지와 소스 출처를 README·앱 정보에 적는다.
- **사용량**: '런칭용' 크리틱은 라운드 수에 상한(예: 6)을 두고, 넘으면 멈추고 사용자에게 묻는다.
- **렌더 시간**: 16x9 12초 최종 렌더는 2,880 서브프레임이다. 3단계에서 실제 시간을 재고, 너무 느리면 서브프레임 수를 품질 단계에 연동한다.
- **동시 편집**: 사용자의 `film.json` 편집과 에이전트의 코드 수정이 같은 값을 건드릴 수 있다. 4단계에서 규칙을 정한다(기본안: 에이전트 턴 중엔 패널 잠금).
