import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getToysDir, loadConfig, saveConfig } from "./configStore.js";

// Electron's Node version for native module compilation
const electronVersion = process.versions["electron"];

// We import sarxina-tools types but the actual instances are created in main.ts
// and passed to startToy at runtime.
interface ToyHandle {
    stop: () => Promise<void>;
}

interface ToyModule {
    startToy: (ctx: unknown) => ToyHandle | Promise<ToyHandle>;
}

// Registry of currently running toys
const runningToys = new Map<string, ToyHandle>();

/**
 * Get the list of available toys that can be installed.
 * This is a static registry — when you add a new toy to the npm scope,
 * add it here too.
 */
export interface ToyDefinition {
    name: string;
    package: string;
    description: string;
    guide: string;
    demoGif?: string;
}

export function getAvailableToys(): ToyDefinition[] {
    return [
        {
            name: "AO3 Tagger",
            package: "@sarxina/ao3tagger",
            description: "Allows your chat to tag your model with AO3 tags",
            guide: "Chat types !ao3tag <text> to add a tag. Tags stack and appear on your forehead. Use !ao3tag clear to remove them.",
        },
        {
            name: "Foxy Jumpscare",
            package: "@sarxina/foxyjumpscare",
            description: "1/10000 chance Withered Foxy jumpscares you through your model each second",
            guide: "Just turn it on. Every second there's a 1 in 10,000 chance a jumpscare gif and sound plays over your model. No commands needed.",
        },
        {
            name: "GetDown",
            package: "@sarxina/getdown",
            description: "Break and randomize your model's movements",
            guide: "Toggle it on and your model starts flailing around chaotically. Toggle it off to stop. No chat commands needed.",
        },
        {
            name: "Mesh Market",
            package: "@sarxina/meshmarket",
            description: "Let chat buy and sell your bodyparts.",
            guide: "!meshmarket balance -> shows chatter's meshbucks\n!meshmarket buy <mesh> <#> -> buy vtuber mesh for # meshbucks\n!meshmarket show/hide - show or hide current ownership",
        },
    ];
}

/**
 * Install a toy from npm into the managed toys directory.
 */
export async function installToy(packageName: string): Promise<void> {
    const toysDir = getToysDir();
    await runNpm(`install ${packageName}`, toysDir);

    const config = loadConfig();
    if (!config.installedToys.includes(packageName)) {
        config.installedToys.push(packageName);
        saveConfig(config);
    }
}

/**
 * Uninstall a toy.
 */
export async function uninstallToy(packageName: string): Promise<void> {
    // Stop it first if running
    if (runningToys.has(packageName)) {
        await stopToy(packageName);
    }

    const toysDir = getToysDir();
    await runNpm(`uninstall ${packageName}`, toysDir);

    const config = loadConfig();
    config.installedToys = config.installedToys.filter((t) => t !== packageName);
    config.activeToys = config.activeToys.filter((t) => t !== packageName);
    saveConfig(config);
}

/**
 * Start a toy. Dynamically imports its startToy function and calls it
 * with the provided context (shared VTS + chat instances).
 */
export async function startToy(packageName: string, ctx: unknown): Promise<void> {
    if (runningToys.has(packageName)) {
        console.log(`${packageName} is already running`);
        return;
    }

    const toysDir = getToysDir();
    const toyDir = path.join(toysDir, "node_modules", packageName);

    if (!existsSync(toyDir)) {
        throw new Error(`${packageName} is not installed`);
    }

    // Read the toy's package.json to find its entry point
    const toyPkg = JSON.parse(
        readFileSync(path.join(toyDir, "package.json"), "utf-8")
    ) as { main?: string };
    const entryFile = toyPkg.main ?? "dist/index.js";
    const entryPath = path.join(toyDir, entryFile);

    // Dynamic import of the toy's main entry point.
    // ESM loader requires file:// URLs, not raw drive-letter paths on Windows.
    const toyModule = (await import(pathToFileURL(entryPath).href)) as ToyModule;

    if (typeof toyModule.startToy !== "function") {
        throw new Error(`${packageName} does not export a startToy function`);
    }

    const handle = await toyModule.startToy(ctx);
    runningToys.set(packageName, handle);

    const config = loadConfig();
    if (!config.activeToys.includes(packageName)) {
        config.activeToys.push(packageName);
        saveConfig(config);
    }

    console.log(`Started ${packageName}`);
}

/**
 * Stop a running toy.
 */
export async function stopToy(packageName: string): Promise<void> {
    const handle = runningToys.get(packageName);
    if (!handle) {
        console.log(`${packageName} is not running`);
        return;
    }

    await handle.stop();
    runningToys.delete(packageName);

    const config = loadConfig();
    config.activeToys = config.activeToys.filter((t) => t !== packageName);
    saveConfig(config);

    console.log(`Stopped ${packageName}`);
}

/**
 * Check if a toy is currently running.
 */
export function isToyRunning(packageName: string): boolean {
    return runningToys.has(packageName);
}

/**
 * Stop all running toys. Called on app shutdown.
 */
export async function stopAllToys(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [name, handle] of runningToys) {
        console.log(`Stopping ${name}...`);
        promises.push(handle.stop());
    }
    await Promise.all(promises);
    runningToys.clear();
}

// --- Internal ---

function runNpm(args: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // Set environment so native modules (like canvas) compile against
        // Electron's Node headers instead of the system Node.
        const env = {
            ...process.env,
            npm_config_target: electronVersion,
            npm_config_arch: process.arch,
            npm_config_target_arch: process.arch,
            npm_config_disturl: "https://electronjs.org/headers",
            npm_config_runtime: "electron",
            npm_config_build_from_source: "true",
        };

        exec(`npm ${args}`, { cwd, env }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`npm ${args} failed: ${stderr || error.message}`));
                return;
            }
            resolve(stdout);
        });
    });
}
