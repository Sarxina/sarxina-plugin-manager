import { useState, useEffect, useCallback } from "react";
import {
    getToyStatus,
    installToy,
    uninstallToy,
    startToy,
    stopToy,
    hasForeheadPin,
    requestForeheadPin,
    checkToyUpdates,
    updateToy,
    type ToyInfo,
    type ToyUpdateInfo,
} from "../hooks/useIpc";
import { ToyControlPanel } from "./ToyControlPanel";

const NEEDS_FOREHEAD_PIN = new Set(["@sarxina/ao3tagger"]);

export function ToyList() {
    const [toys, setToys] = useState<ToyInfo[]>([]);
    const [loading, setLoading] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [pinPrompt, setPinPrompt] = useState(false);
    const [_pendingStart, setPendingStart] = useState<string | null>(null);
    const [expandedInfo, setExpandedInfo] = useState<string | null>(null);
    const [updates, setUpdates] = useState<Record<string, ToyUpdateInfo>>({});

    const refresh = useCallback(async () => {
        const status = await getToyStatus();
        setToys(status);
    }, []);

    const refreshUpdates = useCallback(async () => {
        const result = await checkToyUpdates();
        setUpdates(result);
    }, []);

    useEffect(() => {
        refresh();
        void refreshUpdates();
    }, [refresh, refreshUpdates]);

    const handleUpdate = async (pkg: string) => {
        setLoading(pkg);
        setError("");
        const result = await updateToy(pkg);
        if (!result.success) setError(result.error ?? "Update failed");
        await refresh();
        await refreshUpdates();
        setLoading(null);
    };

    const handleInstall = async (pkg: string) => {
        setLoading(pkg);
        setError("");
        const result = await installToy(pkg);
        if (!result.success) setError(result.error ?? "Install failed");
        await refresh();
        setLoading(null);
    };

    const handleUninstall = async (pkg: string) => {
        setLoading(pkg);
        setError("");
        const result = await uninstallToy(pkg);
        if (!result.success) setError(result.error ?? "Uninstall failed");
        await refresh();
        setLoading(null);
    };

    const handleToggle = async (toy: ToyInfo) => {
        if (toy.running) {
            setLoading(toy.package);
            setError("");
            const result = await stopToy(toy.package);
            if (!result.success) setError(result.error ?? "Stop failed");
            await refresh();
            setLoading(null);
            return;
        }

        if (NEEDS_FOREHEAD_PIN.has(toy.package)) {
            const hasPin = await hasForeheadPin();
            if (!hasPin) {
                setPendingStart(toy.package);
                setPinPrompt(true);
                void waitForForeheadClick(toy.package);
                return;
            }
        }

        await doStart(toy.package);
    };

    const doStart = async (pkg: string) => {
        setLoading(pkg);
        setError("");
        const result = await startToy(pkg);
        if (!result.success) setError(result.error ?? "Start failed");
        await refresh();
        setLoading(null);
    };

    const waitForForeheadClick = async (pkg: string) => {
        setError("");
        const result = await requestForeheadPin();
        if (!result.success) {
            setPinPrompt(false);
            setError(result.error ?? "Failed to get forehead position");
            setPendingStart(null);
            return;
        }
        setPinPrompt(false);
        await doStart(pkg);
        setPendingStart(null);
    };

    const handlePinCancel = () => {
        setPinPrompt(false);
        setPendingStart(null);
    };

    return (
        <div className="panel">
            <h2>Plugins</h2>

            {error && <div className="error-message">{error}</div>}

            {pinPrompt && (
                <div className="pin-prompt">
                    <div className="pin-prompt-content">
                        <h3>Double-click your model's forehead in VTube Studio</h3>
                        <p className="pin-prompt-waiting">Waiting for click...</p>
                        <div className="button-row">
                            <button onClick={handlePinCancel} className="secondary">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="toy-grid">
                {toys.map((toy) => {
                    const toggleExpanded = () =>
                        setExpandedInfo(expandedInfo === toy.package ? null : toy.package);
                    const stop = (e: React.MouseEvent | React.ChangeEvent) => e.stopPropagation();
                    return (
                        <div key={toy.package} className={`toy-card ${toy.running ? "toy-card--active" : ""}`}>
                            <div
                                className="toy-card-row toy-card-row--clickable"
                                onClick={toggleExpanded}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        toggleExpanded();
                                    }
                                }}
                            >
                                <div className="toy-info">
                                    <div className="toy-title-row">
                                        <h3>{toy.name}</h3>
                                        <span className="info-btn" aria-hidden="true" title="Click anywhere to expand">
                                            ?
                                        </span>
                                    </div>
                                    <p className="toy-description">{toy.description}</p>
                                </div>
                                <div className="toy-actions" onClick={stop}>
                                    {!toy.installed ? (
                                        <button
                                            onClick={(e) => { stop(e); handleInstall(toy.package); }}
                                            disabled={loading === toy.package}
                                            className="primary"
                                        >
                                            {loading === toy.package ? "Installing..." : "Install"}
                                        </button>
                                    ) : (
                                        <>
                                            {updates[toy.package]?.available && (
                                                <button
                                                    className="toy-update-arrow"
                                                    onClick={(e) => { stop(e); void handleUpdate(toy.package); }}
                                                    disabled={loading === toy.package}
                                                    title={`Update ${updates[toy.package]?.installed} → ${updates[toy.package]?.latest}`}
                                                >
                                                    ↑
                                                </button>
                                            )}
                                            <label className="toggle" title={toy.running ? "Stop" : "Start"} onClick={stop}>
                                                <input
                                                    type="checkbox"
                                                    checked={toy.running}
                                                    onChange={(e) => { stop(e); handleToggle(toy); }}
                                                    disabled={loading === toy.package}
                                                />
                                                <span className="toggle-slider" />
                                            </label>
                                            <button
                                                className="uninstall-btn"
                                                onClick={(e) => { stop(e); handleUninstall(toy.package); }}
                                                disabled={loading === toy.package || toy.running}
                                                title="Uninstall"
                                            >
                                                🗑
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                            {expandedInfo === toy.package && (
                                <div className="toy-expanded">
                                    {toy.demoGif && (
                                        <img src={toy.demoGif} alt={`${toy.name} demo`} className="toy-demo-gif" />
                                    )}
                                    <p className="toy-guide">{toy.guide}</p>
                                    {toy.installed && <ToyControlPanel packageName={toy.package} />}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
