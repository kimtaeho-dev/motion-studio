## Motion Studio 0.4.2

- **내보낸 영상이 앱에서 본 그대로**: 렌더도 앱 플레이어와 같은 방식(GPU)으로 그립니다. 카드 밑에 그림자를 깐 장면처럼, 앱에는 없던 얇은 테두리가 내보낸 영상에만 생기던 문제가 사라집니다. 이미 만든 필름은 에이전트에게 다시 렌더해 달라고 하면 반영됩니다.
- **3D 필름 렌더가 약 2배 빨라졌습니다.**
- (0.4.1) 완성한 필름이 안 열리던 문제 수정, 전체 길이 바꾸기(장면 시각이 같은 비율로 따라옴).

**받기**: Apple Silicon(M1 이후)은 `-arm64.dmg`, 인텔 맥은 나머지 하나.
처음 열 때 "확인되지 않은 개발자"가 뜨면 시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기.

포함된 FFmpeg(GPL 3.0), three.js(MIT), Rapier(Apache 2.0) 등 구성 요소의 라이선스와 소스 위치:
[LICENSES/README.md](https://github.com/kimtaeho-dev/motion-studio/blob/main/LICENSES/README.md)
