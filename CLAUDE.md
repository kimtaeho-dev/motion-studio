# motion-studio 하우스 룰

이 레포는 **코드로 모션 영상을 만드는 스튜디오**다. 디자이너가 말로 요청하면 Claude가 필름을 만들고, 렌더하고, 자기 프레임을 직접 보고 고친다.
After Effects를 쓰지 않는다. 모든 영상은 HTML 한 장에 들어 있는 `window.seek(t)` 함수의 결과다.

## 렌더 계약 (절대 규칙)

- 작업 대상 필름 폴더(`films/<이름>/`, `out/<이름>/`)만 고친다. 다른 필름과 참고용 샘플(`examples/sample-morph`, `examples/sample-3d`, `examples/sample-physics`, `examples/sample-crayon`, `examples/sample-lottie`)은 읽기만 한다. 샘플을 `films/`로 복사하지 않는다(디자이너의 필름 목록에 디자이너가 만들지 않은 필름이 생긴다).
- 필름 한 편 = `films/<이름>/index.html`(코드) + `films/<이름>/film.json`(데이터). `lib/motion.js`, `lib/stage.js`만 불러온다. 3D가 필요하면 `lib/stage3d.js`(안에 three.js가 들어 있다)를 더한다. Lottie 필름은 `lib/stage-lottie.js`(아래 Lottie). 레포 안의 파일(`lib/`, `assets/`, 필름 폴더)만 불러온다 — 네트워크(CDN)에서 불러오지 않는다. 쓰는 법은 `prompts/api.md`(2D)·`prompts/3d.md`(3D)를 본다. `lib/*.js` 소스는 통째로 읽지 않는다(문서에 없는 걸 찾을 때만 `grep`).
- `film.json`에 길이·BPM·포맷·`transparent`·`params`(디자이너가 바꿀 문구·색·숫자)·`timeline`(이름 붙은 장면 시각)을 둔다. 형식은 `lib/stage.js` 맨 위 주석. 앱의 속성 패널과 타임라인이 이 파일을 고치므로, 디자이너가 바꿀 만한 값은 코드에 박지 말고 여기로 뺀다.
- 디자이너는 앱에서 `params` 값과 `timeline` 시각, 전체 길이(`dur`, 장면 시각이 같은 비율로 따라온다)를 직접 바꾼다. 그래서 장면 시각을 코드에 초로 박지 말고 `film.T`와 `DUR`에서 계산한다. 작업을 시작할 때마다 `film.json`을 새로 읽고, 디자이너가 바꾼 값을 말없이 되돌리지 않는다. 꼭 바꿔야 하면 왜 바꾸는지 먼저 말한다. 새 필름 창에서 고른 포맷·크기·길이도 디자이너가 정한 값이다. 다른 값이 낫다고 보면 기본값으로 바꿔 두지 말고 브리프 질문에 넣는다("2초로 만드셨는데 성공 표시는 1초 안팎을 권해요. 바꿀까요?"). 디자이너가 알아서 하라고 했을 때만 정하고, 정한 값을 알린다.
- 코드는 `Stage.film((film) => { ...; return { draw(g, t, S) {} }; })`. `film.P`(params 값), `film.T`(timeline 시각)로 상수와 표를 만들고, 장면 시각은 반드시 `film.T`에서 읽는다(타임라인에서 끌어 옮기면 따라오도록).
- 모든 프레임은 **시간의 순수 함수**다. `draw(g, t, S)` 안에서 t로부터 모든 값을 계산한다.
- `transparent: true`면 `S.transparent`일 때 배경을 칠하지 않는다.
- 금지: CSS transition/animation, `setTimeout`, `setInterval`, 렌더 모드의 `requestAnimationFrame`, 프레임 사이에 이어지는 상태(누적 변수), `Math.random` (→ `M.rng(seed)`), `Date.now()`.
- **방법은 자유, 망가짐은 검사로, 좋고 나쁨은 디자이너가.** 위 계약만 지키면 그리는 방법은 제한하지 않는다: 2D 캔버스든 three.js 재질·셰이더·지오메트리든 화풍에 맞게 직접 짠다. `lib`의 프리셋(`material()`, 조명, `sp()` 등)은 지름길이지 울타리가 아니다. 검사는 결과물을 망가뜨리는 것(렌더 계약·결정성·렌더 오류)만 막고, 나머지는 디자이너에게 빨리 보여 주고 판단을 받는다(작업 순서 4~6).
- UI·프로덕트 모션의 움직임은 `M.spring` / `M.track` / `M.loopTrack` / `M.stretch`가 기본이다. 목표가 여러 번 바뀌는 값은 `track()`(루프면 `loopTrack()`)으로 스프링을 더한다. 일러스트·캐릭터·물리 느낌처럼 화풍이 다르면 어떤 곡선이든 쓴다(t로부터 계산하는 것만 지킨다).
- 폰트는 `assets/fonts`의 파일만 쓴다(지금 Pretendard / Geist / Geist Mono). 시스템 폰트에 의존하지 않는다. 화풍에 맞는 글꼴이 필요하면 라이선스가 맞는 파일을 디자이너에게 받아 `assets/fonts`에 넣는다. (디자이너가 Figma에서 준 다른 글꼴의 글자는 외곽선 SVG 에셋으로 쓴다 — `prompts/figma.md`)
- **에셋과 레퍼런스를 구분한다.** 디자이너가 첨부할 때 고른다(앱의 첨부 칩: 참고용 / 그대로 쓰기). SVG·.glb는 기본이 그대로 쓰기, 이미지·영상은 기본이 참고용이다.
  - 레퍼런스: 아래 작업 순서 2번처럼 문법만 가져온다.
  - 내 에셋(디자이너 소유의 로고·아이콘·서비스 스크린샷·모델): 다시 그리거나 비슷하게 흉내 내지 않고 **파일 그대로** 쓴다. SVG는 `Stage.svg`(`prompts/api.md`의 SVG 에셋), 이미지는 `Image`를 `Stage.film` 밖에서 미리 불러 `drawImage`, .glb는 `model()`. 받은 에셋은 `brief.md`의 `<inputs>`에 "에셋" 목록으로 적어 다음 턴에도 구분이 남게 한다. 에셋의 색을 바꿔야 하면 `recolor`로 `params`에 연결한다.
- 레이아웃은 1080 기준 단위(`S.unit`)로 짠다. 포맷(1x1, 9x16, 16x9)이 바뀌어도 크롭하지 말고 다시 배치한다.

## 룩

브리프의 **스타일**(UI·프로덕트 모션 / 일러스트·손그림 / 타이포 / 제품 3D …)이 룩을 정한다. 스타일이 정해지면 그 스타일의 문법을 끝까지 밀고 간다. 레퍼런스가 없다고 단순하게 줄이지 않는다 — 장면을 채울 요소(배경 소품, 질감, 2차 동작)를 숏리스트에 넣는다.

모든 스타일 공통 (`--check`가 숫자로 알려 준다 — 막지는 않고, 디자이너에게 보여 줄 때 메모로 붙인다):
- 아무 일도 없는 구간(dead time)을 두지 않는다. 2~4초마다 화면에서 새로운 일이 일어난다. 120BPM 기준이면 비트마다 무언가 움직인다.
- 포맷마다 화면을 쓴다. 한쪽이 대부분의 시간 비어 있으면 그 포맷의 배치를 다시 짠다.

UI·프로덕트 모션의 기본값 (다른 스타일이면 brief.md `<direction>`에 무엇을 따르지 않는지 적는다):
- 피할 것: 그라데이션 위 가운데 제목, 전부 페이드인, 모서리 라벨/프레임 테두리, UI 크롬의 글로우·그라데이션, 흔한 파티클 폭발, 통통 튀는 이징.
- 디스플레이 서체 1개, UI 서체 1개. 브리프에 없으면 포인트 컬러는 1개.
- 모핑하는 컨테이너 안 텍스트는 `M.swapAlpha`로 들어오고 나간다. 모핑 시작 직후 등장, 다음 모핑 직전 퇴장. 겹치면 안 된다.
- 카메라가 스케일하는 요소에 `will-change`나 비트맵 캐시를 쓰지 않는다(텍스트가 흐려진다).
- 루프 영상은 마지막 프레임 = 첫 프레임(커서 위치·속도 포함). `loopTrack`을 쓰면 자동으로 맞춰진다. 루프면 `film.json`에 `"loop": true`(`--check`가 이음새를 본다).

## 3D

- 기기 목업(폰·노트북), 제품 모델(.glb), 입체 글자, 재질이 있는 도형, 떨어지고 부딪히는 물리가 필요하면 3D를 쓴다. 평면 UI 모핑만이면 2D로 충분하다.
- 화풍이 있는 3D(손그림·툰·종이·클레이 …)도 3D로 짠다: 프리셋에 없는 재질은 THREE로 직접 만든다(`examples/sample-crayon`).
- 3D·물리 필름은 **구현에 들어갈 때** `prompts/3d.md`(규칙·API·뼈대·3D 검사)를 읽는다. 브리프·숏리스트 단계에서는 읽지 않는다.
- 숏리스트에 알아 둘 것: 물리 착지는 비트에 맞출 수 있다. 물리로 쌓인 장면은 처음 상태로 저절로 돌아가지 않아 루프가 어렵다. 3D 모델은 디자이너가 준 .glb만 쓴다.

## Lottie (앱·웹에 넣을 애니메이션)

- `film.json`의 `kind`가 `"lottie"`인 필름은 결과물이 `films/<이름>/lottie.json`이다. 개발자가 앱·웹에 넣는 파일이라 영상 필름과 규칙이 다르다. **작업 전에 `prompts/lottie.md`를 읽고 그 작업 순서·검사를 따른다.** 브리프 단계에서도 읽는다(무엇을 물을지가 다르다).
- `index.html`은 고정 셸(`Stage.lottieFilm()`)이라 고치지 않는다. `lottie.json`은 손으로 쓰지 않고 필름 폴더의 `build.mjs`로 만든다(`tools/lottie/kit.mjs`). 고칠 때마다 `node films/<이름>/build.mjs && node tools/lottie.mjs sync films/<이름>`.
- 디자이너가 바꿀 값은 Lottie 슬롯으로 열고, `film.json`의 `params` 키 = 슬롯 id다. 디자이너가 바꾼 값은 말없이 되돌리지 않는다(위 규칙 그대로).
- 아이콘·로더·상태 피드백처럼 **단일 애셋은 숏리스트 승인 없이** 바로 만든다. 장면이 여러 개면 영상 필름처럼 숏리스트를 승인받는다. Lottie에는 초안(`draft`) 단계가 없다.
- 전달 조건: `node tools/lottie.mjs check` BLOCK 0, `node tools/render.mjs films/<이름> --parity` 통과(미리보기 렌더러와 웹 플레이어가 같게 그린다), `node tools/lottie.mjs export`.

## Figma

- 디자이너가 Figma 링크를 주면 **`prompts/figma.md`를 읽고 따른다.** Figma 화면을 상상으로 다시 그리지 않고, 구조·글자·이미지를 받아 그 숫자 그대로 움직인다.
- Figma 읽기 호출은 요금제에 따라 한 달 20번까지일 수 있다. 받은 것은 `films/<이름>/refs/figma/`에 저장하고 다시 부르지 않는다.

## 소리와 템포

- 영상에는 소리를 넣지 않는다. 음악·효과음은 편집 단계에서 얹는다. 오디오를 합성하거나 믹스하지 않는다.
- `bpm`·`beatOffset`은 리듬을 짜는 그리드로 쓴다. 장면 전환과 큰 동작은 비트에 맞춘다.
- 편집에서 얹을 곡이 정해져 있으면 디자이너에게 그 곡의 **BPM과 첫 다운비트 시각**을 물어 `bpm`·`beatOffset`에 적는다. 비트를 자동으로 측정하지 않는다.

## 작업 순서 (게이트를 건너뛰지 않는다, 혼자 오래 다듬지 않는다)

Lottie 필름은 `prompts/lottie.md`의 작업 순서를 따른다(단일 애셋은 숏리스트 생략, 초안 없음). 아래는 영상 필름의 순서다.

단계가 바뀔 때마다 `node tools/state.mjs films/<이름> stage=<단계>`로 기록한다. Motion Studio 앱이 이걸 보고 디자이너에게 진행 단계와 승인 버튼을 보여준다. `state.json`을 손으로 고치지 않는다. `quality`와 `approved`는 앱이 쓴다.

1. **브리프** (`stage=brief`): `films/<이름>/brief.md` (템플릿: `prompts/spec-template.md`). 빈칸이 있으면 디자이너에게 먼저 묻고 **턴을 끝낸다.** 질문은 `node tools/ask.mjs`로 남긴다(질문 4개까지, 선택지 2~4개에 권장안 `--rec`, 열린 질문은 선택지 없이). 앱이 선택지 카드로 보여주고 `waiting=answer`도 함께 기록된다. 채팅에는 질문을 다시 쓰지 않고 한 줄로만 알린다.
2. **레퍼런스가 있으면**: `films/<이름>/refs/`에서 `style_guide.md`를 먼저 쓴다(`prompts/reference.md`). 레퍼런스의 문법만 가져오고 내용·로고·캐릭터는 가져오지 않는다. 디자이너가 그대로 쓰기로 준 에셋은 이 규칙의 대상이 아니다.
3. **숏리스트** (`stage=shotlist`): `films/<이름>/shotlist.md`에 비트 그리드 위의 상태 목록을 마크다운 표로 적는다(비트 | 시각 | 상태 / 동작 | 커서). 다 쓰면 `waiting=approval`로 기록하고, 채팅에 표를 보여주고 승인을 부탁한 뒤 **턴을 끝낸다.** **디자이너 승인 전에는 코드를 쓰지 않는다.** 승인은 앱의 승인 버튼(`state.json`의 `approved`에 `shotlist`가 들어간다) 또는 채팅의 분명한 OK다. 수정 요청이 오면 숏리스트를 고치고 다시 `waiting=approval`.
4. **첫 결과** (`stage=draft`): 구현이 돌아가면 **다듬기 전에 디자이너에게 보여 준다.** 디자이너는 움직임과 이야기를 보고, 에이전트의 검사 숫자·스틸로는 그걸 대신 볼 수 없다.
   - `node tools/render.mjs films/<이름> --check`. **막는 것**만 고친다: 필름이 안 뜸·렌더 오류, 렌더 계약 위반(난수·타이머·누적 상태), 결정성. 나머지(구도·여백·새 일 없음·정지·루프 이음새, 3D면 `--check3d`의 겹침·가림)는 고치지 않고 **보여 줄 때 메모로 붙인다.**
   - `--stills beats` → `contact-beats.png`를 한 번 연다. **깨진 것**만 고친다: 빈 화면, 화면 밖으로 나간 주인공, 읽을 수 없는 글자, 브리프와 다른 화풍. 취향의 다듬기는 하지 않는다.
   - `--draft` 렌더. 그리고 채팅에: 초안이 플레이어에 있다는 것 · 내가 보기에 다음에 다듬을 곳 2~3줄 · 검사 메모(있으면). `waiting=review`로 기록하고 **턴을 끝낸다.**
5. **다듬기** (`stage=critique round=<N>`, 디자이너 의견 한 번 = 한 라운드): 디자이너가 짚은 것과, 내 제안 중 디자이너가 고른 것만 고친다. 바뀐 구간만 `--from/--to`로 확인하고 `--draft` → 4번처럼 보여 주고 `waiting=review`. 라운드 수는 디자이너가 정한다(그만 다듬자고 하면 전달). `films/<이름>/review_log.md`에 `## 라운드 N` 아래 요청과 고친 점을 남긴다.
   - `quality`가 `launch`면 보여 주기 전에 `node tools/critique.mjs` → `prompts/critique-pass.md` 채점을 한 번 하고 점수를 메모에 붙인다(점수를 올리려고 혼자 라운드를 더 돌지 않는다).
   - (Lottie 필름의 라운드 규칙은 `prompts/lottie.md`.)
6. **혼자 도는 한도** (4·5번 모두): 한 턴에 "고치기 → 렌더 → 보기" 순환은 **2번까지**(`quality`가 `fast`면 1번). 그 안에 안 풀리면 고친 데까지 보여 주고 무엇이 남았는지 말한다. 같은 검사가 두 번 고쳐도 실패하거나 원인이 필름 코드 밖(엔진·렌더러·도구)으로 보이면 **더 파지 않는다** — 스틸 한 장과 한 줄 설명으로 알리고 `waiting=answer`. 같은 명령을 다시 돌려 통과하는 검사는 "가끔 튄다"고 알리고 넘어간다.
7. **전달** (`stage=deliver waiting=none`, 디자이너가 OK하면): 요청된 포맷 전부 풀 렌더. 각 포맷에서 `--check`의 **막는 것**이 없어야 한다. `out/<이름>/<포맷>/final.mp4`, `contact-beats.png`, 포스터 프레임(`--stills <시각>` 결과를 `poster.png`로 복사)을 전달하고, 다음에 개선할 점을 한 줄 덧붙인다. `stage=deliver`가 필름을 지금 엔진으로 고정한다(앱이 업데이트돼도 같은 결과). 전달한 필름을 다시 고칠 때는 먼저 `stage`를 앞 단계로 바꾼다 — 최신 엔진으로 풀리니 검사를 다시 돈다.

이미지는 한 장 한 장이 이후 모든 단계의 비용이 된다. 고친 뒤 확인은 바뀐 비트만 `--stills 2.5,3` 처럼 몇 장으로 보고, 컨택트 시트 전체를 다시 열지 않는다.

## 명령어

```bash
node tools/new.mjs <이름>                          # films/_template 복사 (앱에서는 디자이너가 새 필름 창으로 만든다)
npm run preview                                    # http://localhost:4173 — 브라우저 미리보기 (스크러버, 비트 그리드)
node tools/render.mjs films/<이름> --stills beats  # 비트마다 스틸 + 컨택트 시트
node tools/render.mjs films/<이름> --draft         # 빠른 초안 → draft.mp4
node tools/render.mjs films/<이름>                 # 최종 (60fps, 4 서브프레임 모션블러) → final.mp4
node tools/render.mjs films/<이름> --all-formats   # 모든 포맷
node tools/render.mjs films/<이름> --codec prores  # 편집용 ProRes 4444 (투명 배경 유지) · --codec webm / gif
node tools/render.mjs films/<이름> --check         # 품질 검사(모든 필름): 첫 줄 판정. 막는 것은 → 줄대로 고치고, 메모는 보여 줄 때 붙인다
node tools/render.mjs films/<이름> --check3d       # 3D 검사: 파고듦·바닥 아래·가림·잘림을 메모로 (막지 않는다)
node tools/critique.mjs films/<이름> [포맷] [빠른동작시각]
node tools/determinism.mjs films/<이름>            # 다른 프로세스에서 같은 프레임 두 번 → 같은 픽셀인지 (한 페이지 안 순서 섞기는 --check)
node tools/state.mjs films/<이름> stage=shotlist waiting=approval  # 진행 단계 기록 (앱의 단계 표시·승인 버튼)
node tools/ask.mjs films/<이름> --q "질문" --opt "A" --opt "B" --rec 1  # 디자이너에게 묻기 (앱의 선택지 카드)
node tools/engine.mjs films/<이름>                 # 엔진 고정 상태 (deliver면 고정, 앞 단계로 가면 풀림)
node tools/new.mjs <이름> --lottie --size 512x512 --dur 2  # Lottie 필름 (앱에서는 새 필름 창의 "앱·웹에 넣을 것")
node tools/lottie.mjs sync films/<이름>            # Lottie: lottie.json → film.json
node tools/lottie.mjs check films/<이름>           # Lottie: 웹 플레이어 호환·움직임·슬롯 검사
node tools/render.mjs films/<이름> --parity        # Lottie: 미리보기(Skottie)와 웹 플레이어(lottie-web)를 그려 비교
node tools/lottie.mjs export films/<이름>          # Lottie: 슬롯 값을 구워 .json · .lottie
node tools/lottie.mjs text "문구" --font Pretendard-Bold --size 72  # 글자 → 아웃라인 셰이프 레이어
node tools/turn-timing.mjs films/<이름>             # 앱 채팅 턴마다 시간 쪼개기: 모델·도구(종류별)·네트워크 멈춤
```

## effort

새 필름 첫 패스는 xhigh, 런칭용 대표작은 max, 작은 수정이나 재렌더는 medium.
