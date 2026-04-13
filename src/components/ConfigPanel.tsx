import { useState, useEffect } from "react";
import {
    getConfig,
    saveConfig,
    connect,
    twitchAuth,
    hasForeheadPin,
    clearForeheadPin,
    type AppConfig,
} from "../hooks/useIpc";

export function ConfigPanel() {
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [status, setStatus] = useState("");
    const [connected, setConnected] = useState(false);
    const [hasPin, setHasPin] = useState(false);
    const [twitchUser, setTwitchUser] = useState<string | null>(null);
    const [authingTwitch, setAuthingTwitch] = useState(false);

    useEffect(() => {
        getConfig().then((c) => {
            setConfig(c);
            if (c.twitchChannelName) setTwitchUser(c.twitchChannelName);
        });
        hasForeheadPin().then(setHasPin);
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
