import { Router } from 'express';
import { db } from '../db/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';

const router = Router();

// LIST MATERIALS (with category filter and search)
router.get('/', (req, res) => {
  try {
    const { category_id, q, status } = req.query;

    let sql = `
      SELECT 
        m.id,
        m.title,
        m.summary,
        m.status,
        m.category_id,
        c.name as category_name,
        mv.version as current_version,
        m.created_at,
        m.updated_at
      FROM materials m
      LEFT JOIN categories c ON m.category_id = c.id
      LEFT JOIN material_versions mv ON m.current_version_id = mv.id
      WHERE 1=1
    `;
    const params = [];

    if (category_id) {
      sql += ' AND m.category_id = ?';
      params.push(category_id);
    }

    if (status) {
      sql += ' AND m.status = ?';
      params.push(status);
    } else {
      // Default: show ACTIVE for non-admin viewers
      sql += " AND m.status IN ('ACTIVE', 'PENDING_REVIEW')";
    }

    if (q) {
      sql += ' AND (m.title LIKE ? OR m.summary LIKE ? OR m.content LIKE ?)';
      const term = `%${q.trim()}%`;
      params.push(term, term, term);
    }

    sql += ' ORDER BY m.id ASC';

    const materials = db.prepare(sql).all(...params);
    const categories = db.prepare(`SELECT * FROM categories WHERE status = 'ACTIVE' ORDER BY id ASC`).all();

    res.json({ success: true, materials, categories });
  } catch (err) {
    console.error('List materials error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil daftar materi.' });
  }
});

// GET MATERIAL DETAILS WITH VERSION HISTORY
router.get('/:id', (req, res) => {
  try {
    const material = db.prepare(`
      SELECT 
        m.*,
        c.name as category_name,
        mv.version as current_version,
        mv.change_reason as current_version_reason
      FROM materials m
      LEFT JOIN categories c ON m.category_id = c.id
      LEFT JOIN material_versions mv ON m.current_version_id = mv.id
      WHERE m.id = ?
    `).get(req.params.id);

    if (!material) {
      return res.status(404).json({ success: false, error: 'Materi tidak ditemukan.' });
    }

    // Get all versions history
    const versions = db.prepare(`
      SELECT 
        mv.id,
        mv.version,
        mv.status,
        mv.change_reason,
        mv.created_at,
        u1.name as created_by_name,
        u2.name as approved_by_name,
        sv.version as source_version,
        s.title as source_title
      FROM material_versions mv
      LEFT JOIN users u1 ON mv.created_by = u1.id
      LEFT JOIN users u2 ON mv.approved_by = u2.id
      LEFT JOIN source_versions sv ON mv.source_version_id = sv.id
      LEFT JOIN sources s ON sv.source_id = s.id
      WHERE mv.material_id = ?
      ORDER BY mv.id DESC
    `).all(material.id);

    res.json({ success: true, material, versions });
  } catch (err) {
    console.error('Get material error:', err);
    res.status(500).json({ success: false, error: 'Gagal memuat detail materi.' });
  }
});

// CREATE MATERIAL (ADMIN & SUPER_ADMIN)
router.post('/', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  try {
    const { category_id, title, summary, content, source_version_id, status = 'ACTIVE' } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, error: 'Judul dan isi materi wajib diisi.' });
    }

    const matRes = db.prepare(`
      INSERT INTO materials (category_id, title, summary, content, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(category_id || null, title.trim(), summary || '', content.trim(), status);

    const matId = Number(matRes.lastInsertRowid);

    // Create version 1.0
    const mvRes = db.prepare(`
      INSERT INTO material_versions (material_id, version, content, source_version_id, change_reason, created_by, approved_by, status)
      VALUES (?, '1.0', ?, ?, 'Pembuatan materi baru', ?, ?, ?)
    `).run(matId, content.trim(), source_version_id || null, req.user.id, req.user.id, status);

    const mvId = Number(mvRes.lastInsertRowid);
    db.prepare(`UPDATE materials SET current_version_id = ? WHERE id = ?`).run(mvId, matId);

    logAudit({
      userId: req.user.id,
      action: 'CREATE_MATERIAL',
      entityType: 'MATERIAL',
      entityId: matId,
      newData: { title, category_id, status, version: '1.0' },
      reason: 'Admin menambahkan materi baru'
    });

    res.status(201).json({
      success: true,
      message: 'Materi berhasil ditambahkan.',
      materialId: matId
    });
  } catch (err) {
    console.error('Create material error:', err);
    res.status(500).json({ success: false, error: 'Gagal membuat materi baru.' });
  }
});

// UPDATE MATERIAL (Creates new version & preserves history)
router.put('/:id', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  try {
    const { title, summary, content, category_id, change_reason, status = 'ACTIVE' } = req.body;
    const materialId = req.params.id;

    const existingMat = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
    if (!existingMat) {
      return res.status(404).json({ success: false, error: 'Materi tidak ditemukan.' });
    }

    // Get current version string (e.g. "1.0", "1.1")
    const currentVer = db.prepare('SELECT version FROM material_versions WHERE id = ?').get(existingMat.current_version_id);
    let nextVersion = '1.1';
    if (currentVer && currentVer.version) {
      const parts = currentVer.version.split('.');
      if (parts.length === 2 && !isNaN(parts[1])) {
        nextVersion = `${parts[0]}.${Number(parts[1]) + 1}`;
      } else {
        nextVersion = `${currentVer.version}.1`;
      }
    }

    const updatedTitle = title ? title.trim() : existingMat.title;
    const updatedSummary = summary !== undefined ? summary : existingMat.summary;
    const updatedContent = content ? content.trim() : existingMat.content;
    const updatedCatId = category_id !== undefined ? category_id : existingMat.category_id;

    // Create new material version
    const mvRes = db.prepare(`
      INSERT INTO material_versions (material_id, version, content, change_reason, created_by, approved_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      materialId,
      nextVersion,
      updatedContent,
      change_reason || 'Pembaruan materi oleh admin',
      req.user.id,
      req.user.id,
      status
    );
    const newVersionId = Number(mvRes.lastInsertRowid);

    // Update material table
    db.prepare(`
      UPDATE materials
      SET title = ?, summary = ?, content = ?, category_id = ?, status = ?, current_version_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(updatedTitle, updatedSummary, updatedContent, updatedCatId, status, newVersionId, materialId);

    logAudit({
      userId: req.user.id,
      action: 'UPDATE_MATERIAL',
      entityType: 'MATERIAL',
      entityId: materialId,
      oldData: { title: existingMat.title, current_version_id: existingMat.current_version_id },
      newData: { title: updatedTitle, version: nextVersion, change_reason },
      reason: change_reason || 'Pembaruan isi materi'
    });

    res.json({
      success: true,
      message: `Materi berhasil diperbarui ke Versi ${nextVersion}.`,
      version: nextVersion
    });
  } catch (err) {
    console.error('Update material error:', err);
    res.status(500).json({ success: false, error: 'Gagal memperbarui materi.' });
  }
});

// ROLLBACK MATERIAL VERSION (SUPER_ADMIN & ADMIN)
router.post('/:id/rollback', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  try {
    const materialId = req.params.id;
    const { target_version_id, reason } = req.body;

    if (!target_version_id) {
      return res.status(400).json({ success: false, error: 'Target versi untuk rollback wajib ditentukan.' });
    }

    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
    if (!material) {
      return res.status(404).json({ success: false, error: 'Materi tidak ditemukan.' });
    }

    const targetVersion = db.prepare('SELECT * FROM material_versions WHERE id = ? AND material_id = ?').get(target_version_id, materialId);
    if (!targetVersion) {
      return res.status(404).json({ success: false, error: 'Versi target rollback tidak ditemukan.' });
    }

    const currentVersion = db.prepare('SELECT version FROM material_versions WHERE id = ?').get(material.current_version_id);

    // Create a new version entry documenting the rollback
    const rollbackVerStr = `${targetVersion.version}-rollback-${Date.now().toString().slice(-4)}`;
    const mvRes = db.prepare(`
      INSERT INTO material_versions (material_id, version, content, source_version_id, change_reason, created_by, approved_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(
      materialId,
      rollbackVerStr,
      targetVersion.content,
      targetVersion.source_version_id,
      `Rollback dari Versi ${currentVersion?.version || '?'} ke Versi ${targetVersion.version}. Alasan: ${reason || 'Rollback administrasi'}`,
      req.user.id,
      req.user.id
    );

    const newVersionId = Number(mvRes.lastInsertRowid);

    // Apply rollback content to main material
    db.prepare(`
      UPDATE materials 
      SET content = ?, current_version_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(targetVersion.content, newVersionId, materialId);

    logAudit({
      userId: req.user.id,
      action: 'ROLLBACK_MATERIAL',
      entityType: 'MATERIAL',
      entityId: materialId,
      oldData: { version: currentVersion?.version, version_id: material.current_version_id },
      newData: { rollback_to: targetVersion.version, new_version_id: newVersionId },
      reason: reason || `Rollback ke Versi ${targetVersion.version}`
    });

    res.json({
      success: true,
      message: `Berhasil melakukan rollback ke konten Versi ${targetVersion.version}.`,
      newVersion: rollbackVerStr
    });
  } catch (err) {
    console.error('Rollback error:', err);
    res.status(500).json({ success: false, error: 'Gagal melakukan rollback materi.' });
  }
});

export default router;
