import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

/**
 * Candidate base paths to VTube Studio's `Live2DModels` directory across
 * platforms. Each candidate is a directory containing one subfolder per
 * model (e.g. `Live2DModels/Sarxina/`).
 */
function getCandidateModelsDirs(): string[] {
    if (process.platform === "win32") {
        return [
            "C:\\Program Files (x86)\\Steam\\steamapps\\common\\VTube Studio\\VTube Studio_Data\\StreamingAssets\\Live2DModels",
            "C:\\Program Files\\Steam\\steamapps\\common\\VTube Studio\\VTube Studio_Data\\StreamingAssets\\Live2DModels",
        ];
    }
    if (process.platform === "darwin") {
        return [
            path.join(
                homedir(),
                "Library/Application Support/Steam/steamapps/common/VTube Studio/VTube Studio.app/Contents/Resources/Data/StreamingAssets/Live2DModels",
            ),
        ];
    }
    return [];
}

/**
 * Find the absolute path to the directory holding the active Live2D model.
 *
 * @param activeModelFilename The `.model3.json` filename VTS reports as the
 *   currently-loaded model (e.g. `"Sarxina.model3.json"`). Comparison is
 *   case-insensitive and tolerates the `.model3.json` extension being absent.
 * @returns Absolute directory path containing the model, or `null` if no
 *   match is found across the candidate locations.
 */
export function detectModelDirectory(activeModelFilename: string): string | null {
    if (!activeModelFilename) return null;
    const wanted = activeModelFilename.toLowerCase().replace(/\.model3\.json$/, "");

    for (const baseDir of getCandidateModelsDirs()) {
        if (!existsSync(baseDir)) continue;
        let entries: string[];
        try {
            entries = readdirSync(baseDir);
        } catch {
            continue;
        }
        for (const entry of entries) {
            const candidate = path.join(baseDir, entry);
            const manifest = `${entry}.model3.json`;
            if (entry.toLowerCase() === wanted && existsSync(path.join(candidate, manifest))) {
                return candidate;
            }
        }
    }
    return null;
}

/**
 * Validate that a directory looks like a Live2D model directory by checking
 * for at least one `.model3.json` file. Used to guard manual file-picker
 * selections.
 */
export function isValidModelDirectory(dirPath: string): boolean {
    if (!existsSync(dirPath)) return false;
    try {
        return readdirSync(dirPath).some((f) => f.endsWith(".model3.json"));
    } catch {
        return false;
    }
}
