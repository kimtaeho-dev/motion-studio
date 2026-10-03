// Bundles the Electron main process (and the studio server + plugins it pulls
// in) into dist-electron/main.cjs. TypeScript sources are shared with the dev
// server, so they have to go through a bundler before Electron can run them.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const outDir = resolve(repoRoot, "dist-electron");
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: {
    main: resolve(repoRoot, "electron/main.ts"),
    preload: resolve(repoRoot, "electron/preload.ts"),
  },
  outdir: outDir,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  // Provided by the runtime; bundling them would break the native bindings.
  external: ["electron"],
  logLevel: "info",
});

// Loaded from disk by the setup window, so it ships next to the bundles.
copyFileSync(resolve(repoRoot, "electron/onboarding.html"), resolve(outDir, "onboarding.html"));
