const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(path.join(dir, 'streamlab.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Charlas',
  bio TEXT NOT NULL DEFAULT '',
  is_live INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, channel_id)
);
`);

module.exports = db;
