import { useState, useEffect } from "react";
import {
    getConfig,
    saveConfig,
    connect,
    twitchAuth,
    hasForeheadPin,
    clearForeheadPin,
    hasFaceMesh,
    requestFaceMesh,
    clearFaceMesh,
    getModelDirectory,
    detectModelDirectory,
    browseModelDirectory,
    clearModelDirectory,
    type AppConfig,
} from "../hooks/useIpc";

export function ConfigPanel() {
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [status, setStatus] = useState("");
    const [connected, setConnected] = useState(false);
    const [hasPin, setHasPin] = useState(false);
    const [hasFace, setHasFace] = useState(false);
    const [requestingFace, setRequestingFace] = useState(false);
    const [twitchUser, setTwitchUser] = useState<string | null>(null);
    const [authingTwitch, setAuthingTwitch] = useState(false);
    const [modelDir, setModelDir] = useState<string | null>(null);
    const [detectingModel, setDetectingModel] = useState(false);

    useEffect(() => {
        getConfig().then((c) => {
            setConfig(c);
            if (c.twitchChannelName) setTwitchUser(c.twitchChannelName);
        });
        hasForeheadPin().then(setHasPin);
        hasFaceMesh().then(setHasFace);
        getModelDirectory().then(setModelDir);
    }, []);

    if (!config) return <div className="panel">Loading...</div>;

    const update = (field: keyof AppConfig, value: string) => {
        setConfig({ ...config, [field]: value });
    };

    const handleSave = async () => {
        const result = await saveConfig(config);
        setStatus(result.success ? "Settings saved" : `Error: ${result.error}`);
        setTimeout(() => setStatus(""), 3000);
    };

    const handleTwitchAuth = async () => {
        setAuthingTwitch(true);
        setStatus("Opening Twitch login...");
        const result = await twitchAuth();
        setAuthingTwitch(false);

        if (result.success && result.displayName) {
            setTwitchUser(result.displayName);
            setStatus(`Connected as ${result.displayName}`);
            // Refresh config from disk since auth saved new values
            const updatedConfig = await getConfig();
            setConfig(updatedConfig);
            setTimeout(() => setStatus(""), 5000);
        } else {
            setStatus(`Twitch auth failed: ${result.error}`);
        }
    };

    const handleConnect = async () => {
        setStatus("Connecting to VTube Studio...");
        await saveConfig(config);
        const result = await connect();
        if (result.success) {
            setConnected(true);
            setStatus("Connected!");
            setTimeout(() => setStatus(""), 5000);
        } else {
            setStatus(`Connection failed: ${result.error}`);
        }
    };

    return (
        <div className="panel">
            <h2>Settings</h2>

            <div className="config-section">
                <h3>Twitch</h3>
                {twitchUser ? (
                    <div className="twitch-connected">
                        <span className="twitch-check" aria-label="Connected">✓</span>
                        <span className="twitch-status">Logged in as <strong>{twitchUser}</strong></span>
                        <button onClick={handleTwitchAuth} className="secondary" disabled={authingTwitch}>
                            {authingTwitch ? "Authorizing..." : "Re-authorize"}
                        </button>
                    </div>
                ) : (
                    <button onClick={handleTwitchAuth} className="twitch-btn" disabled={authingTwitch}>
                        {authingTwitch ? "Waiting for Twitch..." : "Connect with Twitch"}
                    </button>
                )}
            </div>

            <div className="config-section">
                <h3>VTube Studio</h3>
                <label>
                    API URL
                    <input
                        type="text"
                        value={config.vtsUrl}
                        onChange={(e) => update("vtsUrl", e.target.value)}
                        placeholder="ws://localhost:8001"
                    />
                </label>
            </div>

            <div className="config-section">
                <h3>Model</h3>
                <p className="config-hint">
                    {hasPin
                        ? "Forehead position is set. Reset it if you change models."
                        : "Forehead position not set — you'll be prompted when starting a plugin that needs it."}
                </p>
                {hasPin && (
                    <button
                        onClick={async () => {
                            await clearForeheadPin();
                            setHasPin(false);
                            setStatus("Forehead position cleared");
                            setTimeout(() => setStatus(""), 3000);
                        }}
                        className="secondary"
                    >
                        Reset Forehead Position
                    </button>
                )}

                <p className="config-hint" style={{ marginTop: "1rem" }}>
                    {hasFace
                        ? "Face meshes are set. Reset if you change models."
                        : "Face meshes not set — required by EmojiHead."}
                </p>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                        onClick={async () => {
                            setRequestingFace(true);
                            setStatus("Check VTube Studio — select your face meshes there (click center mesh first).");
                            const result = await requestFaceMesh();
                            setRequestingFace(false);
                            if (result.success) {
                                setHasFace(true);
                                setStatus(`Saved ${result.count} face meshes.`);
                            } else {
                                setStatus(`Face selection failed: ${result.error}`);
                            }
                            setTimeout(() => setStatus(""), 5000);
                        }}
                        disabled={requestingFace}
                    >
                        {requestingFace ? "Waiting for VTS..." : hasFace ? "Re-select Face Meshes" : "Select Face Meshes"}
                    </button>
                    {hasFace && (
                        <button
                            onClick={async () => {
                                await clearFaceMesh();
                                setHasFace(false);
                                setStatus("Face meshes cleared");
                                setTimeout(() => setStatus(""), 3000);
                            }}
                            className="secondary"
                        >
                            Clear
                        </button>
                    )}
                </div>

                <p className="config-hint" style={{ marginTop: "1rem" }}>
                    {modelDir
                        ? `Model directory: ${modelDir}`
                        : "Model directory not set — required by Mesh Market. Detect it from your VTS install or browse to it manually."}
                </p>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                        onClick={async () => {
                            setDetectingModel(true);
                            setStatus("Detecting model directory from VTube Studio...");
                            const result = await detectModelDirectory();
                            setDetectingModel(false);
                            if (result.success && result.path) {
                                setModelDir(result.path);
                                setStatus(`Detected: ${result.path}`);
                            } else {
                                setStatus(result.error ?? "Detection failed.");
                            }
                            setTimeout(() => setStatus(""), 5000);
                        }}
                        disabled={detectingModel}
                    >
                        {detectingModel ? "Detecting..." : modelDir ? "Re-detect" : "Detect Model Directory"}
                    </button>
                    <button
                        onClick={async () => {
                            const result = await browseModelDirectory();
                            if (result.success && result.path) {
                                setModelDir(result.path);
                                setStatus(`Set: ${result.path}`);
                            } else if (result.error && result.error !== "Cancelled.") {
                                setStatus(result.error);
                            }
                            setTimeout(() => setStatus(""), 5000);
                        }}
                        className="secondary"
                    >
                        Browse...
                    </button>
                    {modelDir && (
                        <button
                            onClick={async () => {
                                await clearModelDirectory();
                                setModelDir(null);
                                setStatus("Model directory cleared");
                                setTimeout(() => setStatus(""), 3000);
                            }}
                            className="secondary"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            <div className="config-section">
                <h3>Advanced</h3>
                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={config.debugOutput ?? false}
                        onChange={(e) => setConfig({ ...config, debugOutput: e.target.checked })}
                    />
                    Show debug output in console
                </label>
            </div>

            <div className="button-row">
                <button onClick={handleSave}>Save</button>
                <button onClick={handleConnect} className="primary">
                    {connected ? "Reconnect to VTube Studio" : "Connect to VTube Studio"}
                </button>
            </div>

            {status && <div className="status-message">{status}</div>}
        </div>
    );
}
