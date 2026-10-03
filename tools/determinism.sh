#!/usr/bin/env bash
# determinism.sh — 같은 프레임을 두 번 렌더해서 해시가 같은지 확인. 다르면 어딘가에 Math.random / 타이머 / 누적 상태가 있다.
#   bash tools/determinism.sh films/<이름> [시각들]   예: 0,1.37,5.5
set -euo pipefail
F=${1:?사용법}; T=${2:-0,1.37,3.21,5.5}
NAME=$(basename "$F")
node tools/render.mjs "$F" --stills "$T" >/dev/null
FMT=$(ls "out/$NAME" | head -1)
A=$(cd "out/$NAME/$FMT/stills" && md5sum *.png | sort)
node tools/render.mjs "$F" --stills "$T" >/dev/null
B=$(cd "out/$NAME/$FMT/stills" && md5sum *.png | sort)
if [ "$A" == "$B" ]; then echo "✅ 결정적: 같은 시각 → 같은 픽셀"; else echo "❌ 렌더마다 결과가 다릅니다"; diff <(echo "$A") <(echo "$B"); exit 1; fi
