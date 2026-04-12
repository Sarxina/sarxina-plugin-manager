import { useState } from "react";
import { ToyList } from "./components/ToyList";
import { ConfigPanel } from "./components/ConfigPanel";
import { Footer } from "./components/Footer";
import "./App.css";

type Tab = "plugins" | "settings";

function App() {
    const [activeTab, setActiveTab] = useState<Tab>("plugins");

    return (
        <div className="app">
            <header className="app-header">
                <h1>Sarxina Plugin Manager</h1>
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
