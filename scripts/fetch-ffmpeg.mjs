// Fetches the ffmpeg builds the packaged app ships (resources/bin/ffmpeg), one
// per architecture, into vendor/ffmpeg/<arch>/ffmpeg. Not in git: they are
// 60–95 MB each. Pinned by version and checksum, so a build never picks up a
// different binary than the one that was checked.
//
// Source: Martin Riedl's static macOS builds (https://ffmpeg.martin-riedl.de),
// FFmpeg 9.0.2, GPLv3 (--enable-gpl --enable-version3, no --enable-nonfree),
// signed with his Developer ID. See LICENSES/ffmpeg.md for what that obliges.
//
//   node scripts/fetch-ffmpeg.mjs            # both architectures
//   node scripts/fetch-ffmpeg.mjs arm64      # just one
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '9.0.2';
const BUILDS = {
  // electron-builder's ${arch} names → the download, and the sha256 of the zip
  arm64: {
    url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip',
    sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
  },
  x64: {
    url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip',
    sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4',
  },
};

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BUILDS);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

for (const arch of wanted) {
  const build = BUILDS[arch];
  if (!build) throw new Error(`unknown arch ${arch} (${Object.keys(BUILDS).join(', ')})`);
  const dir = join(repo, 'vendor', 'ffmpeg', arch);
  const binary = join(dir, 'ffmpeg');
  const stamp = join(dir, 'VERSION');
  if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === `${VERSION} ${build.sha256}`) {
    console.log(`ffmpeg ${VERSION} ${arch}: already here`);
    continue;
  }

  console.log(`ffmpeg ${VERSION} ${arch}: downloading ${build.url}`);
  const res = await fetch(build.url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  const actual = sha256(zip);
  if (actual !== build.sha256) throw new Error(`checksum mismatch for ${arch}: expected ${build.sha256}, got ${actual}`);

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const zipPath = join(dir, 'ffmpeg.zip');
  writeFileSync(zipPath, zip);
  // ditto keeps the code signature intact, which unzip does not always do.
  execFileSync('ditto', ['-x', '-k', zipPath, dir]);
  rmSync(zipPath);
  chmodSync(binary, 0o755);
  writeFileSync(stamp, `${VERSION} ${build.sha256}\n`);
  console.log(`ffmpeg ${VERSION} ${arch}: ${binary}`);
}
