---
name: motion-critique
description: 렌더된 모션 영상을 직접 보고 7개 항목으로 채점하고, 가장 큰 문제 3개를 고친다. "크리틱해줘", "검수해줘", "점수 매겨줘", 렌더 직후 품질 확인에 사용.
---

# motion-critique

1. `node tools/critique.mjs films/<이름> [포맷] [빠른동작시각]` 실행.
2. `out/<이름>/<포맷>/critique/`의 contact.png, strip.png, phone.png, seam.png를 **Read로 열어서 본다.** 보지 않고 채점하지 않는다.
   3D 필름이면 포맷마다 `node tools/render.mjs films/<이름> --format <포맷> --check3d`도 돌리고 `check3d/views.png`, `check3d/motion.png`를 연다. 파고듦·바닥 아래가 남아 있으면 그게 가장 큰 문제다.
3. `prompts/critique-pass.md`의 7개 항목을 1~10점으로 채점. 깐깐한 모션 디렉터로 본다. 후하게 주지 않는다.
4. 가장 큰 문제 3개를 타임스탬프와 함께 적고 고친다.
5. 바뀐 구간만 `node tools/render.mjs films/<이름> --from A --to B`로 확인 → 전체 재렌더 → 다시 1번.
6. 라운드마다 `films/<이름>/review_log.md`에 점수, 문제, 수정을 추가한다.
7. 모든 항목 8점 이상이면 멈추고 최종 점수를 보고한다. 3라운드를 넘겨도 8점이 안 되는 항목은 이유와 함께 디자이너에게 판단을 넘긴다.

확인 명령:
- 루프: `seam.png` 왼쪽 6장(끝)과 오른쪽 6장(처음)이 자연스럽게 이어지는지
- 결정성: `node tools/determinism.mjs films/<이름>`
