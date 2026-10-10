<p align="center">
  <img src="build/icon.svg" width="96" height="96" alt="Motion Studio">
</p>

<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/wordmark-dark.svg">
    <img src="assets/brand/wordmark-light.svg" height="28" alt="Motion Studio">
  </picture>
</h1>

<p align="center">
  디자이너가 말로 요청하면 AI 에이전트가 모션 영상과 Lottie를 만들고, 렌더하고, 자기 프레임을 직접 보고 고치는 macOS 앱.<br>
  이 README는 <b>코드에 기여하려는 개발자</b>를 위한 문서입니다.
</p>

<p align="center">
  <a href="https://kimtaeho-dev.github.io/motion-studio/"><b>소개·다운로드</b></a>
  &nbsp;·&nbsp;
  <a href="https://kimtaeho-dev.github.io/motion-studio/guide.html">사용 가이드</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/kimtaeho-dev/motion-studio/releases">릴리스</a>
</p>

---

앱을 쓰려는 분은 [소개 페이지](https://kimtaeho-dev.github.io/motion-studio/)에서 내려받고 [사용 가이드](https://kimtaeho-dev.github.io/motion-studio/guide.html)를 보세요. 아래는 레포를 고치는 사람을 위한 내용입니다.

## 한눈에

모든 영상은 HTML 한 장에 들어 있는 `window.seek(t)` 함수의 결과다. 에이전트(Claude Code)는 `films/<이름>/index.html`(움직임 코드)과 `film.json`(문구·색·장면 시각)을 쓰고, 렌더 도구로 프레임을 뽑아 직접 보고 고친다. 앱은 그 과정을 디자이너에게 보여 주고, 승인 버튼과 속성 패널·타임라인으로 사람이 끼어들 자리를 만든다.

프롬프트는 결과의 일부일 뿐이다. 나머지(렌더 엔진, 스프링, 비트 그리드, 결정적 렌더, 자기 프레임을 보는 검수 루프, 검사 도구)가 이 레포다.

```
디자이너 ── 채팅 ──▶ 앱(src/) ── 메일박스 ──▶ claude -p (에이전트)
                     ▲                           │  CLAUDE.md · prompts/ · .claude/skills/
                     │ state.json · film.json     ▼
                  플레이어 ◀── lib/ (seek(t)) ◀── films/<이름>/ ──▶ tools/render · critique · lottie
```

## 개발 환경

```bash
brew install node ffmpeg
npm install            # Electron(렌더 엔진 겸 앱) 포함
```

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 앱 화면 개발 서버 http://localhost:3040. 작업 폴더 = 이 레포 |
| `npm run app` | 빌드 후 Electron 실행. 작업 폴더 = `~/Library/Application Support/Motion Studio/workspace` |
| `npm run preview` | 필름 하나를 브라우저로 미리보기 http://localhost:4173 (스크러버, 비트 그리드) |
| `npm run dist:mac` | ffmpeg 받기(체크섬 검증) → `release/*.dmg` (arm64, x64, ad-hoc 서명) |

작업 폴더는 `MOTION_STUDIO_WORKSPACE` 환경 변수로 바꿀 수 있다. 패키징한 앱을 깨끗한 작업 폴더로 시험할 때 쓴다.

앱 없이 에이전트만 돌리려면 이 폴더에서 Claude Code를 열고 `/motion-film <이름>`으로 요청한다. 에이전트가 따르는 규칙은 [CLAUDE.md](CLAUDE.md)에 있다.

## 레포 구조

```
CLAUDE.md               에이전트의 하우스 룰: 렌더 계약, 금지 룩, 작업 순서(게이트), Lottie·Figma 규칙
.claude/skills/         /motion-film (브리프→전달), /motion-critique (채점·수정)
prompts/                에이전트가 단계별로 읽는 문서: api.md(2D) · 3d.md · lottie.md · lottie-recipes/ · figma.md
                        spec-template.md · critique-pass.md · reference.md · director-brief.md
lib/                    렌더 엔진. 필름이 불러 쓰는 유일한 코드
  motion.js             spring · track · loopTrack · stretch · swapAlpha · rng
  stage.js              film.json 읽기, 포맷·단위, seek(t) 계약, Stage.svg(SVG 에셋)
  stage3d*.js           three.js 장면·기기 목업·입체 글자, Rapier 물리 굽기, --check3d 검사
  stage-lottie.js       Lottie 필름 셸(Skottie로 미리보기·렌더)
  lottie/               CanvasKit, lottie-web, 슬롯 굽기(bake.mjs), 패리티 비교(parity.js)
tools/                  에이전트와 사람이 같이 쓰는 CLI (아래)
films/                  _template, _template-lottie, 샘플(sample-morph, sample-3d, sample-physics, sample-lottie)
src/                    앱 화면 (Solid + Tailwind). 플레이어, 속성 패널, 타임라인, 채팅, 진행 단계, 내보내기
server/                 Vite 개발 서버와 앱이 같이 쓰는 백엔드: 필름 목록, 메일박스(에이전트 호출), 렌더, 내보내기
electron/               Electron 메인, 첫 실행 준비(Claude Code 설치·로그인), 숨김 창 렌더 워커
site/                   소개 페이지와 사용 가이드 (GitHub Pages)
docs/                   APP_PLAN · DESIGN_SYSTEM · RELEASE_CHECK · RELEASE_NOTES
assets/                 글꼴(Pretendard, Geist, Geist Mono — OFL), 브랜드 자산
```

`films/`의 다른 폴더와 `out/`은 git에 올라가지 않는다(디자이너의 작업물이다). 템플릿과 샘플만 추적한다.

### tools/

| 명령 | 하는 일 |
| --- | --- |
| `node tools/new.mjs <이름> [--lottie]` | 템플릿에서 새 필름 |
| `node tools/render.mjs films/<이름>` | 최종 렌더(60fps, 4 서브프레임 모션블러). `--stills beats` · `--draft` · `--all-formats` · `--codec prores\|webm\|gif` · `--check3d` · `--parity` |
| `node tools/critique.mjs films/<이름>` | 에이전트가 열어 보고 채점할 이미지: 컨택트 시트, 빠른 동작 스트립, 폰 크기, 루프 이음새 |
| `node tools/determinism.mjs films/<이름>` | 같은 프레임을 두 번 그려 픽셀이 같은지 |
| `node tools/state.mjs films/<이름> stage=…` | 진행 단계 기록(앱이 이걸 보고 단계·승인 버튼을 띄운다) |
| `node tools/engine.mjs films/<이름>` | 엔진 고정 상태 |
| `node tools/lottie.mjs sync\|check\|export\|text` | Lottie: film.json 맞추기, 호환·움직임 검사, 슬롯 굽기와 .lottie 묶기, 글자→아웃라인 |
| `node tools/turn-timing.mjs films/<이름>` | 앱 채팅 턴마다 시간을 모델·도구·네트워크로 쪼갠다 |

## 지켜야 할 원리

기여할 때 깨면 안 되는 것들이다. 자세한 규칙은 [CLAUDE.md](CLAUDE.md).

- **프레임은 t의 순수 함수다.** `draw(g, t, S)` 안에서 t만으로 모든 값을 계산한다. 타이머, 누적 상태, `Math.random`, `Date.now()`가 없어서 어느 프레임이든 바로 그리고, 몇 번을 렌더해도 같은 픽셀이 나온다. 엔진을 고치면 `tools/determinism.mjs`로 확인한다.
- **코드와 데이터를 나눈다.** 움직임은 `index.html`, 디자이너가 바꿀 값과 장면 시각은 `film.json`. 앱의 속성 패널과 타임라인은 `film.json`만 고친다. 장면 시각은 코드에 박지 않고 `film.T`에서 읽는다.
- **스프링을 더한다.** 목표가 바뀔 때마다 스프링을 새로 시작하지 않고 하나씩 더한다(`track`). `loopTrack`은 루프 이음새의 위치와 속도까지 맞춘다.
- **엔진 고정.** `stage=deliver`가 그때의 `lib/`을 `lib-versions/<해시>`로 복사한다. 앱이 업데이트돼도 전달한 필름은 같은 픽셀로 렌더된다. 그래서 `lib/`의 동작 변경은 새 필름에만 적용된다고 생각하고 고친다.
- **게이트를 건너뛰지 않는다.** 브리프 → 숏리스트(승인) → 스틸 → 초안 → 검수 → 전달. 에이전트는 승인 전에는 코드를 쓰지 않는다. 앱의 단계 표시는 `state.json`에서 나온다.
- **Lottie는 두 렌더러가 같아야 한다.** 미리보기는 Skottie(CanvasKit), 실제 서비스는 lottie-web이다. `--parity`가 둘을 9개 시점에서 비교한다. `lottie.json`은 손으로 쓰지 않고 필름의 `build.mjs`(`tools/lottie/kit.mjs`)로 만든다.

## 무엇을 고칠 때 무엇을 보나

| 바꾸는 곳 | 확인 |
| --- | --- |
| `lib/` (엔진) | 샘플 필름 `--stills beats`, `determinism.mjs`, 3D면 `--check3d`. 전달된 필름은 고정 엔진으로 도는지 |
| `lib/lottie/`, `tools/lottie*` | `sample-lottie`로 `lottie.mjs check` BLOCK 0, `render.mjs --parity` 통과, `export` 결과를 lottie-web에서 재생 |
| `prompts/`, `CLAUDE.md`, 스킬 | 앱에서 실제로 필름 하나를 끝까지 만들어 보고, `turn-timing.mjs`로 턴 시간이 늘지 않았는지 |
| `src/`, `server/`, `electron/` | `npm run dev`로 화면 확인 후, 패키징한 앱(`npm run dist:mac`)에서 한 번 더. 개발 서버에서만 되는 경우가 많다 |
| `site/` | `python3 -m http.server 4180 --directory site`로 보고, 폰 너비(375px)도 확인 |

에이전트 동작을 바꾸는 수정은 결과물로 판단한다. 프롬프트가 그럴듯해 보이는지보다, 바꾼 뒤 만든 필름의 스틸과 렌더가 나아졌는지를 본다.

## 브랜치·커밋

- `main`에서 브랜치를 따서 작업하고 PR로 올린다.
- 커밋 메시지는 한국어로, 첫 줄에 **무엇이 어떻게 바뀌는지**를 쓴다. 예: `Lottie 속도: 일찍 끝내기, build.mjs, 채점 전 대조`
- 앱 화면의 문구는 해요체로 쓰고, 디자이너가 아는 말로 쓴다(파일 이름·명령어를 화면에 노출하지 않는다). 색·간격·글꼴은 [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)를 따른다.
- 새 의존성은 꼭 필요할 때만. 앱에 함께 배포되는 라이브러리는 [LICENSES/README.md](LICENSES/README.md)에 고지를 더한다.

## 릴리스와 배포

- **앱**: 버전을 올리고 [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md)를 쓴 뒤 [docs/RELEASE_CHECK.md](docs/RELEASE_CHECK.md)의 순서대로 새 macOS 계정에서 점검하고 `gh release create`로 dmg 두 개를 올린다.
- **소개 페이지**: `site/`가 바뀐 커밋이 `main`에 올라오면 `.github/workflows/pages.yml`이 GitHub Pages로 배포한다. 다운로드 버튼은 GitHub API로 최신 릴리스의 dmg를 찾아 가리키므로 릴리스할 때 페이지를 고칠 필요는 없다.

## 라이선스 · 출처

앱에는 FFmpeg(GPL 3.0), Electron, three.js, Rapier, CanvasKit, lottie-web, Pretendard·Geist 글꼴이 들어 있다. 고지는 [LICENSES/README.md](LICENSES/README.md).
파이프라인은 Movez, "How to build motion design studio with Opus 5.5 (Full-course)"(2026-09-27)를, UI 모핑 스펙은 @twoclipping의 공개 템플릿을 바탕으로 했다.
