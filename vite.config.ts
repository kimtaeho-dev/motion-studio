import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidSvg from "vite-plugin-solid-svg";
import solidPlugin from "vite-plugin-solid";
import { filmsPlugin } from "./server/films";
import { mailboxPlugin } from "./server/mailbox";
import { renderPlugin } from "./server/render";
import { exportPlugin } from "./server/export";

export default defineConfig({
  plugins: [solidPlugin(), tailwindcss(), solidSvg({ defaultAsComponent: true }), filmsPlugin(), mailboxPlugin(), renderPlugin(), exportPlugin()],
  server: {
    // 3040 by default; PORT lets a second copy run while the installed app holds 3040.
    port: Number(process.env.PORT) || 3040,
    // films/ and out/ are the agent's working files, served raw by filmsPlugin
    // (which runs its own watcher). Left to Vite, a rewritten film page would
    // trigger a full reload of the app itself.
    // Rooted at the repo, not globbed: "**/lib/**" would also hide src/lib.
    watch: { ignored: ["films", "out", "lib", ".mailbox", ".trash"].map((dir) => path.resolve(__dirname, dir) + "/**") },
  },
  build: {
    target: "esnext",
    // `/assets/` is the workspace's font folder (film pages load from it), so
    // the app's own bundle goes elsewhere.
    assetsDir: "_app",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
