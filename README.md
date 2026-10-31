# Garden Pairs

A calm, cooperative multiplayer memory game. Two players on different devices
flip cards together on a shared board to find all 8 matching pairs — no winner,
no loser, no timer.

**Play it live:** https://garden-pairs.shedrack.workers.dev

Open the link, copy the invite link, and send it to a friend. Whoever joins
second takes the other seat; anyone else spectates.

## How it works

- **Backend:** a Cloudflare Durable Object (`src/server.ts`) built on
  [partyserver](https://www.npmjs.com/package/partyserver). It holds the
  authoritative game state (shuffled deck, open cards, matches, seats) and
  broadcasts updates over WebSocket at `/parties/main/:room`.
- **Frontend:** static files in `public/` served by the same Worker's assets —
  plain HTML/CSS/JS with a vendored `partysocket` client (auto-reconnect).
- Each room is `?room=<id>` in the URL; your seat survives reconnects via a
  stable player id in `localStorage`.

## Commands

```bash
npm install
npm run dev      # local dev at http://localhost:1999
npm test         # simulated two-player game against the dev server
npm run deploy   # deploy to Cloudflare (wrangler login required once)
```
