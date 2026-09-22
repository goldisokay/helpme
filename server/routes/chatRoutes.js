import { Router } from 'express';
import { db } from '../db/database.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { chatRateLimiter } from '../middleware/rateLimit.js';
import { checkEmergencySafety, searchKnowledgeChunks, detectSourceConflict } from '../services/ragService.js';
import { generateGroundedResponse } from '../services/geminiService.js';
import { logAudit } from '../middleware/audit.js';

const router = Router();

// LIST SESSIONS
router.get('/sessions', authenticateToken, (req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT s.*, 
        (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count,
        (SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) as last_message
      FROM chat_sessions s
      WHERE s.user_id = ?
      ORDER BY s.updated_at DESC
    `).all(req.user.id);

    res.json({ success: true, sessions });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengambil riwayat percakapan.' });
  }
});

// CREATE SESSION
router.post('/sessions', authenticateToken, (req, res) => {
  try {
    const { title = 'Percakapan Baru' } = req.body;
    const result = db.prepare(`
      INSERT INTO chat_sessions (user_id, title)
      VALUES (?, ?)
    `).run(req.user.id, title.trim());

    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, session });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ success: false, error: 'Gagal membuat sesi percakapan.' });
  }
});

// GET SESSION WITH MESSAGES
router.get('/sessions/:id', authenticateToken, (req, res) => {
  try {
    const session = db.prepare(`
      SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Sesi percakapan tidak ditemukan.' });
    }

    const messages = db.prepare(`
      SELECT 
        m.id,
        m.role,
        m.content,
        m.created_at,
        ar.id as ai_response_id,
        ar.model,
        ar.confidence,
        ar.sources_used,
        ar.feedback,
        ar.feedback_reason,
        ar.is_flagged
      FROM chat_messages m
      LEFT JOIN ai_responses ar ON m.id = ar.message_id
      WHERE m.session_id = ?
      ORDER BY m.id ASC
    `).all(session.id);

    // Parse JSON sources_used
    const formattedMessages = messages.map(m => {
      let parsedSources = [];
      if (m.sources_used) {
        try {
          parsedSources = JSON.parse(m.sources_used);
        } catch (e) {}
      }
      return {
        ...m,
        sources_used: parsedSources
      };
    });

    res.json({ success: true, session, messages: formattedMessages });
  } catch (err) {
    console.error('Get session error:', err);
    res.status(500).json({ success: false, error: 'Gagal memuat pesan percakapan.' });
  }
});

// DELETE SESSION
router.delete('/sessions/:id', authenticateToken, (req, res) => {
  try {
    const session = db.prepare(`SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Sesi percakapan tidak ditemukan.' });
    }

    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(session.id);
    res.json({ success: true, message: 'Percakapan berhasil dihapus.' });
  } catch (err) {
    console.error('Delete session error:', err);
    res.status(500).json({ success: false, error: 'Gagal menghapus percakapan.' });
  }
});

// SEND MESSAGE & GET RAG GROUNDED RESPONSE
router.post('/sessions/:id/messages', optionalAuth, chatRateLimiter, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: 'Pesan pertanyaan tidak boleh kosong.' });
    }

    const query = content.trim();

    // Verify session or create anonymous if requested
    let session = null;
    if (sessionId !== 'guest') {
      session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId);
    }

    // 1. First Aid Safety Layer Check
    const safetyInfo = checkEmergencySafety(query);

    // 2. Hybrid Search (FTS5 BM25 + Vector Similarity + Source Priority)
    const retrievedChunks = searchKnowledgeChunks({ query, limit: 5, minScore: 0.15 });

    // 3. Source Conflict Detection
    const conflictInfo = detectSourceConflict(retrievedChunks);

    // 4. Grounded AI Synthesizer / Gemini API Call
    const aiResult = await generateGroundedResponse({
      query,
      chunks: retrievedChunks,
      safetyInfo,
      conflictInfo
    });

    let savedUserMsgId = null;
    let savedAssistantMsgId = null;
    let savedAiRespId = null;

    // Save to database if session exists
    if (session) {
      // Insert user message
      const userMsgRes = db.prepare(`
        INSERT INTO chat_messages (session_id, role, content)
        VALUES (?, 'user', ?)
      `).run(session.id, query);
      savedUserMsgId = Number(userMsgRes.lastInsertRowid);

      // Insert assistant message
      const asstMsgRes = db.prepare(`
        INSERT INTO chat_messages (session_id, role, content)
        VALUES (?, 'assistant', ?)
      `).run(session.id, aiResult.answer);
      savedAssistantMsgId = Number(asstMsgRes.lastInsertRowid);

      // Insert ai_responses log
      const aiRespRes = db.prepare(`
        INSERT INTO ai_responses (message_id, model, confidence, sources_used, retrieved_chunks)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        savedAssistantMsgId,
        aiResult.model,
        aiResult.confidence,
        JSON.stringify(aiResult.sources),
        JSON.stringify(aiResult.knowledge_chunks)
      );
      savedAiRespId = Number(aiRespRes.lastInsertRowid);

      // Update session title if default
      if (session.title === 'Percakapan Baru' || !session.title) {
        const generatedTitle = query.length > 40 ? query.substring(0, 37) + '...' : query;
        db.prepare(`UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?`).run(generatedTitle, session.id);
      } else {
        db.prepare(`UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?`).run(session.id);
      }
    }

    res.json({
      success: true,
      user_message_id: savedUserMsgId,
      assistant_message_id: savedAssistantMsgId,
      ai_response_id: savedAiRespId,
      answer: aiResult.answer,
      sources: aiResult.sources,
      retrieved_chunks: aiResult.knowledge_chunks,
      confidence: aiResult.confidence,
      model: aiResult.model,
      is_emergency: aiResult.isEmergency,
      safety_banner: aiResult.safetyBanner,
      has_conflict: aiResult.hasConflict,
      conflict_message: aiResult.conflictMessage,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ success: false, error: 'Gagal memproses pertanyaan Anda.' });
  }
});

// SUBMIT FEEDBACK (Thumbs Up / Thumbs Down)
router.post('/feedback', optionalAuth, (req, res) => {
  try {
    const { ai_response_id, feedback, feedback_reason } = req.body;

    if (!ai_response_id || !['HELPFUL', 'UNHELPFUL'].includes(feedback)) {
      return res.status(400).json({ success: false, error: 'Parameter feedback tidak valid.' });
    }

    db.prepare(`
      UPDATE ai_responses 
      SET feedback = ?, feedback_reason = ?
      WHERE id = ?
    `).run(feedback, feedback_reason || null, ai_response_id);

    if (req.user) {
      logAudit({
        userId: req.user.id,
        action: 'SUBMIT_AI_FEEDBACK',
        entityType: 'AI_RESPONSE',
        entityId: ai_response_id,
        newData: { feedback, feedback_reason },
        reason: 'Umpan balik pengguna terhadap jawaban AI'
      });
    }

    res.json({ success: true, message: 'Terima kasih atas umpan balik Anda!' });
  } catch (err) {
    console.error('Feedback error:', err);
    res.status(500).json({ success: false, error: 'Gagal mengirimkan feedback.' });
  }
});

// TRACEABILITY: Get detailed chunk origin for an AI response
router.get('/trace/:responseId', (req, res) => {
  try {
    const aiResp = db.prepare('SELECT * FROM ai_responses WHERE id = ?').get(req.params.responseId);
    if (!aiResp) {
      return res.status(404).json({ success: false, error: 'Data respon AI tidak ditemukan.' });
    }

    let chunkIds = [];
    if (aiResp.retrieved_chunks) {
      try {
        chunkIds = JSON.parse(aiResp.retrieved_chunks);
      } catch (e) {}
    }

    let chunkDetails = [];
    if (chunkIds.length > 0) {
      const placeholders = chunkIds.map(() => '?').join(',');
      chunkDetails = db.prepare(`
        SELECT 
          kc.id,
          kc.chapter,
          kc.section,
          kc.page_number,
          kc.content,
          kc.status as chunk_status,
          sv.version as source_version,
          sv.status as version_status,
          sv.file_path,
          s.title as source_title,
          s.authority,
          s.organization
        FROM knowledge_chunks kc
        JOIN source_versions sv ON kc.source_version_id = sv.id
        JOIN sources s ON sv.source_id = s.id
        WHERE kc.id IN (${placeholders})
      `).all(...chunkIds);
    }

    res.json({
      success: true,
      response_id: aiResp.id,
      model: aiResp.model,
      confidence: aiResp.confidence,
      feedback: aiResp.feedback,
      feedback_reason: aiResp.feedback_reason,
      created_at: aiResp.created_at,
      chunks: chunkDetails
    });
  } catch (err) {
    console.error('Trace error:', err);
    res.status(500).json({ success: false, error: 'Gagal menelusuri data sumber.' });
  }
});

export default router;
