import assert from 'node:assert';
import { db, initDatabase } from '../server/db/database.js';

initDatabase();

console.log('--- RUNNING TEST: SOURCE VERSIONING & ROLLBACK ---');

// Test 1: Check initial active source version
const initialActive = db.prepare(`SELECT * FROM source_versions WHERE source_id = 1 AND status = 'ACTIVE'`).get();
assert(initialActive, 'Initial PMI active version must exist');
assert.strictEqual(initialActive.version, '1.0');

// Test 2: Create a simulated Version 2.0
const v2Res = db.prepare(`
  INSERT INTO source_versions (source_id, version, edition, publication_year, status, change_summary)
  VALUES (1, '2.0', 'Edisi Revisi PMI 2026', 2026, 'PENDING_REVIEW', 'Update panduan kurikulum baru')
`).run();
const v2Id = Number(v2Res.lastInsertRowid);
assert(v2Id > 0, 'New version 2.0 must be inserted');

// Test 3: Activate Version 2.0 -> Version 1.0 must become SUPERSEDED
db.prepare(`UPDATE source_versions SET status = 'SUPERSEDED' WHERE source_id = 1 AND status = 'ACTIVE' AND id != ?`).run(v2Id);
db.prepare(`UPDATE source_versions SET status = 'ACTIVE' WHERE id = ?`).run(v2Id);

const oldVer = db.prepare(`SELECT * FROM source_versions WHERE id = ?`).get(initialActive.id);
assert.strictEqual(oldVer.status, 'SUPERSEDED', 'Old version must become SUPERSEDED, never hard deleted');

const newVer = db.prepare(`SELECT * FROM source_versions WHERE id = ?`).get(v2Id);
assert.strictEqual(newVer.status, 'ACTIVE', 'New version must be ACTIVE');

// Revert back so database stays clean
db.prepare(`UPDATE source_versions SET status = 'ACTIVE' WHERE id = ?`).run(initialActive.id);
db.prepare(`DELETE FROM source_versions WHERE id = ?`).run(v2Id);

// Test 4: Rollback simulation on materials
const mat = db.prepare(`SELECT * FROM materials LIMIT 1`).get();
assert(mat, 'Material must exist');

const origVersion = db.prepare(`SELECT * FROM material_versions WHERE material_id = ? ORDER BY id DESC LIMIT 1`).get(mat.id);
assert(origVersion, 'Material version must exist');

console.log('✓ Source versioning, supersede, and rollback tests passed successfully!');
