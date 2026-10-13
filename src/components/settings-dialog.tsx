import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { AppSettings } from "@/types";

const label = "text-[10px] font-strong text-muted-foreground";

/** "max" → "Max". The CLI reports plan names in lower case. */
function planName(plan?: string): string | null {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : null;
}

/** A team's name; a personal account's "<email>'s Organization" says nothing the email does not. */
function teamName(org?: string): string | null {
  return org && !/'s Organization$/.test(org) ? org : null;
}

/** Sidebar ⚙ / ⌘,: the account the agent runs as, and where the films live. */
export function SettingsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [settings, setSettings] = createSignal<AppSettings | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/__settings");
      setSettings((await res.json()) as AppSettings);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  // Signing in happens in its own window; coming back to this one is when the account may have changed.
  createEffect(() => {
    if (!props.open) return;
    setError(null);
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    onCleanup(() => window.removeEventListener("focus", onFocus));
  });

  const switchAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/__settings/sign-out", { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!body.ok) setError(body.error ?? "로그아웃하지 못했어요");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const account = () => settings()?.account ?? null;

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent class="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>설정</AlertDialogTitle>
          <AlertDialogDescription>에이전트가 쓰는 Claude 계정과 필름이 저장되는 곳이에요.</AlertDialogDescription>
        </AlertDialogHeader>

        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <span class={label}>Claude 계정</span>
            <div class="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <Show
                when={account()?.loggedIn}
                fallback={
                  <span class="text-xxs text-muted-foreground">{settings() ? "로그인되어 있지 않아요" : "불러오는 중…"}</span>
                }
              >
                <div class="flex min-w-0 flex-col gap-0.5">
                  <span class="truncate text-xxs text-foreground">{account()?.email}</span>
                  <span class="truncate text-[10px] text-muted-foreground">
                    {[planName(account()?.subscriptionType), teamName(account()?.orgName)].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </Show>
              <Show when={settings()?.canSwitch}>
                <Button size="sm" variant="outline" disabled={busy()} onClick={() => void switchAccount()}>
                  {account()?.loggedIn ? "계정 전환" : "로그인"}
                </Button>
              </Show>
            </div>
            <span class="text-[10px] text-muted-foreground">
              <Show
                when={settings()?.canSwitch}
                fallback="개발 모드에서는 이 맥의 Claude Code 로그인을 그대로 써요. 계정은 터미널에서 바꿔요."
              >
                이 앱에서만 쓰는 로그인이에요. 바꿔도 터미널이나 다른 앱의 Claude Code 계정은 그대로예요.
              </Show>
            </span>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class={label}>작업 폴더</span>
            <div class="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <span class="min-w-0 truncate font-mono text-[10px] text-muted-foreground" title={settings()?.workspace}>
                {settings()?.workspace ?? ""}
              </span>
              <Show when={settings()?.canReveal}>
                <Button size="sm" variant="outline" onClick={() => void fetch("/__settings/reveal", { method: "POST" })}>
                  Finder에서 보기
                </Button>
              </Show>
            </div>
          </div>

          <Show when={error()}>
            <span class="text-xxs text-destructive">{error()}</span>
          </Show>
        </div>

        <AlertDialogFooter class="items-center sm:justify-between">
          <span class="font-mono text-[10px] text-muted-foreground">
            <Show when={settings()?.version}>Motion Studio {settings()?.version}</Show>
          </span>
          <AlertDialogCancel>닫기</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
