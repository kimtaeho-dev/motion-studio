#!/usr/bin/env node
/*
 * engine.mjs — 전달한 필름을 그때의 엔진(lib/)으로 고정한다. 앱이 업데이트돼 엔진이 바뀌어도
 * 승인받은 필름은 다시 렌더할 때 같은 결과가 나온다.
 *
 *   node tools/engine.mjs films/<이름>          # 지금 상태 (최신 엔진 / 고정된 엔진)
 *   node tools/engine.mjs films/<이름> pin      # 지금 엔진으로 고정 (stage=deliver가 자동으로 부른다)
 *   node tools/engine.mjs films/<이름> unpin    # 최신 엔진으로 (stage를 deliver 밖으로 바꾸면 자동)
 *
 * 고정 = lib/을 lib-versions/<지문>/lib/에 한 번 복사해 두고, 필름 index.html의 ../../lib/ 경로를
 * ../../lib-versions/<지문>/lib/로 바꾼다. 글꼴(assets/)은 바뀌지 않으므로 링크로 잇는다.
 * lib-versions/는 앱이 업데이트할 때 덮어쓰지 않는다.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED = /\.\.\/\.\.\/lib-versions\/([0-9a-f]+)\/lib\//g;

/** lib/의 내용 지문 (파일 경로 + 내용) */
export function engineHash(root) {
  const h = createHash('sha1');
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(relative(root, p)).update(readFileSync(p));
    }
  };
  walk(join(root, 'lib'));
  return h.digest('hex').slice(0, 10);
}

/** 지금 lib/을 lib-versions/<지문>/에 (없으면) 복사하고 지문을 돌려준다 */
export function snapshot(root) {
  const id = engineHash(root), dir = join(root, 'lib-versions', id);
  if (!existsSync(join(dir, 'lib'))) {
    cpSync(join(root, 'lib'), join(dir, 'lib'), { recursive: true });
    symlinkSync('../../assets', join(dir, 'assets'));
  }
  return id;
}

export function pinnedTo(filmDir) {
  const html = readFileSync(join(filmDir, 'index.html'), 'utf8');
  const m = [...html.matchAll(PINNED)];
  return m.length ? m[0][1] : null;
}

export function pin(filmDir, root) {
  const id = snapshot(root), file = join(filmDir, 'index.html');
  const html = readFileSync(file, 'utf8').replace(PINNED, '../../lib/');
  writeFileSync(file, html.replaceAll('../../lib/', `../../lib-versions/${id}/lib/`));
  return id;
}

export function unpin(filmDir) {
  const file = join(filmDir, 'index.html');
  const before = readFileSync(file, 'utf8'), after = before.replace(PINNED, '../../lib/');
  if (after !== before) writeFileSync(file, after);
  return after !== before;
}

// 명령줄로 부를 때
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [filmArg, cmd] = process.argv.slice(2);
  if (!filmArg || !existsSync(join(filmArg, 'index.html'))) {
    console.error('사용법: node tools/engine.mjs films/<이름> [pin|unpin]');
    process.exit(1);
  }
  const root = process.cwd();
  if (cmd === 'pin') console.log(`🔒 ${filmArg}: 엔진 ${pin(filmArg, root)}로 고정`);
  else if (cmd === 'unpin') console.log(unpin(filmArg) ? `🔓 ${filmArg}: 최신 엔진으로` : `${filmArg}: 이미 최신 엔진`);
  else {
    const p = pinnedTo(filmArg);
    console.log(p ? `🔒 ${filmArg}: 엔진 ${p}로 고정됨 (최신 ${engineHash(root)})` : `${filmArg}: 최신 엔진 (${engineHash(root)})`);
  }
}
