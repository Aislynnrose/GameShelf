/* app.js — UI + routing for Family Game Shelf. Talks to storage only via DB.* (js/db.js). */

// ---------------------------------------------------------------- helpers --

const $app = document.getElementById("app");
const $view = document.getElementById("view");
const $tabbar = document.getElementById("tabbar");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function toast(msg, ms = 2200) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function openModal(innerHtml, { onMount } = {}) {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal-sheet">${innerHtml}</div>`;
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.body.appendChild(backdrop);
  if (onMount) onMount(backdrop);
}

function closeModal() {
  const el = document.getElementById("modal-backdrop");
  if (el) el.remove();
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function playersLabel(g) {
  if (g.minPlayers && g.maxPlayers) {
    return g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`;
  }
  if (g.maxPlayers) return `up to ${g.maxPlayers} players`;
  if (g.minPlayers) return `${g.minPlayers}+ players`;
  return "";
}

function maxPlayersWithExt(g) {
  const ext = (g.extensions || []).reduce((sum, e) => sum + (Number(e.addsPlayers) || 0), 0);
  return (g.maxPlayers || 0) + ext;
}

function timeLabel(g) {
  if (g.playTimeMin && g.playTimeMax && g.playTimeMin !== g.playTimeMax) return `${g.playTimeMin}–${g.playTimeMax} min`;
  if (g.playTimeMax) return `${g.playTimeMax} min`;
  if (g.playTimeMin) return `${g.playTimeMin} min`;
  return "";
}

const DIFF_LABELS = { 1: "Light", 2: "Easy", 3: "Medium", 4: "Challenging", 5: "Heavy" };

function diffDots(level) {
  let out = '<span class="diff-dots">';
  for (let i = 1; i <= 5; i++) out += `<span class="${i <= level ? "on" : ""}">&#9679;</span>`;
  out += "</span>";
  return out;
}

function resizeImageFile(file, maxDim = 640, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function emojiForGame(g) {
  return "🎲";
}

// ------------------------------------------------------------- household --

async function ensureHousehold() {
  let household = await DB.getMeta("household");
  if (!household) {
    household = {
      id: DB.uid(),
      name: "Our Household",
      createdAt: Date.now(),
    };
    await DB.setMeta("household", household);
  }
  let members = await DB.getMembers();
  if (!members.length) {
    await DB.saveMember({ name: "You", role: "owner", isSelf: true, addedAt: Date.now() });
  }
  return household;
}

// --------------------------------------------------------------- routing --

const TABS = [
  { key: "games", label: "Games", icon: "🎲", render: renderGamesRoute },
  { key: "tracker", label: "Scoreboard", icon: "🏆", render: renderTrackerRoute },
  { key: "household", label: "Household", icon: "👪", render: renderHouseholdRoute },
];

function parseHash() {
  const raw = (location.hash || "#games").slice(1);
  const parts = raw.split("/").filter(Boolean);
  return { tab: parts[0] || "games", parts };
}

function renderTabbar() {
  const { tab } = parseHash();
  $tabbar.innerHTML = TABS.map(
    (t) => `<button data-tab="${t.key}" class="${t.key === tab ? "active" : ""}">
      <span class="ic">${t.icon}</span><span>${t.label}</span>
    </button>`
  ).join("");
  $tabbar.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = "#" + btn.dataset.tab; });
  });
}

async function route() {
  await ensureHousehold();
  renderTabbar();
  const { tab, parts } = parseHash();
  $view.scrollTop = 0;
  const found = TABS.find((t) => t.key === tab);
  if (found) await found.render(parts);
  else await renderGamesRoute([]);
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);

// ================================================================= BGG ===
// Client for the small lookup proxy in bgg-proxy/ — see that folder's
// README for why a proxy is needed (BoardGameGeek's API has no CORS
// support) and how to deploy one for free. The app just needs its URL,
// set once in Household → Settings.

let bggEndpointCache = undefined;

async function getBggEndpoint() {
  if (bggEndpointCache === undefined) {
    bggEndpointCache = await DB.getMeta("bggEndpoint", "");
  }
  return bggEndpointCache;
}

async function setBggEndpoint(url) {
  bggEndpointCache = url;
  await DB.setMeta("bggEndpoint", url);
}

async function bggApiCall(path) {
  const endpoint = await getBggEndpoint();
  if (!endpoint) throw new Error("NO_ENDPOINT");
  const base = endpoint.replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`);
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) throw new Error((body && body.error) || `Lookup failed (${res.status})`);
  return body;
}

async function bggSearch(query) {
  const body = await bggApiCall(`/search?q=${encodeURIComponent(query)}`);
  return body.results || [];
}

async function bggGameDetail(id) {
  return bggApiCall(`/game?id=${encodeURIComponent(id)}`); // { game, expansions }
}

async function testBggEndpoint(url) {
  const base = url.replace(/\/+$/, "");
  const res = await fetch(`${base}/search?q=catan`);
  if (!res.ok) throw new Error(`Service responded ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body.results)) throw new Error("Unexpected response shape");
  return body.results.length;
}

// =============================================================== GAMES ===

let gamesFilterState = { q: "", diffs: [], players: "", age: "", maxTime: "", panelOpen: false };

async function renderGamesRoute(parts) {
  if (parts[1] === "add") return renderAddGameChooser();
  if (parts[1] === "add-manual") return renderGameForm(null);
  if (parts[1] === "edit" && parts[2]) return renderGameForm(parts[2]);
  if (parts[1] === "view" && parts[2]) return renderGameDetail(parts[2]);
  return renderGamesList();
}

// ------------------------------------------------------- add-game chooser --

async function renderAddGameChooser() {
  removeFab();
  const endpoint = await getBggEndpoint();

  if (!endpoint) {
    $view.innerHTML = `
      <h2 style="margin-top:0;">Add a Game</h2>
      <div class="note-banner">
        Auto-fill from BoardGameGeek isn't set up yet. Add a free lookup service once in
        <strong>Household → BoardGameGeek Lookup Service</strong>, or add this game by hand for now.
      </div>
      <div class="btn-row">
        <button class="btn secondary" id="go-settings">Set Up Lookup</button>
        <button class="btn" id="go-manual">Enter Manually</button>
      </div>
    `;
    document.getElementById("go-settings").addEventListener("click", () => { location.hash = "#household"; });
    document.getElementById("go-manual").addEventListener("click", () => { location.hash = "#games/add-manual"; });
    return;
  }

  $view.innerHTML = `
    <h2 style="margin-top:0;">Add a Game</h2>
    <label>Search BoardGameGeek</label>
    <div style="display:flex;gap:8px;">
      <input type="text" id="bgg-q" placeholder="Game name…" style="flex:1;" />
      <button class="btn small" id="bgg-search-btn" style="width:auto;">Search</button>
    </div>
    <div id="bgg-results" style="margin-top:14px;"></div>
    <button class="link-btn" id="go-manual" style="margin-top:10px;">Or enter a game manually →</button>
  `;

  const $q = document.getElementById("bgg-q");
  const $results = document.getElementById("bgg-results");
  $q.focus();

  async function doSearch() {
    const query = $q.value.trim();
    if (!query) return;
    $results.innerHTML = `<p style="color:var(--text-dim);">Searching BoardGameGeek…</p>`;
    try {
      const results = await bggSearch(query);
      if (!results.length) {
        $results.innerHTML = `<div class="empty-state"><div class="big">🔍</div><div>No matches on BoardGameGeek.<br/>Try a different spelling, or add it manually.</div></div>`;
        return;
      }
      $results.innerHTML = `<div class="card">` + results.slice(0, 25).map((r) => `
        <div class="session-item" data-id="${escapeHtml(r.id)}" style="cursor:pointer;">
          <div><strong>${escapeHtml(r.name)}</strong></div>
          <span class="pill">${escapeHtml(r.yearPublished || "")}</span>
        </div>
      `).join("") + `</div>`;
      $results.querySelectorAll("[data-id]").forEach((row) => {
        row.addEventListener("click", () => selectBggResult(row.dataset.id, row.querySelector("strong").textContent));
      });
    } catch (err) {
      $results.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><div>Couldn't reach the lookup service.<br/><span style="font-size:12px;">${escapeHtml(err.message)}</span></div></div>`;
    }
  }

  async function selectBggResult(id, name) {
    $results.innerHTML = `<p style="color:var(--text-dim);">Loading "${escapeHtml(name)}"…</p>`;
    try {
      const { game, expansions } = await bggGameDetail(id);
      // Update the URL bar without re-triggering the router (so Back still makes sense).
      history.replaceState(null, "", "#games/add-manual");
      renderGameForm(null, { ...game, bggExpansions: expansions || [] });
    } catch (err) {
      $results.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><div>Couldn't load that game's details.<br/><span style="font-size:12px;">${escapeHtml(err.message)}</span></div><button class="btn secondary small" id="retry-select" style="margin-top:10px;">Try Again</button></div>`;
      document.getElementById("retry-select").addEventListener("click", () => selectBggResult(id, name));
    }
  }

  document.getElementById("bgg-search-btn").addEventListener("click", doSearch);
  $q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });
  document.getElementById("go-manual").addEventListener("click", () => { location.hash = "#games/add-manual"; });
}

async function renderGamesList() {
  const games = await DB.getGames();
  const f = gamesFilterState;

  function matches(g) {
    if (f.q) {
      const hay = [g.name, g.description, ...(g.keywords || [])].join(" ").toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    if (f.diffs.length && !f.diffs.includes(g.difficulty)) return false;
    if (f.players) {
      const n = Number(f.players);
      const max = maxPlayersWithExt(g);
      if (!(n >= (g.minPlayers || 1) && n <= (max || 999))) return false;
    }
    if (f.age) {
      const n = Number(f.age);
      if (g.ageRating && n < g.ageRating) return false;
    }
    if (f.maxTime) {
      const n = Number(f.maxTime);
      const needed = g.playTimeMin || g.playTimeMax || 0;
      if (needed && needed > n) return false;
    }
    return true;
  }

  const filtered = games
    .filter(matches)
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || a.name.localeCompare(b.name));

  const activeFilterCount =
    f.diffs.length + (f.players ? 1 : 0) + (f.age ? 1 : 0) + (f.maxTime ? 1 : 0);

  $view.innerHTML = `
    <div class="searchbar">
      <input type="search" id="search-input" placeholder="Search name, description, keywords…" value="${escapeHtml(f.q)}" />
      <button class="icon-btn" id="filter-toggle">⚙️${activeFilterCount ? `<span style="color:var(--accent);font-size:10px;margin-left:2px;">${activeFilterCount}</span>` : ""}</button>
      <button class="icon-btn" id="quickpick-btn" title="What should we play?">🎯</button>
    </div>
    <div id="filter-panel" class="card ${f.panelOpen ? "" : "hidden"}">
      <label>Difficulty</label>
      <div class="chip-group" id="diff-chips">
        ${[1, 2, 3, 4, 5].map((d) => `<span class="chip ${f.diffs.includes(d) ? "active" : ""}" data-d="${d}">${DIFF_LABELS[d]}</span>`).join("")}
      </div>
      <div class="row-2">
        <div><label>Playing with (# people)</label><input type="number" min="1" id="f-players" value="${f.players}" placeholder="e.g. 4" /></div>
        <div><label>Youngest player's age</label><input type="number" min="0" id="f-age" value="${f.age}" placeholder="e.g. 8" /></div>
      </div>
      <label>Time available (max minutes)</label>
      <input type="number" min="1" id="f-maxtime" value="${f.maxTime}" placeholder="e.g. 45" />
      <div class="btn-row" style="margin-top:14px;">
        <button class="btn secondary small" id="clear-filters">Clear filters</button>
      </div>
    </div>
    <div id="games-list"></div>
  `;

  const $list = document.getElementById("games-list");
  if (!games.length) {
    $list.innerHTML = `<div class="empty-state"><div class="big">🗄️</div><div>Your shelf is empty.<br/>Tap + to add your first game.</div></div>`;
  } else if (!filtered.length) {
    $list.innerHTML = `<div class="empty-state"><div class="big">🔍</div><div>No games match your search/filters.</div></div>`;
  } else {
    $list.innerHTML = filtered.map(gameCardHtml).join("");
    $list.querySelectorAll(".game-card").forEach((card) => {
      card.addEventListener("click", () => { location.hash = `#games/view/${card.dataset.id}`; });
    });
  }

  document.getElementById("search-input").addEventListener("input", (e) => {
    f.q = e.target.value; renderGamesList();
  });
  document.getElementById("filter-toggle").addEventListener("click", () => {
    f.panelOpen = !f.panelOpen; renderGamesList();
  });
  document.getElementById("quickpick-btn").addEventListener("click", () => openQuickPick(games));
  document.querySelectorAll("#diff-chips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const d = Number(chip.dataset.d);
      f.diffs = f.diffs.includes(d) ? f.diffs.filter((x) => x !== d) : [...f.diffs, d];
      renderGamesList();
    });
  });
  document.getElementById("f-players").addEventListener("input", (e) => { f.players = e.target.value; renderGamesList(); });
  document.getElementById("f-age").addEventListener("input", (e) => { f.age = e.target.value; renderGamesList(); });
  document.getElementById("f-maxtime").addEventListener("input", (e) => { f.maxTime = e.target.value; renderGamesList(); });
  document.getElementById("clear-filters").addEventListener("click", () => {
    gamesFilterState = { q: f.q, diffs: [], players: "", age: "", maxTime: "", panelOpen: true };
    renderGamesList();
  });

  addFab("+", () => { location.hash = "#games/add"; });
}

function gameCardHtml(g) {
  const meta = [playersLabel(g), timeLabel(g), g.ageRating ? `${g.ageRating}+` : "", g.difficulty ? DIFF_LABELS[g.difficulty] : ""]
    .filter(Boolean)
    .map((m) => `<span class="pill">${escapeHtml(m)}</span>`)
    .join("");
  return `<div class="card game-card" data-id="${g.id}">
    <div class="thumb">${g.image ? `<img src="${g.image}" alt="">` : emojiForGame(g)}</div>
    <div class="info">
      <h3>${escapeHtml(g.name)} ${g.favorite ? '<span class="fav">★</span>' : ""}</h3>
      <div class="meta">${meta}</div>
    </div>
  </div>`;
}

function addFab(label, onClick) {
  removeFab();
  const btn = document.createElement("button");
  btn.className = "fab";
  btn.id = "fab-btn";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  document.body.appendChild(btn);
}
function removeFab() {
  const b = document.getElementById("fab-btn");
  if (b) b.remove();
}

function openQuickPick(allGames) {
  let players = "";
  let time = "";
  function pickHtml(pool) {
    if (!pool.length) return `<div class="empty-state"><div class="big">🤷</div><div>No games fit those filters. Try loosening them.</div></div>`;
    const g = pool[Math.floor(Math.random() * pool.length)];
    return gameCardHtml(g) + `<p style="text-align:center;color:var(--text-dim);font-size:13px;">${pool.length} game${pool.length === 1 ? "" : "s"} matched</p>`;
  }
  function filterPool() {
    return allGames.filter((g) => {
      if (players && !(Number(players) >= (g.minPlayers || 1) && Number(players) <= (maxPlayersWithExt(g) || 999))) return false;
      if (time) { const needed = g.playTimeMin || g.playTimeMax || 0; if (needed && needed > Number(time)) return false; }
      return true;
    });
  }
  function render(container) {
    const pool = filterPool();
    container.querySelector("#qp-result").innerHTML = pickHtml(pool);
    container.querySelectorAll("#qp-result .game-card").forEach((c) => c.addEventListener("click", () => { closeModal(); location.hash = `#games/view/${c.dataset.id}`; }));
  }
  openModal(`
    <h3>🎯 What should we play?</h3>
    <div class="row-2">
      <div><label>How many players?</label><input type="number" min="1" id="qp-players" placeholder="optional" /></div>
      <div><label>Minutes available?</label><input type="number" min="1" id="qp-time" placeholder="optional" /></div>
    </div>
    <div id="qp-result" style="margin-top:14px;"></div>
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn secondary" id="qp-reroll">🎲 Pick again</button>
      <button class="btn" id="qp-close">Done</button>
    </div>
  `, {
    onMount: (container) => {
      render(container);
      container.querySelector("#qp-players").addEventListener("input", (e) => { players = e.target.value; render(container); });
      container.querySelector("#qp-time").addEventListener("input", (e) => { time = e.target.value; render(container); });
      container.querySelector("#qp-reroll").addEventListener("click", () => render(container));
      container.querySelector("#qp-close").addEventListener("click", closeModal);
    },
  });
}

// ------------------------------------------------------------ game form --

function weightToDifficulty(weight) {
  if (!weight) return 3;
  // BGG's "weight" is a 1.0–5.0 float; map onto our 1–5 integer scale.
  return Math.min(5, Math.max(1, Math.round(weight)));
}

async function renderGameForm(id, prefill) {
  removeFab();
  const editing = Boolean(id);
  const blank = {
    name: "", image: null, difficulty: 3, ageRating: "", minPlayers: "", maxPlayers: "",
    playTimeMin: "", playTimeMax: "", description: "", keywords: [], extensions: [], favorite: false, location: "",
  };
  let game;
  if (editing) {
    game = await DB.getGame(id);
  } else if (prefill) {
    game = {
      ...blank,
      name: prefill.name || "",
      image: prefill.image || null,
      difficulty: weightToDifficulty(prefill.weight),
      ageRating: prefill.minAge || "",
      minPlayers: prefill.minPlayers || "",
      maxPlayers: prefill.maxPlayers || "",
      playTimeMin: prefill.minPlayTime || "",
      playTimeMax: prefill.maxPlayTime || "",
      description: prefill.description || "",
      bggWeight: prefill.weight || null,
      bggWeightVotes: prefill.weightVotes || 0,
      bggId: prefill.id || null,
    };
  } else {
    game = blank;
  }

  let pendingImage = game.image || null;
  let extensions = (game.extensions || []).map((e) => ({ ...e }));
  // Candidate expansions pulled from BGG for a freshly-searched game — the user
  // checks off which ones their household actually owns before they're added.
  let bggCandidates = (prefill?.bggExpansions || []).map((e) => ({
    id: e.id,
    name: e.name,
    minPlayers: e.minPlayers,
    maxPlayers: e.maxPlayers,
    owned: false,
  }));

  $view.innerHTML = `
    <h2 style="margin-top:0;">${editing ? "Edit Game" : "Add a Game"}</h2>
    ${prefill ? `<div class="note-banner">Pre-filled from BoardGameGeek${game.bggWeight ? ` — difficulty estimated from a community weight of ${game.bggWeight.toFixed(1)}/5 (${game.bggWeightVotes} ratings)` : ""}. Review and adjust anything before saving.</div>` : ""}

    <label>Photo</label>
    <div style="display:flex;gap:12px;align-items:center;">
      <div class="thumb" id="photo-preview" style="width:72px;height:72px;border-radius:12px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;overflow:hidden;">
        ${pendingImage ? `<img src="${pendingImage}" style="width:100%;height:100%;object-fit:cover;">` : "🎲"}
      </div>
      <input type="file" accept="image/*" capture="environment" id="photo-input" style="flex:1;" />
    </div>

    <label>Game name *</label>
    <input type="text" id="f-name" value="${escapeHtml(game.name)}" placeholder="Catan" />

    <label>Difficulty</label>
    <div class="chip-group" id="f-diff-chips">
      ${[1, 2, 3, 4, 5].map((d) => `<span class="chip ${game.difficulty === d ? "active" : ""}" data-d="${d}">${DIFF_LABELS[d]}</span>`).join("")}
    </div>

    <div class="row-2">
      <div><label>Min players</label><input type="number" min="1" id="f-minp" value="${game.minPlayers ?? ""}" /></div>
      <div><label>Max players</label><input type="number" min="1" id="f-maxp" value="${game.maxPlayers ?? ""}" /></div>
    </div>
    <div class="row-2">
      <div><label>Age rating</label><input type="number" min="0" id="f-age" value="${game.ageRating ?? ""}" placeholder="8" /></div>
      <div><label>Location (optional)</label><input type="text" id="f-loc" value="${escapeHtml(game.location || "")}" placeholder="Hall closet" /></div>
    </div>
    <div class="row-2">
      <div><label>Play time min (mins)</label><input type="number" min="1" id="f-tmin" value="${game.playTimeMin ?? ""}" /></div>
      <div><label>Play time max (mins)</label><input type="number" min="1" id="f-tmax" value="${game.playTimeMax ?? ""}" /></div>
    </div>

    <label>Description</label>
    <textarea id="f-desc" placeholder="What's it about, how it's played…">${escapeHtml(game.description || "")}</textarea>

    <label>Keywords / tags <span style="color:var(--text-dim);font-weight:400;">(comma separated — helps search)</span></label>
    <input type="text" id="f-keywords" value="${escapeHtml((game.keywords || []).join(", "))}" placeholder="strategy, trading, dice" />

    <label style="display:flex;align-items:center;justify-content:space-between;">
      <span>Mark as favorite</span>
      <input type="checkbox" id="f-fav" ${game.favorite ? "checked" : ""} style="width:20px;height:20px;" />
    </label>

    ${bggCandidates.length ? `
      <div class="section-title">Expansions Found on BoardGameGeek</div>
      <div class="card" id="bgg-ext-list"></div>
    ` : ""}

    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>Expansions / Extensions</span>
      <button class="link-btn" id="add-ext">+ Add</button>
    </div>
    <div class="card" id="ext-list"></div>

    <div class="btn-row" style="margin-top:22px;">
      <button class="btn secondary" id="cancel-btn">Cancel</button>
      <button class="btn" id="save-btn">${editing ? "Save Changes" : "Add Game"}</button>
    </div>
    ${editing ? `<button class="btn danger" id="delete-btn" style="margin-top:12px;">Delete Game</button>` : ""}
  `;

  let selectedDiff = game.difficulty || 3;
  document.querySelectorAll("#f-diff-chips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      selectedDiff = Number(chip.dataset.d);
      document.querySelectorAll("#f-diff-chips .chip").forEach((c) => c.classList.toggle("active", Number(c.dataset.d) === selectedDiff));
    });
  });

  document.getElementById("photo-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImage = await resizeImageFile(file);
    document.getElementById("photo-preview").innerHTML = `<img src="${pendingImage}" style="width:100%;height:100%;object-fit:cover;">`;
  });

  function renderExtList() {
    const list = document.getElementById("ext-list");
    if (!extensions.length) {
      list.innerHTML = `<p style="color:var(--text-dim);font-size:13.5px;margin:0;">No expansions added yet.</p>`;
      return;
    }
    list.innerHTML = extensions.map((e, i) => `
      <div class="ext-item">
        <div style="flex:1;">
          <input type="text" data-i="${i}" data-f="name" value="${escapeHtml(e.name)}" placeholder="Expansion name" style="margin-bottom:6px;" />
          <input type="number" min="0" data-i="${i}" data-f="addsPlayers" value="${e.addsPlayers ?? ""}" placeholder="+ players it adds" />
        </div>
        <button class="icon-btn" data-remove="${i}">✕</button>
      </div>
    `).join("");
    list.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = Number(inp.dataset.i), f = inp.dataset.f;
        extensions[i][f] = f === "addsPlayers" ? Number(inp.value) : inp.value;
      });
    });
    list.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => { extensions.splice(Number(btn.dataset.remove), 1); renderExtList(); });
    });
  }
  renderExtList();
  document.getElementById("add-ext").addEventListener("click", () => {
    extensions.push({ name: "", addsPlayers: 0 });
    renderExtList();
  });

  function renderBggExtList() {
    const list = document.getElementById("bgg-ext-list");
    if (!list) return;
    list.innerHTML = bggCandidates.map((c, i) => `
      <div class="ext-item">
        <label style="display:flex;align-items:center;gap:10px;flex:1;margin:0;font-weight:400;color:var(--text);">
          <input type="checkbox" data-i="${i}" class="bgg-ext-check" style="width:20px;height:20px;flex-shrink:0;" ${c.owned ? "checked" : ""} />
          <span>${escapeHtml(c.name)}${c.maxPlayers ? ` <span class="pill">up to ${c.maxPlayers}p</span>` : ""}</span>
        </label>
      </div>
    `).join("");
    list.querySelectorAll(".bgg-ext-check").forEach((cb) => {
      cb.addEventListener("change", () => { bggCandidates[Number(cb.dataset.i)].owned = cb.checked; });
    });
  }
  renderBggExtList();

  document.getElementById("cancel-btn").addEventListener("click", () => history.back());
  if (editing) {
    document.getElementById("delete-btn").addEventListener("click", async () => {
      if (confirm(`Delete "${game.name}"? This can't be undone.`)) {
        await DB.deleteGame(game.id);
        toast("Game deleted");
        location.hash = "#games";
      }
    });
  }

  document.getElementById("save-btn").addEventListener("click", async () => {
    const name = document.getElementById("f-name").value.trim();
    if (!name) { toast("Please enter a game name"); return; }
    const finalMaxPlayers = Number(document.getElementById("f-maxp").value) || null;

    const ownedBggExtensions = bggCandidates
      .filter((c) => c.owned)
      .map((c) => ({
        name: c.name,
        addsPlayers: c.maxPlayers && finalMaxPlayers && c.maxPlayers > finalMaxPlayers ? c.maxPlayers - finalMaxPlayers : 0,
      }));

    const updated = {
      ...game,
      name,
      image: pendingImage,
      difficulty: selectedDiff,
      minPlayers: Number(document.getElementById("f-minp").value) || null,
      maxPlayers: finalMaxPlayers,
      ageRating: Number(document.getElementById("f-age").value) || null,
      location: document.getElementById("f-loc").value.trim(),
      playTimeMin: Number(document.getElementById("f-tmin").value) || null,
      playTimeMax: Number(document.getElementById("f-tmax").value) || null,
      description: document.getElementById("f-desc").value.trim(),
      keywords: document.getElementById("f-keywords").value.split(",").map((s) => s.trim()).filter(Boolean),
      favorite: document.getElementById("f-fav").checked,
      extensions: [...extensions.filter((e) => e.name.trim()), ...ownedBggExtensions],
    };
    const saved = await DB.saveGame(updated);
    toast(editing ? "Game updated" : "Game added");
    location.hash = `#games/view/${saved.id}`;
  });
}

// ---------------------------------------------------------- game detail --

async function renderGameDetail(id) {
  removeFab();
  const g = await DB.getGame(id);
  if (!g) { location.hash = "#games"; return; }
  const extRows = (g.extensions || []).map((e) => `
    <div class="ext-item"><span>${escapeHtml(e.name)}</span><span class="pill">+${e.addsPlayers || 0} players</span></div>
  `).join("") || `<p style="color:var(--text-dim);font-size:13.5px;margin:0;">None on file.</p>`;

  $view.innerHTML = `
    <div class="detail-header">
      <div class="thumb">${g.image ? `<img src="${g.image}">` : emojiForGame(g)}</div>
      <div>
        <h2>${escapeHtml(g.name)} ${g.favorite ? '<span class="fav">★</span>' : ""}</h2>
        <div>${diffDots(g.difficulty || 0)} <span style="color:var(--text-dim);font-size:13px;">${DIFF_LABELS[g.difficulty] || "—"}</span></div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-box"><div class="label">Players</div><div class="value">${playersLabel(g) || "—"}${g.extensions?.length ? ` <span style="color:var(--text-dim);font-weight:400;">(up to ${maxPlayersWithExt(g)} w/ exp.)</span>` : ""}</div></div>
      <div class="stat-box"><div class="label">Play time</div><div class="value">${timeLabel(g) || "—"}</div></div>
      <div class="stat-box"><div class="label">Age rating</div><div class="value">${g.ageRating ? g.ageRating + "+" : "—"}</div></div>
      <div class="stat-box"><div class="label">Location</div><div class="value">${escapeHtml(g.location) || "—"}</div></div>
    </div>

    ${g.description ? `<div class="section-title">Description</div><p style="line-height:1.5;">${escapeHtml(g.description)}</p>` : ""}

    ${g.keywords?.length ? `<div class="section-title">Keywords</div><div class="chip-group">${g.keywords.map((k) => `<span class="pill">${escapeHtml(k)}</span>`).join("")}</div>` : ""}

    <div class="section-title">Expansions / Extensions</div>
    <div class="card">${extRows}</div>

    <div class="btn-row" style="margin-top:18px;">
      <button class="btn secondary" id="edit-btn">Edit</button>
      <button class="btn" id="play-btn">🏆 Track a Game Night</button>
    </div>
  `;
  document.getElementById("edit-btn").addEventListener("click", () => { location.hash = `#games/edit/${g.id}`; });
  document.getElementById("play-btn").addEventListener("click", () => { location.hash = `#tracker/new/${g.id}`; });
}

// ============================================================ TRACKER ===

async function renderTrackerRoute(parts) {
  if (parts[1] === "new") return renderNewSession(parts[2] || null);
  if (parts[1] === "session" && parts[2]) return renderSessionDetail(parts[2]);
  return renderTrackerHome();
}

async function renderTrackerHome() {
  removeFab();
  const sessions = await DB.getSessions();
  const active = sessions.find((s) => !s.endedAt);
  const past = sessions.filter((s) => s.endedAt);

  $view.innerHTML = `
    ${active ? `
      <div class="card" style="border-color:var(--accent);">
        <div class="section-title" style="margin-top:0;">In Progress</div>
        <div class="session-item" style="cursor:pointer;" id="resume-active">
          <div><strong>${escapeHtml(active.gameName)}</strong><br/><span style="color:var(--text-dim);font-size:13px;">${active.players.length} players · round ${active.rounds.length}</span></div>
          <span class="pill">Resume →</span>
        </div>
      </div>
    ` : ""}
    <button class="btn" id="new-session-btn">＋ Start Game Night</button>

    <div class="section-title">History</div>
    <div id="history-list"></div>
  `;
  if (active) document.getElementById("resume-active").addEventListener("click", () => { location.hash = `#tracker/session/${active.id}`; });
  document.getElementById("new-session-btn").addEventListener("click", () => { location.hash = "#tracker/new"; });

  const $hist = document.getElementById("history-list");
  if (!past.length) {
    $hist.innerHTML = `<div class="empty-state"><div class="big">📋</div><div>No finished game nights yet.</div></div>`;
  } else {
    $hist.innerHTML = `<div class="card">` + past.map((s) => {
      const winner = s.players.find((p) => p.name === s.winner);
      return `<div class="session-item" data-id="${s.id}" style="cursor:pointer;">
        <div><strong>${escapeHtml(s.gameName)}</strong><br/><span style="color:var(--text-dim);font-size:13px;">${fmtDate(s.startedAt)} · ${s.players.length} players${s.winner ? ` · 🏆 ${escapeHtml(s.winner)}` : ""}</span></div>
        <span class="pill">${s.rounds.length} rounds</span>
      </div>`;
    }).join("") + `</div>`;
    $hist.querySelectorAll("[data-id]").forEach((row) => {
      row.addEventListener("click", () => { location.hash = `#tracker/session/${row.dataset.id}`; });
    });
  }
}

async function renderNewSession(prefillGameId) {
  removeFab();
  const games = await DB.getGames();
  let chosenGame = prefillGameId ? games.find((g) => g.id === prefillGameId) : null;
  let customName = "";
  let players = [];
  let lowWins = false;

  $view.innerHTML = `
    <h2 style="margin-top:0;">Start Game Night</h2>
    <label>Game</label>
    <select id="game-select">
      <option value="">— Choose from your shelf —</option>
      ${games.map((g) => `<option value="${g.id}" ${g.id === prefillGameId ? "selected" : ""}>${escapeHtml(g.name)}</option>`).join("")}
      <option value="__custom__">Something else (type name)…</option>
    </select>
    <input type="text" id="custom-name" class="hidden" placeholder="Game name" style="margin-top:8px;" />

    <label style="display:flex;align-items:center;justify-content:space-between;">
      <span>Lowest score wins (e.g. golf-style)</span>
      <input type="checkbox" id="low-wins" style="width:20px;height:20px;" />
    </label>

    <label>Players</label>
    <div style="display:flex;gap:8px;">
      <input type="text" id="player-input" placeholder="Player name" style="flex:1;" />
      <button class="btn small" id="add-player-btn" style="width:auto;">Add</button>
    </div>
    <div class="card" id="players-list" style="margin-top:10px;"></div>

    <button class="btn" id="start-btn" style="margin-top:18px;">Start</button>
  `;

  function renderPlayers() {
    const list = document.getElementById("players-list");
    if (!players.length) { list.innerHTML = `<p style="color:var(--text-dim);font-size:13.5px;margin:0;">Add at least 2 players.</p>`; return; }
    list.innerHTML = players.map((p, i) => `<div class="player-row"><span class="pname">${escapeHtml(p)}</span><button class="icon-btn" data-i="${i}">✕</button></div>`).join("");
    list.querySelectorAll("[data-i]").forEach((btn) => btn.addEventListener("click", () => { players.splice(Number(btn.dataset.i), 1); renderPlayers(); }));
  }
  renderPlayers();

  function addPlayerFromInput() {
    const inp = document.getElementById("player-input");
    const v = inp.value.trim();
    if (v) { players.push(v); inp.value = ""; renderPlayers(); }
    inp.focus();
  }
  document.getElementById("add-player-btn").addEventListener("click", addPlayerFromInput);
  document.getElementById("player-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addPlayerFromInput(); } });

  const $select = document.getElementById("game-select");
  const $custom = document.getElementById("custom-name");
  $select.addEventListener("change", () => {
    $custom.classList.toggle("hidden", $select.value !== "__custom__");
  });
  if (!prefillGameId) $select.value = "";

  document.getElementById("low-wins").addEventListener("change", (e) => { lowWins = e.target.checked; });

  document.getElementById("start-btn").addEventListener("click", async () => {
    if (players.length < 2) { toast("Add at least 2 players"); return; }
    let gameId = null, gameName = "";
    if ($select.value === "__custom__") {
      gameName = document.getElementById("custom-name").value.trim();
      if (!gameName) { toast("Enter a game name"); return; }
    } else if ($select.value) {
      const g = games.find((x) => x.id === $select.value);
      gameId = g.id; gameName = g.name;
    } else {
      toast("Choose a game"); return;
    }
    const existingActive = (await DB.getSessions()).find((s) => !s.endedAt);
    if (existingActive) { toast("Finish or discard the game in progress first"); return; }
    const session = await DB.saveSession({
      gameId, gameName, lowWins,
      players: players.map((name) => ({ name, total: 0 })),
      rounds: [],
      startedAt: Date.now(),
      endedAt: null,
      winner: null,
    });
    location.hash = `#tracker/session/${session.id}`;
  });
}

async function renderSessionDetail(id) {
  removeFab();
  const session = await DB.getSession(id);
  if (!session) { location.hash = "#tracker"; return; }
  const active = !session.endedAt;

  $view.innerHTML = `
    <h2 style="margin-top:0;">${escapeHtml(session.gameName)}</h2>
    <div class="meta" style="color:var(--text-dim);font-size:13px;margin-bottom:14px;">
      ${fmtDateTime(session.startedAt)} · Round ${session.rounds.length}${session.lowWins ? " · lowest score wins" : ""}${session.endedAt ? " · Finished" : ""}
    </div>

    <div class="card" id="standings"></div>

    ${active ? `
      <div class="btn-row" style="margin-top:14px;">
        <button class="btn" id="enter-round-btn">Enter Round ${session.rounds.length + 1} Scores</button>
      </div>
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn secondary" id="add-player-mid-btn">+ Add Player</button>
        <button class="btn secondary" id="end-session-btn">End Game</button>
      </div>
    ` : `
      <div class="btn-row" style="margin-top:14px;">
        <button class="btn secondary" id="delete-session-btn">Delete From History</button>
      </div>
    `}

    ${session.rounds.length ? `
      <div class="section-title">Round History</div>
      <div class="card" style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13.5px;">
          <thead><tr>
            <th style="text-align:left;padding:4px 6px;color:var(--text-dim);">Round</th>
            ${session.players.map((p) => `<th style="text-align:right;padding:4px 6px;color:var(--text-dim);">${escapeHtml(p.name)}</th>`).join("")}
          </tr></thead>
          <tbody>
            ${session.rounds.map((r, i) => `<tr>
              <td style="padding:4px 6px;">${i + 1}</td>
              ${session.players.map((p) => `<td style="text-align:right;padding:4px 6px;">${r.scores[p.name] ?? "–"}</td>`).join("")}
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    ` : ""}
  `;

  function renderStandings() {
    const sorted = [...session.players].sort((a, b) => session.lowWins ? a.total - b.total : b.total - a.total);
    document.getElementById("standings").innerHTML = sorted.map((p, i) => `
      <div class="player-row">
        <span class="pname">${i === 0 && session.rounds.length ? "🏆 " : ""}${escapeHtml(p.name)}</span>
        <span class="score">${p.total}</span>
      </div>
    `).join("");
  }
  renderStandings();

  if (active) {
    document.getElementById("enter-round-btn").addEventListener("click", () => openRoundModal(session));
    document.getElementById("add-player-mid-btn").addEventListener("click", () => {
      const name = prompt("New player's name?");
      if (name && name.trim()) {
        session.players.push({ name: name.trim(), total: 0 });
        DB.saveSession(session).then(() => renderSessionDetail(id));
      }
    });
    document.getElementById("end-session-btn").addEventListener("click", async () => {
      if (!confirm("End this game night? Final standings will be saved to history.")) return;
      const sorted = [...session.players].sort((a, b) => session.lowWins ? a.total - b.total : b.total - a.total);
      session.winner = sorted[0]?.name || null;
      session.endedAt = Date.now();
      await DB.saveSession(session);
      toast("Game night saved!");
      renderSessionDetail(id);
    });
  } else {
    document.getElementById("delete-session-btn").addEventListener("click", async () => {
      if (confirm("Delete this game night from history?")) {
        await DB.deleteSession(id);
        location.hash = "#tracker";
      }
    });
  }
}

function openRoundModal(session) {
  openModal(`
    <h3>Round ${session.rounds.length + 1} — ${escapeHtml(session.gameName)}</h3>
    <div id="round-inputs">
      ${session.players.map((p) => `
        <label>${escapeHtml(p.name)}</label>
        <input type="number" data-name="${escapeHtml(p.name)}" placeholder="0" />
      `).join("")}
    </div>
    <div class="btn-row" style="margin-top:16px;">
      <button class="btn secondary" id="round-cancel">Cancel</button>
      <button class="btn" id="round-save">Save Round</button>
    </div>
  `, {
    onMount: (container) => {
      container.querySelector("#round-cancel").addEventListener("click", closeModal);
      container.querySelector("#round-save").addEventListener("click", async () => {
        const scores = {};
        container.querySelectorAll("#round-inputs input").forEach((inp) => {
          scores[inp.dataset.name] = Number(inp.value) || 0;
        });
        session.rounds.push({ round: session.rounds.length + 1, scores });
        session.players.forEach((p) => { p.total += scores[p.name] || 0; });
        await DB.saveSession(session);
        closeModal();
        renderSessionDetail(session.id);
      });
    },
  });
}

// ========================================================== HOUSEHOLD ===

async function renderHouseholdRoute() {
  removeFab();
  const household = await DB.getMeta("household");
  const members = await DB.getMembers();
  const bggEndpoint = await getBggEndpoint();

  $view.innerHTML = `
    <div class="note-banner">
      This version keeps everything on <strong>this device only</strong>. Invites below generate a real
      household code, but other phones won't see your shared list until cloud sync is turned on — ask to
      add that whenever you're ready.
    </div>

    <label>Household name</label>
    <input type="text" id="hh-name" value="${escapeHtml(household.name)}" />

    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>Members</span>
      <button class="link-btn" id="add-member-btn">+ Add</button>
    </div>
    <div class="card" id="members-list"></div>

    <div class="section-title">BoardGameGeek Lookup Service</div>
    <p style="color:var(--text-dim);font-size:12.5px;margin-top:0;">
      Lets "Add a Game" auto-fill details from BoardGameGeek instead of typing them in by hand.
      This needs a small free proxy service — see <code>bgg-proxy/README.md</code> in the project files for
      a 5-minute setup (Cloudflare Worker or Azure Function, both free). Paste its URL below once it's deployed.
    </p>
    <input type="text" id="bgg-endpoint" value="${escapeHtml(bggEndpoint)}" placeholder="https://your-proxy-url.example.com" />
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn secondary small" id="bgg-test-btn">Test Connection</button>
      <button class="btn small" id="bgg-save-btn">Save</button>
    </div>
    <p id="bgg-status" style="font-size:12.5px;color:var(--text-dim);min-height:16px;"></p>

    <div class="section-title">Invite Someone</div>
    <div class="btn-row">
      <button class="btn secondary" id="invite-qr-btn">📷 QR Code</button>
      <button class="btn secondary" id="invite-email-btn">✉️ Email</button>
    </div>

    <div class="section-title">Backup</div>
    <div class="btn-row">
      <button class="btn secondary" id="export-btn">⬇️ Export Backup</button>
      <button class="btn secondary" id="import-btn">⬆️ Import Backup</button>
    </div>
    <input type="file" accept="application/json" id="import-file" class="hidden" />

    <div class="section-title">Danger Zone</div>
    <button class="btn danger" id="clear-btn">Clear All Data</button>
  `;

  document.getElementById("hh-name").addEventListener("change", async (e) => {
    household.name = e.target.value.trim() || "Our Household";
    await DB.setMeta("household", household);
    toast("Household name saved");
  });

  const $bggStatus = document.getElementById("bgg-status");
  document.getElementById("bgg-save-btn").addEventListener("click", async () => {
    const url = document.getElementById("bgg-endpoint").value.trim();
    await setBggEndpoint(url);
    toast(url ? "Lookup service saved" : "Lookup service cleared");
  });
  document.getElementById("bgg-test-btn").addEventListener("click", async () => {
    const url = document.getElementById("bgg-endpoint").value.trim();
    if (!url) { $bggStatus.textContent = "Enter a URL first."; return; }
    $bggStatus.textContent = "Testing…";
    try {
      const count = await testBggEndpoint(url);
      $bggStatus.textContent = `✅ Working — got ${count} result(s) for a test search.`;
      $bggStatus.style.color = "var(--good)";
    } catch (err) {
      $bggStatus.textContent = `⚠️ ${err.message}`;
      $bggStatus.style.color = "var(--danger)";
    }
  });

  function renderMembers() {
    document.getElementById("members-list").innerHTML = members.map((m) => `
      <div class="member-item">
        <div><strong>${escapeHtml(m.name)}</strong>${m.isSelf ? ' <span style="color:var(--text-dim);font-size:12px;">(you)</span>' : ""}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <select data-id="${m.id}" class="role-select" style="width:auto;padding:6px 8px;font-size:12.5px;">
            <option value="owner" ${m.role === "owner" ? "selected" : ""}>Owner</option>
            <option value="editor" ${m.role === "editor" ? "selected" : ""}>Editor</option>
            <option value="viewer" ${m.role === "viewer" ? "selected" : ""}>Viewer</option>
          </select>
          ${m.isSelf ? "" : `<button class="icon-btn" data-remove="${m.id}">✕</button>`}
        </div>
      </div>
    `).join("");
    document.querySelectorAll(".role-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const m = members.find((x) => x.id === sel.dataset.id);
        m.role = sel.value;
        await DB.saveMember(m);
        toast(`${m.name} is now ${m.role}`);
      });
    });
    document.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await DB.deleteMember(btn.dataset.remove);
        location.hash = "#household"; route();
      });
    });
  }
  renderMembers();

  document.getElementById("add-member-btn").addEventListener("click", () => {
    openModal(`
      <h3>Add Household Member</h3>
      <label>Name</label>
      <input type="text" id="nm-name" placeholder="Family member's name" />
      <label>Role</label>
      <select id="nm-role">
        <option value="editor" selected>Editor — can add/edit games &amp; scores</option>
        <option value="viewer">Viewer — can only view</option>
        <option value="owner">Owner — full control incl. roles</option>
      </select>
      <div class="btn-row" style="margin-top:16px;">
        <button class="btn secondary" id="nm-cancel">Cancel</button>
        <button class="btn" id="nm-save">Add</button>
      </div>
    `, {
      onMount: (c) => {
        c.querySelector("#nm-cancel").addEventListener("click", closeModal);
        c.querySelector("#nm-save").addEventListener("click", async () => {
          const name = c.querySelector("#nm-name").value.trim();
          if (!name) { toast("Enter a name"); return; }
          await DB.saveMember({ name, role: c.querySelector("#nm-role").value, addedAt: Date.now() });
          closeModal();
          route();
        });
      },
    });
  });

  document.getElementById("invite-qr-btn").addEventListener("click", () => {
    const payload = JSON.stringify({ type: "family-game-shelf-invite", v: 1, householdId: household.id, householdName: household.name });
    const code = btoa(unescape(encodeURIComponent(payload)));
    openModal(`
      <h3>Invite via QR</h3>
      <p style="color:var(--text-dim);font-size:13.5px;">Have them scan this once cloud sync is enabled. For now you can also just read them the code below.</p>
      <div class="qr-box" id="qr-target"></div>
      <label>Household code</label>
      <input type="text" readonly value="${code}" onclick="this.select()" />
      <button class="btn" id="qr-done" style="margin-top:16px;">Done</button>
    `, {
      onMount: (c) => {
        try {
          // eslint-disable-next-line no-undef
          new QRCode(c.querySelector("#qr-target"), { text: code, width: 200, height: 200, colorDark: "#0f172a", colorLight: "#ffffff" });
        } catch (err) {
          c.querySelector("#qr-target").innerHTML = `<p style="color:#333;padding:20px;">QR library unavailable offline — use the code above instead.</p>`;
        }
        c.querySelector("#qr-done").addEventListener("click", closeModal);
      },
    });
  });

  document.getElementById("invite-email-btn").addEventListener("click", () => {
    const subject = encodeURIComponent(`Join our "${household.name}" game shelf`);
    const body = encodeURIComponent(`Hey! I'm setting up our family game shelf app.\n\nHousehold: ${household.name}\n\n(Once cloud sync is turned on, this email will carry a real join link — for now, ask me to add you locally.)`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  });

  document.getElementById("export-btn").addEventListener("click", async () => {
    const data = await DB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `game-shelf-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const $importFile = document.getElementById("import-file");
  document.getElementById("import-btn").addEventListener("click", () => $importFile.click());
  $importFile.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const replace = confirm("Replace ALL current data with this backup? Cancel to merge instead.");
      await DB.importAll(data, { replace });
      toast("Backup imported");
      route();
    } catch (err) {
      alert("Couldn't import that file: " + err.message);
    }
  });

  document.getElementById("clear-btn").addEventListener("click", async () => {
    if (!confirm("This deletes ALL games, sessions, and members on this device. Continue?")) return;
    if (!confirm("Are you absolutely sure? This cannot be undone.")) return;
    const data = await DB.exportAll();
    for (const g of data.games) await DB.deleteGame(g.id);
    for (const s of data.sessions) await DB.deleteSession(s.id);
    for (const m of data.members) if (!m.isSelf) await DB.deleteMember(m.id);
    toast("All data cleared");
    route();
  });
}

// ------------------------------------------------------------- SW setup --

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
