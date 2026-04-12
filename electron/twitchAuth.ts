import { shell } from "electron";
import http from "node:http";
import crypto from "node:crypto";

const TWITCH_CLIENT_ID = "ca28wij67yu3awdfub9c7xj5deh8xw";
const REDIRECT_PORT = 8921;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

// Scopes the launcher needs
const SCOPES = [
    "chat:read",
    "chat:edit",
    "channel:read:redemptions",
].join(" ");

interface TwitchTokens {
    accessToken: string;
    refreshToken: string;
    clientId: string;
}

/**
 * Runs the full Twitch OAuth2 PKCE flow:
 * 1. Opens the user's browser to Twitch login
 * 2. Catches the redirect on a local server
 * 3. Exchanges the code for tokens
 * 4. Returns the tokens
 */
export async function authenticateWithTwitch(): Promise<TwitchTokens> {
    // Generate PKCE challenge
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

    // Build auth URL
    const authUrl = new URL("https://id.twitch.tv/oauth2/authorize");
    authUrl.searchParams.set("client_id", TWITCH_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("force_verify", "true");

    // Start listening for the redirect, then open the browser
    const codePromise = waitForAuthCode();
    shell.openExternal(authUrl.toString());
    const authCode = await codePromise;

    // Exchange code for tokens
    const tokenResp = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: TWITCH_CLIENT_ID,
            code: authCode,
            grant_type: "authorization_code",
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier,
        }),
    });

    if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        throw new Error(`Token exchange failed: ${errText}`);
    }

    const tokenData = (await tokenResp.json()) as {
        access_token: string;
        refresh_token: string;
    };

    return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        clientId: TWITCH_CLIENT_ID,
    };
}

/**
 * Spins up a temporary local HTTP server that waits for Twitch's redirect,
 * extracts the auth code, and shuts down.
 */
function waitForAuthCode(): Promise<string> {
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
            // Server ready — browser will be opened by the caller
        });

        // Timeout after 2 minutes
        setTimeout(() => {
            server.close();
            reject(new Error("Twitch auth timed out — no response within 2 minutes"));
        }, 120000);
    });
}

/**
 * Get the user's Twitch user ID and display name from their access token.
 */
export async function getTwitchUser(accessToken: string): Promise<{ id: string; login: string; displayName: string }> {
    const resp = await fetch("https://api.twitch.tv/helix/users", {
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Client-Id": TWITCH_CLIENT_ID,
        },
    });

    if (!resp.ok) {
        throw new Error(`Failed to get Twitch user: ${resp.status}`);
    }

    const data = (await resp.json()) as { data: { id: string; login: string; display_name: string }[] };
    const user = data.data[0];
    if (!user) throw new Error("No user data returned from Twitch");

    return { id: user.id, login: user.login, displayName: user.display_name };
}
