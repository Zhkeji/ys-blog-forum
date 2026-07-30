const { db } = require('./database');
let cache = {}, cacheTime = 0;

function loadSettings() {
  const now = Date.now();
  if (now - cacheTime < 5000 && Object.keys(cache).length > 0) return cache;
  try {
    for (const r of db.prepare('SELECT key,value FROM settings').all()) cache[r.key] = r.value;
    cacheTime = now;
  } catch (e) {}
  return cache;
}

function getSetting(k) { return loadSettings()[k]; }

function setSetting(k, v) {
  db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))").run(k, String(v));
  cache[k] = String(v);
}

function setSettings(obj) {
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))");
  const batch = db.transaction((items) => { for (const [k, v] of items) stmt.run(k, String(v)); });
  batch(Object.entries(obj));
  Object.assign(cache, Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)])));
}

module.exports = { loadSettings, getSetting, setSetting, setSettings };
