# motion-studio 하우스 룰

이 레포는 **코드로 모션 영상을 만드는 스튜디오**다. 디자이너가 말로 요청하면 Claude가 필름을 만들고, 렌더하고, 자기 프레임을 직접 보고 고친다.
After Effects를 쓰지 않는다. 모든 영상은 HTML 한 장에 들어 있는 `window.seek(t)` 함수의 결과다.

## 렌더 계약 (절대 규칙)

- 작업 대상 필름 폴더(`films/<이름>/`, `out/<이름>/`)만 고친다. 다른 필름(`films/sample-morph`, `films/sample-3d`, `films/sample-physics` 같은 참고용 포함)은 읽기만 한다.
- 필름 한 편 = `films/<이름>/index.html`(코드) + `films/<이름>/film.json`(데이터). `lib/motion.js`, `lib/stage.js`만 불러온다. 3D가 필요하면 `lib/stage3d.js`(안에 three.js가 들어 있다)를 더한다. 그 밖의 라이브러리는 사람이 명시적으로 요청한 경우만.
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

- 기기 목업(폰·노트북), 제품 모델(.glb), 입체 글자, 재질이 있는 도형이 필요하면 3D를 쓴다. 평면 UI 모핑만이면 2D로 충분하다.
- `lib/stage3d.js`만 쓴다: `world`(장면·카메라·조명 프리셋 studio/soft/dramatic), `phone`·`laptop`(화면 = `screen()` 2D 캔버스), `text3d`·`fonts3d`, `material`(plastic·matte·clay·metal·chrome·glass·pearl), `model`, `set`, `physics`. 쓰는 법은 파일 맨 위 주석과 `films/sample-3d/`(배치·카메라), `films/sample-physics/`(물리).
- 3D 장면을 three.js로 직접 새로 짜지 않는다. 프리셋에 없는 모양은 `THREE`의 기본 지오메트리에 `material()`을 입혀 만든다.
- 순수 함수 규칙은 그대로다. `draw` 안에서 모든 물체의 위치·회전·스케일과 카메라를 t로부터 다시 정한다(`set`, `W.fit`). 이전 프레임 값에 더하지 않는다. 움직임은 2D와 같이 `track`·`loopTrack` 스프링.
- `world()`·재질·기기·글자는 `Stage.film` 함수 안에서 만든다. 폰트(`await fonts3d()`)와 모델(`await model('refs/x.glb')`)만 그 밖에서 한 번 불러온다.
- 기기 화면 속 UI는 `screen().draw((g, w, h) => ...)`에서 2D로 그린다. 2D 규칙(swapAlpha, 스프링)이 그대로 적용된다. 화면 글자는 폰이 가장 작게 보이는 프레임에서도 읽혀야 한다.
- 포맷마다 배치 표를 따로 두고(`S.portrait`/`S.landscape`, 물리처럼 draw 전에 필요하면 `film.portrait`/`film.landscape`), `W.fit(S, { width, height })`로 그 영역이 화면에 다 들어오게 한다. 크롭하지 않는다.
- 물체는 이름을 붙여 넣는다: `W.add({ 폰: ph, 캡슐: cap })`. 검사 보고서와 그림에 그 이름이 나온다.
- 바닥에 놓이는 물체에는 접지 그림자가 자동으로 붙는다(닿을수록 작고 진하게). 물체가 떠 있으면 일부러 띄운 것인지 확인한다.
- 3D 모델은 디자이너가 준 .glb(`refs/`)만 쓴다. 인터넷에서 받지 않는다.
- 룩: 조명 프리셋 하나, 재질은 2~3종. 블룸·글로우·렌즈 플레어 같은 후처리는 쓰지 않는다. 그림자가 화면 밖에서 잘리면 `world({ shadowArea })`를 키운다.

### 물리 (무게·충돌)

- 고르는 기준: 물체끼리 부딪히거나 쌓이거나 굴러가면 `physics()`(미리 굽기). 하나가 떨어지거나 미끄러지기만 하면 `M.drop`·`M.slide`·`M.arc` 곡선(2D에도 쓴다). UI 전환·카메라·기기 회전은 지금처럼 스프링.
- 물리는 `Stage.film` 함수 안에서 `sim.bake(film.dur)`로 0초부터 끝까지 미리 계산하고, `draw` 맨 앞에서 `sim.apply(t)`로 꺼내 쓴다. 그래서 여전히 t의 순수 함수다. `await physicsReady()`는 밖에서 한 번.
- 키프레임으로 움직이는 물체(폰 회전 등)도 `sim.kinematic(obj, t => ({ pos, rot }))`로 넣어야 다른 물체가 거기 부딪힌다. 넣지 않으면 뚫고 지나간다.
- 착지는 비트에 맞춘다: `sim.body(obj, { pos: 'above', land: { at: film.T.hit, pos: [x, z] } })`. `pos: 'above'`는 착지 자리 바로 위 화면 밖에서 기다리게 하고, `at`(놓는 시각)을 빼면 "그냥 놓아서 그 비트에 닿는" 시각을 계산한다. 이게 기본이다. 억지로 위로 던지는 설정이면 보고서의 `물리 설정` 줄이 알려 준다.
- 느낌은 `feel` 프리셋(snappy 기본 · heavy · floaty · real)으로 고르고, 중력 숫자를 직접 넣지 않는다(단위가 자동 환산된다). 세울 물체(밑이 둥근 글자 등)는 `upright: true`.
- 기다리는 자리를 손으로 정하면 너무 높아 세게 떨어지거나(튀어 나감), 서로 겹쳐 놓는 순간 튕긴다. `pos: 'above'`를 쓰면 둘 다 코드가 막는다.
- 그릇에 담거나 쌓을 때는 착지 자리를 `pile(objs, { radius, radiusTop, on, size, height })`로 받는다. 같은 자리에 여러 개를 떨어뜨리면 서로 끼어 끝없이 부딪힌다(보고서 `물리 설정`·`끼임` 줄). pile이 돌려주는 층 수로 담길 높이를 먼저 확인하고, 그릇보다 높으면 개수·크기를 줄인다.
- 그릇이 "가득 차 보이게" 하려면 실제로 채우지 말고 **가짜 바닥**을 쓴다: 그릇 안 높은 곳에 안 보이는 원판(`visible = false`, 그릇과 같은 키프레임 물체에 붙인다)을 두고 그 위에 pile로 쌓는다. 적은 개수로 넘칠 듯 보인다.
- 물리로 쌓인 장면은 처음으로 저절로 돌아가지 않는다. 루프가 필요하면 화면 밖으로 치우는 연출을 넣거나, 마지막 구간만 스프링으로 되돌린다. 아니면 루프가 아닌 필름으로 만든다.

### 3D 검사 (코드가 판정, AI는 실패했을 때만)

- 검사는 코드가 한다: `node tools/render.mjs films/<이름> --check3d`. 첫 줄이 판정이다. **`판정: 통과`면 그림을 열지 않고 다음으로 간다.**
- 실패하면 각 문제 아래 `→` 줄에 고치는 법이 숫자로 나온다(옮길 벡터, 카메라 배율 등. 다른 물체와 안 겹치는 자리를 코드가 골라 둔 것). 그대로 적용하고 한 번 더 검사한다. `views.png`·`motion.png`는 `→`가 "빈자리가 없다"이거나 같은 문제가 두 번 남을 때만 연다.
- 고치는 라운드는 단계마다 2번까지. 그래도 남으면 의도한 것인지 판단해서 `W.allow({ 이름: ['occluded'] })`(시간 구간만: `{ 이름: { occluded: [3.4, 3.7] } }`)로 표시하거나, 남은 문제를 디자이너에게 한 줄로 알리고 넘어간다.
- 작업 중에는 주 포맷 하나만 검사한다. 모든 포맷 검사는 전달 직전에 한 번.
- 무게감도 코드가 본다: 바닥에 닿기 직전 느려지는 낙하(둥둥 내려앉음)는 `무게감`으로, 물리 착지가 비트에서 벗어나면 `비트` 줄로 나온다.
- 미리 막는 게 싸다: 줄 세우기는 `row()`(폭대로 간격), 떨어뜨리기는 `pos: 'above'` + `land`(화면 바로 위에서 비트에 착지), 카메라는 Stage.film 안에서 `W.fit(film, ...)`로 먼저 잡는다. 좌표를 손으로 계산할수록 검사 라운드가 늘어난다.

## 소리와 템포

- 영상에는 소리를 넣지 않는다. 음악·효과음은 편집 단계에서 얹는다. 오디오를 합성하거나 믹스하지 않는다.
- `bpm`·`beatOffset`은 리듬을 짜는 그리드로 쓴다. 장면 전환과 큰 동작은 비트에 맞춘다.
- 편집에서 얹을 곡이 정해져 있으면 디자이너에게 그 곡의 **BPM과 첫 다운비트 시각**을 물어 `bpm`·`beatOffset`에 적는다. 비트를 자동으로 측정하지 않는다.

## 작업 순서 (게이트를 건너뛰지 않는다)

단계가 바뀔 때마다 `node tools/state.mjs films/<이름> stage=<단계>`로 기록한다. Motion Studio 앱이 이걸 보고 디자이너에게 진행 단계와 승인 버튼을 보여준다. `state.json`을 손으로 고치지 않는다. `quality`와 `approved`는 앱이 쓴다.

1. **브리프** (`stage=brief`): `films/<이름>/brief.md` (템플릿: `prompts/spec-template.md`). 빈칸이 있으면 디자이너에게 먼저 묻고, `waiting=answer`로 기록한 뒤 **턴을 끝낸다.**
2. **레퍼런스가 있으면**: `films/<이름>/refs/`에서 `style_guide.md`를 먼저 쓴다(`prompts/reference.md`). 레퍼런스의 문법만 가져오고 내용·로고·캐릭터는 가져오지 않는다.
3. **숏리스트** (`stage=shotlist`): `films/<이름>/shotlist.md`에 비트 그리드 위의 상태 목록을 마크다운 표로 적는다(비트 | 시각 | 상태 / 동작 | 커서). 다 쓰면 `waiting=approval`로 기록하고, 채팅에 표를 보여주고 승인을 부탁한 뒤 **턴을 끝낸다.** **디자이너 승인 전에는 코드를 쓰지 않는다.** 승인은 앱의 승인 버튼(`state.json`의 `approved`에 `shotlist`가 들어간다) 또는 채팅의 분명한 OK다. 수정 요청이 오면 숏리스트를 고치고 다시 `waiting=approval`.
4. **스틸** (`stage=stills`): `node tools/render.mjs films/<이름> --stills beats`로 비트마다 1장 → `contact-beats.png`를 **직접 열어서 본다.** 그리드에서 벗어남, 답답함, 읽기 어려움을 고친다. 3D 필름은 주 포맷 하나로 `--check3d`도 돌린다(판정이 통과면 끝, 아래 3D 검사 규칙).
5. **초안** (`stage=draft`): `--draft`로 빠르게 렌더해서 타이밍을 확인한다.
6. **크리틱 루프** (라운드마다 `stage=critique round=<N>`): 풀 렌더 → `node tools/critique.mjs` (3D면 마지막 라운드에 모든 포맷 `--check3d`) → `prompts/critique-pass.md` 기준으로 점수를 매긴다. 라운드 수는 `films/<이름>/state.json`의 `quality`를 따른다: `fast` 1라운드 · `standard`(없을 때 기본) 3라운드 · `launch` 모든 항목이 8점 이상이 될 때까지(최소 3라운드, 6라운드를 넘기면 멈추고 `waiting=answer`로 디자이너에게 묻는다). 매 라운드 `films/<이름>/review_log.md`에 `## 라운드 N` 제목 아래 점수와 고친 점을 남긴다.
7. **전달** (`stage=deliver waiting=none`): `out/<이름>/<포맷>/final.mp4`, `contact-beats.png`, 포스터 프레임(`--stills <시각>` 결과를 `poster.png`로 복사)을 전달하고, 다음에 개선할 점을 한 줄 덧붙인다.

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
```

## effort

새 필름 첫 패스는 xhigh, 런칭용 대표작은 max, 작은 수정이나 재렌더는 medium.
