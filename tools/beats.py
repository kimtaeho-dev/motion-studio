#!/usr/bin/env python3
"""
beats.py — 음악 파일의 비트 그리드를 측정한다. 애니메이션은 이 숫자에 맞춰 움직인다.

  python3 tools/beats.py films/<이름>/audio/track.wav > films/<이름>/audio/beats.json

출력:
  bpm         측정된 템포
  beats       모든 비트 시각(초)       → 상태 전환을 여기에
  downbeats   4박마다 (마디 첫 박)     → 큰 순간을 여기에
  hits        강한 어택(onset peak)    → 효과음을 여기에
  offset      첫 비트 시각              → 필름의 beatOffset 에 넣는다

필요: pip install numpy librosa soundfile
"""
import sys, json
import numpy as np
import librosa

if len(sys.argv) < 2:
    sys.exit(__doc__)

y, sr = librosa.load(sys.argv[1], sr=None, mono=True)
tempo, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
beats = librosa.frames_to_time(frames, sr=sr).round(3).tolist()
onset = librosa.onset.onset_strength(y=y, sr=sr)
peaks = librosa.util.peak_pick(onset, pre_max=3, post_max=3, pre_avg=3, post_avg=5, delta=0.5, wait=10)

# 다운비트 추정: 4가지 위상 중 저음 에너지가 가장 큰 쪽을 마디 첫 박으로
low = librosa.feature.rms(y=librosa.effects.preemphasis(y, coef=-0.97))[0]
bt = librosa.frames_to_samples(frames) // 512
phase = int(np.argmax([low[np.clip(bt[p::4], 0, len(low) - 1)].mean() if len(bt[p::4]) else 0 for p in range(4)]))

json.dump({
    "bpm": round(float(np.atleast_1d(tempo)[0]), 2),
    "offset": beats[phase] if beats else 0,
    "beats": beats,
    "downbeats": beats[phase::4],
    "hits": librosa.frames_to_time(peaks, sr=sr).round(3).tolist(),
    "duration": round(len(y) / sr, 3),
}, sys.stdout, indent=1)
print()
