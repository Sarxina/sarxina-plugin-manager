import { app } from "electron";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

export interface ClickPinData {
    modelID: string;
    artMeshID: string;
    angle: number;
    size: number;
    vertexID1: number;
    vertexID2: number;
    vertexID3: number;
    vertexWeight1: number;
    vertexWeight2: number;
    vertexWeight3: number;
}

export interface FaceMeshData {
    /** Pin target — the "center" face mesh to anchor the emoji to. */
    pin: string;
    /** All meshes to hide while the emoji is active (includes pin). */
    hide: string[];
}

export interface AppConfig {
    twitchClientId: string;
    twitchAccessToken: string;
    twitchChannelName: string;
    twitchRefreshToken: string;
    twitchBroadcasterId: string;
    vtsUrl: string;
    installedToys: string[];
    activeToys: string[];
    foreheadPin: ClickPinData | null;
    faceMesh: FaceMeshData | null;
    /** Absolute path to the active Live2D model's directory (containing the
     *  .model3.json). Used by toys that need to parse the .moc3 hierarchy. */
    modelDirectory: string | null;
    /** Per-toy configuration bags, keyed by npm package name. Populated from
     *  the toy's `getControlSchema()` + user choices. */
    toyConfigs: Record<string, Record<string, unknown>>;
    debugOutput: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
    twitchClientId: "",
    twitchAccessToken: "",
    twitchChannelName: "",
    twitchRefreshToken: "",
    twitchBroadcasterId: "",
    vtsUrl: "ws://localhost:8001",
    installedToys: [],
    activeToys: [],
    foreheadPin: null,
    faceMesh: null,
    modelDirectory: null,
    toyConfigs: {},
    debugOutput: false,
};

function getConfigDir(): string {
    return path.join(app.getPath("userData"));
}

function getConfigPath(): string {
    return path.join(getConfigDir(), "config.json");
}

export function getToysDir(): string {
    // Use a path without spaces — native modules (like canvas) fail to
    // compile when the working directory contains spaces due to a
    // node-pre-gyp bug.
    const homeDir = app.getPath("home");
    const dir = path.join(homeDir, ".sarxina-toys");
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        // Initialize a package.json so npm install works in this directory
        writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({ name: "sarxina-toys", private: true, dependencies: {} }, null, 2)
        );
    }
    return dir;
}

export function loadConfig(): AppConfig {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) {
        saveConfig(DEFAULT_CONFIG);
        return { ...DEFAULT_CONFIG };
    }
    try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<AppConfig>;
        return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

export function saveConfig(config: AppConfig): void {
    const dir = getConfigDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}
