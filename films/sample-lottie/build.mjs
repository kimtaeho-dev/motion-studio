// 성공 체크 — lottie.json을 만드는 스크립트. 고친 뒤: node films/sample-lottie/build.mjs && node tools/lottie.mjs sync films/sample-lottie
import { lottie, layer, group, ellipse, path, fill, stroke, trim, slot, kf, write } from '../../tools/lottie/kit.mjs';

const accent = () => slot('#2F6BFF', 'accent');   // 속성 패널: 포인트 컬러
const mark = () => slot('#FFFFFF', 'mark');       // 속성 패널: 체크 색
const C = [256, 256, 0];

write(lottie({
  nm: '성공 체크', w: 512, h: 512, fr: 60, op: 120,
  layers: [
    // 체크: 원이 거의 다 커진 뒤 한 획으로 그어진다
    layer('체크', [group('체크', [
      path([[-62, 4], [-18, 48], [70, -46]], { nm: '체크 선' }),
      trim(kf([[16, 0], [38, 100]])),
      stroke(mark(), 30),
    ])], { ks: { p: C } }),
    // 원: 0에서 커져 착지 (UI라 넘침 없이)
    layer('원', [group('원', [ellipse(300), fill(accent())])],
      { ks: { p: C, s: kf([[0, [0, 0, 100], 'entrance-sharp'], [22, [100, 100, 100]]]) } }),
    // 물결: 원이 착지할 때 한 번 퍼지고 사라진다
    layer('물결', [group('물결', [ellipse(300), stroke(accent(), 8, { o: kf([[20, 50, 'settle-soft'], [60, 0]]) })])],
      { ip: 20, ks: { p: C, s: kf([[20, [100, 100, 100], 'settle-soft'], [60, [150, 150, 100]]]) } }),
  ],
}), import.meta.url);
