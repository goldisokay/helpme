import { Router } from 'express';
import { db } from '../db/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';

const router = Router();

// LIST ALL SOURCES
router.get('/', (req, res) => {
  try {
    const sources = db.prepare(`
      SELECT 
        s.*,
        (SELECT COUNT(*) FROM source_versions WHERE source_id = s.id) as version_count,
        (SELECT version FROM source_versions WHERE source_id = s.id AND status = 'ACTIVE' LIMIT 1) as active_version,
        (SELECT publication_year FROM source_versions WHERE source_id = s.id AND status = 'ACTIVE' LIMIT 1) as active_year
      FROM sources s
      ORDER BY 
        CASE s.authority 
          WHEN 'PRIMARY' THEN 1 
          WHEN 'SECONDARY' THEN 2 
          WHEN 'SUPPLEMENTARY' THEN 3 
          ELSE 4 
        END, s.id ASC
    `).all();

    res.json({ success: true, sources });
  } catch (err) {
    console.error('List sources error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil daftar sumber.' });
  }
});

// GET SOURCE DETAILS WITH VERSIONS
router.get('/:id', (req, res) => {
  try {
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(req.params.id);
    if (!source) {
      return res.status(404).json({ success: false, error: 'Sumber tidak ditemukan.' });
    }

    const versions = db.prepare(`
      SELECT 
        sv.*,
        (SELECT COUNT(*) FROM knowledge_chunks WHERE source_version_id = sv.id) as chunk_count,
        u1.name as uploaded_by_name,
        u2.name as approved_by_name
      FROM source_versions sv
      LEFT JOIN users u1 ON sv.uploaded_by = u1.id
      LEFT JOIN users u2 ON sv.approved_by = u2.id
      WHERE sv.source_id = ?
      ORDER BY sv.created_at DESC
    `).all(source.id);

    res.json({ success: true, source, versions });
  } catch (err) {
    console.error('Get source error:', err);
    res.status(500).json({ success: false, error: 'Gagal memuat detail sumber.' });
  }
});

// CREATE NEW SOURCE (ADMIN & SUPER_ADMIN)
router.post('/', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  try {
    const { title, organization, author, country = 'Indonesia', language = 'Bahasa Indonesia', authority = 'PRIMARY', source_type = 'GUIDEBOOK', description } = req.body;

    if (!title || !organization) {
      return res.status(400).json({ success: false, error: 'Judul dan organisasi sumber wajib diisi.' });
    }

    const result = db.prepare(`
      INSERT INTO sources (title, organization, author, country, language, authority, source_type, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title.trim(), organization.trim(), author || '', country, language, authority, source_type, description || '');

    const sourceId = Number(result.lastInsertRowid);

    logAudit({
      userId: req.user.id,
      action: 'CREATE_SOURCE',
      entityType: 'SOURCE',
      entityId: sourceId,
      newData: { title, organization, authority },
      reason: 'Admin menambahkan sumber pedoman baru'
    });

    res.status(201).json({ success: true, message: 'Sumber baru berhasil dibuat.', sourceId });
  } catch (err) {
    console.error('Create source error:', err);
    res.status(500).json({ success: false, error: 'Gagal menambahkan sumber.' });
  }
});

// CREATE NEW VERSION FOR A SOURCE (ADMIN & SUPER_ADMIN)
router.post('/:id/versions', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  try {
    const sourceId = req.params.id;
    const { version, edition, publication_year, effective_date, change_summary, status = 'PENDING_REVIEW' } = req.body;

    if (!version) {
      return res.status(400).json({ success: false, error: 'Nomor versi wajib diisi (misal: 2.0).' });
    }

    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
    if (!source) {
      return res.status(404).json({ success: false, error: 'Sumber tidak ditemukan.' });
    }

    const result = db.prepare(`
      INSERT INTO source_versions (source_id, version, edition, publication_year, effective_date, status, uploaded_by, change_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sourceId, version.trim(), edition || '', publication_year || new Date().getFullYear(), effective_date || null, status, req.user.id, change_summary || '');

    const versionId = Number(result.lastInsertRowid);

    logAudit({
      userId: req.user.id,
      action: 'CREATE_SOURCE_VERSION',
      entityType: 'SOURCE_VERSION',
      entityId: versionId,
      newData: { source_id: sourceId, version, status },
      reason: 'Admin membuat versi baru untuk sumber'
    });

    res.status(201).json({ success: true, message: `Versi ${version} berhasil dibuat.`, versionId });
  } catch (err) {
    console.error('Create source version error:', err);
    res.status(500).json({ success: false, error: 'Gagal membuat versi sumber.' });
  }
});

// ACTIVATE SOURCE VERSION (Marks old active version as SUPERSEDED)
router.post('/versions/:id/activate', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  try {
    const versionId = req.params.id;
    const version = db.prepare('SELECT * FROM source_versions WHERE id = ?').get(versionId);
    if (!version) {
      return res.status(404).json({ success: false, error: 'Versi sumber tidak ditemukan.' });
    }

    // Find previous ACTIVE version of this source
    const oldActiveVersion = db.prepare(`
      SELECT * FROM source_versions 
      WHERE source_id = ? AND status = 'ACTIVE' AND id != ?
    `).get(version.source_id, versionId);

    // If previous active exists, set to SUPERSEDED
    if (oldActiveVersion) {
      db.prepare(`
        UPDATE source_versions 
        SET status = 'SUPERSEDED' 
        WHERE id = ?
      `).run(oldActiveVersion.id);

      // Also mark its chunks as SUPERSEDED so RAG default skips them
      db.prepare(`
        UPDATE knowledge_chunks 
        SET status = 'SUPERSEDED', updated_at = datetime('now')
        WHERE source_version_id = ?
      `).run(oldActiveVersion.id);
    }

    // Activate the new version
    db.prepare(`
      UPDATE source_versions 
      SET status = 'ACTIVE', approved_by = ?, approved_at = datetime('now') 
      WHERE id = ?
    `).run(req.user.id, versionId);

    // Set its chunks to ACTIVE
    db.prepare(`
      UPDATE knowledge_chunks 
      SET status = 'ACTIVE', updated_at = datetime('now')
      WHERE source_version_id = ?
    `).run(versionId);

    logAudit({
      userId: req.user.id,
      action: 'ACTIVATE_SOURCE_VERSION',
      entityType: 'SOURCE_VERSION',
      entityId: versionId,
      oldData: oldActiveVersion ? { superseded_version_id: oldActiveVersion.id, version: oldActiveVersion.version } : null,
      newData: { active_version_id: versionId, version: version.version },
      reason: oldActiveVersion 
        ? `Aktivasi Versi ${version.version}. Versi lama ${oldActiveVersion.version} kini berstatus SUPERSEDED.`
        : `Aktivasi Versi ${version.version} sebagai rujukan aktif.`
    });

    res.json({
      success: true,
      message: `Versi ${version.version} kini berstatus ACTIVE. ${oldActiveVersion ? `Versi ${oldActiveVersion.version} telah ditandai sebagai SUPERSEDED.` : ''}`
    });
  } catch (err) {
    console.error('Activate version error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengaktifkan versi sumber.' });
  }
});

// SUPERSEDE OR ARCHIVE SOURCE VERSION
router.post('/versions/:id/status', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  try {
    const versionId = req.params.id;
    const { status, reason } = req.body;

    if (!['SUPERSEDED', 'ARCHIVED', 'DISABLED', 'ACTIVE', 'PENDING_REVIEW'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status tidak valid.' });
    }

    const version = db.prepare('SELECT * FROM source_versions WHERE id = ?').get(versionId);
    if (!version) {
      return res.status(404).json({ success: false, error: 'Versi sumber tidak ditemukan.' });
    }

    db.prepare('UPDATE source_versions SET status = ? WHERE id = ?').run(status, versionId);
    db.prepare('UPDATE knowledge_chunks SET status = ? WHERE source_version_id = ?').run(status, versionId);

    logAudit({
      userId: req.user.id,
      action: 'UPDATE_SOURCE_VERSION_STATUS',
      entityType: 'SOURCE_VERSION',
      entityId: versionId,
      oldData: { status: version.status },
      newData: { status },
      reason: reason || `Perubahan status versi menjadi ${status}`
    });

    res.json({ success: true, message: `Status versi berhasil diubah menjadi ${status}.` });
  } catch (err) {
    console.error('Update version status error:', err);
    res.status(500).json({ success: false, error: 'Gagal memperbarui status versi.' });
  }
});

// COMPARE TWO VERSIONS (DIFF COMPARISON)
router.get('/compare', authenticateToken, (req, res) => {
  try {
    const { v1_id, v2_id, type = 'source' } = req.query;

    if (!v1_id || !v2_id) {
      return res.status(400).json({ success: false, error: 'Harap tentukan dua versi untuk dibandingkan (v1_id & v2_id).' });
    }

    let v1, v2;
    if (type === 'material') {
      v1 = db.prepare('SELECT * FROM material_versions WHERE id = ?').get(v1_id);
      v2 = db.prepare('SELECT * FROM material_versions WHERE id = ?').get(v2_id);
    } else {
      v1 = db.prepare('SELECT * FROM source_versions WHERE id = ?').get(v1_id);
      v2 = db.prepare('SELECT * FROM source_versions WHERE id = ?').get(v2_id);
    }

    if (!v1 || !v2) {
      return res.status(404).json({ success: false, error: 'Salah satu versi tidak ditemukan.' });
    }

    // Line by line diff algorithm
    const lines1 = (v1.content || v1.change_summary || '').split('\n');
    const lines2 = (v2.content || v2.change_summary || '').split('\n');

    const added = [];
    const removed = [];
    const unchanged = [];

    const set1 = new Set(lines1.map(l => l.trim()));
    const set2 = new Set(lines2.map(l => l.trim()));

    for (const l of lines2) {
      if (!set1.has(l.trim()) && l.trim().length > 0) {
        added.push(l);
      } else if (l.trim().length > 0) {
        unchanged.push(l);
      }
    }

    for (const l of lines1) {
      if (!set2.has(l.trim()) && l.trim().length > 0) {
        removed.push(l);
      }
    }

    res.json({
      success: true,
      v1: { id: v1.id, version: v1.version, status: v1.status },
      v2: { id: v2.id, version: v2.version, status: v2.status },
      diff: {
        total_added: added.length,
        total_removed: removed.length,
        total_unchanged: unchanged.length,
        added,
        removed
      }
    });
  } catch (err) {
    console.error('Compare error:', err);
    res.status(500).json({ success: false, error: 'Gagal membandingkan versi.' });
  }
});

export default router;
