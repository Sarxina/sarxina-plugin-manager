// Typed wrappers around Electron IPC for the renderer process.

interface IpcRenderer {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

// The preload script exposes ipcRenderer on window
const ipc = (window as unknown as { ipcRenderer: IpcRenderer }).ipcRenderer;

export interface AppConfig {
    twitchClientId: string;
    twitchAccessToken: string;
    twitchChannelName: string;
    twitchRefreshToken: string;
    twitchBroadcasterId: string;
    vtsUrl: string;
    installedToys: string[];
    activeToys: string[];
    foreheadPin: unknown;
    faceMesh: { pin: string; hide: string[] } | null;
    debugOutput: boolean;
}

export interface ToyInfo {
    name: string;
    package: string;
    description: string;
    guide: string;
    demoGif?: string;
    installed: boolean;
    running: boolean;
}

interface IpcResult {
    success: boolean;
    error?: string;
}

export async function twitchAuth(): Promise<IpcResult & { displayName?: string }> {
    return (await ipc.invoke("twitch-auth")) as IpcResult & { displayName?: string };
}

export async function getConfig(): Promise<AppConfig> {
    return (await ipc.invoke("get-config")) as AppConfig;
}

export async function saveConfig(config: AppConfig): Promise<IpcResult> {
    return (await ipc.invoke("save-config", config)) as IpcResult;
}

export async function connect(): Promise<IpcResult> {
    return (await ipc.invoke("connect")) as IpcResult;
}

export async function getToyStatus(): Promise<ToyInfo[]> {
    return (await ipc.invoke("get-toy-status")) as ToyInfo[];
}

export async function installToy(packageName: string): Promise<IpcResult> {
    return (await ipc.invoke("install-toy", packageName)) as IpcResult;
}

export async function uninstallToy(packageName: string): Promise<IpcResult> {
    return (await ipc.invoke("uninstall-toy", packageName)) as IpcResult;
}

export async function startToy(packageName: string): Promise<IpcResult> {
    return (await ipc.invoke("start-toy", packageName)) as IpcResult;
}

export async function stopToy(packageName: string): Promise<IpcResult> {
    return (await ipc.invoke("stop-toy", packageName)) as IpcResult;
}

export async function hasForeheadPin(): Promise<boolean> {
    return (await ipc.invoke("has-forehead-pin")) as boolean;
}

export async function requestForeheadPin(): Promise<IpcResult> {
    return (await ipc.invoke("request-forehead-pin")) as IpcResult;
}

export async function clearForeheadPin(): Promise<IpcResult> {
    return (await ipc.invoke("clear-forehead-pin")) as IpcResult;
}

export async function hasFaceMesh(): Promise<boolean> {
    return (await ipc.invoke("has-face-mesh")) as boolean;
}

export async function requestFaceMesh(): Promise<IpcResult & { count?: number }> {
    return (await ipc.invoke("request-face-mesh")) as IpcResult & { count?: number };
}

export async function clearFaceMesh(): Promise<IpcResult> {
    return (await ipc.invoke("clear-face-mesh")) as IpcResult;
}
