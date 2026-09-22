import { db } from '../db/database.js';

export function logAudit({ userId, action, entityType, entityId, oldData = null, newData = null, reason = '' }) {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_data, new_data, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    stmt.run(
      userId || null,
      action,
      entityType,
      entityId || null,
      oldData ? (typeof oldData === 'string' ? oldData : JSON.stringify(oldData)) : null,
      newData ? (typeof newData === 'string' ? newData : JSON.stringify(newData)) : null,
      reason || ''
    );
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
