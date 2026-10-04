import { createSignal, type JSX } from "solid-js";

const KEY = "motion-studio.split";
const DEFAULT_RATIO = 0.52;
/** Neither panel may be squeezed below this, whatever the window. */
const MIN_PX = 140;

function loadRatio(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return value > 0 && value < 1 ? value : DEFAULT_RATIO;
  } catch {
    return DEFAULT_RATIO;
  }
}

/**
 * Two panels stacked in the right column with a handle between them: the
 * inspector holds long documents (a shotlist, a review log), the chat a long
 * thread, and which deserves the room changes from minute to minute.
 * Double-click the handle to go back to the default split.
 */
export function SplitColumn(props: { top: JSX.Element; bottom: JSX.Element }) {
  const [ratio, setRatio] = createSignal(loadRatio());
  let box: HTMLDivElement | undefined;

  const save = (value: number) => {
    try {
      localStorage.setItem(KEY, String(value));
    } catch {
      // A split that is not remembered is still a split.
    }
  };

  const onDown = (e: PointerEvent) => {
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = box!.getBoundingClientRect();
      const y = Math.min(Math.max(ev.clientY - r.top, MIN_PX), r.height - MIN_PX);
      setRatio(y / r.height);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      save(ratio());
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return (
    <div ref={box} class="flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-[140px] flex-col" style={{ flex: `${ratio()} 1 0` }}>
        {props.top}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="리뷰와 에이전트 사이 높이 조절"
        title="끌어서 높이 조절 · 두 번 누르면 원래대로"
        onPointerDown={onDown}
        onDblClick={() => {
          setRatio(DEFAULT_RATIO);
          save(DEFAULT_RATIO);
        }}
        class="group flex h-3 shrink-0 cursor-row-resize touch-none items-center justify-center"
      >
        <div class="h-1 w-10 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/50" />
      </div>
      <div class="flex min-h-[140px] flex-col" style={{ flex: `${1 - ratio()} 1 0` }}>
        {props.bottom}
      </div>
    </div>
  );
}
