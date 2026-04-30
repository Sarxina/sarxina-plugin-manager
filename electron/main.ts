import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
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
    getInstalledToyVersion,
    getLatestToyVersion,
    updateToy,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharedChat: any = null;
let sharedActionRegistry: unknown = null;
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
    sharedChat = new tools.TwitchManager();
    // Build the action registry around the shared chat manager so toys can
    // register Actions via `ctx.actionRegistry` instead of consuming events
    // directly. Each toy's Actions are independent — registry routes to all.
    sharedActionRegistry = new tools.ActionRegistry([sharedChat]);
    return sharedChat;
}

async function buildToyContext(packageName?: string): Promise<unknown> {
    const config = loadConfig();
    const toyConfig = packageName ? (config.toyConfigs[packageName] ?? {}) : {};
    // ensureChatManager populates sharedActionRegistry as a side effect when
    // chat is available. If Twitch isn't configured, both stay null.
    const chat = await ensureChatManager(config);
    return {
        chat,
        actionRegistry: chat ? sharedActionRegistry : null,
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
// Compares "0.4.1" vs "0.4.0"-style strings. Returns true if `latest` is
// strictly greater. Tolerant of extra parts (any beyond the third are
// ignored) and missing parts (treated as 0).
function isNewerVersion(latest: string, current: string): boolean {
    const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
    const a = parse(latest);
    const b = parse(current);
    for (let i = 0; i < 3; i++) {
        const la = a[i] ?? 0;
        const lb = b[i] ?? 0;
        if (la > lb) return true;
        if (la < lb) return false;
    }
    return false;
}

ipcMain.handle("check-for-update", async () => {
    try {
        const resp = await fetch(
            "https://api.github.com/repos/Sarxina/sarxina-plugin-manager/releases/latest",
            {
                headers: {
                    "User-Agent": "sarxina-plugin-manager",
                    Accept: "application/vnd.github+json",
                },
            },
        );
        if (!resp.ok) return { available: false };
        const data = (await resp.json()) as { tag_name?: string; html_url?: string };
        const latest = data.tag_name?.replace(/^v/, "") ?? "";
        const current = app.getVersion();
        if (!latest || !isNewerVersion(latest, current)) return { available: false };
        return {
            available: true,
            latestVersion: latest,
            url: data.html_url ?? "https://github.com/Sarxina/sarxina-plugin-manager/releases/latest",
        };
    } catch {
        return { available: false };
    }
});

ipcMain.handle("open-external", async (_event, url: string) => {
    await shell.openExternal(url);
});

// Downloads the Windows .exe asset from the latest GitHub release into the
// user's Downloads folder, streaming progress back to the renderer so the
// button can show a percentage. When done, opens File Explorer with the new
// .exe highlighted so the user can run it manually (we keep portable, so
// the app can't replace itself in place).
ipcMain.handle("download-update", async () => {
    try {
        const releaseResp = await fetch(
            "https://api.github.com/repos/Sarxina/sarxina-plugin-manager/releases/latest",
            {
                headers: {
                    "User-Agent": "sarxina-plugin-manager",
                    Accept: "application/vnd.github+json",
                },
            },
        );
        if (!releaseResp.ok) {
            return { success: false, error: `GitHub API ${releaseResp.status}` };
        }
        const release = (await releaseResp.json()) as {
            assets?: Array<{ name: string; browser_download_url: string; size: number }>;
        };
        const asset = release.assets?.find((a) => /Windows.*\.exe$/i.test(a.name));
        if (!asset) {
            return { success: false, error: "No Windows .exe asset on the latest release." };
        }

        const downloadsDir = app.getPath("downloads");
        const targetPath = path.join(downloadsDir, asset.name);

        const dlResp = await fetch(asset.browser_download_url, {
            headers: { "User-Agent": "sarxina-plugin-manager" },
            redirect: "follow",
        });
        if (!dlResp.ok || !dlResp.body) {
            return { success: false, error: `Download failed: ${dlResp.status}` };
        }

        const total = asset.size;
        let received = 0;
        let lastPercent = -1;
        const fileStream = (await import("node:fs")).createWriteStream(targetPath);
        const reader = dlResp.body.getReader();
        const sender = win?.webContents;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fileStream.write(Buffer.from(value));
            received += value.length;
            const percent = total > 0 ? Math.floor((received / total) * 100) : 0;
            if (percent !== lastPercent) {
                lastPercent = percent;
                sender?.send("update-download-progress", percent);
            }
        }
        fileStream.end();
        await new Promise<void>((resolve) => fileStream.on("close", () => resolve()));

        shell.showItemInFolder(targetPath);
        return { success: true, path: targetPath };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
});

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

ipcMain.handle("check-toy-updates", async () => {
    const config = loadConfig();
    const results: Record<string, { installed: string | null; latest: string | null; available: boolean }> = {};
    await Promise.all(
        config.installedToys.map(async (pkg) => {
            const installed = getInstalledToyVersion(pkg);
            const latest = await getLatestToyVersion(pkg);
            const available = !!installed && !!latest && isNewerVersion(latest, installed);
            results[pkg] = { installed, latest, available };
        }),
    );
    return results;
});

ipcMain.handle("update-toy", async (_event, packageName: string) => {
    try {
        await updateToy(packageName);
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
