const Database = require("better-sqlite3");
const config = require("../config");
const fs = require("fs");
const { join } = require("path");

// KST (UTC+9) 기준 현재 시각 반환
function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace("Z", "+09:00");
}

//---------------------------------------------------------------------------------------
// DB 초기화
//---------------------------------------------------------------------------------------
const DATA_DIR = require("path").dirname(config.dbPath);
const DB_PATH  = config.dbPath;

let _db = null;

function getDb() {
  if (_db) return _db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS bot_config (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id     TEXT    NOT NULL UNIQUE,
      navigate       TEXT,
      wishlist_url   TEXT,
      smartstore_url TEXT,
      alert_threshold_pct REAL DEFAULT 0,
      updated_at     TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wish_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id   TEXT    NOT NULL,
      item_id      TEXT    NOT NULL,
      item_name    TEXT,
      item_url     TEXT,
      first_seen_at TEXT   NOT NULL,
      UNIQUE(profile_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id   TEXT    NOT NULL,
      item_id      TEXT    NOT NULL,
      price        INTEGER,
      is_available INTEGER NOT NULL DEFAULT 1,
      checked_at   TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id   TEXT    NOT NULL,
      item_id      TEXT    NOT NULL,
      item_name    TEXT,
      alert_type   TEXT    NOT NULL,
      old_price    INTEGER,
      new_price    INTEGER,
      note         TEXT,
      alerted_at   TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_history (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at         TEXT    NOT NULL,
      profile_id     TEXT    NOT NULL,
      navigate_mode  TEXT,
      items_checked  INTEGER DEFAULT 0,
      alerts_fired   INTEGER DEFAULT 0,
      success        INTEGER NOT NULL DEFAULT 0,
      note           TEXT
    );

    CREATE TABLE IF NOT EXISTS account_status (
      profile_id  TEXT PRIMARY KEY,
      blocked_at  TEXT,
      blocked_url TEXT,
      fail_reason TEXT,
      updated_at  TEXT NOT NULL
    );
  `);

  return _db;
}

//---------------------------------------------------------------------------------------
// 봇 설정 저장 / 조회
//---------------------------------------------------------------------------------------
function upsertBotConfig({ profileId, navigate, wishlistUrl, smartstoreUrl, alertThresholdPct }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO bot_config (profile_id, navigate, wishlist_url, smartstore_url, alert_threshold_pct, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      navigate            = excluded.navigate,
      wishlist_url        = excluded.wishlist_url,
      smartstore_url      = excluded.smartstore_url,
      alert_threshold_pct = excluded.alert_threshold_pct,
      updated_at          = excluded.updated_at
  `).run(
    profileId || "default",
    navigate || null,
    wishlistUrl || null,
    smartstoreUrl || null,
    alertThresholdPct ?? 0,
    nowKST(),
  );
}

function getBotConfig(profileId) {
  const db = getDb();
  const specific = db.prepare("SELECT * FROM bot_config WHERE profile_id = ?").get(profileId);
  if (specific) return specific;
  return db.prepare("SELECT * FROM bot_config WHERE profile_id = 'default'").get() || null;
}

//---------------------------------------------------------------------------------------
// 위시리스트 아이템 저장 / 조회
//---------------------------------------------------------------------------------------
function upsertWishItem({ profileId, itemId, itemName, itemUrl }) {
  getDb().prepare(`
    INSERT INTO wish_items (profile_id, item_id, item_name, item_url, first_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, item_id) DO UPDATE SET
      item_name = excluded.item_name,
      item_url  = excluded.item_url
  `).run(profileId, itemId, itemName || null, itemUrl || null, nowKST());
}

function getWishItems(profileId) {
  return getDb()
    .prepare("SELECT * FROM wish_items WHERE profile_id = ?")
    .all(profileId);
}

//---------------------------------------------------------------------------------------
// 가격 이력 저장 / 조회
//---------------------------------------------------------------------------------------
function insertPriceHistory({ profileId, itemId, price, isAvailable }) {
  getDb().prepare(`
    INSERT INTO price_history (profile_id, item_id, price, is_available, checked_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(profileId, itemId, price ?? null, isAvailable ? 1 : 0, nowKST());
}

function getLastPrice(profileId, itemId) {
  return getDb()
    .prepare(`
      SELECT price, is_available FROM price_history
      WHERE profile_id = ? AND item_id = ?
      ORDER BY id DESC LIMIT 1
    `)
    .get(profileId, itemId) || null;
}

//---------------------------------------------------------------------------------------
// 알림 로그 저장 / 조회
//---------------------------------------------------------------------------------------
function insertAlertLog({ profileId, itemId, itemName, alertType, oldPrice, newPrice, note }) {
  getDb().prepare(`
    INSERT INTO alert_log (profile_id, item_id, item_name, alert_type, old_price, new_price, note, alerted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(profileId, itemId, itemName || null, alertType, oldPrice ?? null, newPrice ?? null, note || null, nowKST());
}

function getRecentAlerts(limit = 50) {
  return getDb()
    .prepare("SELECT * FROM alert_log ORDER BY id DESC LIMIT ?")
    .all(limit);
}

//---------------------------------------------------------------------------------------
// 실행 이력 저장
//---------------------------------------------------------------------------------------
function insertRun({ profileId, navigateMode, itemsChecked, alertsFired, success, note }) {
  getDb().prepare(`
    INSERT INTO run_history (run_at, profile_id, navigate_mode, items_checked, alerts_fired, success, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nowKST(), profileId, navigateMode || null, itemsChecked ?? 0, alertsFired ?? 0, success ? 1 : 0, note || null);
}

//---------------------------------------------------------------------------------------
// 계정 차단 상태
//---------------------------------------------------------------------------------------
function markAccountBlocked(profileId, blockedUrl) {
  getDb().prepare(`
    INSERT INTO account_status (profile_id, blocked_at, blocked_url, fail_reason, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      blocked_at  = excluded.blocked_at,
      blocked_url = excluded.blocked_url,
      fail_reason = excluded.fail_reason,
      updated_at  = excluded.updated_at
  `).run(profileId, nowKST(), blockedUrl || null, "blocked", nowKST());
}

function isAccountBlocked(profileId) {
  const row = getDb()
    .prepare("SELECT blocked_at FROM account_status WHERE profile_id = ?")
    .get(profileId);
  return !!(row && row.blocked_at);
}

module.exports = {
  getDb,
  upsertBotConfig,
  getBotConfig,
  upsertWishItem,
  getWishItems,
  insertPriceHistory,
  getLastPrice,
  insertAlertLog,
  getRecentAlerts,
  insertRun,
  markAccountBlocked,
  isAccountBlocked,
};
