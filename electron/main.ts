import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "./configStore.js";
import type { AppConfig, ClickPinData } from "./configStore.js";
import {
    getAvailableToys,
    installToy,
    uninstallToy,
    startToy,
    stopToy,
    isToyRunning,
    stopAllToys,
    getToyControlSchema,
    notifyToyConfigChange,
} from "./toyManager.js";
import { authenticateWithTwitch, getTwitchUser } from "./twitchAuth.js";
import { detectModelDirectory, isValidModelDirectory } from "./modelDetector.js";
import { resolveToyConfig, type ToyControlSchema } from "./toyControls.js";

const MESHMARKET_PACKAGE = "@sarxina/meshmarket";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env["APP_ROOT"] = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env["APP_ROOT"]!, "dist-electron");
export const RENDERER_DIST = path.join(process.env["APP_ROOT"]!, "dist");

process.env["VITE_PUBLIC"] = VITE_DEV_SERVER_URL
    ? path.join(process.env["APP_ROOT"]!, "public")
    : RENDERER_DIST;

let win: BrowserWindow | null;

// Shared connections — created when user clicks Connect
let sharedChat: unknown = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharedVts: any = null;

function createWindow(): void {
    win = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 700,
        minHeight: 500,
        title: "Sarxina Plugin Manager",
        icon: path.join(process.env["VITE_PUBLIC"]!, "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "preload.mjs"),
        },
    });

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL);
    } else {
        win.loadFile(path.join(RENDERER_DIST, "index.html"));
    }
}

// --- Shared context management ---

async function connectVts(config: AppConfig): Promise<void> {
    const tools = await import("@sarxina/sarxina-tools");

    // Load plugin icon for VTS auth prompt (128x128 PNG, base64-encoded)
    let pluginIcon: string | undefined;
    try {
        const iconPath = path.join(process.env["VITE_PUBLIC"] ?? "", "icon-128.png");
        pluginIcon = readFileSync(iconPath).toString("base64");
    } catch {
        // Icon not found — auth will work without it, just no icon shown
    }

    sharedVts = await tools.VTSClient.connect({
        url: config.vtsUrl || "ws://localhost:8001",
        pluginName: "SarxinaPluginManager",
        pluginDeveloper: "Sarxina",
        pluginIcon,
    });

    // Best-effort model directory detection. Doesn't fail the connect on error.
    try {
        await refreshModelDirectory();
    } catch (err) {
        console.warn("Model directory detection failed:", err);
    }
}

/**
 * Ask VTS for the active model and try to locate its directory on disk.
 * Saves the result to config (or clears it if no match). Returns the path,
 * or null if nothing was detected.
 */
async function refreshModelDirectory(): Promise<string | null> {
    if (!sharedVts) return null;
    const resp = await sharedVts.sendRequest("CurrentModelRequest");
    const data = resp.data as { modelLoaded?: boolean; live2DModelName?: string };
    if (!data.modelLoaded || !data.live2DModelName) return null;
    const detected = detectModelDirectory(data.live2DModelName);
    if (detected) {
        const config = loadConfig();
        if (config.modelDirectory !== detected) {
            config.modelDirectory = detected;
            saveConfig(config);
        }
    }
    return detected;
}

async function ensureChatManager(config: AppConfig): Promise<unknown> {
    if (sharedChat) return sharedChat;
    if (!config.twitchClientId || !config.twitchAccessToken || !config.twitchChannelName) {
        return null;
    }
    process.env["TWITCH_CLIENT_ID"] = config.twitchClientId;
    process.env["TWITCH_ACCESS_TOKEN"] = config.twitchAccessToken;
    process.env["TWITCH_CHANNEL_NAME"] = config.twitchChannelName;
    process.env["TWITCH_REFRESH_TOKEN"] = config.twitchRefreshToken;
    process.env["TWITCH_BROADCASTER_ID"] = config.twitchBroadcasterId;
    const tools = await import("@sarxina/sarxina-tools");
    sharedChat = new tools.TwitchChatManager();
    return sharedChat;
}

async function buildToyContext(packageName?: string): Promise<unknown> {
    const config = loadConfig();
    const toyConfig = packageName ? (config.toyConfigs[packageName] ?? {}) : {};
    return {
        chat: await ensureChatManager(config),
        vts: sharedVts,
        foreheadPin: config.foreheadPin ?? undefined,
        faceMesh: config.faceMesh ?? undefined,
        modelDirectory: config.modelDirectory ?? undefined,
        dataDir: app.getPath("userData"),
        broadcasterLogin: config.twitchChannelName,
        debug: config.debugOutput,
        config: toyConfig,
    };
}

// --- IPC Handlers ---

// Twitch OAuth
ipcMain.handle("twitch-auth", async () => {
    try {
        const tokens = await authenticateWithTwitch();
        const user = await getTwitchUser(tokens.accessToken);

        // Save to config
        const config = loadConfig();
        config.twitchClientId = tokens.clientId;
        config.twitchAccessToken = tokens.accessToken;
        config.twitchRefreshToken = tokens.refreshToken;
        config.twitchChannelName = user.login;
        config.twitchBroadcasterId = user.id;
        saveConfig(config);

        return { success: true, displayName: user.displayName };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
});

// Config
ipcMain.handle("get-config", () => {
    return loadConfig();
});

ipcMain.handle("save-config", (_event, config: AppConfig) => {
    saveConfig(config);
    return { success: true };
});

// Connection
ipcMain.handle("connect", async () => {
    try {
        const config = loadConfig();
        await connectVts(config);
        return { success: true };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const hint = "Check that VTube Studio is running with the API enabled (General Settings → scroll down → VTube Studio Plugins) and that the API port matches.";
        return { success: false, error: `${message}\n\n${hint}` };
    }
});

// Forehead pin
ipcMain.handle("has-forehead-pin", () => {
    const config = loadConfig();
    return config.foreheadPin !== null;
});

ipcMain.handle("request-forehead-pin", async () => {
    try {
        if (!sharedVts) {
            return { success: false, error: "Not connected to VTube Studio" };
        }
        const pin = await sharedVts.requestUserClick();
        const config = loadConfig();
        config.foreheadPin = pin as ClickPinData;
        saveConfig(config);
        return { success: true };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
});

ipcMain.handle("clear-forehead-pin", () => {
    const config = loadConfig();
    config.foreheadPin = null;
    saveConfig(config);
    return { success: true };
});

// Face mesh — used by EmojiHead to know which meshes to hide + where to pin.
ipcMain.handle("has-face-mesh", () => {
    const config = loadConfig();
    return config.faceMesh !== null;
});

ipcMain.handle("request-face-mesh", async () => {
    try {
        if (!sharedVts) {
            return { success: false, error: "Not connected to VTube Studio" };
        }
        const resp = await sharedVts.sendRequest("ArtMeshSelectionRequest", {
            textOverride: "Select every face mesh you want hidden when EmojiHead is active. Click the center face mesh FIRST — that's where the emoji pins.",
            helpOverride: "Click each face artmesh (skin, eyes, mouth, brows, etc). Don't include hair, ears, or accessories. The first mesh you click becomes the pin target.",
            requestedArtMeshCount: 0,
            activeArtMeshes: [],
        });
        const data = resp.data as { success: boolean; activeArtMeshes: string[] };
        if (!data.success || data.activeArtMeshes.length === 0) {
            return { success: false, error: "Selection cancelled or empty" };
        }
        const config = loadConfig();
        config.faceMesh = {
            pin: data.activeArtMeshes[0]!,
            hide: data.activeArtMeshes,
        };
        saveConfig(config);
        return { success: true, count: data.activeArtMeshes.length };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
});

ipcMain.handle("clear-face-mesh", () => {
    const config = loadConfig();
    config.faceMesh = null;
    saveConfig(config);
    return { success: true };
});

// Model directory
ipcMain.handle("get-model-directory", () => {
    return loadConfig().modelDirectory;
});

ipcMain.handle("detect-model-directory", async () => {
    if (!sharedVts) {
        return { success: false, error: "Not connected to VTube Studio." };
    }
    try {
        const detected = await refreshModelDirectory();
        if (!detected) {
            return {
                success: false,
                error: "Could not auto-locate your model. Use Browse to point at it manually.",
            };
        }
        return { success: true, path: detected };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
});

ipcMain.handle("browse-model-directory", async () => {
    const result = await dialog.showOpenDialog({
        title: "Select your Live2D model directory",
        properties: ["openDirectory"],
        message: "Pick the folder that contains your model's .model3.json file.",
    });
    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: "Cancelled." };
    }
    const chosen = result.filePaths[0]!;
    if (!isValidModelDirectory(chosen)) {
        return {
            success: false,
            error: "That folder doesn't contain a .model3.json file. Pick the model's own folder.",
        };
    }
    const config = loadConfig();
    config.modelDirectory = chosen;
    saveConfig(config);
    return { success: true, path: chosen };
});

ipcMain.handle("clear-model-directory", () => {
    const config = loadConfig();
    config.modelDirectory = null;
    saveConfig(config);
    return { success: true };
});

// Toys
ipcMain.handle("get-available-toys", () => {
    return getAvailableToys();
});

ipcMain.handle("get-toy-status", () => {
    const config = loadConfig();
    const available = getAvailableToys();
    return available.map((toy) => ({
        ...toy,
        installed: config.installedToys.includes(toy.package),
        running: isToyRunning(toy.package),
    }));
});

ipcMain.handle("install-toy", async (_event, packageName: string) => {
    try {
        await installToy(packageName);
        return { success: true };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
});

ipcMain.handle("uninstall-toy", async (_event, packageName: string) => {
    try {
        await uninstallToy(packageName);
        return { success: true };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
});

ipcMain.handle("start-toy", async (_event, packageName: string) => {
    try {
        if (!sharedVts) {
            return { success: false, error: "Not connected to VTube Studio." };
        }
        if (packageName === MESHMARKET_PACKAGE && !loadConfig().modelDirectory) {
            return {
                success: false,
                error: "Mesh Market needs your Live2D model directory. Open Settings → Model → Detect (or Browse) before starting.",
            };
        }
        await startToy(packageName, await buildToyContext(packageName));
        return { success: true };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
});

ipcMain.handle("stop-toy", async (_event, packageName: string) => {
    try {
        await stopToy(packageName);
        return { success: true };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
});

// Toy controls
ipcMain.handle("get-toy-schema", async (_event, packageName: string) => {
    try {
        const schema = await getToyControlSchema(packageName, await buildToyContext(packageName));
        return { success: true, schema: schema ?? null };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
});

ipcMain.handle("get-toy-config", (_event, packageName: string) => {
    const config = loadConfig();
    return config.toyConfigs[packageName] ?? {};
});

ipcMain.handle(
    "set-toy-config",
    async (_event, packageName: string, values: Record<string, unknown>, schema: ToyControlSchema | null) => {
        try {
            const config = loadConfig();
            const resolved = schema ? resolveToyConfig(schema, values) : { ...values };
            config.toyConfigs[packageName] = resolved;
            saveConfig(config);
            await notifyToyConfigChange(packageName, resolved);
            return { success: true };
        } catch (err) {
            return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
    },
);

// --- App lifecycle ---

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
        win = null;
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on("before-quit", async () => {
    await stopAllToys();
});

app.whenReady().then(createWindow);
