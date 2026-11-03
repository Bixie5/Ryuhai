# Shop skins

Each skin is alternate artwork for **one piece**. Players buy it with bananas and can equip it.

## Easiest: the admin page
Start the server (`npm start`). The terminal prints a link like
`http://localhost:3000/admin?key=...`. Open it to add a skin: pick the piece, upload the image,
type a name and a price. You can change prices or delete skins there too. The new skin shows up in
every player's Shop straight away (they just reopen the Shop).

## By hand (optional)
1. Put the image in `art/` (PNG, JPG or WEBP).
2. Add an entry to `catalog.json`:

       { "id": "frost-dragon", "name": "Frost Dragon", "piece": "dragon", "price": 500,
         "image": "art/frost-dragon.webp", "description": "Ice and fury", "faceCenter": [50, 22] }

   `piece` is one of: dragon, monarch, knight, wizard, knave, fool, empress, joker.
   `faceCenter` is where the face is, as [x%, y%] of the image. It is used to crop the small round
   face icons.
3. `catalog.js` is a generated copy of `catalog.json` (the Android app reads it). Easiest is to use
   the admin page, which keeps both in sync. If you edit by hand, update both.

## Image tips
- Portrait 3:4 (for example 540x720) looks best; other shapes are cropped to fit the card.
- Keep files under about 300 KB so the app stays small and loads fast.
