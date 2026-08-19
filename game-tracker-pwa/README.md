# Family Game Shelf

A installable phone app (PWA) for tracking your family's board games and keeping score on game night.

## What's in this version

- **Games tab** — add games with photo, difficulty, age rating, player count, play time,
  description, keywords, and expansions/extensions (with how many extra players each adds).
  Search by name/description/keywords, and filter by difficulty, player count, age, and max time. A "🎯 What should we play?" button picks a random game that fits your player count and time.
- **Scoreboard tab** — start a game night, add players, enter scores round by round (auto-tracked), see live standings, and browse past game nights with full round-by-round history.
- **Household tab** — set a household name, keep a member roster with roles (Owner/Editor/Viewer), generate an invite QR code or email, and export/import a full JSON backup of everything.
- Installable to your home screen, works offline, dark-themed for game-night lighting.

## Important: this version is single-device (by design, for now)

Everything is stored in the browser's local database **on that one phone** — it does **not**
sync between devices yet. The Household tab's roles and invite code are fully built out in the UI, but they're not wired to a real backend, so a second phone won't automatically see the same list yet.

**When you're ready for real multi-device sync** (everyone sees the same list, edits show up on each other's phones, invite QR/email actually adds someone), the recommended next step is wiring this up to **Firebase** (Google's free-tier app backend — Firestore for the shared data, Firebase Auth for login). The app was structured to make that swap easy: all storage calls go through `js/db.js`, so only that one file needs to be replaced with a Firestore version — the rest of the app (`js/app.js`) doesn't need to change. Just ask, and it can be built next.

Also note: **barcode scanning to add games** was intentionally left out of this version — there's no barcode database specific to board games, so it requires chaining a UPC lookup with a BoardGameGeek search and a manual fallback. It's a reasonable follow-up feature; ask if you'd like it added.

## How to install it on your phone

This is a set of static files (no server-side code), so it needs to be hosted somewhere with
HTTPS before "Add to Home Screen" will work like a real app. Two easy free options:

**Option A — Netlify Drop (fastest, no account needed for a quick test)**
1. Go to https://app.netlify.com/drop on a computer.
2. Drag the whole `game-tracker-pwa` folder onto the page.
3. You'll get a live `https://…netlify.app` URL — open it on your phone.

**Option B — GitHub Pages (best if you want a permanent link)**
1. Create a new GitHub repo and upload the contents of `game-tracker-pwa/`.
2. In the repo Settings → Pages, set the source to the `main` branch, root folder.
3. GitHub gives you a `https://<you>.github.io/<repo>/` URL.

Once it's hosted:
- **iPhone:** open the link in Safari → tap the Share icon → "Add to Home Screen."
- **Android:** open the link in Chrome → tap the ⋮ menu → "Add to Home screen" / "Install app."

It'll then launch full-screen like a normal app, and keeps working without signal since the
service worker caches the app shell.

## Suggestions for what to add next

A few ideas worth considering, roughly in order of impact:

1. **Real multi-device sync (Firebase)** — the big one; makes the Household tab's invites and
   roles actually functional, and lets everyone see the same shelf and scores live.
2. **Barcode scanning** — camera scan → UPC lookup → BoardGameGeek match → manual fallback, as    discussed above.
3. **Play stats** — most-played game, per-person win/loss record over time, "hasn't been played in X months" nudges to rediscover games in the closet.
4. **House rules notes per game** — a free-text field for the family's own variant rules, separate from the official description.
5. **Wishlist / lending tracker** — games you want to buy, or games currently lent to a friend.
6. **Push reminders** — e.g. a Friday evening nudge suggesting a quick game based on who's home.
7. **Per-player avatars/colors** in the scoreboard for faster reading at a glance during a game.
8. **CSV export of session history** for people who like to chart their family's game nights.

Happy to build any of these next — just say which one(s).