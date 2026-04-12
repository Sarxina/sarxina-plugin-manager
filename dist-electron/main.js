import { app, shell, ipcMain, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
const DEFAULT_CONFIG = {
  twitchClientId: "",
  twitchAccessToken: "",
  twitchChannelName: "",
  twitchRefreshToken: "",
  twitchBroadcasterId: "",
  vtsUrl: "ws://localhost:8001",
  installedToys: [],
  activeToys: [],
  foreheadPin: null,
  debugOutput: false
};
function getConfigDir() {
  return path.join(app.getPath("userData"));
}
function getConfigPath() {
  return path.join(getConfigDir(), "config.json");
}
function getToysDir() {
  const homeDir = app.getPath("home");
  const dir = path.join(homeDir, ".sarxina-toys");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "sarxina-toys", private: true, dependencies: {} }, null, 2)
    );
  }
  return dir;
}
function loadConfig() {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function saveConfig(config) {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}
const electronVersion = process.versions["electron"];
const runningToys = /* @__PURE__ */ new Map();
function getAvailableToys() {
  return [
    {
      name: "AO3 Tagger",
      package: "@sarxina/ao3tagger",
      description: "Allows your chat to tag your model with AO3 tags",
      guide: "Chat types !ao3tag <text> to add a tag. Tags stack and appear on your forehead. Use !ao3tag clear to remove them."
    },
    {
      name: "Foxy Jumpscare",
      package: "@sarxina/foxyjumpscare",
      description: "1/10000 chance Withered Foxy jumpscares you through your model each second",
      guide: "Just turn it on. Every second there's a 1 in 10,000 chance a jumpscare gif and sound plays over your model. No commands needed."
    },
    {
      name: "GetDown",
      package: "@sarxina/getdown",
      description: "Break and randomize your model's movements",
      guide: "Toggle it on and your model starts flailing around chaotically. Toggle it off to stop. No chat commands needed."
    }
  ];
}
async function installToy(packageName) {
  const toysDir = getToysDir();
  await runNpm(`install ${packageName}`, toysDir);
  const config = loadConfig();
  if (!config.installedToys.includes(packageName)) {
    config.installedToys.push(packageName);
    saveConfig(config);
  }
}
async function uninstallToy(packageName) {
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
async function startToy(packageName, ctx) {
  if (runningToys.has(packageName)) {
    console.log(`${packageName} is already running`);
    return;
  }
  const toysDir = getToysDir();
  const toyDir = path.join(toysDir, "node_modules", packageName);
  if (!existsSync(toyDir)) {
    throw new Error(`${packageName} is not installed`);
  }
  const toyPkg = JSON.parse(
    readFileSync(path.join(toyDir, "package.json"), "utf-8")
  );
  const entryFile = toyPkg.main ?? "dist/index.js";
  const entryPath = path.join(toyDir, entryFile);
  const toyModule = await import(entryPath);
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
async function stopToy(packageName) {
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
function isToyRunning(packageName) {
  return runningToys.has(packageName);
}
async function stopAllToys() {
  const promises = [];
  for (const [name, handle] of runningToys) {
    console.log(`Stopping ${name}...`);
    promises.push(handle.stop());
  }
  await Promise.all(promises);
  runningToys.clear();
}
function runNpm(args, cwd) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      npm_config_target: electronVersion,
      npm_config_arch: process.arch,
      npm_config_target_arch: process.arch,
      npm_config_disturl: "https://electronjs.org/headers",
      npm_config_runtime: "electron",
      npm_config_build_from_source: "true"
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
const TWITCH_CLIENT_ID = "ca28wij67yu3awdfub9c7xj5deh8xw";
const REDIRECT_PORT = 8921;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPES = [
  "chat:read",
  "chat:edit",
  "channel:read:redemptions"
].join(" ");
async function authenticateWithTwitch() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const authUrl = new URL("https://id.twitch.tv/oauth2/authorize");
  authUrl.searchParams.set("client_id", TWITCH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("force_verify", "true");
  const codePromise = waitForAuthCode();
  shell.openExternal(authUrl.toString());
  const authCode = await codePromise;
  const tokenResp = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      code: authCode,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier
    })
  });
  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    throw new Error(`Token exchange failed: ${errText}`);
  }
  const tokenData = await tokenResp.json();
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    clientId: TWITCH_CLIENT_ID
  };
}
function waitForAuthCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authorization denied.</h2><p>You can close this tab.</p></body></html>");
          server.close();
          reject(new Error(`Twitch auth denied: ${error}`));
          return;
        }
        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Connected to Twitch!</h2><p>You can close this tab and return to Sarxina Plugin Manager.</p></body></html>");
          server.close();
          resolve(code);
          return;
        }
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(REDIRECT_PORT, () => {
    });
    setTimeout(() => {
      server.close();
      reject(new Error("Twitch auth timed out — no response within 2 minutes"));
    }, 12e4);
  });
}
async function getTwitchUser(accessToken) {
  const resp = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Client-Id": TWITCH_CLIENT_ID
    }
  });
  if (!resp.ok) {
    throw new Error(`Failed to get Twitch user: ${resp.status}`);
  }
  const data = await resp.json();
  const user = data.data[0];
  if (!user) throw new Error("No user data returned from Twitch");
  return { id: user.id, login: user.login, displayName: user.display_name };
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env["APP_ROOT"] = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env["APP_ROOT"], "dist-electron");
const RENDERER_DIST = path.join(process.env["APP_ROOT"], "dist");
process.env["VITE_PUBLIC"] = VITE_DEV_SERVER_URL ? path.join(process.env["APP_ROOT"], "public") : RENDERER_DIST;
let win;
let sharedChat = null;
let sharedVts = null;
function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    title: "Sarxina Plugin Manager",
    icon: path.join(process.env["VITE_PUBLIC"], "icon.png"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
async function createSharedConnections(config) {
  process.env["TWITCH_CLIENT_ID"] = config.twitchClientId;
  process.env["TWITCH_ACCESS_TOKEN"] = config.twitchAccessToken;
  process.env["TWITCH_CHANNEL_NAME"] = config.twitchChannelName;
  process.env["TWITCH_REFRESH_TOKEN"] = config.twitchRefreshToken;
  process.env["TWITCH_BROADCASTER_ID"] = config.twitchBroadcasterId;
  const tools = await import("@sarxina/sarxina-tools");
  let pluginIcon;
  try {
    const iconPath = path.join(process.env["VITE_PUBLIC"] ?? "", "icon-128.png");
    pluginIcon = readFileSync(iconPath).toString("base64");
  } catch {
  }
  sharedChat = new tools.TwitchChatManager();
  sharedVts = await tools.VTSClient.connect({
    url: config.vtsUrl || "ws://localhost:8001",
    pluginName: "SarxinaPluginManager",
    pluginDeveloper: "Sarxina",
    pluginIcon
  });
}
function buildToyContext() {
  const config = loadConfig();
  return {
    chat: sharedChat,
    vts: sharedVts,
    foreheadPin: config.foreheadPin ?? void 0,
    debug: config.debugOutput
  };
}
ipcMain.handle("twitch-auth", async () => {
  try {
    const tokens = await authenticateWithTwitch();
    const user = await getTwitchUser(tokens.accessToken);
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
ipcMain.handle("get-config", () => {
  return loadConfig();
});
ipcMain.handle("save-config", (_event, config) => {
  saveConfig(config);
  return { success: true };
});
ipcMain.handle("connect", async () => {
  try {
    const config = loadConfig();
    if (!config.twitchClientId || !config.twitchAccessToken || !config.twitchChannelName) {
      return { success: false, error: "Twitch credentials not configured" };
    }
    await createSharedConnections(config);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});
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
    config.foreheadPin = pin;
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
ipcMain.handle("get-available-toys", () => {
  return getAvailableToys();
});
ipcMain.handle("get-toy-status", () => {
  const config = loadConfig();
  const available = getAvailableToys();
  return available.map((toy) => ({
    ...toy,
    installed: config.installedToys.includes(toy.package),
    running: isToyRunning(toy.package)
  }));
});
ipcMain.handle("install-toy", async (_event, packageName) => {
  try {
    await installToy(packageName);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});
ipcMain.handle("uninstall-toy", async (_event, packageName) => {
  try {
    await uninstallToy(packageName);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});
ipcMain.handle("start-toy", async (_event, packageName) => {
  try {
    if (!sharedVts || !sharedChat) {
      return { success: false, error: "Not connected. Configure and connect first." };
    }
    await startToy(packageName, buildToyContext());
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});
ipcMain.handle("stop-toy", async (_event, packageName) => {
  try {
    await stopToy(packageName);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});
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
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
