# motion-studio 하우스 룰

이 레포는 **코드로 모션 영상을 만드는 스튜디오**다. 디자이너가 말로 요청하면 Claude가 필름을 만들고, 렌더하고, 자기 프레임을 직접 보고 고친다.
After Effects를 쓰지 않는다. 모든 영상은 HTML 한 장에 들어 있는 `window.seek(t)` 함수의 결과다.

## 렌더 계약 (절대 규칙)

- 필름 한 편 = `films/<이름>/index.html`(코드) + `films/<이름>/film.json`(데이터). `lib/motion.js`, `lib/stage.js`만 불러온다. 다른 라이브러리는 사람이 명시적으로 요청한 경우만.
- `film.json`에 길이·BPM·포맷·`transparent`·`params`(디자이너가 바꿀 문구·색·숫자)·`timeline`(이름 붙은 장면 시각)·`cues`를 둔다. 형식은 `lib/stage.js` 맨 위 주석. 앱의 속성 패널과 타임라인이 이 파일을 고치므로, 디자이너가 바꿀 만한 값은 코드에 박지 말고 여기로 뺀다.
- 디자이너는 앱에서 `params` 값, `timeline` 시각, 고정 시각 `cues`를 직접 바꾼다. 작업을 시작할 때마다 `film.json`을 새로 읽고, 디자이너가 바꾼 값을 말없이 되돌리지 않는다. 꼭 바꿔야 하면 왜 바꾸는지 먼저 말한다. 장면에 붙는 효과음은 `at`으로 써야 디자이너가 장면을 옮길 때 함께 따라간다.
- 코드는 `Stage.film((film) => { ...; return { draw(g, t, S) {} }; })`. `film.P`(params 값), `film.T`(timeline 시각)로 상수와 표를 만들고, 장면 시각은 반드시 `film.T`에서 읽는다(타임라인에서 끌어 옮기면 따라오도록).
- 모든 프레임은 **시간의 순수 함수**다. `draw(g, t, S)` 안에서 t로부터 모든 값을 계산한다.
- `transparent: true`면 `S.transparent`일 때 배경을 칠하지 않는다.
- 금지: CSS transition/animation, `setTimeout`, `setInterval`, 렌더 모드의 `requestAnimationFrame`, 프레임 사이에 이어지는 상태(누적 변수), `Math.random` (→ `M.rng(seed)`), `Date.now()`.
- 움직임은 `M.spring` / `M.track` / `M.loopTrack` / `M.stretch`로 만든다. 고정 곡선 이징은 선 그리기 진행도처럼 스프링이 어색한 곳에만 쓴다.
- 목표가 여러 번 바뀌는 값은 반드시 `track()`(루프면 `loopTrack()`)을 쓴다. 스프링을 새로 시작하지 않고 더한다.
- 폰트는 `assets/fonts`의 Pretendard / Geist / Geist Mono만 쓴다. 시스템 폰트에 의존하지 않는다.
- 레이아웃은 1080 기준 단위(`S.unit`)로 짠다. 포맷(1x1, 9x16, 16x9)이 바뀌어도 크롭하지 말고 다시 배치한다.
- 효과음은 `film.json`의 `cues`로 선언한다. 장면에 붙는 효과음은 `{ "at": "<timeline 이름>", "dt": 0.02, "type": "pop" }`, 고정 시각은 `{ "t": 1.5, "type": "click" }`. 타이핑처럼 규칙적으로 반복되는 것만 코드에서 `return { cues: [...] }`로 만든다. 오디오 파일을 직접 만지지 않는다.

## 룩

- 금지된 기본값: 그라데이션 위 가운데 제목, 전부 페이드인, 모서리 라벨/프레임 테두리, UI 크롬의 글로우·그라데이션, 흔한 파티클 폭발, 통통 튀는 이징(UI에서), 아무 일도 없는 구간(dead time).
- 디스플레이 서체 1개, UI 서체 1개. 브리프에 없으면 포인트 컬러는 1개.
- 2~4초마다 화면에서 새로운 일이 일어나야 한다. 120BPM 기준이면 비트마다 무언가 움직인다.
- 모핑하는 컨테이너 안 텍스트는 `M.swapAlpha`로 들어오고 나간다. 모핑 시작 직후 등장, 다음 모핑 직전 퇴장. 겹치면 안 된다.
- 카메라가 스케일하는 요소에 `will-change`나 비트맵 캐시를 쓰지 않는다(텍스트가 흐려진다).
- 루프 영상은 마지막 프레임 = 첫 프레임(커서 위치·속도 포함). `loopTrack`을 쓰면 자동으로 맞춰진다.

## 사운드

- 트랙이 없으면 `tools/sound.mjs`가 BPM에 맞춰 음악과 효과음을 합성한다.
- 트랙이 있으면 `films/<이름>/audio/track.wav`에 두고, 디자이너에게 **BPM과 첫 다운비트 시각**을 물어 필름의 `bpm`·`beatOffset`에 적는다. 다운비트에서 시작하고, 효과음은 그 비트 그리드에 맞춘다. 비트를 자동으로 측정하지 않는다.
- 최종 라우드니스는 -14 LUFS (sound.mjs가 처리).

## 작업 순서 (게이트를 건너뛰지 않는다)

1. **브리프**: `films/<이름>/brief.md` (템플릿: `prompts/spec-template.md`). 빈칸이 있으면 디자이너에게 먼저 묻는다.
2. **레퍼런스가 있으면**: `films/<이름>/refs/`에서 `style_guide.md`를 먼저 쓴다(`prompts/reference.md`). 레퍼런스의 문법만 가져오고 내용·로고·캐릭터는 가져오지 않는다.
3. **숏리스트**: `films/<이름>/shotlist.md`에 비트 그리드 위의 상태 목록을 적는다. 시각, 상태, 커서 동작, 효과음. **디자이너 OK를 받기 전에는 코드를 쓰지 않는다.**
4. **스틸**: `node tools/render.mjs films/<이름> --stills beats`로 비트마다 1장 → `contact-beats.png`를 **직접 열어서 본다.** 그리드에서 벗어남, 답답함, 읽기 어려움을 고친다.
5. **초안**: `--draft`로 빠르게 렌더해서 타이밍을 확인한다.
6. **크리틱 루프**: 풀 렌더 → `tools/sound.mjs` → `node tools/critique.mjs` → `prompts/critique-pass.md` 기준으로 점수를 매긴다. 라운드 수는 `films/<이름>/state.json`의 `quality`를 따른다: `fast` 1라운드 · `standard`(없을 때 기본) 3라운드 · `launch` 모든 항목이 8점 이상이 될 때까지(최소 3라운드, 6라운드를 넘기면 멈추고 디자이너에게 묻는다). 매 라운드 `films/<이름>/review_log.md`에 점수와 고친 점을 남긴다.
7. **전달**: `out/<이름>/<포맷>/final.mp4`, `contact-beats.png`, 포스터 프레임(`--stills <시각>`)을 전달하고, 다음에 개선할 점을 한 줄 덧붙인다.

수정할 때는 바뀐 구간만 `--from/--to`로 다시 렌더해서 확인한 뒤, 마지막에 전체를 렌더한다.

## 명령어

```bash
node tools/new.mjs <이름>                          # films/_template 복사 (앱에서는 디자이너가 새 필름 창으로 만든다)
npm run preview                                    # http://localhost:4173 — 브라우저 미리보기 (스크러버, 비트 그리드)
node tools/render.mjs films/<이름> --stills beats  # 비트마다 스틸 + 컨택트 시트
node tools/render.mjs films/<이름> --draft         # 빠른 초안
node tools/render.mjs films/<이름>                 # 최종 (60fps, 4 서브프레임 모션블러)
node tools/render.mjs films/<이름> --all-formats   # 모든 포맷
node tools/render.mjs films/<이름> --codec prores  # 편집용 ProRes 4444 (투명 배경 유지) · --codec webm / gif
node tools/sound.mjs films/<이름> [--format 9x16]  # 음악+효과음 합성, 믹스 → final.mp4
node tools/critique.mjs films/<이름> [포맷] [빠른동작시각]
node tools/determinism.mjs films/<이름>            # 같은 프레임 두 번 → 같은 픽셀인지
```

## effort

새 필름 첫 패스는 xhigh, 런칭용 대표작은 max, 작은 수정이나 재렌더는 medium.
