import { shell } from "electron";
import http from "node:http";

const TWITCH_CLIENT_ID = "7pt77gkod0z7lv6npo45d6njqnrtz7";
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
 * Runs the Twitch OAuth2 Implicit Grant flow (public client, no secret).
 * Twitch returns the access token in the URL fragment, so the callback page
 * uses JS to forward the fragment to /token-capture as a query string.
 * Implicit Grant does not issue refresh tokens.
 */
export async function authenticateWithTwitch(): Promise<TwitchTokens> {
    const authUrl = new URL("https://id.twitch.tv/oauth2/authorize");
    authUrl.searchParams.set("client_id", TWITCH_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "token");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("force_verify", "true");

    const tokenPromise = waitForAccessToken();
    shell.openExternal(authUrl.toString());
    const accessToken = await tokenPromise;

    return {
        accessToken,
        refreshToken: "",
        clientId: TWITCH_CLIENT_ID,
    };
}

/**
 * Spins up a temporary local HTTP server.
 *   /callback       — serves JS that copies the URL fragment to /token-capture
 *   /token-capture  — receives the forwarded access_token as a query string
 */
function waitForAccessToken(): Promise<string> {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url ?? "", `http://localhost:${REDIRECT_PORT}`);

            if (url.pathname === "/callback") {
                // Fragment isn't sent to server; forward it via JS redirect.
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(`<html><body>
<script>
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("access_token");
  const error = params.get("error");
  if (token) {
    window.location.replace("/token-capture?access_token=" + encodeURIComponent(token));
  } else {
    window.location.replace("/token-capture?error=" + encodeURIComponent(error || "no_token"));
  }
</script>
<p>Finishing Twitch login...</p>
</body></html>`);
                return;
            }

            if (url.pathname === "/token-capture") {
                const token = url.searchParams.get("access_token");
                const error = url.searchParams.get("error");

                if (error) {
                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end("<html><body><h2>Authorization denied.</h2><p>You can close this tab.</p></body></html>");
                    server.close();
                    reject(new Error(`Twitch auth denied: ${error}`));
                    return;
                }

                if (token) {
                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end("<html><body><h2>Connected to Twitch!</h2><p>You can close this tab and return to Sarxina Plugin Manager.</p></body></html>");
                    server.close();
                    resolve(token);
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
