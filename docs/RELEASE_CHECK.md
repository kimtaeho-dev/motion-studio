# 배포 전 점검과 릴리스

## 1. 빌드

```bash
npm run dist:mac
```

`release/Motion Studio-<버전>-arm64.dmg`(Apple Silicon)와 `release/Motion Studio-<버전>.dmg`(Intel)가 나온다.
빌드 로그에 `ffmpeg arm64: Developer ID Application: Martin Riedl` / `ffmpeg x86_64: …`가 찍혀야 한다
(앱 안 ffmpeg의 아키텍처와 서명을 `scripts/after-pack.cjs`가 확인한다).

## 2. 새 macOS 사용자 계정에서 점검

개발 도구가 하나도 없는 디자이너의 맥과 같은 조건을 만들려면 새 사용자 계정이 가장 확실하다.
(시스템 설정 → 사용자 및 그룹 → 사용자 추가. 관리자일 필요는 없다.)

새 계정으로 로그인해서:

1. `which node brew ffmpeg claude` — 모두 없어야 한다.
2. dmg를 브라우저로 내려받는다(격리 표시가 붙도록 — AirDrop이나 복사로 옮기면 Gatekeeper 점검이 빠진다).
3. dmg를 열고 응용 프로그램으로 끌어다 놓는다 → 실행 → "확인되지 않은 개발자" →
   시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기.
4. 준비 화면: 설치 시작 → 로그인 시작 → 브라우저 코드 붙여넣기.
5. 샘플 필름(Sample · One shape morph)이 재생되는지.
6. `+` → 새 필름(1x1, 6초, 빠르게) → 채팅으로 요청 → 숏리스트에서 멈추는지 → 승인 →
   렌더 줄에 진행률이 뜨는지 → 진행 단계가 전달까지 가는지.
7. 내보내기 → MP4·GIF → 다운로드/Motion Studio에 파일이 생기는지 → Finder에서 보기.
8. 속성 탭에서 색을 바꾸고 ⌘Z로 되돌려 본다.

인텔 맥이 있으면 같은 순서를 Intel dmg로 한 번 더.

## 3. GitHub 릴리스

점검이 끝나면 태그를 달고 dmg 두 개를 올린다. README의 다운로드 링크는
`releases/latest`를 가리킨다.

```bash
gh release create v<버전> "release/Motion Studio-<버전>-arm64.dmg" "release/Motion Studio-<버전>.dmg" --target main --title "Motion Studio <버전>" --notes-file docs/RELEASE_NOTES.md
```

GPL 의무: 릴리스 노트나 README에서 [LICENSES/README.md](../LICENSES/README.md)로 가는 링크를 유지한다
(FFmpeg 소스 위치가 거기 있다).
