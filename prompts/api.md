# 엔진 API (2D) — lib/motion.js · lib/stage.js

구현할 때 이 문서를 본다. `lib/*.js` 소스를 통째로 읽지 않는다(필요한 게 여기 없을 때만 `grep`으로 그 부분).
3D·물리는 `prompts/3d.md`. 디자이너가 준 SVG(로고·아이콘)는 아래 [SVG 에셋](#svg-에셋).

## 필름 뼈대

```html
<!doctype html>
<meta charset="utf-8">
<title>이름</title>
<script src="../../lib/motion.js"></script>
<script src="../../lib/stage.js"></script>
<script>
const { track, loopTrack, colorTrack, mixColor, spring, stretch, swapAlpha, swapBlur, range, clamp, lerp, ease, sp, rng } = M;
Stage.film((film) => {
  const { P, T, dur: DUR, bpm } = film;   // P = params 값, T = timeline 시각(초)
  // 상수·표는 여기서 (film.json이 바뀌면 이 함수가 다시 불린다)
  return {
    draw(g, t, S) {                        // 모든 값은 t로부터. 이전 프레임 값에 더하지 않는다
      if (!S.transparent) { g.fillStyle = P.bg; g.fillRect(0, 0, S.W, S.H); }
      ...
    },
  };
});
</script>
```

- `film` = `{ title, dur, bpm, beatOffset, fps, transparent, P, T, W, H, format, portrait, landscape }`
- `S` = `{ W, H, format, unit, cx, cy, portrait, landscape, transparent, dur, bpm }` — `unit` = 짧은 변 기준 1080 → 1. 길이는 `n * S.unit`.
- film.json (앱의 속성 패널·타임라인이 이 파일만 고친다):
```json
{ "title": "출시 D-1", "dur": 6, "bpm": 120, "beatOffset": 0, "fps": 60,
  "formats": { "1x1": [1080, 1080], "9x16": [1080, 1920], "16x9": [1920, 1080] },
  "transparent": false,
  "params": { "bg": { "type": "color", "value": "#E9E6E0", "label": "배경" },
              "word": { "type": "text", "value": "출시", "label": "입체 글자" },
              "count": { "type": "number", "value": 3, "label": "상자 수" } },
  "timeline": { "open": { "t": 0.5, "label": "뚜껑 열림" }, "hit": { "t": 2, "label": "첫 글자 착지" } } }
```
  params의 type은 `text` · `color` · `number`. label은 디자이너가 알아볼 한국어. timeline 시각은 코드에서 `film.T.키`로만 쓴다.

## motion.js (전역 `M`)

| 함수 | 설명 |
|---|---|
| `spring(t, k=170, d=26)` | 0→1 감쇠 스프링. t ≤ 0이면 0 |
| `sp(name)` | 프리셋 `[k, d]`: `snappy` 버튼·토글 · `ui` 컨테이너(기본) · `camera` 카메라·큰 레이아웃 · `heavy` 큰 타이포·로고 · `playful` 마스코트(UI 금지). `track(t, keys, ...sp('ui'))` |
| `track(t, [[t0, v0], [t1, v1], ...], k, d)` | 목표가 여러 번 바뀌는 값. 변화마다 스프링을 더한다 |
| `loopTrack(t, keys, dur, k, d)` | 루프용 track. 마지막 값 = 첫 값이어야 한다. 이음새 위치·속도까지 맞음 |
| `colorTrack(t, [[t, '#hex'], ...], k, d, loopDur?)` | 색 track → `rgb()` 문자열 |
| `mixColor(a, b, p)` | 두 hex 색 섞기 → `rgb()` |
| `stretch(t, [[t, 왼쪽x], ...], width, { fast, slow, loop })` | 늘어나는 인디케이터 → `{ left, right, width, center }` |
| `swapAlpha(t, tIn, tOut, inDelay=0.08, inDur=0.14, outDur=0.1)` | 모핑 컨테이너 안 내용의 알파 0~1. tOut = null이면 계속 |
| `swapBlur(alpha, max=10)` | 교체 중 블러 px |
| `range(a, b, x)` · `clamp(x, a=0, b=1)` · `lerp(a, b, p)` · `inv(a, b, x)` | 진행도·보간 |
| `ease.linear/outCubic/inOutCubic/outExpo(p)` | 고정 곡선 — 선 그리기 진행도처럼 스프링이 어색한 곳에만 |
| `beat(n, bpm=120, offset=0)` · `bar(n, bpm, 4, offset)` · `loopT(t, dur)` | 비트·마디 시각, 루프 시각 |
| `rng(seed)` | 시드 난수 함수. `Math.random` 대신 `const r = rng(7); r()` |
| `drop(t, t0, h, { g=3000, v0=0, bounce=0.3 })` | 떨어져 튀다 멈춤 → 바닥 위 높이(≥0). 2D는 px/s² 3000 |
| `dropHits(t0, h, { g, v0, bounce })` | drop의 착지 시각들 `[{ t, speed }]` |
| `slide(t, t0, v0, { mu=0.4, g=3000 })` | 마찰로 멈추는 이동 거리 |
| `arc(t, t0, t1, p0, p1, { g=3000 })` | t0에 p0 → t1에 정확히 p1 (비트에 착지). `[x, y]`, y는 위가 + |
| `squash(t, hits, amount=0.08, ref=1500)` | 착지 찌그러짐 s → 스케일 `[1 + s*0.3, 1 − s]` |

## stage.js 그리기 도우미 (전역 `Stage`)

| 함수 | 설명 |
|---|---|
| `Stage.text(g, str, x, y, { font, color='#111', align='center', base='middle', alpha=1, blur=0, dy=0 })` | 알파·블러와 함께 글자 |
| `Stage.layer(g, alpha, blur, () => { ... })` | 묶어서 알파·블러 |
| `Stage.rrect(g, x, y, w, h, r)` | 둥근 사각형 경로 (fill/stroke는 직접) |
| `Stage.cursor(g, x, y, scale=1, down=0)` | 화살표 커서. down 0~1 = 눌림 |

폰트: `'600 46px Pretendard'`, `'500 30px Geist'`, `'400 24px "Geist Mono"'` (Pretendard 400/500/600/700, Geist 400/500/600/700, Geist Mono 400).

## SVG 에셋

디자이너가 **그대로 쓰기**로 첨부한 SVG(로고·아이콘·일러스트)는 다시 그리지 않고 `Stage.svg`로 불러 벡터 그대로 그린다. 확대해도 흐려지지 않고, 도형마다 따로 움직일 수 있다.

```html
<script src="../../lib/motion.js"></script>
<script src="../../lib/stage.js"></script>
<script type="module">
const { track, sp, range, clamp } = M;
const logo = await Stage.svg('refs/logo.svg');   // Stage.film 밖에서 한 번만 (module 스크립트라 await 가능)

Stage.film((film) => {
  const { P, T } = film;
  return {
    draw(g, t, S) {
      logo.draw(g, S.cx, S.cy, {
        width: 520 * S.unit,                           // width / height / scale 중 하나. 비율은 유지
        recolor: { '#111111': P.ink },                 // 원래 색 → params 색 (속성 패널에서 바꿀 수 있게)
        part: (p, i) => {                              // 도형마다: p = { i, id, groups, cx, cy, w, h, length, ... }
          const t0 = T.logo + i * 0.06;
          return { trace: range(t0, t0 + 0.5, t), fill: range(t0 + 0.4, t0 + 0.7, t) };
        },
      });
    },
  };
});
</script>
```

| 항목 | 설명 |
|---|---|
| `await Stage.svg(경로)` | 필름 폴더 기준 경로(`refs/x.svg`). 같은 경로는 한 번만 읽는다. 지원하지 않는 요소가 있으면 콘솔 경고 + `svg.warnings` |
| `await Stage.svg(경로, { split: true })` | 한 패스에 여러 조각이 든 것(외곽선 글자, 합쳐진 아이콘)을 조각마다 나눈다. 글자 속 구멍은 바깥 조각에 붙는다. 조각은 `p.piece` 번호를 갖고, 원래 패스의 `id`를 같이 쓴다. 글자 단위가 아니라 **자모·획 단위**일 수 있으니 `cx`·`cy`로 정렬해 엇갈림을 준다 |
| Figma에서 내보낸 SVG | 깨진 한글 레이어 이름을 되살린다(`part('OPEN 1주년…')`로 찾을 수 있다). 바깥 프레임에서 딸려 온 배경 사각형은 `p.background`로 표시되고 그리지 않는다(`draw`에 `background: true`면 그림) |
| `svg.w` · `svg.h` · `svg.aspect` | viewBox 크기 |
| `svg.parts` | 그리는 순서대로 도형 목록. `{ i, id, groups, cx, cy, x, y, w, h, length }` (SVG 단위). 왼쪽부터 등장시키려면 `cx`로 정렬해 순번을 매긴다 |
| `svg.part(이름)` | `id`가 그 이름이거나 그 이름의 `<g id>` 안에 있는 도형들 |
| `svg.box(x, y, opts)` | 그릴 자리 `{ x, y, w, h, k }` (draw와 같은 opts). 옆에 글자를 붙일 때 |
| `svg.draw(g, x, y, opts)` | `(x, y)`에 `anchor`(기본 `[0.5, 0.5]`, SVG 상자 기준) 맞춰 그린다. 위 표의 box를 돌려준다 |

`draw` opts: `width` · `height` · `scale` · `anchor` · `alpha` · `fill`(모든 칠을 한 색으로) · `recolor`(`{ 원래 hex: 새 색 }`, 그라데이션 정지점에도) · `only`(id나 그룹 이름, 배열 가능) · `traceWidth`(선 없는 도형의 윤곽 굵기, SVG 단위) · `part(p, n)` → `{ alpha, trace, fill, dx, dy, scale, rotate }`.
- `trace` 0~1: 윤곽이 그려진 정도. 선이 있는 도형은 그 선이, 없는 도형은 칠 색 윤곽이 그려진다. 기본 1.
- `fill` 0~1: 칠의 알파. 그려지는 동안 0으로 두고 다 그려질 때 채운다. 기본 1.
- `dx` · `dy`는 화면 px(`S.unit` 곱해서), `scale` · `rotate`(라디안)는 도형 중심 기준.

지원: path·rect·circle·ellipse·line·polyline·polygon, `<g>`·`<use>`, transform, 단색·linear/radialGradient 칠과 선, opacity, fill-rule, 선 끝·이음. **그리지 않는 것**: `<text>`(디자이너에게 글자를 아웃라인으로 바꾼 SVG를 받는다), `<image>`, clipPath·mask·filter, gradientTransform. 경고가 나오면 디자이너에게 알린다.
