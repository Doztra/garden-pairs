// Two-player simulation for the cooperative memory game: join, flip, learn
// the deck, clear the board, rematch, disconnect/resume, spectate.
// Run: node test/simulate.mjs
const HOST = "localhost:1999";
const ROOM = "testroom-" + Math.random().toString(36).slice(2, 8);

function client(id) {
  const ws = new WebSocket(`ws://${HOST}/parties/main/${ROOM}?_pk=${id}`);
  const c = { ws, id, role: 0, state: null, ready: null, known: new Map() };
  c.ready = new Promise((res) => ws.addEventListener("open", res, { once: true }));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "state") {
      c.state = m.game;
      m.game.faces.forEach((f, i) => {
        if (f != null) c.known.set(i, f);
      });
    }
    if (m.type === "role") c.role = m.role;
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, timeout = 8000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > timeout) throw new Error("timeout waiting for: " + what);
    await sleep(40);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ok:", msg);
};

const A = client("player-a");
const B = client("player-b");
await Promise.all([A.ready, B.ready]);
await waitFor(() => A.state && B.state && A.role && B.role, "initial state");

assert(
  A.role !== B.role && A.role + B.role === 3,
  `two players seated (A=${A.role}, B=${B.role})`
);
assert(A.state.status === "playing", "game starts when both seats filled");
assert(A.state.matched.every((m) => !m), "fresh board");

// Basic flip flow: open one card
A.send({ type: "flip", idx: 0 });
await waitFor(() => A.state.open.length === 1, "first card opens");
assert(A.state.faces[0] != null, "open card's face is visible to players");

// Flipping the same card again is ignored
A.send({ type: "flip", idx: 0 });
await sleep(150);
assert(A.state.open.length === 1, "re-flip of open card ignored");

// Spectator can't flip
const S = client("spectator");
await S.ready;
await waitFor(() => S.state, "spectator state");
assert(S.role === 0, "third connection is a spectator");
S.send({ type: "flip", idx: 2 });
await sleep(150);
assert(!A.state.open.includes(2), "spectator flip ignored");

// Play the whole game cooperatively: remember every face we've seen
// (the server stops sending them once cards flip back down).
async function playToFinish(p1, p2) {
  const players = [p1, p2];
  const known = p1.known;
  let turn = 0;
  while (p1.state.status === "playing") {
    const st = p1.state;
    const unmatched = st.matched
      .map((m, i) => (m ? -1 : i))
      .filter((i) => i >= 0);
    if (unmatched.length === 0) break;
    // prefer a pair whose faces we already know match
    let pair = null;
    const byFace = new Map();
    for (const i of unmatched) {
      const f = known.get(i);
      if (f != null) {
        if (byFace.has(f)) {
          pair = [byFace.get(f), i];
          break;
        }
        byFace.set(f, i);
      }
    }
    if (!pair) {
      const unknown = unmatched.filter((i) => !known.has(i));
      pair = (unknown.length >= 2 ? unknown : unmatched).slice(0, 2);
    }
    const who = players[turn++ % 2];
    who.send({ type: "flip", idx: pair[0] });
    // a flip can resolve instantly (matched), in which case the "open"
    // state is never broadcast — accept either outcome
    await waitFor(
      () => p1.state.open.includes(pair[0]) || p1.state.matched[pair[0]],
      "card 1 opens or matches"
    );
    if (p1.state.matched[pair[0]]) continue; // resolved in one flip
    who.send({ type: "flip", idx: pair[1] });
    await waitFor(
      () => p1.state.open.length === 0,
      "pair resolves (match or flip-back)"
    );
  }
}

await playToFinish(A, B);
assert(A.state.status === "finished" && B.state.status === "finished", "board cleared together");
assert(A.state.pairs === 8, "all 8 pairs found");
assert(A.state.moves >= 8, "moves counted");

// Rematch: both players must agree
A.send({ type: "rematch" });
await sleep(120);
assert(A.state.status === "finished", "one rematch vote doesn't restart");
B.send({ type: "rematch" });
await waitFor(() => A.state.status === "playing", "rematch starts new round");
assert(A.state.matched.every((m) => !m), "board reshuffled");

// Disconnect -> abandoned; reconnect -> resumed
B.ws.close();
await waitFor(() => A.state.status === "abandoned", "abandoned on disconnect");
const B2 = client("player-b");
await B2.ready;
await waitFor(() => B2.role === B.role && A.state.status === "playing", "reconnect resumes");

console.log("\nAll checks passed.");
process.exit(0);
