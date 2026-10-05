# motion-studio 하우스 룰

이 레포는 **코드로 모션 영상을 만드는 스튜디오**다. 디자이너가 말로 요청하면 Claude가 필름을 만들고, 렌더하고, 자기 프레임을 직접 보고 고친다.
After Effects를 쓰지 않는다. 모든 영상은 HTML 한 장에 들어 있는 `window.seek(t)` 함수의 결과다.

## 렌더 계약 (절대 규칙)

- 작업 대상 필름 폴더(`films/<이름>/`, `out/<이름>/`)만 고친다. 다른 필름(`films/sample-morph`, `films/sample-3d`, `films/sample-physics` 같은 참고용 포함)은 읽기만 한다.
- 필름 한 편 = `films/<이름>/index.html`(코드) + `films/<이름>/film.json`(데이터). `lib/motion.js`, `lib/stage.js`만 불러온다. 3D가 필요하면 `lib/stage3d.js`(안에 three.js가 들어 있다)를 더한다. 그 밖의 라이브러리는 사람이 명시적으로 요청한 경우만. 쓰는 법은 `prompts/api.md`(2D)·`prompts/3d.md`(3D)를 본다. `lib/*.js` 소스는 통째로 읽지 않는다(문서에 없는 걸 찾을 때만 `grep`).
- `film.json`에 길이·BPM·포맷·`transparent`·`params`(디자이너가 바꿀 문구·색·숫자)·`timeline`(이름 붙은 장면 시각)을 둔다. 형식은 `lib/stage.js` 맨 위 주석. 앱의 속성 패널과 타임라인이 이 파일을 고치므로, 디자이너가 바꿀 만한 값은 코드에 박지 말고 여기로 뺀다.
- 디자이너는 앱에서 `params` 값과 `timeline` 시각을 직접 바꾼다. 작업을 시작할 때마다 `film.json`을 새로 읽고, 디자이너가 바꾼 값을 말없이 되돌리지 않는다. 꼭 바꿔야 하면 왜 바꾸는지 먼저 말한다.
- 코드는 `Stage.film((film) => { ...; return { draw(g, t, S) {} }; })`. `film.P`(params 값), `film.T`(timeline 시각)로 상수와 표를 만들고, 장면 시각은 반드시 `film.T`에서 읽는다(타임라인에서 끌어 옮기면 따라오도록).
- 모든 프레임은 **시간의 순수 함수**다. `draw(g, t, S)` 안에서 t로부터 모든 값을 계산한다.
- `transparent: true`면 `S.transparent`일 때 배경을 칠하지 않는다.
- 금지: CSS transition/animation, `setTimeout`, `setInterval`, 렌더 모드의 `requestAnimationFrame`, 프레임 사이에 이어지는 상태(누적 변수), `Math.random` (→ `M.rng(seed)`), `Date.now()`.
- 움직임은 `M.spring` / `M.track` / `M.loopTrack` / `M.stretch`로 만든다. 고정 곡선 이징은 선 그리기 진행도처럼 스프링이 어색한 곳에만 쓴다.
- 목표가 여러 번 바뀌는 값은 반드시 `track()`(루프면 `loopTrack()`)을 쓴다. 스프링을 새로 시작하지 않고 더한다.
- 폰트는 `assets/fonts`의 Pretendard / Geist / Geist Mono만 쓴다. 시스템 폰트에 의존하지 않는다.
- 레이아웃은 1080 기준 단위(`S.unit`)로 짠다. 포맷(1x1, 9x16, 16x9)이 바뀌어도 크롭하지 말고 다시 배치한다.

## 룩

- 금지된 기본값: 그라데이션 위 가운데 제목, 전부 페이드인, 모서리 라벨/프레임 테두리, UI 크롬의 글로우·그라데이션, 흔한 파티클 폭발, 통통 튀는 이징(UI에서), 아무 일도 없는 구간(dead time).
- 디스플레이 서체 1개, UI 서체 1개. 브리프에 없으면 포인트 컬러는 1개.
- 2~4초마다 화면에서 새로운 일이 일어나야 한다. 120BPM 기준이면 비트마다 무언가 움직인다.
- 모핑하는 컨테이너 안 텍스트는 `M.swapAlpha`로 들어오고 나간다. 모핑 시작 직후 등장, 다음 모핑 직전 퇴장. 겹치면 안 된다.
- 카메라가 스케일하는 요소에 `will-change`나 비트맵 캐시를 쓰지 않는다(텍스트가 흐려진다).
- 루프 영상은 마지막 프레임 = 첫 프레임(커서 위치·속도 포함). `loopTrack`을 쓰면 자동으로 맞춰진다.

## 3D

- 기기 목업(폰·노트북), 제품 모델(.glb), 입체 글자, 재질이 있는 도형, 떨어지고 부딪히는 물리가 필요하면 3D를 쓴다. 평면 UI 모핑만이면 2D로 충분하다.
- 3D·물리 필름은 **구현에 들어갈 때** `prompts/3d.md`(규칙·API·뼈대·3D 검사)를 읽고 그대로 따른다. 브리프·숏리스트 단계에서는 읽지 않는다.
- 숏리스트에 알아 둘 것: 물리 착지는 비트에 맞출 수 있다. 물리로 쌓인 장면은 처음 상태로 저절로 돌아가지 않아 루프가 어렵다. 3D 모델은 디자이너가 준 .glb만 쓴다.

## 소리와 템포

- 영상에는 소리를 넣지 않는다. 음악·효과음은 편집 단계에서 얹는다. 오디오를 합성하거나 믹스하지 않는다.
- `bpm`·`beatOffset`은 리듬을 짜는 그리드로 쓴다. 장면 전환과 큰 동작은 비트에 맞춘다.
- 편집에서 얹을 곡이 정해져 있으면 디자이너에게 그 곡의 **BPM과 첫 다운비트 시각**을 물어 `bpm`·`beatOffset`에 적는다. 비트를 자동으로 측정하지 않는다.

## 작업 순서 (게이트를 건너뛰지 않는다)

단계가 바뀔 때마다 `node tools/state.mjs films/<이름> stage=<단계>`로 기록한다. Motion Studio 앱이 이걸 보고 디자이너에게 진행 단계와 승인 버튼을 보여준다. `state.json`을 손으로 고치지 않는다. `quality`와 `approved`는 앱이 쓴다.

1. **브리프** (`stage=brief`): `films/<이름>/brief.md` (템플릿: `prompts/spec-template.md`). 빈칸이 있으면 디자이너에게 먼저 묻고, `waiting=answer`로 기록한 뒤 **턴을 끝낸다.**
2. **레퍼런스가 있으면**: `films/<이름>/refs/`에서 `style_guide.md`를 먼저 쓴다(`prompts/reference.md`). 레퍼런스의 문법만 가져오고 내용·로고·캐릭터는 가져오지 않는다.
3. **숏리스트** (`stage=shotlist`): `films/<이름>/shotlist.md`에 비트 그리드 위의 상태 목록을 마크다운 표로 적는다(비트 | 시각 | 상태 / 동작 | 커서). 다 쓰면 `waiting=approval`로 기록하고, 채팅에 표를 보여주고 승인을 부탁한 뒤 **턴을 끝낸다.** **디자이너 승인 전에는 코드를 쓰지 않는다.** 승인은 앱의 승인 버튼(`state.json`의 `approved`에 `shotlist`가 들어간다) 또는 채팅의 분명한 OK다. 수정 요청이 오면 숏리스트를 고치고 다시 `waiting=approval`.
4. **스틸** (`stage=stills`): `node tools/render.mjs films/<이름> --stills beats`로 비트마다 1장 → `contact-beats.png`를 **직접 열어서 본다.** 그리드에서 벗어남, 답답함, 읽기 어려움을 고친다. 고칠 점은 한 번에 모아서 고치고, 확인은 바뀐 비트만 `--stills 2.5,3` 처럼 몇 장으로 본다(컨택트 시트 전체를 고칠 때마다 다시 열지 않는다 — 이미지 한 장 한 장이 이후 모든 단계의 비용이 된다). 3D 필름은 주 포맷 하나로 `--check3d`도 돌린다(판정이 통과면 끝, `prompts/3d.md`의 3D 검사).
5. **초안** (`stage=draft`): `--draft`로 빠르게 렌더해서 타이밍을 확인한다.
6. **크리틱 루프** (라운드마다 `stage=critique round=<N>`): 풀 렌더 → `node tools/critique.mjs` (3D면 마지막 라운드에 모든 포맷 `--check3d`) → `prompts/critique-pass.md` 기준으로 점수를 매긴다. 라운드 수는 `films/<이름>/state.json`의 `quality`를 따른다: `fast` 1라운드 · `standard`(없을 때 기본) 3라운드 · `launch` 모든 항목이 8점 이상이 될 때까지(최소 3라운드, 6라운드를 넘기면 멈추고 `waiting=answer`로 디자이너에게 묻는다). 매 라운드 `films/<이름>/review_log.md`에 `## 라운드 N` 제목 아래 점수와 고친 점을 남긴다.
7. **전달** (`stage=deliver waiting=none`): `out/<이름>/<포맷>/final.mp4`, `contact-beats.png`, 포스터 프레임(`--stills <시각>` 결과를 `poster.png`로 복사)을 전달하고, 다음에 개선할 점을 한 줄 덧붙인다. `stage=deliver`가 필름을 지금 엔진으로 고정한다(앱이 업데이트돼도 같은 결과). 전달한 필름을 다시 고칠 때는 먼저 `stage`를 앞 단계로 바꾼다 — 최신 엔진으로 풀리니 검사를 다시 돈다.

수정할 때는 바뀐 구간만 `--from/--to`로 다시 렌더해서 확인한 뒤, 마지막에 전체를 렌더한다.

## 명령어

```bash
node tools/new.mjs <이름>                          # films/_template 복사 (앱에서는 디자이너가 새 필름 창으로 만든다)
npm run preview                                    # http://localhost:4173 — 브라우저 미리보기 (스크러버, 비트 그리드)
node tools/render.mjs films/<이름> --stills beats  # 비트마다 스틸 + 컨택트 시트
node tools/render.mjs films/<이름> --draft         # 빠른 초안 → draft.mp4
node tools/render.mjs films/<이름>                 # 최종 (60fps, 4 서브프레임 모션블러) → final.mp4
node tools/render.mjs films/<이름> --all-formats   # 모든 포맷
node tools/render.mjs films/<이름> --codec prores  # 편집용 ProRes 4444 (투명 배경 유지) · --codec webm / gif
node tools/render.mjs films/<이름> --check3d       # 3D 검사: 파고듦·바닥 아래·가림·잘림 + views.png·motion.png
node tools/critique.mjs films/<이름> [포맷] [빠른동작시각]
node tools/determinism.mjs films/<이름>            # 같은 프레임 두 번 → 같은 픽셀인지
node tools/state.mjs films/<이름> stage=shotlist waiting=approval  # 진행 단계 기록 (앱의 단계 표시·승인 버튼)
node tools/engine.mjs films/<이름>                 # 엔진 고정 상태 (deliver면 고정, 앞 단계로 가면 풀림)
```

## effort

새 필름 첫 패스는 xhigh, 런칭용 대표작은 max, 작은 수정이나 재렌더는 medium.
