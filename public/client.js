import PartySocket from "./vendor/index.js";

const SIZE = 16;
const FACE_EMOJI = ["🌸", "🌊", "🌙", "⭐", "🍀", "🌈", "🦋", "🌻"];

// Room comes from the URL (?room=abc123). Create one if missing so the
// invite link is always shareable.
const qs = new URLSearchParams(location.search);
let room = qs.get("room");
if (!room || !/^[a-z0-9-]{2,32}$/i.test(room)) {
  room = Math.random().toString(36).slice(2, 10);
  history.replaceState(null, "", `?room=${room}`);
}

// Stable connection id so a reconnect keeps your seat.
let pid = localStorage.getItem("gp-player-id");
if (!pid) {
  pid = crypto.randomUUID();
  localStorage.setItem("gp-player-id", pid);
}

const isLocal =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";
const socket = new PartySocket({
  host: isLocal ? "localhost:1999" : location.host,
  room,
  id: pid,
});

let game = null;
let role = 0; // 1 or 2 = player, 0 = spectator
let youVoted = false;
let connected = false;
const prevMatched = Array(SIZE).fill(false);

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const badgeEl = document.getElementById("badge");
const inviteBtn = document.getElementById("invite");
const rematchBtn = document.getElementById("rematch");
const connDot = document.getElementById("connDot");
const connText = document.getElementById("connText");

// Build the card grid once.
const cards = [];
for (let i = 0; i < SIZE; i++) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.idx = String(i);
  card.innerHTML = `
    <div class="card-inner">
      <div class="face back">✿</div>
      <div class="face front"></div>
    </div>`;
  boardEl.appendChild(card);
  cards.push({
    el: card,
    front: card.querySelector(".face.front"),
  });
}

socket.addEventListener("open", () => {
  connected = true;
  connDot.className = "dot online";
  connText.textContent = "online";
  render();
});

socket.addEventListener("close", () => {
  connected = false;
  connDot.className = "dot offline";
  connText.textContent = "reconnecting…";
  render();
});

socket.addEventListener("message", (evt) => {
  let msg;
  try {
    msg = JSON.parse(evt.data);
  } catch {
    return;
  }
  if (msg.type === "state") {
    game = msg.game;
    render();
  } else if (msg.type === "role") {
    role = msg.role;
    youVoted = msg.youVoted;
    render();
  }
});

boardEl.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  if (!game || game.status !== "playing" || role === 0) return;
  socket.send(JSON.stringify({ type: "flip", idx: Number(card.dataset.idx) }));
});

inviteBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    inviteBtn.textContent = "Link copied!";
  } catch {
    inviteBtn.textContent = location.href;
  }
  setTimeout(() => (inviteBtn.textContent = "Copy invite link"), 2000);
});

rematchBtn.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "rematch" }));
});

function render() {
  if (!game) return;
  const { matched, open, status, moves, pairs, faces, seats } = game;
  const openSet = new Set(open);

  for (let i = 0; i < SIZE; i++) {
    const { el, front } = cards[i];
    const faceUp = matched[i] || openSet.has(i);
    el.classList.toggle("up", faceUp);
    el.classList.toggle("matched", matched[i]);
    front.textContent = faces[i] != null ? FACE_EMOJI[faces[i]] : "";
    if (matched[i] && !prevMatched[i]) {
      // retrigger the settle animation on a fresh match
      el.classList.remove("matched");
      void el.offsetWidth;
      el.classList.add("matched");
    }
    prevMatched[i] = matched[i];
  }

  // input locked while a mismatch is on display (open.length 2 = brief pause
  // before the server flips both back), or you're spectating
  boardEl.classList.toggle("locked", open.length >= 2);
  boardEl.classList.toggle(
    "inactive",
    status !== "playing" || role === 0 || !connected
  );

  // Status line — gentle, cooperative wording
  let text;
  if (!connected) text = "Reconnecting…";
  else if (status === "waiting")
    text = "This is a game for two — copy the invite link and send it to a friend.";
  else if (status === "abandoned")
    text = "Your partner stepped away — send them the invite link to keep playing.";
  else if (status === "playing")
    text =
      role === 0
        ? `Watching along — ${pairs} of 8 pairs found`
        : pairs === 0
          ? "Flip any two cards to start finding pairs together."
          : `${pairs} of 8 pairs found · ${moves} moves together`;
  else if (status === "finished")
    text = `All 8 pairs found in ${moves} moves — nicely done, together. 🌷`;
  statusEl.textContent = text || "";

  // Badge
  if (role === 0) {
    badgeEl.textContent = "Spectating";
  } else {
    const otherHere = seats[role === 1 ? 1 : 0];
    badgeEl.textContent =
      `You're player ${role} · partner ${otherHere ? "here" : "open seat"}`;
  }

  // Play-again button
  const canRematch = status === "finished" && role !== 0 && connected;
  rematchBtn.classList.toggle("hidden", !canRematch);
  rematchBtn.disabled = youVoted;
  rematchBtn.textContent = youVoted ? "Waiting for partner…" : "Play again";
}
