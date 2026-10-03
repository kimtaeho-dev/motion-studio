// Ad-hoc signs the packed app.
//
// Apple Silicon refuses to run Mach-O binaries with no signature at all — the
// "app is damaged" dialog, which offers no way forward in the GUI. An ad-hoc
// signature costs nothing and no Apple Developer account, and downgrades that
// to the ordinary "unidentified developer" prompt, which a user can clear from
// System Settings. Notarization with a Developer ID would remove the prompt
// entirely; this is the no-account path.
const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // Renders and sound need the bundled ffmpeg (scripts/fetch-ffmpeg.mjs), and
  // it has to be the one for this build's architecture.
  const ffmpeg = path.join(appPath, "Contents", "Resources", "bin", "ffmpeg");
  const expected = { 1: "x86_64", 3: "arm64" }[context.arch];
  const kind = spawnSync("file", [ffmpeg], { encoding: "utf8" }).stdout ?? "";
  if (!kind.includes("Mach-O") || (expected && !kind.includes(expected))) {
    throw new Error(`bundled ffmpeg missing or wrong architecture (want ${expected}): ${kind.trim() || ffmpeg}\nRun: node scripts/fetch-ffmpeg.mjs`);
  }

  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });

  // Signed by its builder or re-signed above — either is fine, broken is not:
  // Apple Silicon refuses to run an executable without a valid signature.
  const ffmpegCheck = spawnSync("codesign", ["-v", ffmpeg], { encoding: "utf8" });
  if (ffmpegCheck.status !== 0) throw new Error(`bundled ffmpeg signature invalid:\n${ffmpegCheck.stderr}`);
  const ffmpegSigner = /Authority=([^\n]+)/.exec(spawnSync("codesign", ["-dv", "--verbose=2", ffmpeg], { encoding: "utf8" }).stderr ?? "");
  console.log(`  ffmpeg ${expected}: ${ffmpegSigner ? ffmpegSigner[1] : "ad-hoc"}`);

  // codesign reports on stderr, and execFileSync only hands back stdout, so the
  // verification has to go through spawnSync to see anything at all.
  const info = spawnSync("codesign", ["-dv", appPath], { encoding: "utf8" }).stderr ?? "";
  if (/adhoc/i.test(info)) {
    console.log(`  ad-hoc signed: ${appPath}`);
  } else {
    throw new Error(`ad-hoc signing did not take effect for ${appPath}:\n${info}`);
  }
};
