import { useEffect, useState } from "react";
import { ToyList } from "./components/ToyList";
import { ConfigPanel } from "./components/ConfigPanel";
import { Footer } from "./components/Footer";
import { checkForUpdate, openExternal, type UpdateInfo } from "./hooks/useIpc";
import "./App.css";

type Tab = "plugins" | "settings";

function App() {
    const [activeTab, setActiveTab] = useState<Tab>("plugins");
    const [update, setUpdate] = useState<UpdateInfo | null>(null);

    useEffect(() => {
        void checkForUpdate().then(setUpdate);
    }, []);

    return (
        <div className="app">
            <header className="app-header">
                <div className="app-title-row">
                    <h1>Sarxina Plugin Manager</h1>
                    {update?.available && update.url && (
                        <button
                            className="update-available"
                            onClick={() => void openExternal(update.url!)}
                            title={`Latest: v${update.latestVersion}`}
                        >
                            Update available!
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
