// Typed wrappers around Electron IPC for the renderer process.

interface IpcRenderer {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (...args: unknown[]) => void): void;
    off(channel: string, listener: (...args: unknown[]) => void): void;
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
    modelDirectory: string | null;
    toyConfigs: Record<string, Record<string, unknown>>;
    debugOutput: boolean;
}

// Mirror of electron/toyControls.ts. Keep them in sync.
export interface ControlBase {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly showWhen?: {
        readonly id: string;
        readonly equals: string | number | boolean;
    };
}
export interface SliderControl extends ControlBase {
    readonly type: "slider";
    readonly min: number;
    readonly max: number;
    readonly step?: number;
    readonly default: number;
    readonly valueLabels?: Readonly<Record<number, string>>;
}
export interface SelectControl extends ControlBase {
    readonly type: "select";
    readonly options: ReadonlyArray<{ readonly value: string | number; readonly label: string }>;
    readonly default: string | number;
}
export interface RadioControl extends ControlBase {
    readonly type: "radio";
    readonly options: ReadonlyArray<{ readonly value: string | number; readonly label: string }>;
    readonly default: string | number;
}
export interface ToggleControl extends ControlBase {
    readonly type: "toggle";
    readonly default: boolean;
}
export interface NumberInputControl extends ControlBase {
    readonly type: "numberInput";
    readonly default: number;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly placeholder?: string;
}
export interface TextInputControl extends ControlBase {
    readonly type: "textInput";
    readonly default: string;
    readonly placeholder?: string;
}
export type ToyControl =
    | SliderControl
    | SelectControl
    | RadioControl
    | ToggleControl
    | NumberInputControl
    | TextInputControl;
export type ToyControlSchema = readonly ToyControl[];

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

export interface UpdateInfo {
    available: boolean;
    latestVersion?: string;
    url?: string;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
    return (await ipc.invoke("check-for-update")) as UpdateInfo;
}

export async function openExternal(url: string): Promise<void> {
    await ipc.invoke("open-external", url);
}

export async function downloadUpdate(): Promise<IpcResult & { path?: string }> {
    return (await ipc.invoke("download-update")) as IpcResult & { path?: string };
}

export interface ToyUpdateInfo {
    installed: string | null;
    latest: string | null;
    available: boolean;
}

export async function checkToyUpdates(): Promise<Record<string, ToyUpdateInfo>> {
    return (await ipc.invoke("check-toy-updates")) as Record<string, ToyUpdateInfo>;
}

export async function updateToy(packageName: string): Promise<IpcResult> {
    return (await ipc.invoke("update-toy", packageName)) as IpcResult;
}

export function onUpdateProgress(handler: (percent: number) => void): () => void {
    const wrapped = (...args: unknown[]) => {
        const percent = args[1];
        if (typeof percent === "number") handler(percent);
    };
    ipc.on("update-download-progress", wrapped);
    return () => ipc.off("update-download-progress", wrapped);
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

export async function getModelDirectory(): Promise<string | null> {
    return (await ipc.invoke("get-model-directory")) as string | null;
}

export async function detectModelDirectory(): Promise<IpcResult & { path?: string }> {
    return (await ipc.invoke("detect-model-directory")) as IpcResult & { path?: string };
}

export async function browseModelDirectory(): Promise<IpcResult & { path?: string }> {
    return (await ipc.invoke("browse-model-directory")) as IpcResult & { path?: string };
}

export async function clearModelDirectory(): Promise<IpcResult> {
    return (await ipc.invoke("clear-model-directory")) as IpcResult;
}

export async function getToySchema(
    packageName: string,
): Promise<IpcResult & { schema?: ToyControlSchema | null }> {
    return (await ipc.invoke("get-toy-schema", packageName)) as IpcResult & {
        schema?: ToyControlSchema | null;
    };
}

export async function getToyConfig(packageName: string): Promise<Record<string, unknown>> {
    return (await ipc.invoke("get-toy-config", packageName)) as Record<string, unknown>;
}

export async function setToyConfig(
    packageName: string,
    values: Record<string, unknown>,
    schema: ToyControlSchema | null,
): Promise<IpcResult> {
    return (await ipc.invoke("set-toy-config", packageName, values, schema)) as IpcResult;
}
