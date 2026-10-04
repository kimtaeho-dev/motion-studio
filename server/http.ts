import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(data || "{}");
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** Streams the request body into `file`; rejects (and removes the partial file) past `limit` bytes. */
export function saveBody(req: IncomingMessage, file: string, limit: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    let size = 0;
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      fs.rmSync(file, { force: true });
      reject(err);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) fail(new Error("too large"));
    });
    req.on("error", fail);
    out.on("error", fail);
    out.on("finish", () => !failed && resolve(size));
    req.pipe(out);
  });
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Serves one file, never cached (the agent rewrites these constantly), with
 * byte ranges so <video>/<audio> can seek.
 */
export function sendFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  const { size } = fs.statSync(file);
  res.setHeader("Content-Type", contentTypeFor(file));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Accept-Ranges", "bytes");

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && size > 0) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    if (req.method === "HEAD") return void res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.setHeader("Content-Length", String(size));
  if (req.method === "HEAD") return void res.end();
  fs.createReadStream(file).pipe(res);
}

/** `root/<rel>` when it stays inside `root`, else null. */
export function inside(root: string, rel: string): string | null {
  const file = path.resolve(root, "." + path.sep + rel);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}
