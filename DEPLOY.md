# Playing over the internet

Players on different networks just need to reach the **same game server**. The server is the website, the rooms and the accounts in one program, so you run it somewhere both players can reach, then everybody uses its address.

## Option 1: from your own computer (free, no account, good for friends)
1. Start the server: `npm start`.
2. Install Cloudflare's free tunnel tool (`cloudflared`) and run, in a second window:
   `cloudflared tunnel --url http://localhost:3000`
3. It prints an address like `https://something-random.trycloudflare.com`. Send it to your friend. Both of you open it in a browser (or type it into **Server** in the Android app), then create/join a room as usual.

Your computer must stay on and the tool running while you play. The address changes each time you start it. (`ngrok http 3000` works the same way.)

## Option 2: host it online (always on, a fixed address)
Any host that runs a Node app or a Dockerfile works. This project includes ready files:

- **Render**: push the project to GitHub, then New > Blueprint, pick the repo (uses `render.yaml`). You get `https://ryuhai.onrender.com` or similar. The free plan sleeps after a while with no visitors (the first visit then takes about 30 seconds) and its disk is wiped on every redeploy.
- **Fly.io**: follow the commands in `fly.toml`. Includes a small permanent disk and stays awake.
- **Any VPS**: `docker build -t ryuhai . && docker run -d -p 80:3000 -v ryuhai-data:/data ryuhai`, and put HTTPS in front (Caddy or Cloudflare).

### Saves on a host
Accounts (cloud save) and shop skins you add in the admin page are stored in the folder named by `DATA_DIR` (`/data` in the Docker image). Use a host plan with a **persistent disk/volume mounted at `/data`**, otherwise they vanish when the server restarts or redeploys. Back that folder up.

### Admin page
Open `https://your-address/admin?key=YOUR_ADMIN_KEY`. Set `ADMIN_KEY` in the host's settings (Render generates one for you).

## Android app
- Players can type the public address into **Server** the first time (a plain host name like `ryuhai.onrender.com` is automatically used over secure `https`/`wss`).
- Or bake it in so nobody types anything: put your address in `web/config.js` (`window.HC_CONFIG = { server: 'ryuhai.onrender.com' }`) and rebuild the APK.
- Skins added later in the admin page show up in the app without a rebuild, because it loads them from your server.

## Settings reference
| Variable | Meaning |
| --- | --- |
| `PORT` | port to listen on (hosts usually set it) |
| `DATA_DIR` | folder for accounts and shop skins (use a persistent disk) |
| `ADMIN_KEY` | key for the `/admin` page |
| `TRUST_PROXY` | set to `1` behind a host/proxy so login limits use each player's real address (the Docker image sets it) |
| `ACCOUNTS_FILE` | override the accounts file location |

## Always-on shop (skins visible even when your computer is off)
Skins you add in the admin page are saved on the computer running the server. To make them available to every player at all times, the admin page can also copy them to a **free public GitHub repository**. GitHub serves those files around the clock, and the game loads the shop from there every time it opens.

**One-time setup (about 5 minutes)**
1. On GitHub, create a new **public** repository for the skins, for example `ryuhai-skins`. Tick "Add a README" so it is not empty.
2. Create an access token: GitHub > Settings > Developer settings > Personal access tokens > **Fine-grained tokens** > Generate. Choose "Only select repositories" and pick the skins repo, then under Repository permissions set **Contents: Read and write**. Copy the token (it starts with `github_pat_`). Treat it like a password.
3. Start the server with these settings (Windows PowerShell shown; on Mac/Linux use `export NAME=value`):
   ```
   $env:REMOTE_GITHUB_REPO="YourName/ryuhai-skins"
   $env:REMOTE_GITHUB_TOKEN="github_pat_xxxxxxxx"
   npm start
   ```
   Optional: `REMOTE_GITHUB_BRANCH` (default `main`) and `REMOTE_GITHUB_DIR` (a folder inside the repo, default the top).
4. Open the admin page. The **Always-on copy** box should say "Up to date" and shows an address like
   `https://raw.githubusercontent.com/YourName/ryuhai-skins/main/`
5. Paste that address into `web/config.js` as `shopUrl`, then rebuild the Android app (and redeploy the website if you host it). You only do this once.

**After that**
- Add or edit a skin in the admin page: it is saved on your computer and uploaded to GitHub automatically. Players see it the next time they open the game (give it up to a minute). Your computer can then be off.
- The game remembers the last shop it loaded, so the shop also shows in a poor connection.
- If an upload fails (no internet, expired token) the skin is still saved on your computer and the admin page says what went wrong. **Sync now** retries.
- If you move to a new computer or wipe the shop folder, start the server with the same settings and it restores your skins from GitHub automatically. (If only some could be downloaded it stops and tells you, rather than overwrite the copy on GitHub.)
- The token only ever lives in the server's settings. It is never sent to players or written into any file.
- Skins are public: anyone with the repository address can view the images. Prices and ownership are still decided inside the game on each device.
