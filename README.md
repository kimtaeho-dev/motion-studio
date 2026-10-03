# motion-studio

코드로 만드는 모션 스튜디오. After Effects 없이, Claude Code에게 말로 요청하면 모션 영상(MP4)이 나온다.

> 프롬프트는 영상의 10%다. 나머지 90%는 하네스(렌더 엔진, 스프링, 비트 그리드, 사운드, 자기 프레임을 보는 크리틱 루프)다.
> 이 레포가 그 90%다.

![sample](docs/sample-contact.png)

## 디자이너용: 이렇게 쓴다

Claude Code를 이 폴더에서 열고 말하면 된다.

```
/motion-film onboarding-reel
업클래스 신규 온보딩 3단계를 9:16 15초 릴로 만들어줘. 스크린샷은 refs/에 넣어뒀어.
```

Claude가 순서대로 진행한다. 게이트마다 멈추고 확인을 받는다.

1. **질문**: 상태 목록, 문구, 색, 포맷, 음악 중 비어 있는 것을 한 번에 묻는다 → `brief.md`
2. **숏리스트**: 비트 단위 표(시각, 상태, 커서, 효과음)를 보여준다 → `shotlist.md` — **여기서 OK를 줘야 코드를 쓴다**
3. **스틸**: 비트마다 1장씩 뽑은 컨택트 시트를 직접 보고 고친다
4. **렌더 + 사운드 + 크리틱**: 7개 항목을 채점하고, 모두 8점 이상이 될 때까지 최소 3라운드 고친다 → `review_log.md`
5. **전달**: `out/<이름>/<포맷>/final.mp4`

수정은 말로 하면 된다: "3초쯤 토글이 너무 빨라요", "포인트 컬러 업비트 블루로", "9:16도 뽑아줘".

브라우저로 직접 보려면 `npm run preview` → http://localhost:4173 에서 필름을 연다.
스크러버를 드래그하거나 Space(재생/정지), ←/→(1프레임), Shift+←/→(1비트)로 움직인다. grid를 켜면 비트 번호가 보인다.

## 설치

```bash
# macOS
brew install node ffmpeg python
npm install && npx playwright install chromium
```

## 구조

```
CLAUDE.md                 하우스 룰. Claude가 매번 읽는다 (렌더 계약, 금지 룩, 작업 순서)
.claude/skills/
  motion-film/            /motion-film — 브리프부터 전달까지 전체 파이프라인
  motion-critique/        /motion-critique — 렌더 결과를 보고 채점·수정
lib/
  motion.js               스프링(닫힌 해), track/loopTrack, stretch, swapAlpha, rng …
  stage.js                film.json 로딩·검사, 캔버스·포맷·폰트·미리보기 UI·렌더 계약 (window.seek / FILM / READY / Stage.reload)
tools/
  render.mjs              Playwright 프레임 캡처 → ffmpeg (60fps, 4 서브프레임 모션블러)
  sound.mjs               효과음·음악 합성, 믹스, -14 LUFS → final.mp4
  critique.sh             contact / strip / phone / seam / loop_check
  determinism.sh          같은 프레임 두 번 렌더 → 같은 픽셀인지
  new.mjs, preview.mjs
prompts/
  spec-template.md        XML 스펙 (inputs / direction / structure / build / gotchas / start)
  critique-pass.md        채점 기준과 찾을 문제 목록
  reference.md            레퍼런스 → style_guide.md
  director-brief.md       30초 이상 긴 작업용 브리프
films/
  _template/              npm run new -- <이름> 이 복사하는 원본 (index.html + film.json)
  sample-morph/           샘플: 하나의 도형이 9개 UI 상태를 지나는 12초 루프
assets/fonts/             Pretendard, Geist, Geist Mono (OFL) — 기기마다 결과가 같도록 레포에 포함
```

## 엔진의 원리

- **seek(t)**: 필름은 "t초의 프레임을 그려라"라는 함수 하나다. 타이머도, 누적 상태도 없다. 그래서 812번째 프레임을 0~811 없이 바로 그릴 수 있고, 몇 번을 렌더해도 같은 픽셀이 나온다. 수정은 한 줄 고치고 그 구간만 다시 렌더하면 된다.
- **스프링을 더한다**: 목표가 여러 번 바뀌는 값(커서, 컨테이너 폭)은 스프링을 다시 시작하지 않고 변화마다 하나씩 더한다(`track`). 움직임이 끊기지 않고, 여전히 t의 순수 함수다. `loopTrack`은 이전 사이클의 꼬리까지 더해서 루프 이음새의 위치와 속도를 정확히 맞춘다.
- **늘어나는 인디케이터**: 탭 인디케이터와 토글 노브는 앞 끝과 뒤 끝이 서로 다른 스프링을 탄다(`stretch`). 이동 중에 액체처럼 늘어났다가 붙는다.
- **모션 블러**: 프레임마다 4장의 서브프레임을 렌더해서 ffmpeg `tmix`로 평균낸다.
- **코드와 데이터 분리**: 움직임은 `index.html`, 바꿀 만한 값(문구·색·장면 시각·효과음)은 `film.json`. 장면 시각을 옮기면 거기 붙은 효과음과 움직임이 함께 따라온다.
- **사운드**: 효과음은 `film.json`의 `cues`(`{ at, dt, type }` 또는 `{ t, type }`)로 선언하면 `sound.mjs`가 합성한다. 음악이 없으면 BPM에 맞춰 루프 가능한 베드를 합성한다.

스프링 프리셋 (`M.sp('이름')`):

| 이름 | 용도 |
|---|---|
| snappy | 버튼, 토글, 인디케이터 앞 끝 |
| ui | 카드, 컨테이너 (기본) |
| camera | 카메라, 큰 레이아웃 |
| heavy | 큰 타이포, 로고 |
| playful | 마스코트, 스티커 (UI엔 쓰지 않음) |

## 명령어

```bash
npm run new -- <이름>
npm run preview
node tools/render.mjs films/<이름> --stills beats     # 비트마다 스틸
node tools/render.mjs films/<이름> --draft            # 빠른 초안 (30fps, 절반 해상도)
node tools/render.mjs films/<이름>                    # 최종
node tools/render.mjs films/<이름> --from 4 --to 6    # 구간만
node tools/render.mjs films/<이름> --all-formats
node tools/sound.mjs films/<이름> [--format 9x16]
bash tools/critique.sh films/<이름> [포맷] [시각]
bash tools/determinism.sh films/<이름>
```

렌더 시간 참고: 1080×1080, 12초, 60fps, 4 서브프레임 ≈ 3분. 초안은 수십 초.

## lottie-studio와의 차이

lottie-studio는 프로덕트에 들어가는 Lottie 에셋(lottie-web 재생)을 만든다. motion-studio는 SNS, 런칭, 내부 공유용 **영상(MP4)**을 만든다.
앱 안에서 재생되는 인터랙션이면 lottie-studio, 보여주는 영상이면 motion-studio.

## 출처

Movez, "How to build motion design studio with Opus 5.5 (Full-course)"(2026-09-27)의 파이프라인을 팀용으로 옮겼다.
UI 모핑 스펙은 @twoclipping의 공개 템플릿을 바탕으로 했다.
