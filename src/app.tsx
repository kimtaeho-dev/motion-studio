import { Sidebar } from "@/components/sidebar";
import { Player } from "@/components/player";
import { StagePanel } from "@/components/stage-panel";
import { Inspector } from "@/components/inspector";
import { ChatPanel } from "@/components/chat-panel";
import { MediaViewer } from "@/components/media-viewer";
import { ChatProvider } from "@/context/chat";
import { FilesProvider } from "@/context/files";
import { PlayerProvider } from "@/context/player";

/**
 * One film open (docs/APP_PLAN.md, 메인 화면): film list · player with
 * timeline and renders · stage, inspector and agent stacked on the right.
 */
export function App() {
  return (
    <ChatProvider>
      <FilesProvider>
        <PlayerProvider>
          <div class="flex h-screen gap-3 bg-canvas p-3">
            <Sidebar />
            <Player />
            <div class="flex min-h-0 flex-col gap-3">
              <StagePanel />
              <Inspector />
              <div class="flex min-h-0 flex-[1.3] flex-col">
                <ChatPanel />
              </div>
            </div>
          </div>
          <MediaViewer />
        </PlayerProvider>
      </FilesProvider>
    </ChatProvider>
  );
}
