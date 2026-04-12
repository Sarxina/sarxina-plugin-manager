import { app, BrowserWindow, ipcMain } from "electron";
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
} from "./toyManager.js";
import { authenticateWithTwitch, getTwitchUser } from "./twitchAuth.js";

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

async function createSharedConnections(config: AppConfig): Promise<void> {
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

    if (config.twitchClientId && config.twitchAccessToken && config.twitchChannelName) {
        process.env["TWITCH_CLIENT_ID"] = config.twitchClientId;
        process.env["TWITCH_ACCESS_TOKEN"] = config.twitchAccessToken;
        process.env["TWITCH_CHANNEL_NAME"] = config.twitchChannelName;
        process.env["TWITCH_REFRESH_TOKEN"] = config.twitchRefreshToken;
        process.env["TWITCH_BROADCASTER_ID"] = config.twitchBroadcasterId;
        sharedChat = new tools.TwitchChatManager();
    }
}

/**
 * Build the context object to pass to a toy's startToy(). Includes the
 * forehead pin if one is saved in config.
 */
function buildToyContext(): unknown {
    const config = loadConfig();
    return {
        chat: sharedChat,
        vts: sharedVts,
        foreheadPin: config.foreheadPin ?? undefined,
        debug: config.debugOutput,
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
        await createSharedConnections(config);
        return { success: true };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
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
        await startToy(packageName, buildToyContext());
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
