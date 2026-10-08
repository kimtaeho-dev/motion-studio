// __NAME__ — lottie.json을 만드는 스크립트. 쓰는 법: prompts/lottie.md "build.mjs", 조각은 tools/lottie/kit.mjs 맨 위 주석.
// 고친 뒤: node films/<이름>/build.mjs && node tools/lottie.mjs sync films/<이름>
import { lottie, layer, group, ellipse, rect, path, fill, stroke, trim, slot, kf, write } from '../../tools/lottie/kit.mjs';

const W = __W__, H = __H__, FR = 60, OP = __OP__;   // 크기·길이는 디자이너가 새 필름 창에서 고른 값

write(lottie({
  nm: '__NAME__', w: W, h: H, fr: FR, op: OP,
  layers: [],
}), import.meta.url);
