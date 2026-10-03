import { For, Match, Switch, type JSX } from "solid-js";

/**
 * The small slice of Markdown the agent actually writes: **bold**, *italic*,
 * `code`, fenced code, bullet and numbered lists, links, headings, and tables
 * (a shotlist is one). Rendered to real elements rather than to an HTML string, so a reply
 * that quotes an attached SVG — or anything else that looks like markup —
 * cannot become markup. That also means no sanitizer to keep honest, and no
 * Markdown dependency for six syntaxes.
 */

type Block =
  | { kind: "code"; code: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "paragraph"; text: string };

const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?\s*$/;

/** "| a | b |" -> ["a", "b"]. An escaped "\|" stays inside its cell. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      blocks.push({ kind: "code", code: code.join("\n") });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    // A table needs its header and rule lines; one stray "|" line is just text.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", text: heading[1].trim() });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      // A switch between bullets and numbers starts a new list rather than
      // silently re-labelling the items already collected.
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1].trim());
      continue;
    }

    // An indented line under a list item continues that item.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}

// Ordered so that ** wins over *, and so a link's URL is only ever http(s) —
// which is what keeps `[click](javascript:…)` from rendering as a link at all.
const INLINE =
  /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

function renderInline(text: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));

    const [, code, bold, boldAlt, italic, linkText, linkHref] = match;
    if (code !== undefined) {
      out.push(<code class="rounded-sm bg-foreground/10 px-1 font-mono">{code}</code>);
    } else if (bold !== undefined || boldAlt !== undefined) {
      out.push(<strong class="font-strong">{bold ?? boldAlt}</strong>);
    } else if (italic !== undefined) {
      out.push(<em class="italic">{italic}</em>);
    } else {
      out.push(
        <a href={linkHref} target="_blank" rel="noreferrer" class="underline underline-offset-2">
          {linkText}
        </a>,
      );
    }
    last = at + match[0].length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Block(props: { block: Block }) {
  return (
    <Switch>
      <Match when={props.block.kind === "code" && props.block}>
        {(block) => (
          <pre class="overflow-x-auto rounded-md bg-foreground/10 p-2 font-mono">
            <code>{block().code}</code>
          </pre>
        )}
      </Match>
      <Match when={props.block.kind === "heading" && props.block}>
        {(block) => <p class="font-strong">{renderInline(block().text)}</p>}
      </Match>
      <Match when={props.block.kind === "list" && props.block}>
        {(block) => (
          <ul class="flex flex-col gap-0.5">
            <For each={block().items}>
              {(item, index) => (
                <li class="flex gap-1.5">
                  <span class="shrink-0 opacity-60">{block().ordered ? `${index() + 1}.` : "·"}</span>
                  <span class="min-w-0 whitespace-pre-wrap">{renderInline(item)}</span>
                </li>
              )}
            </For>
          </ul>
        )}
      </Match>
      <Match when={props.block.kind === "table" && props.block}>
        {(block) => (
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-left">
              <thead>
                <tr>
                  <For each={block().head}>
                    {(cell) => <th class="border-b border-border px-1.5 py-1 font-strong whitespace-nowrap">{renderInline(cell)}</th>}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={block().rows}>
                  {(row) => (
                    <tr class="align-top">
                      <For each={row}>{(cell) => <td class="border-b border-border/60 px-1.5 py-1">{renderInline(cell)}</td>}</For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        )}
      </Match>
      <Match when={props.block.kind === "paragraph" && props.block}>
        {(block) => <p class="whitespace-pre-wrap">{renderInline(block().text)}</p>}
      </Match>
    </Switch>
  );
}

/** Renders one agent reply. Plain text passes through unchanged. */
export function Markdown(props: { text: string }) {
  const blocks = () => parseBlocks(props.text);
  return (
    <div class="flex flex-col gap-1.5">
      <For each={blocks()}>{(block) => <Block block={block} />}</For>
    </div>
  );
}
