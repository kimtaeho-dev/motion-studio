## Motion Studio 0.1.0

말로 만드는 모션 영상 — 첫 공개판.

- 새 필름(이름·포맷·길이·품질) → 채팅으로 요청 → 숏리스트 승인 → 렌더·검수 → 전달
- 플레이어와 타임라인: 마디·비트, 장면 표시, 효과음. 장면 시각을 끌어서 옮기기
- 속성 탭에서 문구·색·숫자 직접 편집, 되돌리기
- 렌더 진행률과 취소, 내보내기(MP4·GIF·ProRes 4444·WebM·포스터)
- Node.js, Homebrew, ffmpeg 설치 불필요 — 영상 인코더까지 앱에 포함

**받기**: Apple Silicon(M1 이후)은 `-arm64.dmg`, 인텔 맥은 나머지 하나.
처음 열 때 "확인되지 않은 개발자"가 뜨면 시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기.

포함된 FFmpeg(GPL 3.0) 등 구성 요소의 라이선스와 소스 위치:
[LICENSES/README.md](https://github.com/kimtaeho-dev/motion-studio/blob/main/LICENSES/README.md)
