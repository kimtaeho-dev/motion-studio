---
name: motion-film
description: 코드로 모션 영상(UI 모핑 루프, 프로덕트 릴, 런칭 영상, 기능 소개 모션, SNS 모션 광고)을 만든다. 디자이너가 "모션 만들어줘", "영상 만들어줘", "런칭 릴", "/motion-film <이름>" 이라고 할 때 사용.
---

# motion-film

디자이너는 코드를 몰라도 된다. 말로 요청하면 이 파이프라인을 끝까지 돌리고, 게이트마다 확인을 받는다.
규칙은 레포 루트 `CLAUDE.md`가 우선한다. 단계가 바뀔 때마다 `node tools/state.mjs films/<이름> stage=<단계>`로 기록한다(앱의 진행 단계 표시와 승인 버튼이 이걸 본다).

## 0. 필름 준비
- `films/<이름>/`이 없으면 `node tools/new.mjs <이름>`.
- 디자이너가 레퍼런스(이미지, 영상)나 3D 모델(.glb)을 줬으면 `films/<이름>/refs/`에 둔다.

## 1. 입력 받기 (brief.md)
`prompts/spec-template.md`의 `<inputs>` 항목 중 빈 것을 한 번에 묻는다. 기본값을 제안하면서 묻는다
(예: "포맷은 1x1 + 9x16, 템포는 120BPM으로 할까요?"). 물었으면 `waiting=answer`로 기록하고 턴을 끝낸다. 답을 `brief.md`에 채운다.
실제 프로덕트 화면이 필요하면 디자이너에게 스크린샷을 달라고 한다(채팅창에 끌어다 놓으면 refs/에 저장된다). 프로덕트 UI를 상상으로 그리지 않는다.
브리프·숏리스트 단계에서는 `lib/`·`prompts/api.md`·`prompts/3d.md`·샘플 코드를 읽지 않는다 (구현 단계에서 읽는다 — 먼저 읽으면 이후 모든 단계에서 그만큼 비용이 든다).

## 2. 레퍼런스 → style_guide.md (있을 때만)
`prompts/reference.md` 절차. 문법만 가져오고 내용은 가져오지 않는다.

## 3. 숏리스트 → 디자이너 OK
`films/<이름>/shotlist.md`에 비트 그리드 표를 쓴다:

| 비트 | 시각 | 상태 | 커서 |
|---|---|---|---|

편집에서 얹을 곡이 정해져 있으면 먼저 디자이너에게 그 곡의 BPM과 첫 다운비트 시각(초)을 묻고 `bpm`·`beatOffset`으로 쓴다. 비트를 자동으로 측정하지 않는다.
다 쓰면 `node tools/state.mjs films/<이름> stage=shotlist waiting=approval`, 채팅에 표를 보여주고 승인을 부탁한 뒤 턴을 끝낸다.
**승인(앱의 승인 버튼 또는 채팅의 분명한 OK) 전에는 코드를 쓰지 않는다.**

## 4. 구현
`films/<이름>/film.json`(데이터)과 `films/<이름>/index.html`(코드). API는 `prompts/api.md`를 본다(`lib/` 소스를 통째로 읽지 않는다).
- `index.html` 맨 위 주석에 **장면 의도**를 남긴다: 비트마다 무엇이 왜 움직이는지 한 줄씩(timeline 키로). 수정 요청이 오면 코드보다 이 주석과 상태 표를 먼저 본다.
2D 필름은 `films/sample-morph/`를 구조 참고로 읽는다(film.json의 params·timeline, index.html의 STATES 표, CUR 커서 키, 상태별 draw 함수). 3D·물리 필름은 `prompts/3d.md`를 읽는다(뼈대 포함 — 샘플은 막힐 때만).
- 숏리스트의 장면 시각은 `film.json` `timeline`에 이름을 붙여 옮기고, 코드에서는 `film.T.<이름>`으로만 쓴다.
- 화면에 나오는 문구, 포인트 컬러, 배경색은 `params`로 뺀다. `label`은 디자이너가 알아볼 한국어로.
- 컨테이너 크기/모서리/색/카메라: `loopTrack` (루프 아니면 `track`)
- 커서: 화면 좌표 키, UI를 가리킬 땐 그 시점 줌을 곱한다. 클릭은 카메라가 멈춘 뒤.
- 상태 안 내용: `swapAlpha` + `swapBlur`
- 인디케이터/노브: `stretch`
- 소리는 만들지 않는다 (CLAUDE.md, 소리와 템포)
- 3D(기기 목업, 제품 모델, 입체 글자, 재질 도형)·물리는 `prompts/3d.md`의 규칙과 뼈대대로. 포맷별 배치 표 + `W.fit`, 화면 속 UI는 `screen().draw`에서 2D로, 물체는 이름을 붙여 `W.add({ 이름: obj })`. 줄 세우기는 `row()`, 떨어뜨리기는 `pos: 'above'` + `land: { at: 비트 }`. 좌표를 손으로 계산하지 않는다.

## 5. 스틸 → 직접 보기
`stage=stills`. `node tools/render.mjs films/<이름> --stills beats` → `out/<이름>/<포맷>/contact-beats.png`를 Read로 열어서 본다.
비트에 아무것도 없는 칸, 너무 작은 글자, 화면 밖으로 나간 커서, 겹침을 고친다. 깨끗해질 때까지 반복.
3D면 주 포맷 하나로 `node tools/render.mjs films/<이름> --check3d` → 판정이 통과면 다음 단계. 실패면 `→` 제안대로 고치고 한 번 더 (2라운드까지, `prompts/3d.md`의 3D 검사).

## 6. 렌더 + 크리틱 루프
초안은 `stage=draft`, 크리틱은 라운드마다 `stage=critique round=<N>`.
```bash
node tools/render.mjs films/<이름>          # 1x1 기준 12초 ≈ 20초
node tools/critique.mjs films/<이름> <포맷> <가장 빠른 동작 시각>
```
그다음 `/motion-critique` 절차(`prompts/critique-pass.md`)로 채점 → 수정 → 재렌더. 라운드 수는 `state.json`의 `quality`(CLAUDE.md 6번): fast 1 · standard 3 · launch 전 항목 8점 이상까지(6라운드 상한).
`node tools/determinism.mjs films/<이름>`이 통과해야 한다.

## 7. 전달
- 요청된 포맷 전부 렌더 (`--all-formats` 또는 `--format`).
- 포스터: `node tools/render.mjs films/<이름> --stills <가장 좋은 시각>` → 그 스틸을 `out/<이름>/<포맷>/poster.png`로 복사.
- `node tools/state.mjs films/<이름> stage=deliver waiting=none`.
- 디자이너에게: 완성본이 플레이어 아래 결과물 줄에 있다는 것, 최종 점수, 다음에 개선할 점 한 줄. 파일 경로는 말하지 않는다.

## 수정 요청이 오면
`index.html` 맨 위의 장면 의도와 상태 표부터 읽고 고칠 곳을 찾는다(코드 전체를 다시 읽지 않는다). 고친 뒤 의도가 바뀌었으면 주석도 고친다.
"3초쯤 토글이 너무 빨라요" → 해당 키의 시각/스프링 프리셋만 바꾸고 `--from 2.5 --to 4.5`로 구간 렌더해서 먼저 보여준다. OK면 전체 렌더.
