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
  <b>말로 만드는 모션 영상</b><br>
  원하는 영상을 말하면 AI 에이전트가 장면을 짜고, 렌더하고, 자기 프레임을 직접 보고 고칩니다.<br>
  After Effects도, 코드도, 터미널도 필요 없습니다.
</p>

<p align="center">
  <a href="https://github.com/kimtaeho-dev/motion-studio/releases/latest"><b>↓ 앱 다운로드 (macOS)</b></a>
  &nbsp;·&nbsp;
  <a href="#사용-가이드">사용 가이드</a>
  &nbsp;·&nbsp;
  <a href="#개발자용">개발자용</a>
</p>

<p align="center">
  <img src="docs/sample-contact.png" width="720" alt="샘플 필름의 비트별 컨택트 시트">
</p>

---

## 사용 가이드

### 1. 설치

[Releases](https://github.com/kimtaeho-dev/motion-studio/releases/latest)에서 dmg를 받아(M1 이후 맥은 `-arm64.dmg`) **응용 프로그램**으로 옮깁니다.
"확인되지 않은 개발자" 안내가 뜨면 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**를 한 번 누르면 됩니다.
처음 열 때 앱이 에이전트(Claude Code)를 설치하고 Anthropic 계정 로그인을 안내합니다. 그 밖에 따로 설치할 것은 없습니다.

### 2. 만들기

1. 왼쪽 `+`로 새 필름을 만듭니다. 먼저 **어디에 쓰나요?**를 고릅니다.
   - **영상으로 올릴 것**: SNS·발표·출시 릴. 포맷(1x1·9x16·16x9·4x5), 길이, 품질(빠르게 1라운드 · 기본 3라운드 · 런칭용 전 항목 8점 이상)을 고릅니다.
   - **앱·웹에 넣을 것**: 로더·성공 체크·아이콘·마이크로 인터랙션처럼 개발자에게 넘길 **Lottie** 애니메이션. 크기와 길이를 고릅니다. 아이콘 하나 같은 작은 것은 장면 표 승인 없이 바로 만들고, 웹·앱 플레이어에서도 똑같이 나오는지 검사까지 마친 뒤 넘깁니다.
2. 오른쪽 아래 채팅창에 원하는 영상을 말합니다. 레퍼런스 이미지·영상, 서비스 스크린샷, 제품 모델(.glb)은 끌어다 놓습니다.
   - "버튼이 로더를 거쳐 체크로 바뀌는 4초 루프, 포인트 컬러는 파랑"
   - "앱 출시를 알리는 15초 세로 영상. 첫 화면 → 검색 → 결과 → 저장 순서로"
   - "폰 목업이 돌면서 결제 화면이 체크로 바뀌고, 옆에 'Ship'이 입체 글자로"
3. 에이전트가 비트별 장면 표(숏리스트)를 보여주고 멈춥니다. **승인**을 눌러야 만들기 시작합니다.
4. 스틸 → 초안 → 검수를 거쳐 완성본이 나옵니다. 진행 단계는 오른쪽 위에 보입니다.

첨부한 파일 옆의 표시를 눌러 쓰임을 고를 수 있습니다.
- **참고용**: 분위기·색·리듬만 참고합니다. 다른 영상의 캡처처럼 내용을 가져오면 안 되는 파일. 이미지·영상의 기본값입니다.
- **그대로 쓰기**: 내 로고·아이콘·서비스 스크린샷처럼 영상에 그 파일 자체가 들어가야 하는 것. SVG와 3D 모델의 기본값입니다. SVG는 벡터 그대로 들어가서 확대해도 선명하고, 로고 획이 하나씩 그려지는 식으로 도형마다 따로 움직일 수 있습니다. 글자는 아웃라인(패스)으로 바꾼 SVG를 주세요.

에이전트는 화면을 상상해서 그리지 않으니 실제 서비스 화면이 필요하면 스크린샷을 **그대로 쓰기**로 주세요.
영상에는 소리가 없습니다. 편집에서 얹을 곡이 있으면 BPM과 첫 박 시각을 알려 주면 장면을 박자에 맞춥니다.

### 3. 직접 고치기

- **속성 탭**: 문구·색·숫자·장면 시각을 바로 고칩니다.
- **타임라인**: 파란 장면 표시를 끌어 옮깁니다(비트에 붙음, Alt는 프레임 단위).
- 직접 바꾼 값은 에이전트가 말없이 되돌리지 않습니다. 말로 고쳐 달라고 해도 됩니다.

단축키: Space 재생 · ←/→ 프레임 · Shift+←/→ 비트 · ⌘Z / ⇧⌘Z 되돌리기·다시 하기

### 4. 내보내기

플레이어 오른쪽 위 **내보내기**에서 Lottie(앱·웹, `.json`·`.lottie` — Lottie 필름만) · MP4(SNS·발표) · GIF(슬랙·노션) · ProRes 4444(편집 툴, 투명 배경) · WebM(웹, 투명 배경) · 포스터·컨택트 시트를 고릅니다.
결과는 **다운로드 → Motion Studio** 폴더에 모입니다.

### 이상할 때

| 증상 | 해결 |
| --- | --- |
| "이 필름을 열 수 없어요" | 에이전트에게 "필름이 안 열려"라고 말합니다 |
| "로그인이 풀렸어요" | **다시 로그인** → **다시 보내기** |
| 렌더가 오래 걸림 | 1080×1080 12초가 M 시리즈 맥에서 20~30초. 렌더 줄에서 취소할 수 있습니다 |
| 필름을 잘못 지움 | 작업 폴더의 `.trash`에 남아 있습니다 |

작업 폴더: `~/Library/Application Support/Motion Studio/workspace/` (`films/` 필름, `out/` 렌더 결과). 앱을 업데이트해도 지워지지 않습니다.

---

## 개발자용

모든 영상은 HTML 한 장에 들어 있는 `window.seek(t)` 함수의 결과다. 프롬프트는 영상의 10%이고, 나머지 90%(렌더 엔진, 스프링, 비트 그리드, 자기 프레임을 보는 크리틱 루프)가 이 레포다.

### 시작

```bash
brew install node ffmpeg
npm install            # Electron(렌더 엔진 겸 앱) 포함
npm run preview        # 브라우저 미리보기 http://localhost:4173
npm run dev            # 앱 화면 개발 서버 http://localhost:3040 (작업공간 = 이 레포)
npm run app            # 빌드 후 Electron 실행 (작업공간 = Application Support)
npm run dist:mac       # ffmpeg 받기(체크섬 검증) → release/*.dmg (arm64, x64, ad-hoc 서명)
```

앱 없이 쓰려면 이 폴더에서 Claude Code를 열고 `/motion-film <이름>`으로 요청한다. 작업 순서와 규칙은 [CLAUDE.md](CLAUDE.md)에 있다.

### 구조

```
CLAUDE.md               하우스 룰: 렌더 계약, 금지 룩, 작업 순서
.claude/skills/         /motion-film (브리프→전달), /motion-critique (채점·수정)
lib/                    motion.js(스프링·track·stretch) · stage.js(film.json·포맷·렌더 계약) · stage3d*.js(three.js, Rapier 물리, --check3d)
tools/                  render · critique · determinism · new · preview · state(진행 단계) · engine(엔진 고정)
prompts/                api.md · 3d.md · spec-template.md · critique-pass.md · reference.md · director-brief.md
films/                  _template + 샘플 3편 (sample-morph, sample-3d, sample-physics)
assets/fonts/           Pretendard, Geist, Geist Mono (OFL)
src/ server/ electron/  설치형 앱 (Solid 화면 · Vite/앱 공용 서버 · Electron과 렌더 워커) — docs/APP_PLAN.md
```

### 엔진의 원리

- **seek(t)**: 프레임은 t의 순수 함수다. 타이머도 누적 상태도 없어서 어느 프레임이든 바로 그리고, 몇 번을 렌더해도 같은 픽셀이 나온다.
- **스프링을 더한다**: 목표가 바뀔 때마다 스프링을 하나씩 더한다(`track`). `loopTrack`은 루프 이음새의 위치·속도까지 맞춘다.
- **코드와 데이터 분리**: 움직임은 `index.html`, 문구·색·장면 시각은 `film.json`. 장면을 옮기면 움직임이 따라온다.
- **3D·물리**: three.js 장면을 2D 캔버스에 얹는다. 물리는 필름을 열 때 1/960초 간격으로 미리 구워 seek(t)가 표에서 꺼내 쓴다. `--check3d`가 파고듦·가림·잘림을 숫자로 판정한다.
- **엔진 고정**: `stage=deliver`가 그때의 `lib/`을 복사해 두어, 앱이 업데이트돼도 전달한 필름은 같은 픽셀로 렌더된다.
- **렌더**: 숨김 창에서 GPU로 그려 60fps, 4 서브프레임 모션블러로 ffmpeg 인코딩. 1080×1080 12초 ≈ 22초.

### 라이선스 · 출처

앱에는 FFmpeg(GPL 3.0), Electron, Pretendard·Geist 글꼴이 들어 있다. 고지는 [LICENSES/README.md](LICENSES/README.md).
파이프라인은 Movez, "How to build motion design studio with Opus 5.5 (Full-course)"(2026-09-27)를, UI 모핑 스펙은 @twoclipping의 공개 템플릿을 바탕으로 했다.
