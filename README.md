# Ryuhai

Two-player secret-pick game. Both players lock in one piece per turn, then both are revealed.
Your opponent's hand and pick are both hidden; only the piece count and the pieces that have fallen are public.

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
| Monarch | Knight, Wizard, Knave, Fool | reusable; losing it loses the game |
| Knight | Wizard, Knave, Fool, Empress | reusable |
| Wizard | Knave, Fool, Empress | reusable; you hold two |
| Knave | Fool, Empress | reusable; you hold two |
| Fool | Empress only | reusable; you hold two |
| Empress | Monarch only | reusable |
| Joker | becomes the piece it meets; both return to hand | reusable, cannot be destroyed before transforming |

Equal pieces destroy each other (two Monarchs = both lose = draw). Joker vs Joker: both return to hand.
Win by: opponent has no pieces, opponent has no piece that can beat any of yours, or opponent's Monarch is taken.

### Rulings I had to choose
- A winning piece returns to hand and can be used again; the loser is destroyed. Only the Dragon is spent after winning. Equal pieces destroy each other (except Jokers).
- If a Monarch is captured, that decides the game even if the capturer would also be out of power.
- If both sides meet a loss condition at once, it is a draw.

## Layout
- `shared/engine.js` rules engine (used by server, browser and app), `shared/engine.test.js`
- `server/server.js` rooms + static hosting, `server/server.test.js`
- `web/` the client
- `android/` Gradle project

`npm test` runs the engine and server tests.
