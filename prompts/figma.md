# Figma 링크로 만들기

디자이너가 Figma 링크(`figma.com/design/<파일키>/…?node-id=<노드>`)를 주면 이 문서를 따른다. 목표는 **디자이너의 실제 화면을 상상으로 다시 그리지 않고**, Figma의 숫자·글자·이미지 그대로 움직이게 하는 것이다.
링크의 `node-id=215-32`는 도구에 `215:32`로 넘긴다. `node-id`가 없는 링크면 프레임을 오른쪽 클릭 → "선택 항목 링크 복사"로 다시 달라고 한다.

## 연결과 사용량

- Figma는 claude.ai 커넥터로 붙는다. Figma 도구(`get_metadata` 등)가 보이지 않거나 인증 오류면 디자이너에게 이렇게 말하고 `waiting=answer`로 턴을 끝낸다: "claude.ai 설정 → 커넥터에서 Figma를 연결한 뒤 다시 보내 주세요."
- **읽기 호출은 수가 정해져 있다.** 무료·Starter 요금제나 보기·Collab 좌석은 한 달에 20번, 유료 Dev·Full 좌석은 하루 200번 정도. 그래서:
  - 프레임 하나에 **`get_metadata` 1번 + `download_assets` 1번 + (우리 글꼴이 아닌 글자가 있으면) 프레임 전체 SVG `download_assets(…, defaultFormat: "svg")` 1번**, 최대 3번이다. 글자 노드마다 따로 받지 않는다.
  - `get_design_context`는 쓰지 않는다(웹 코드용이라 크고, 우리에겐 필요 없다). `get_screenshot`도 따로 부르지 않는다 — `download_assets`의 `export`가 같은 렌더다.
  - **받은 것은 모두 `films/<이름>/refs/figma/`에 저장하고 다시 부르지 않는다.** 다음 턴·수정 요청에서는 저장한 파일을 읽는다. Figma 쪽 디자인이 바뀌었다고 디자이너가 말할 때만 다시 받는다.
- 오류를 디자이너 말로 바꿔 전한다:
  - "edit access"가 없다는 오류 → "이 파일은 편집 권한이 없어서 읽을 수 없어요. Figma에서 파일 이름 메뉴 → '내 드래프트로 복제'를 한 뒤, 복제본에서 같은 프레임 링크를 보내 주세요."
  - 사용량 초과(rate limit) → `whoami`로 요금제를 확인하고 "Figma 요금제의 이번 달 읽기 횟수를 다 썼어요. 프레임을 'Copy as SVG/PNG'로 복사해 채팅에 붙여 주시면 그걸로 이어서 만들게요."

## 받기 (films/<이름>/refs/figma/)

모든 경로는 레포(작업 폴더) 기준이다. `refs/figma/`만 쓰면 작업 폴더 맨 위에 생기니, 항상 `films/<이름>/`부터 적는다. 단, 필름 코드(`index.html`) 안에서는 필름 페이지 기준이라 `Stage.svg('refs/figma/215-32.svg')`처럼 `refs/figma/…`로 부른다.

1. `get_metadata(fileKey, nodeId)` → `films/<이름>/refs/figma/<노드>.xml`로 그대로 저장. 레이어 이름·종류·위치·크기와 **글자 내용**(TEXT 노드 이름)이 들어 있다.
2. `download_assets(fileKey, nodeId)` → 응답의 URL은 잠깐만 유효하니 바로 받는다(`curl -L -o`).
   - `export` → `films/<이름>/refs/figma/<노드>-full.png`. 매우 클 수 있으니 받은 뒤 `sips -Z 1600`으로 줄인다. **참고용**(대조에 쓴다).
   - `rawImages` → `films/<이름>/refs/figma/img-<n>.<format>`. 사진·일러스트 원본 = **그대로 쓰기 에셋**.
   - `svgAssets` → `films/<이름>/refs/figma/<이름>.svg`. 아이콘·로고 = **그대로 쓰기 에셋**.
3. 프레임 전체 SVG를 받았으면 `films/<이름>/refs/figma/<노드>.svg`.
4. **저장 확인**: `ls films/<이름>/refs/figma/` — `<노드>.xml`과 `<노드>-full.png`(SVG를 받았으면 `<노드>.svg`도)가 있어야 다음 단계로 간다. 받은 것을 `films/<이름>/refs/` 바로 아래나 다른 곳에 두지 않는다 — 다음 턴과 수정 요청이 이 폴더를 보고 Figma를 다시 부르지 않기 때문이다. 이미지 파일 이름은 알아보기 쉽게 바꿔도 되지만(`img-bag.jpg`) 폴더는 `films/<이름>/refs/figma/`다.
5. `brief.md`의 `<inputs>`에 Figma 링크, 노드, 받은 파일 목록과 각각의 쓰임(참고/에셋)을 적는다.
6. 원본 이미지가 수 MB면 화면에 쓰는 크기의 2배 정도로 줄여 둔다(`sips -Z`). 원본은 지우지 않는다.

## 다시 만들기 — 무엇을 코드로, 무엇을 파일로

Figma 프레임을 필름 화면에 옮길 때 배율은 `k = 필름에서 그 화면이 차지할 폭 / Figma 프레임 폭`. 위치·크기·모서리·글자 크기 모두 Figma 숫자에 `k`를 곱한다(눈대중으로 바꾸지 않는다).

| Figma에 있는 것 | 필름에서 |
|---|---|
| Pretendard·Geist로 된 글자 | 코드로 다시 쓰고 문구를 `params`(text)로 연다 → 속성 패널에서 바뀐다 |
| 그 밖의 글꼴로 된 글자(포스터 제목 등) | **프레임 전체**를 `download_assets(…, defaultFormat: "svg")`로 한 번 받아 `films/<이름>/refs/figma/<노드>.svg`로 저장 → `Stage.svg(…, { split: true })`로 불러 `only: '<레이어 이름>'`으로 그 글자만 그린다(이름은 get_metadata의 TEXT 이름). 외곽선이라 원래 글꼴 모양이 그대로 남는다. 문구는 고정이라는 것을 디자이너에게 알린다(바꾸려면 Figma에서 고친 뒤 다시 받기) |
| 사진·일러스트(rawImages) | 그대로 쓰기 에셋 → `Image` + `drawImage` |
| 아이콘·로고(svgAssets) | 그대로 쓰기 에셋 → `Stage.svg` |
| 사각형·카드·버튼처럼 움직일 컨테이너 | 코드로 다시 만든다(모핑·크기 변화를 주려면 코드여야 한다). Figma의 크기·모서리·색 그대로 |
| 색 | 배경·포인트 컬러처럼 디자이너가 바꿀 만한 것은 `params`(color)로 |

- 우리 글꼴 규칙(CLAUDE.md)은 그대로다. 다른 글꼴을 쓰려고 글꼴 파일을 구하지 않는다 — 외곽선 SVG가 그 문제를 푼다.
- 화면 구성(무엇이 어디에)은 Figma 그대로 두고, **움직임만 더한다.** 브리프에서 디자이너가 구성을 바꾸자고 하지 않는 한 레이아웃을 새로 짜지 않는다. 다른 포맷(예: 1x1)으로 옮길 때만 영역을 다시 배치한다.
- 숏리스트의 마지막 상태(또는 대표 비트)는 Figma 화면과 같은 모습이 되게 짠다 — 디자이너가 그린 완성 화면이 영상의 "착지"다.

## 확인 (검수에 더한다)

- **Figma 대조**: 숏리스트에서 Figma 화면과 같아야 하는 시각의 스틸을 `films/<이름>/refs/figma/<노드>-full.png`와 나란히 놓고 본다(`ffmpeg … hstack`). 위치·크기·색·글자가 어긋나면 고칠 점이다. `review_log.md`에 "Figma 대조: 맞음/어긋남(무엇)"을 적는다.

## Lottie 필름이면

`prompts/lottie.md`가 우선이다. Figma에서는 아이콘·로고(`svgAssets`)와 외곽선 글자 SVG를 받아 `prompts/lottie-recipes/svg-animation.md`대로 셰이프 레이어로 옮긴다. 사진(`rawImages`)은 Lottie 이미지 에셋으로 넣되, 파일이 커지니 꼭 필요한 것만.
