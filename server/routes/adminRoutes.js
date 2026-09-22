import { Router } from 'express';
import { db } from '../db/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';

const router = Router();

// Require ADMIN or SUPER_ADMIN for all admin routes
router.use(authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'));

// DASHBOARD STATS
router.get('/dashboard', (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
    const totalMaterials = db.prepare('SELECT COUNT(*) as cnt FROM materials').get().cnt;
    const totalSources = db.prepare('SELECT COUNT(*) as cnt FROM sources').get().cnt;
    const activeSources = db.prepare("SELECT COUNT(*) as cnt FROM source_versions WHERE status = 'ACTIVE'").get().cnt;
    const pendingReviews = db.prepare("SELECT (SELECT COUNT(*) FROM source_versions WHERE status = 'PENDING_REVIEW') + (SELECT COUNT(*) FROM materials WHERE status = 'PENDING_REVIEW') as cnt").get().cnt;
    const archivedSources = db.prepare("SELECT COUNT(*) as cnt FROM source_versions WHERE status IN ('ARCHIVED', 'SUPERSEDED')").get().cnt;
    const totalAiQuestions = db.prepare('SELECT COUNT(*) as cnt FROM ai_responses').get().cnt;
    const totalChunks = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_chunks').get().cnt;

    const recentChanges = db.prepare(`
      SELECT 
        a.id,
        a.action,
        a.entity_type,
        a.entity_id,
        a.reason,
        a.created_at,
        u.name as user_name,
        u.role as user_role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.id DESC
      LIMIT 8
    `).all();

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalMaterials,
        totalSources,
        activeSources,
        pendingReviews,
        archivedSources,
        totalAiQuestions,
        totalChunks
      },
      recentChanges
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ success: false, error: 'Gagal memuat statistik dashboard.' });
  }
});

// LIST ALL USERS
router.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, name, username, email, role, pmr_level, status, created_at, updated_at
      FROM users
      ORDER BY id ASC
    `).all();

    res.json({ success: true, users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil data pengguna.' });
  }
});

// UPDATE USER ROLE (SUPER_ADMIN ONLY)
router.put('/users/:id/role', authorizeRoles('SUPER_ADMIN'), (req, res) => {
  try {
    const { role } = req.body;
    const targetUserId = req.params.id;

    if (!['USER', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Peran tidak valid.' });
    }

    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'Pengguna tidak ditemukan.' });
    }

    db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(role, targetUserId);

    logAudit({
      userId: req.user.id,
      action: 'UPDATE_USER_ROLE',
      entityType: 'USER',
      entityId: targetUserId,
      oldData: { role: targetUser.role },
      newData: { role },
      reason: `Super Admin mengubah peran pengguna ${targetUser.username} menjadi ${role}`
    });

    res.json({ success: true, message: `Peran pengguna berhasil diubah menjadi ${role}.` });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ success: false, error: 'Gagal memperbarui peran pengguna.' });
  }
});

// TOGGLE USER STATUS (ACTIVE/SUSPENDED)
router.put('/users/:id/status', authorizeRoles('SUPER_ADMIN'), (req, res) => {
  try {
    const { status } = req.body;
    const targetUserId = req.params.id;

    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status tidak valid.' });
    }

    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'Pengguna tidak ditemukan.' });
    }

    db.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, targetUserId);

    logAudit({
      userId: req.user.id,
      action: 'UPDATE_USER_STATUS',
      entityType: 'USER',
      entityId: targetUserId,
      oldData: { status: targetUser.status },
      newData: { status },
      reason: `Super Admin mengubah status pengguna menjadi ${status}`
    });

    res.json({ success: true, message: `Status pengguna berhasil diubah menjadi ${status}.` });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ success: false, error: 'Gagal memperbarui status pengguna.' });
  }
});

// REVIEW CENTER: List pending review items
router.get('/review-center', (req, res) => {
  try {
    // 1. Pending Source Versions
    const pendingSourceVersions = db.prepare(`
      SELECT 
        sv.*,
        s.title as source_title,
        s.organization,
        u.name as uploader_name
      FROM source_versions sv
      JOIN sources s ON sv.source_id = s.id
      LEFT JOIN users u ON sv.uploaded_by = u.id
      WHERE sv.status = 'PENDING_REVIEW'
      ORDER BY sv.created_at DESC
    `).all();

    // 2. Pending Materials
    const pendingMaterials = db.prepare(`
      SELECT 
        m.*,
        c.name as category_name
      FROM materials m
      LEFT JOIN categories c ON m.category_id = c.id
      WHERE m.status = 'PENDING_REVIEW'
      ORDER BY m.updated_at DESC
    `).all();

    // 3. Flagged AI Responses needing Quality Control
    const flaggedResponses = db.prepare(`
      SELECT 
        ar.*,
        cm.content as question,
        cs.user_id,
        u.name as user_name
      FROM ai_responses ar
      JOIN chat_messages cm ON ar.message_id = cm.id
      JOIN chat_sessions cs ON cm.session_id = cs.id
      LEFT JOIN users u ON cs.user_id = u.id
      WHERE ar.is_flagged = 1 OR ar.feedback = 'UNHELPFUL'
      ORDER BY ar.created_at DESC
      LIMIT 20
    `).all();

    res.json({
      success: true,
      pendingSourceVersions,
      pendingMaterials,
      flaggedResponses
    });
  } catch (err) {
    console.error('Review center error:', err);
    res.status(500).json({ success: false, error: 'Gagal memuat review center.' });
  }
});

// REVIEW ACTION (Approve / Reject)
router.post('/review-center/:type/:id/action', (req, res) => {
  try {
    const { type, id } = req.params;
    const { action, reason } = req.body; // action: 'APPROVE', 'REJECT', 'REQUEST_REVISION'

    if (!['APPROVE', 'REJECT', 'REQUEST_REVISION'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Aksi review tidak valid.' });
    }

    if (type === 'source_version') {
      const newStatus = action === 'APPROVE' ? 'ACTIVE' : (action === 'REJECT' ? 'DISABLED' : 'DRAFT');
      db.prepare(`
        UPDATE source_versions 
        SET status = ?, approved_by = ?, approved_at = datetime('now')
        WHERE id = ?
      `).run(newStatus, req.user.id, id);

      db.prepare(`UPDATE knowledge_chunks SET status = ? WHERE source_version_id = ?`).run(newStatus, id);

      logAudit({
        userId: req.user.id,
        action: `REVIEW_SOURCE_VERSION_${action}`,
        entityType: 'SOURCE_VERSION',
        entityId: id,
        newData: { status: newStatus },
        reason: reason || `Review tindakan: ${action}`
      });
    } else if (type === 'material') {
      const newStatus = action === 'APPROVE' ? 'ACTIVE' : (action === 'REJECT' ? 'ARCHIVED' : 'DRAFT');
      db.prepare(`
        UPDATE materials SET status = ?, updated_at = datetime('now') WHERE id = ?
      `).run(newStatus, id);

      logAudit({
        userId: req.user.id,
        action: `REVIEW_MATERIAL_${action}`,
        entityType: 'MATERIAL',
        entityId: id,
        newData: { status: newStatus },
        reason: reason || `Review tindakan: ${action}`
      });
    }

    res.json({ success: true, message: `Review berhasil diproses dengan status: ${action}.` });
  } catch (err) {
    console.error('Process review error:', err);
    res.status(500).json({ success: false, error: 'Gagal memproses aksi review.' });
  }
});

// AI LOGS & QUALITY CONTROL
router.get('/ai-logs', (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT 
        ar.id,
        ar.message_id,
        ar.model,
        ar.confidence,
        ar.sources_used,
        ar.feedback,
        ar.feedback_reason,
        ar.is_flagged,
        ar.flag_notes,
        ar.created_at,
        cm.content as question,
        (SELECT content FROM chat_messages WHERE id = ar.message_id) as answer,
        u.name as user_name,
        u.username as user_username
      FROM ai_responses ar
      JOIN chat_messages cm ON cm.id = (
        SELECT id FROM chat_messages 
        WHERE session_id = (SELECT session_id FROM chat_messages WHERE id = ar.message_id)
          AND role = 'user' AND id < ar.message_id
        ORDER BY id DESC LIMIT 1
      )
      LEFT JOIN chat_sessions cs ON cm.session_id = cs.id
      LEFT JOIN users u ON cs.user_id = u.id
      ORDER BY ar.id DESC
      LIMIT 50
    `).all();

    const formattedLogs = logs.map(l => {
      let parsedSources = [];
      try {
        parsedSources = JSON.parse(l.sources_used);
      } catch (e) {}
      return {
        ...l,
        sources_used: parsedSources
      };
    });

    res.json({ success: true, logs: formattedLogs });
  } catch (err) {
    console.error('AI logs error:', err);
    res.status(500).json({ success: false, error: 'Gagal memuat log AI.' });
  }
});

// FLAG AI RESPONSE
router.post('/ai-logs/:id/flag', (req, res) => {
  try {
    const responseId = req.params.id;
    const { is_flagged, flag_notes } = req.body;

    db.prepare(`
      UPDATE ai_responses 
      SET is_flagged = ?, flag_notes = ?
      WHERE id = ?
    `).run(is_flagged ? 1 : 0, flag_notes || '', responseId);

    logAudit({
      userId: req.user.id,
      action: 'FLAG_AI_RESPONSE',
      entityType: 'AI_RESPONSE',
      entityId: responseId,
      newData: { is_flagged, flag_notes },
      reason: flag_notes || 'Admin menandai respon AI untuk investigasi'
    });

    res.json({ success: true, message: 'Status penandaan respon AI berhasil diperbarui.' });
  } catch (err) {
    console.error('Flag AI response error:', err);
    res.status(500).json({ success: false, error: 'Gagal menandai respon AI.' });
  }
});

// AUDIT LOGS
router.get('/audit-logs', (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT 
        a.*,
        u.name as user_name,
        u.role as user_role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.id DESC
      LIMIT 100
    `).all();

    res.json({ success: true, logs });
  } catch (err) {
    console.error('Audit logs error:', err);
    res.status(500).json({ success: false, error: 'Gagal memuat log audit.' });
  }
});

// GET SYSTEM SETTINGS
router.get('/settings', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM system_settings').all();
    const settingsMap = {};
    for (const s of settings) {
      settingsMap[s.key] = s.value;
    }
    res.json({ success: true, settings: settingsMap });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ success: false, error: 'Gagal memuat pengaturan sistem.' });
  }
});

// UPDATE SYSTEM SETTINGS (SUPER_ADMIN ONLY)
router.put('/settings', authorizeRoles('SUPER_ADMIN'), (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ success: false, error: 'Payload pengaturan tidak valid.' });
    }

    const stmt = db.prepare(`
      INSERT INTO system_settings (key, value, updated_by, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET 
        value = excluded.value, 
        updated_by = excluded.updated_by, 
        updated_at = datetime('now')
    `);

    for (const [k, v] of Object.entries(settings)) {
      stmt.run(k, String(v), req.user.id);
    }

    logAudit({
      userId: req.user.id,
      action: 'UPDATE_SYSTEM_SETTINGS',
      entityType: 'SETTINGS',
      entityId: 1,
      newData: settings,
      reason: 'Super Admin memperbarui konfigurasi sistem HelpMe!'
    });

    res.json({ success: true, message: 'Pengaturan sistem berhasil diperbarui.' });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ success: false, error: 'Gagal menyimpan pengaturan sistem.' });
  }
});

export default router;
