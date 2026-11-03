# Ryuhai

Two-player secret-pick game. Both players lock in one piece per turn, then both are revealed.
Your opponent's hand and pick are both hidden. The game never shows what they hold or have lost, only what each round reveals.

## Play on the web (same Wi-Fi / LAN, or over the internet)

Requires Node 18+.

    npm install
    npm start

The terminal prints a `localhost` address and a LAN address (e.g. `http://192.168.1.20:3000`).
One player opens it and taps **Create a room**; the other opens the same address and taps **Join**
(open rooms are listed automatically, or type the 4-letter code). The server only relays picks
and never reveals a pick before both players have locked in. Dropped connections resume automatically.

To play over the internet, host the folder on any Node host (Render, Fly, a VPS) and share the URL.
`PORT` is read from the environment.

Each round ends on its result. Online, both players press **Next turn** on their own device before the next round starts. In Pass & play, either player presses Next turn, then Player 1 confirms "I am Player 1" before picking (and Player 2 does the same after Player 1 locks in).

**PvP points:** a separate score shown top-left on the home screen with a W/L/D record. Only online games against another person count (not the Bot, not Pass & play): win +10, draw +5, loss -10. A win where your Empress made the final capture (took the Monarch) is worth +20. Points and the record are saved on the device.

**Bananas:** every finished game pays out bananas, shown in the top-right corner: win +100, draw +50, loss -50. The balance is saved on the device (browser or Android app), starts at 0 and can go below zero. Games against the Bot and online games pay out; Pass & play does not.

Also on the menu: **Play vs Bot** and **Pass & play** (one device, works offline).

## Android app

The app is a WebView wrapper around the same web client (`android/`), with the game bundled so
Bot and Pass & play work offline. Room play connects to your server: tap **Server** on the menu
and enter the address the server printed (e.g. `192.168.1.20:3000`).

Build the APK one of three ways:

1. **Android Studio:** open the `android/` folder, then Build > Build APK(s).
2. **Command line** (JDK 17 + Android SDK installed): `./build-apk.sh`
   -> `android/app/build/outputs/apk/debug/app-debug.apk`
3. **GitHub Actions:** push this folder to a GitHub repo; the *Build Android APK* workflow
   produces the APK as a downloadable artifact (Actions tab > latest run).

Install the debug APK by sending it to the phone and allowing "install unknown apps".

## Rules summary

| Piece | Beats | Uses |
|---|---|---|
| Dragon | everything | spent after winning; 1 per game |
| Monarch | Knight, Wizard, Knave, Fool | reusable; losing your last Monarch loses the game |
| Knight | Wizard, Knave, Fool, Empress | reusable |
| Wizard | Knave, Fool, Empress | reusable; you hold two |
| Knave | Fool, Empress | reusable; you hold two |
| Fool | Empress only | reusable; you hold two |
| Empress | Monarch only | reusable |
| Joker | becomes the piece it meets; both return to hand | reusable, cannot be destroyed before transforming |

Equal pieces destroy each other (two Monarchs = both lose = draw). Joker vs Joker: both return to hand.
The game ends only when a Monarch is eliminated: capture the opponent's last Monarch and you win; if both players lose their last Monarch in the same round it is a draw. Having no piece that can beat the opponent's is not a loss, play just continues.

### Rulings I had to choose
- A winning piece returns to hand and can be used again; the loser is destroyed. Only the Dragon is spent after winning. Equal pieces destroy each other (except Jokers).
- A player loses only when their last true Monarch is captured. Losing one of multiple Monarchs does not end the game. If both players lose their last Monarch in the same round, the game is a draw.

## Layout
- `shared/engine.js` rules engine (used by server, browser and app), `shared/engine.test.js`
- `server/server.js` rooms + static hosting, `server/server.test.js`
- `web/` the client
- `android/` Gradle project

`npm test` runs the engine and server tests.

## Shop and skins
The **Shop** button on the home screen sells alternate artwork ("skins") for each piece, paid for with bananas. Skins are cosmetic only. Ownership and the equipped skin are saved on the device. In online games your opponent sees the skins you have equipped; Pass & play uses each device's equipped skins for both seats; the Bot always uses the classic art.

The shop ships **empty**. To add skins later:
1. Start the server (`npm start`). It prints an admin link like `http://localhost:3000/admin?key=...` (set `ADMIN_KEY=yourkey` to keep the key the same between runs).
2. Open the link, pick the piece, upload the image, type a name, set the price in bananas, click the face. Prices can be edited or skins deleted on the same page.
3. Players see new skins when they next open the Shop.

You can also edit `web/shop/catalog.json` by hand, see `web/shop/README.md`. For the Android app, rebuild the APK after adding skins so the images and `catalog.js` are bundled (or, if the app is pointed at your server, it loads the catalog and images from there).

## Online save (accounts)
Players can make a free account (**Sign in** button next to Shop) so bananas, PvP points, the W/L/D record, bought skins and equipped skins are saved on the server and can be loaded on any device. No outside service is needed, it uses the game server itself.

- **How it works:** the server keeps accounts in `data/accounts.json` (change the location with `ACCOUNTS_FILE`). Passwords are stored only as salted scrypt hashes, login tokens only as hashes. Back this file up, it is the players' saves.
- **Automatic:** once signed in, every change uploads in the background. Opening the app on another device pulls the latest. If two devices changed things while apart, they are merged (bananas and points add up, skins are combined).
- **First sign-in on a device that already has progress:** the player chooses to use the account's progress, keep the device's, or combine both.
- **Limits:** there is no password reset (a forgotten password means a new account), and a save is only as trustworthy as the device that sends it, so this is not anti-cheat. If the server is reachable over the internet, put it behind HTTPS so passwords are not sent in clear text.
- **Google sign-in / Google Play Games:** not included. Both need a Google Cloud / Play Console project and keys that only you can create. The account system above is built so a Google sign-in can be added later as another way to get the same account.
