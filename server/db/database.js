import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import Database from 'libsql';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

let dbInstance;

if (TURSO_DATABASE_URL && TURSO_AUTH_TOKEN) {
  const syncUrl = TURSO_DATABASE_URL.startsWith('libsql://')
    ? TURSO_DATABASE_URL.replace('libsql://', 'https://')
    : TURSO_DATABASE_URL;

  const isVercel = process.env.VERCEL === '1';
  const replicaPath = isVercel
    ? '/tmp/helpme_turso.db'
    : path.resolve(__dirname, '../../data/helpme_turso.db');

  dbInstance = new Database(replicaPath, {
    syncUrl,
    authToken: TURSO_AUTH_TOKEN
  });

  try {
    await dbInstance.sync();
    console.log('✅ Terhubung dan tersinkronisasi dengan Database Turso Cloud!');
  } catch (err) {
    console.warn('⚠️ Peringatan sinkronisasi awal Turso:', err.message);
  }
} else {
  const DATA_DIR = path.resolve(__dirname, '../../data');
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const DB_PATH = process.env.DATABASE_PATH 
    ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
    : path.join(DATA_DIR, 'helpme.db');

  dbInstance = new DatabaseSync(DB_PATH);
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA journal_mode = WAL;');
}

export const db = dbInstance;

export function initDatabase() {
  db.exec(`
    -- USERS TABLE
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('USER', 'ADMIN', 'SUPER_ADMIN')) DEFAULT 'USER',
      pmr_level TEXT NOT NULL DEFAULT 'WIRA',
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'SUSPENDED', 'PENDING')) DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- SOURCES TABLE
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      organization TEXT NOT NULL,
      author TEXT,
      country TEXT NOT NULL DEFAULT 'Indonesia',
      language TEXT NOT NULL DEFAULT 'Bahasa Indonesia',
      authority TEXT NOT NULL CHECK(authority IN ('PRIMARY', 'SECONDARY', 'SUPPLEMENTARY', 'UNVERIFIED')) DEFAULT 'PRIMARY',
      source_type TEXT NOT NULL DEFAULT 'GUIDEBOOK',
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- SOURCE VERSIONS TABLE
    CREATE TABLE IF NOT EXISTS source_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
      version TEXT NOT NULL,
      edition TEXT,
      publication_year INTEGER,
      effective_date TEXT,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'DRAFT', 'PENDING_REVIEW', 'SUPERSEDED', 'ARCHIVED', 'DISABLED')) DEFAULT 'DRAFT',
      file_path TEXT,
      uploaded_by INTEGER REFERENCES users(id),
      approved_by INTEGER REFERENCES users(id),
      approved_at TEXT,
      change_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- CATEGORIES TABLE
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')) DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- MATERIALS TABLE
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      summary TEXT,
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'DRAFT', 'PENDING_REVIEW', 'ARCHIVED', 'SUPERSEDED')) DEFAULT 'ACTIVE',
      current_version_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- MATERIAL VERSIONS TABLE
    CREATE TABLE IF NOT EXISTS material_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      content TEXT NOT NULL,
      source_version_id INTEGER REFERENCES source_versions(id),
      change_reason TEXT,
      created_by INTEGER REFERENCES users(id),
      approved_by INTEGER REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'DRAFT', 'PENDING_REVIEW', 'SUPERSEDED', 'ARCHIVED')) DEFAULT 'DRAFT',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- KNOWLEDGE CHUNKS TABLE
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_version_id INTEGER NOT NULL REFERENCES source_versions(id) ON DELETE CASCADE,
      material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
      chapter TEXT NOT NULL,
      section TEXT,
      page_number INTEGER,
      content TEXT NOT NULL,
      embedding TEXT, -- JSON array of normalized term weights or vector
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'DRAFT', 'PENDING_REVIEW', 'SUPERSEDED', 'ARCHIVED')) DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- CHAT SESSIONS TABLE
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- CHAT MESSAGES TABLE
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- AI RESPONSES TABLE
    CREATE TABLE IF NOT EXISTS ai_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER UNIQUE NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      confidence REAL DEFAULT 0.95,
      sources_used TEXT, -- JSON array of source citations
      retrieved_chunks TEXT, -- JSON array of chunk metadata IDs
      feedback TEXT CHECK(feedback IN ('HELPFUL', 'UNHELPFUL', NULL)),
      feedback_reason TEXT,
      is_flagged INTEGER NOT NULL DEFAULT 0,
      flag_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- AUDIT LOGS TABLE
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      old_data TEXT, -- JSON
      new_data TEXT, -- JSON
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- SYSTEM SETTINGS TABLE
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- FTS5 VIRTUAL TABLE FOR HYBRID RETRIEVAL
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
      chunk_id UNINDEXED,
      chapter,
      section,
      content,
      tokenize='unicode61'
    );
  `);

  // Initialize default system settings if not exists
  const defaultSettings = [
    ['ai_model', 'gemini-3.8-flash'],
    ['strict_rag_grounding', 'true'],
    ['allow_general_knowledge', 'false'],
    ['source_conflict_handling', 'STRICT_WARNING'],
    ['pmi_wira_priority', 'HIGHEST'],
    ['min_confidence_score', '0.65'],
    ['safety_alert_banner', 'true'],
    ['app_version', '1.0.0']
  ];

  const insertSettingStmt = db.prepare(`
    INSERT OR IGNORE INTO system_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `);

  for (const [key, val] of defaultSettings) {
    insertSettingStmt.run(key, val);
  }
}
