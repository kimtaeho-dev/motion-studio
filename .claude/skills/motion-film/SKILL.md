---
name: motion-film
description: 코드로 모션 영상(UI 모핑 루프, 프로덕트 릴, 런칭 영상, 기능 소개 모션, SNS 모션 광고)을 만든다. 디자이너가 "모션 만들어줘", "영상 만들어줘", "런칭 릴", "/motion-film <이름>" 이라고 할 때 사용.
---

# motion-film

디자이너는 코드를 몰라도 된다. 말로 요청하면 이 파이프라인을 끝까지 돌리고, 게이트마다 확인을 받는다.
규칙은 레포 루트 `CLAUDE.md`가 우선한다.

## 0. 필름 준비
- `films/<이름>/`이 없으면 `npm run new -- <이름>`.
- 디자이너가 레퍼런스(이미지, 영상)나 음악을 줬으면 `films/<이름>/refs/`, `films/<이름>/audio/track.wav`에 둔다.

## 1. 입력 받기 (brief.md)
`prompts/spec-template.md`의 `<inputs>` 항목 중 빈 것을 한 번에 묻는다. 기본값을 제안하면서 묻는다
(예: "포맷은 1x1 + 9x16, 음악은 합성으로 할까요?"). 답을 `brief.md`에 채운다.
실제 프로덕트 화면이 필요하면 스크린샷을 달라고 하거나 URL에서 Playwright로 직접 캡처한다. 프로덕트 UI를 상상으로 그리지 않는다.

## 2. 레퍼런스 → style_guide.md (있을 때만)
`prompts/reference.md` 절차. 문법만 가져오고 내용은 가져오지 않는다.

## 3. 숏리스트 → 디자이너 OK
`films/<이름>/shotlist.md`에 비트 그리드 표를 쓴다:

| 비트 | 시각 | 상태 | 커서 | 효과음 |
|---|---|---|---|---|

음악 파일이 있으면 먼저 디자이너에게 BPM과 첫 다운비트 시각(초)을 묻고 `bpm`·`beatOffset`으로 쓴다. 비트를 자동으로 측정하지 않는다.
**표를 보여주고 OK를 받기 전에는 코드를 쓰지 않는다.**

## 4. 구현
`films/<이름>/film.json`(데이터)과 `films/<이름>/index.html`(코드). `films/sample-morph/`를 구조 참고로 읽는다(film.json의 params·timeline·cues, index.html의 STATES 표, CUR 커서 키, 상태별 draw 함수).
- 숏리스트의 장면 시각은 `film.json` `timeline`에 이름을 붙여 옮기고, 코드에서는 `film.T.<이름>`으로만 쓴다.
- 화면에 나오는 문구, 포인트 컬러, 배경색은 `params`로 뺀다. `label`은 디자이너가 알아볼 한국어로.
- 컨테이너 크기/모서리/색/카메라: `loopTrack` (루프 아니면 `track`)
- 커서: 화면 좌표 키, UI를 가리킬 땐 그 시점 줌을 곱한다. 클릭은 카메라가 멈춘 뒤.
- 상태 안 내용: `swapAlpha` + `swapBlur`
- 인디케이터/노브: `stretch`
- 효과음: `film.json` `cues` (`at`으로 timeline에 붙인다). 반복 패턴만 코드의 `cues`

## 5. 스틸 → 직접 보기
`node tools/render.mjs films/<이름> --stills beats` → `out/<이름>/<포맷>/contact-beats.png`를 Read로 열어서 본다.
비트에 아무것도 없는 칸, 너무 작은 글자, 화면 밖으로 나간 커서, 겹침을 고친다. 깨끗해질 때까지 반복.

## 6. 렌더 + 사운드 + 크리틱 루프
```bash
node tools/render.mjs films/<이름>          # 1x1 기준 12초 ≈ 3분
node tools/sound.mjs films/<이름>
bash tools/critique.sh films/<이름> <포맷> <가장 빠른 동작 시각>
```
그다음 `/motion-critique` 절차(`prompts/critique-pass.md`)로 채점 → 수정 → 재렌더. 모든 항목 8점 이상, 최소 3라운드.
`bash tools/determinism.sh films/<이름>`이 통과해야 한다.

## 7. 전달
- 요청된 포맷 전부 렌더 (`--all-formats` 또는 `--format`)하고 포맷마다 `sound.mjs --format`.
- 포스터: `node tools/render.mjs films/<이름> --stills <가장 좋은 시각>`.
- 디자이너에게: final.mp4 경로, 컨택트 시트, 최종 점수, 다음에 개선할 점 한 줄.

## 수정 요청이 오면
"3초쯤 토글이 너무 빨라요" → 해당 키의 시각/스프링 프리셋만 바꾸고 `--from 2.5 --to 4.5`로 구간 렌더해서 먼저 보여준다. OK면 전체 렌더.
