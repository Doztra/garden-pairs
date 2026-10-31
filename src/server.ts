import { routePartykitRequest, Server } from "partyserver";
import type { Connection } from "partyserver";

const SIZE = 16; // 4x4 board, 8 pairs
const MISMATCH_MS = 1200; // how long a wrong pair stays face-up

type Status = "waiting" | "playing" | "finished" | "abandoned";

interface GameState {
  deck: number[]; // card face id at each index (each face appears twice)
  matched: boolean[];
  open: number[]; // currently face-up indices (max 2)
  status: Status;
  moves: number;
  players: [string | null, string | null];
  rematch: string[];
}

interface Env {
  Main: DurableObjectNamespace<MemoryMatch>;
}

// Calm nature-themed faces
const FACES = 8;

function shuffledDeck(): number[] {
  const deck = Array.from({ length: SIZE }, (_, i) => i % FACES);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export class MemoryMatch extends Server<Env> {
  game: GameState = {
    deck: shuffledDeck(),
    matched: Array(SIZE).fill(false),
    open: [],
    status: "waiting",
    moves: 0,
    players: [null, null],
    rematch: [],
  };

  flipBackTimer: ReturnType<typeof setTimeout> | null = null;

  roleOf(id: string): 0 | 1 | 2 {
    if (this.game.players[0] === id) return 1;
    if (this.game.players[1] === id) return 2;
    return 0;
  }

  onConnect(conn: Connection) {
    const g = this.game;
    let tookSeat = false;
    if (this.roleOf(conn.id) === 0) {
      if (!g.players[0]) {
        g.players[0] = conn.id;
        tookSeat = true;
      } else if (!g.players[1]) {
        g.players[1] = conn.id;
        tookSeat = true;
      }
    } else {
      tookSeat = true;
    }
    if (tookSeat) this.maybeStart();
    this.sync();
  }

  onClose(conn: Connection) {
    const g = this.game;
    for (const c of this.getConnections()) {
      if (c !== conn && c.id === conn.id) {
        this.sync();
        return;
      }
    }
    const role = this.roleOf(conn.id);
    g.rematch = g.rematch.filter((id) => id !== conn.id);
    if (role !== 0) {
      g.players[role - 1] = null;
      if (g.status === "playing") g.status = "abandoned";
      else if (!g.players[0] && !g.players[1]) g.status = "waiting";
    }
    this.sync();
  }

  onMessage(sender: Connection, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    let msg: { type?: string; idx?: number };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const g = this.game;
    const role = this.roleOf(sender.id);

    if (msg.type === "flip") {
      if (g.status !== "playing" || role === 0) return;
      const idx = msg.idx ?? -1;
      if (
        idx < 0 ||
        idx >= SIZE ||
        g.matched[idx] ||
        g.open.includes(idx) ||
        g.open.length >= 2
      )
        return;
      g.open.push(idx);
      if (g.open.length === 2) {
        g.moves++;
        const [a, b] = g.open;
        if (g.deck[a] === g.deck[b]) {
          g.matched[a] = g.matched[b] = true;
          g.open = [];
          if (g.matched.every(Boolean)) g.status = "finished";
        } else {
          // show the mismatch briefly, then flip both back
          this.flipBackTimer = setTimeout(() => {
            this.game.open = [];
            this.flipBackTimer = null;
            this.sync();
          }, MISMATCH_MS);
        }
      }
    } else if (
      msg.type === "rematch" &&
      role !== 0 &&
      g.status === "finished"
    ) {
      if (!g.rematch.includes(sender.id)) g.rematch.push(sender.id);
      if (g.rematch.length >= 2) this.newRound();
    }
    this.sync();
  }

  maybeStart() {
    const g = this.game;
    if (!g.players[0] || !g.players[1]) return;
    if (g.status === "waiting") this.newRound();
    else if (g.status === "abandoned") g.status = "playing";
    else if (g.status === "finished") this.newRound();
  }

  newRound() {
    if (this.flipBackTimer) {
      clearTimeout(this.flipBackTimer);
      this.flipBackTimer = null;
    }
    const g = this.game;
    g.deck = shuffledDeck();
    g.matched = Array(SIZE).fill(false);
    g.open = [];
    g.status = "playing";
    g.moves = 0;
    g.rematch = [];
  }

  sync() {
    const g = this.game;
    const stateMsg = JSON.stringify({
      type: "state",
      game: {
        matched: g.matched,
        open: g.open,
        status: g.status,
        moves: g.moves,
        pairs: g.matched.filter(Boolean).length / 2,
        faces: g.matched.map((m, i) =>
          m || g.open.includes(i) ? g.deck[i] : null
        ),
        seats: [!!g.players[0], !!g.players[1]],
        rematchCount: g.rematch.length,
      },
    });
    for (const conn of this.getConnections()) {
      conn.send(stateMsg);
      conn.send(
        JSON.stringify({
          type: "role",
          role: this.roleOf(conn.id),
          youVoted: g.rematch.includes(conn.id),
        })
      );
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
