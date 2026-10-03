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
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });

  // codesign reports on stderr, and execFileSync only hands back stdout, so the
  // verification has to go through spawnSync to see anything at all.
  const info = spawnSync("codesign", ["-dv", appPath], { encoding: "utf8" }).stderr ?? "";
  if (/adhoc/i.test(info)) {
    console.log(`  ad-hoc signed: ${appPath}`);
  } else {
    throw new Error(`ad-hoc signing did not take effect for ${appPath}:\n${info}`);
  }
};
