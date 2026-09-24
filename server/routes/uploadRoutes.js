import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { db } from '../db/database.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';
import { tokenize, computeTermFrequencies } from '../services/vectorService.js';

const router = Router();

const UPLOADS_DIR = process.env.VERCEL === '1'
  ? path.resolve('/tmp', 'uploads')
  : path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    cb(null, `${Date.now()}_${safeName}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.pdf', '.txt', '.md', '.markdown'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung. Harap unggah PDF, TXT, atau Markdown.'));
    }
  }
});

// UPLOAD DOCUMENT & EXTRACT CHUNKS IN DRAFT STATUS
router.post('/document', authenticateToken, authorizeRoles('ADMIN', 'SUPER_ADMIN'), upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'File dokumen wajib dipilih.' });
    }

    const { source_id, version, edition, publication_year, chapter_name } = req.body;

    if (!source_id || !version) {
      return res.status(400).json({ success: false, error: 'ID Sumber dan nomor versi wajib diisi.' });
    }

    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(source_id);
    if (!source) {
      return res.status(404).json({ success: false, error: 'Sumber tidak ditemukan.' });
    }

    // 1. Create a DRAFT source version
    const versionRes = db.prepare(`
      INSERT INTO source_versions (source_id, version, edition, publication_year, status, file_path, uploaded_by, change_summary)
      VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?)
    `).run(
      source_id,
      version.trim(),
      edition || 'Edisi Revisi',
      publication_year || new Date().getFullYear(),
      path.relative(process.cwd(), req.file.path),
      req.user.id,
      `Dokumen baru diunggah: ${req.file.originalname} (Perlu review admin sebelum diaktifkan)`
    );
    const versionId = Number(versionRes.lastInsertRowid);

    // 2. Extract Text & Split into Chunks
    const ext = path.extname(req.file.originalname).toLowerCase();
    let extractedPages = [];

    if (ext === '.pdf') {
      try {
        const text = execSync(`pdftotext "${req.file.path}" -`, { maxBuffer: 30 * 1024 * 1024 }).toString();
        const pages = text.split('\x0c');
        extractedPages = pages.map((p, idx) => ({
          pageNumber: idx + 1,
          chapter: chapter_name || 'Dokumen Baru',
          section: `Halaman ${idx + 1}`,
          content: p.trim()
        })).filter(p => p.content.length > 50);
      } catch (err) {
        console.error('pdftotext extraction error:', err);
      }
    } else {
      // TXT or Markdown
      const content = fs.readFileSync(req.file.path, 'utf8');
      const paragraphs = content.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 50);
      extractedPages = paragraphs.map((para, idx) => ({
        pageNumber: idx + 1,
        chapter: chapter_name || 'Dokumen Baru',
        section: `Paragraf ${idx + 1}`,
        content: para
      }));
    }

    // 3. Save Chunks into DRAFT status
    const insertChunkStmt = db.prepare(`
      INSERT INTO knowledge_chunks (source_version_id, chapter, section, page_number, content, embedding, status)
      VALUES (?, ?, ?, ?, ?, ?, 'DRAFT')
    `);

    const insertFtsStmt = db.prepare(`
      INSERT INTO knowledge_chunks_fts (chunk_id, chapter, section, content)
      VALUES (?, ?, ?, ?)
    `);

    let chunksCount = 0;
    for (const chunk of extractedPages) {
      const tokens = tokenize(chunk.content);
      const tf = computeTermFrequencies(tokens);
      const embJson = JSON.stringify(tf);

      const cRes = insertChunkStmt.run(
        versionId,
        chunk.chapter,
        chunk.section,
        chunk.pageNumber,
        chunk.content,
        embJson
      );
      const cId = Number(cRes.lastInsertRowid);
      insertFtsStmt.run(cId, chunk.chapter, chunk.section, chunk.content);
      chunksCount++;
    }

    // 4. Record Audit Log
    logAudit({
      userId: req.user.id,
      action: 'UPLOAD_DOCUMENT',
      entityType: 'SOURCE_VERSION',
      entityId: versionId,
      newData: {
        filename: req.file.originalname,
        versionId,
        chunksExtracted: chunksCount,
        status: 'DRAFT'
      },
      reason: `Admin mengunggah dokumen ${req.file.originalname}. Tersimpan sebagai DRAFT untuk tahap review.`
    });

    res.status(201).json({
      success: true,
      message: `Dokumen berhasil diunggah! Sebanyak ${chunksCount} potongan knowledge tersimpan dengan status DRAFT. Harap tinjau di Review Center sebelum mengaktifkannya.`,
      versionId,
      chunksCount
    });
  } catch (err) {
    console.error('Upload document error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengunggah dan memproses dokumen.' });
  }
});

export default router;
