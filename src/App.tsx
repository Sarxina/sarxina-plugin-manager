import { useEffect, useState } from "react";
import { ToyList } from "./components/ToyList";
import { ConfigPanel } from "./components/ConfigPanel";
import { Footer } from "./components/Footer";
import {
    checkForUpdate,
    downloadUpdate,
    onUpdateProgress,
    type UpdateInfo,
} from "./hooks/useIpc";
import "./App.css";

type Tab = "plugins" | "settings";
type DownloadState = "idle" | "downloading" | "done" | "error";

function App() {
    const [activeTab, setActiveTab] = useState<Tab>("plugins");
    const [update, setUpdate] = useState<UpdateInfo | null>(null);
    const [downloadState, setDownloadState] = useState<DownloadState>("idle");
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        void checkForUpdate().then(setUpdate);
        const unsubscribe = onUpdateProgress(setProgress);
        return unsubscribe;
    }, []);

    const handleUpdateClick = async () => {
        if (downloadState === "downloading") return;
        setDownloadState("downloading");
        setProgress(0);
        const result = await downloadUpdate();
        setDownloadState(result.success ? "done" : "error");
    };

    const buttonLabel = (() => {
        if (downloadState === "downloading") return `Downloading... ${progress}%`;
        if (downloadState === "done") return "Open in Downloads";
        if (downloadState === "error") return "Download failed — retry";
        return "Update available!";
    })();

    return (
        <div className="app">
            <header className="app-header">
                <div className="app-title-row">
                    <h1>Sarxina Plugin Manager</h1>
                    {update?.available && (
                        <button
                            className="update-available"
                            onClick={() => void handleUpdateClick()}
                            disabled={downloadState === "downloading"}
                            title={`Latest: v${update.latestVersion}`}
                        >
                            {buttonLabel}
                        </button>
                    )}
                </div>
                <nav className="tab-bar">
                    <button
                        className={activeTab === "plugins" ? "tab active" : "tab"}
                        onClick={() => setActiveTab("plugins")}
                    >
                        Plugins
                    </button>
                    <button
                        className={activeTab === "settings" ? "tab active" : "tab"}
                        onClick={() => setActiveTab("settings")}
                    >
                        Settings
                    </button>
                </nav>
            </header>

            <main className="app-content">
                {activeTab === "plugins" && <ToyList />}
                {activeTab === "settings" && <ConfigPanel />}
            </main>

            <Footer />
        </div>
    );
}

export default App;
