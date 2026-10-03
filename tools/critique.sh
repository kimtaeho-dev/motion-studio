#!/usr/bin/env bash
# critique.sh — 렌더 결과를 "보는" 용도의 이미지들을 만든다. Claude가 이 이미지들을 직접 열어 보고 점수를 매긴다.
#
#   bash tools/critique.sh films/<이름> [포맷] [빠른동작시각]
#
#   contact.png  0.5초마다 1장, 6열 — 전체 흐름, 죽은 구간 찾기
#   strip.png    빠른 동작 주변 연속 12프레임 — 튐, 겹침, 미끄러짐 찾기
#   phone.png    360px 폭으로 축소 — 폰에서 읽히는지
#   seam.png     루프 이음새 (끝 6프레임 + 처음 6프레임) — 끊김 찾기
#   loop_check.mp4  두 번 이어 붙인 영상 — 이음새를 눈으로 확인
set -euo pipefail
NAME=$(basename "${1:?사용법: bash tools/critique.sh films/<이름> [포맷] [시각]}")
FMT=${2:-$(ls "out/$NAME" | head -1)}
D="out/$NAME/$FMT"
V="$D/final.mp4"; [ -f "$V" ] || V="$D/silent.mp4"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V")
FPS=$(ffprobe -v error -select_streams v -show_entries stream=r_frame_rate -of csv=p=0 "$V" | awk -F/ '{print $1/$2}')
FAST=${3:-$(awk -v d="$DUR" 'BEGIN{print d/3}')}
mkdir -p "$D/critique"; C="$D/critique"
q() { ffmpeg -hide_banner -loglevel error -y "$@"; }

ROWS=$(awk -v d="$DUR" 'BEGIN{r=int((d*2+5)/6); print (r<1?1:r)}')
q -i "$V" -vf "fps=2,scale=270:-1,tile=6x${ROWS}:padding=6:color=0x111111" -frames:v 1 "$C/contact.png"
q -ss "$(awk -v t="$FAST" 'BEGIN{print (t-0.1<0?0:t-0.1)}')" -i "$V" -vf "scale=320:-1,tile=12x1:padding=4" -frames:v 1 "$C/strip.png"
q -i "$V" -vf "fps=1,scale=360:-1,tile=5x$(awk -v d="$DUR" 'BEGIN{r=int((d+4)/5); print (r<1?1:r)}'):padding=6:color=0x111111" -frames:v 1 "$C/phone.png"
# 이음새: 마지막 6프레임 + 처음 6프레임
q -sseof "-$(awk -v f="$FPS" 'BEGIN{print 6.5/f}')" -i "$V" -vf "scale=240:-1" -frames:v 6 "$C/_end_%02d.png"
q -i "$V" -vf "scale=240:-1" -frames:v 6 "$C/_start_%02d.png"
q -framerate 1 -pattern_type glob -i "$C/_*.png" -vf "tile=12x1:padding=4:color=0xff0050" -frames:v 1 "$C/seam.png" 2>/dev/null || true
rm -f "$C"/_*.png
q -stream_loop 1 -i "$V" -c copy "$C/loop_check.mp4"

echo "👀 $C/{contact,strip,phone,seam}.png, loop_check.mp4"
echo "   다음: Claude에게 'prompts/critique-pass.md 대로 크리틱해줘' 라고 하면 된다."
