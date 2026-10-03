// `electron dist-electron/render-worker.cjs <render.mjs args>` — the render
// worker on its own, for the dev server and the CLI. The packaged app runs the
// same code through its own executable (`--render-worker`, see main.ts).
import { runRenderWorker } from "./render-worker";

runRenderWorker(process.argv.slice(2));
