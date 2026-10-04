# 함께 배포되는 구성 요소의 라이선스

Motion Studio 앱(dmg)에는 아래 프로그램과 글꼴이 들어 있다. 앱 안에서는
`Motion Studio.app/Contents/Resources/LICENSES/`에 이 폴더가 그대로 들어간다.

## FFmpeg 9.0.2 — GPL 3.0

앱은 영상 인코딩(H.264, ProRes, VP9, GIF)에 FFmpeg를 별도
실행 파일로 쓴다(`Contents/Resources/bin/ffmpeg`).

- 빌드: Martin Riedl의 macOS 정적 빌드 (<https://ffmpeg.martin-riedl.de>),
  Developer ID로 서명된 바이너리를 바꾸지 않고 넣는다.
- 구성: `--enable-gpl --enable-version3`, `--enable-nonfree` 없음.
  x264(GPL), x265(GPL), libvpx(BSD), OpenSSL 3(Apache 2.0) 등을 정적으로 포함한다.
  정확한 구성은 `ffmpeg -buildconf`로 볼 수 있다.
- 라이선스 전문: [GPL-3.0.txt](GPL-3.0.txt)
- 소스:
  - FFmpeg 9.0.2: <https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz>
  - 빌드 스크립트와 포함 라이브러리 버전: <https://gitlab.com/martinr92/ffmpeg>
  - 위 주소에서 받을 수 없게 되면, 이 앱을 배포한 쪽에 요청하면 같은 소스를 제공한다.
- 받는 방법과 검증(SHA-256): `scripts/fetch-ffmpeg.mjs`

FFmpeg는 Motion Studio와 별개의 프로그램이며, Motion Studio는 FFmpeg를
명령줄로 실행할 뿐 링크하지 않는다.

## Electron — MIT

앱 셸과 렌더 엔진. Electron과 Chromium의 라이선스는 electron-builder가 앱에
함께 넣는 `LICENSE.electron.txt`, `LICENSES.chromium.html`에 있다.

## 글꼴 — SIL Open Font License 1.1

필름과 앱 화면에 쓰는 Pretendard, Geist, Geist Mono.
라이선스: `assets/fonts/LICENSE-Pretendard.txt`, `assets/fonts/LICENSE-Geist.txt`.
