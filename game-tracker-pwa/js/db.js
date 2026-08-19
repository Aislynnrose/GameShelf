/*
 * db.js — local data layer for Family Game Shelf.
 *
 * Everything here talks to IndexedDB on THIS device only. It is written as a
 * small async "repository" API (getGames, saveGame, deleteGame, etc.) on
 * purpose: when real multi-device sync is added later (see README —
 * Firebase/Firestore is the recommended path), only this file needs to be
 * swapped out. The rest of the app (app.js) never touches IndexedDB
 * directly, it only calls DB.*.
 */

const DB = (() => {
  const DB_NAME = "family-game-shelf";
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("games")) {
          const store = db.createObjectStore("games", { keyPath: "id" });
          store.createIndex("name", "name", { unique: false });
        }
        if (!db.objectStoreNames.contains("sessions")) {
          db.createObjectStore("sessions", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("members")) {
          db.createObjectStore("members", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function uid() {
    return (
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9)
    );
  }

  // ---------- Games ----------
  async function getGames() {
    const store = await tx("games", "readonly");
    return reqToPromise(store.getAll());
  }

  async function getGame(id) {
    const store = await tx("games", "readonly");
    return reqToPromise(store.get(id));
  }

  async function saveGame(game) {
    if (!game.id) game.id = uid();
    game.updatedAt = Date.now();
    if (!game.createdAt) game.createdAt = game.updatedAt;
    const store = await tx("games", "readwrite");
    await reqToPromise(store.put(game));
    return game;
  }

  async function deleteGame(id) {
    const store = await tx("games", "readwrite");
    await reqToPromise(store.delete(id));
  }

  // ---------- Sessions (score tracker history) ----------
  async function getSessions() {
    const store = await tx("sessions", "readonly");
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  async function getSession(id) {
    const store = await tx("sessions", "readonly");
    return reqToPromise(store.get(id));
  }

  async function saveSession(session) {
    if (!session.id) session.id = uid();
    const store = await tx("sessions", "readwrite");
    await reqToPromise(store.put(session));
    return session;
  }

  async function deleteSession(id) {
    const store = await tx("sessions", "readwrite");
    await reqToPromise(store.delete(id));
  }

  // ---------- Members / household ----------
  async function getMembers() {
    const store = await tx("members", "readonly");
    return reqToPromise(store.getAll());
  }

  async function saveMember(member) {
    if (!member.id) member.id = uid();
    const store = await tx("members", "readwrite");
    await reqToPromise(store.put(member));
    return member;
  }

  async function deleteMember(id) {
    const store = await tx("members", "readwrite");
    await reqToPromise(store.delete(id));
  }

  // ---------- Meta (household info, single-row settings) ----------
  async function getMeta(key, fallback = null) {
    const store = await tx("meta", "readonly");
    const row = await reqToPromise(store.get(key));
    return row ? row.value : fallback;
  }

  async function setMeta(key, value) {
    const store = await tx("meta", "readwrite");
    await reqToPromise(store.put({ key, value }));
    return value;
  }

  // ---------- Backup / restore ----------
  async function exportAll() {
    const [games, sessions, members] = await Promise.all([
      getGames(),
      getSessions(),
      getMembers(),
    ]);
    const household = await getMeta("household", null);
    return {
      exportedAt: new Date().toISOString(),
      app: "family-game-shelf",
      version: 1,
      household,
      games,
      sessions,
      members,
    };
  }

  async function importAll(data, { replace = false } = {}) {
    if (!data || data.app !== "family-game-shelf") {
      throw new Error("This doesn't look like a Family Game Shelf backup file.");
    }
    if (replace) {
      const [gStore, sStore, mStore] = await Promise.all([
        tx("games", "readwrite"),
        tx("sessions", "readwrite"),
        tx("members", "readwrite"),
      ]);
      await Promise.all([
        reqToPromise(gStore.clear()),
        reqToPromise(sStore.clear()),
        reqToPromise(mStore.clear()),
      ]);
    }
    for (const g of data.games || []) await saveGame(g);
    for (const s of data.sessions || []) await saveSession(s);
    for (const m of data.members || []) await saveMember(m);
    if (data.household) await setMeta("household", data.household);
  }

  return {
    uid,
    getGames,
    getGame,
    saveGame,
    deleteGame,
    getSessions,
    getSession,
    saveSession,
    deleteSession,
    getMembers,
    saveMember,
    deleteMember,
    getMeta,
    setMeta,
    exportAll,
    importAll,
  };
})();
