import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import {
  IpcInvoke,
  IpcSend,
  IpcEvent,
  type SpawnPtyRequest,
  type SpawnPtyResult,
  type PtyInputRequest,
  type PtyResizeRequest,
  type PtyDataEvent,
  type PtyExitEvent,
  type ListAgentsRequest,
  type AgentTasksEvent,
  type ListHistoryRequest,
  type ListHistoryResult,
  type SetSessionTitleRequest,
  type ListMemosResult,
  type SetMemoRequest,
  type AppConfig,
  type AppPaths,
  type NotifyRequest,
  type PlaySoundRequest,
  type SoundOption,
  type TestWebhookRequest,
  type WebhookSendResult,
  type AppAction,
  type RendererApi,
} from '@shared/ipc';

/**
 * Main -> Renderer の push イベントを購読する共通ヘルパ。
 * 購読解除関数を返す。
 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.off(channel, handler);
  };
}

const api: RendererApi = {
  pty: {
    spawn: (req: SpawnPtyRequest): Promise<SpawnPtyResult> =>
      ipcRenderer.invoke(IpcInvoke.ptySpawn, req) as Promise<SpawnPtyResult>,
    kill: (ptyId: string): Promise<void> =>
      ipcRenderer.invoke(IpcInvoke.ptyKill, ptyId) as Promise<void>,
    input: (req: PtyInputRequest): void => {
      ipcRenderer.send(IpcSend.ptyInput, req);
    },
    resize: (req: PtyResizeRequest): void => {
      ipcRenderer.send(IpcSend.ptyResize, req);
    },
    onData: (listener: (e: PtyDataEvent) => void): (() => void) =>
      subscribe<PtyDataEvent>(IpcEvent.ptyData, listener),
    onExit: (listener: (e: PtyExitEvent) => void): (() => void) =>
      subscribe<PtyExitEvent>(IpcEvent.ptyExit, listener),
  },
  agents: {
    list: (req: ListAgentsRequest): Promise<AgentTasksEvent> =>
      ipcRenderer.invoke(IpcInvoke.agentsList, req) as Promise<AgentTasksEvent>,
    onTasks: (listener: (e: AgentTasksEvent) => void): (() => void) =>
      subscribe<AgentTasksEvent>(IpcEvent.agentTasks, listener),
  },
  history: {
    list: (req: ListHistoryRequest): Promise<ListHistoryResult> =>
      ipcRenderer.invoke(IpcInvoke.historyList, req) as Promise<ListHistoryResult>,
    setTitle: (req: SetSessionTitleRequest): Promise<void> =>
      ipcRenderer.invoke(IpcInvoke.historySetTitle, req) as Promise<void>,
  },
  memo: {
    list: (): Promise<ListMemosResult> =>
      ipcRenderer.invoke(IpcInvoke.memoList) as Promise<ListMemosResult>,
    set: (req: SetMemoRequest): Promise<ListMemosResult> =>
      ipcRenderer.invoke(IpcInvoke.memoSet, req) as Promise<ListMemosResult>,
  },
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke(IpcInvoke.configGet) as Promise<AppConfig>,
    set: (patch: Partial<AppConfig>): Promise<AppConfig> =>
      ipcRenderer.invoke(IpcInvoke.configSet, patch) as Promise<AppConfig>,
  },
  notify: {
    show: (req: NotifyRequest): Promise<void> =>
      ipcRenderer.invoke(IpcInvoke.notifyShow, req) as Promise<void>,
    listSounds: (): Promise<SoundOption[]> =>
      ipcRenderer.invoke(IpcInvoke.notifyListSounds) as Promise<SoundOption[]>,
    playSound: (req: PlaySoundRequest): Promise<void> =>
      ipcRenderer.invoke(IpcInvoke.notifyPlaySound, req) as Promise<void>,
    testWebhook: (req: TestWebhookRequest): Promise<WebhookSendResult> =>
      ipcRenderer.invoke(IpcInvoke.notifyTestWebhook, req) as Promise<WebhookSendResult>,
  },
  app: {
    paths: (): Promise<AppPaths> => ipcRenderer.invoke(IpcInvoke.appPaths) as Promise<AppPaths>,
    accessibilitySupport: (): Promise<boolean> =>
      ipcRenderer.invoke(IpcInvoke.appAccessibilitySupport) as Promise<boolean>,
    onAccessibilitySupportChanged: (listener: (enabled: boolean) => void): (() => void) =>
      subscribe<boolean>(IpcEvent.accessibilitySupportChanged, listener),
  },
  menu: {
    onAction: (listener: (action: AppAction) => void): (() => void) =>
      subscribe<AppAction>(IpcEvent.menuAction, listener),
  },
};

contextBridge.exposeInMainWorld('api', api);
