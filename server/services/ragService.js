import { db } from '../db/database.js';
import { tokenize, computeTermFrequencies, cosineSimilarity } from './vectorService.js';

// Emergency and Life-Threatening keywords for safety layer
const EMERGENCY_KEYWORDS = [
  'tidak sadar', 'pingsan', 'koma', 'henti napas', 'sesak napas parah', 'tersedak',
  'henti jantung', 'cpr', 'rjp', 'darah menyembur', 'perdarahan hebat', 'syok',
  'kejang', 'keracunan', 'gigitan ular', 'patah tulang terbuka', 'cedera leher',
  'unconscious', 'cardiac arrest', 'severe bleeding', 'choking', 'poisoning'
];

export function checkEmergencySafety(query) {
  const lower = query.toLowerCase();
  const matched = EMERGENCY_KEYWORDS.filter(kw => lower.includes(kw));
  if (matched.length > 0) {
    return {
      isEmergency: true,
      matchedKeywords: matched,
      bannerMessage: '⚠️ PERHATIAN KEDARURATAN MEDIS: Informasi ini adalah panduan edukasi PMR WIRA dan bukan pengganti tindakan medis profesional. Jika kondisi korban tampak serius, tidak sadar, sesak berat, atau mengancam nyawa, SEGERA minta bantuan orang dewasa, pembina PMR, tenaga kesehatan, atau hubungi Layanan Ambulans / Darurat 118 / 119!'
    };
  }
  return {
    isEmergency: false,
    matchedKeywords: [],
    bannerMessage: null
  };
}

export function searchKnowledgeChunks({ query, limit = 5, minScore = 0.15 }) {
  const cleanQuery = query.replace(/[^\w\s-]/g, ' ').trim();
  if (!cleanQuery) return [];

  const queryTokens = tokenize(cleanQuery);
  const queryTf = computeTermFrequencies(queryTokens);

  // 1. FTS5 Search on active chunks
  // Join with source_versions and sources to ensure source is ACTIVE and retrieve authority
  const ftsSearchSql = `
    SELECT 
      kc.id,
      kc.chapter,
      kc.section,
      kc.page_number,
      kc.content,
      kc.embedding,
      kc.source_version_id,
      s.title as source_title,
      s.organization,
      s.authority,
      s.country,
      s.language,
      sv.version as source_version,
      sv.edition as source_edition,
      sv.publication_year,
      rank as fts_rank
    FROM knowledge_chunks_fts fts
    JOIN knowledge_chunks kc ON fts.chunk_id = kc.id
    JOIN source_versions sv ON kc.source_version_id = sv.id
    JOIN sources s ON sv.source_id = s.id
    WHERE fts.knowledge_chunks_fts MATCH ?
      AND kc.status = 'ACTIVE'
      AND sv.status = 'ACTIVE'
    ORDER BY rank
    LIMIT 25
  `;

  let ftsResults = [];
  try {
    // Format fts query with OR or prefixes
    const ftsQuery = queryTokens.map(t => `"${t}"*`).join(' OR ');
    if (ftsQuery) {
      ftsResults = db.prepare(ftsSearchSql).all(ftsQuery);
    }
  } catch (e) {
    // If fts matching syntax errors out on complex punctuation, fallback gracefully
    console.warn('FTS5 query notice:', e.message);
  }

  // 2. Fetch all active chunks for vector scoring if FTS returned few results
  const allActiveChunksSql = `
    SELECT 
      kc.id,
      kc.chapter,
      kc.section,
      kc.page_number,
      kc.content,
      kc.embedding,
      kc.source_version_id,
      s.title as source_title,
      s.organization,
      s.authority,
      s.country,
      s.language,
      sv.version as source_version,
      sv.edition as source_edition,
      sv.publication_year
    FROM knowledge_chunks kc
    JOIN source_versions sv ON kc.source_version_id = sv.id
    JOIN sources s ON sv.source_id = s.id
    WHERE kc.status = 'ACTIVE'
      AND sv.status = 'ACTIVE'
  `;
  const allChunks = db.prepare(allActiveChunksSql).all();

  // Combine and score
  const scoredMap = new Map();

  // Process FTS scores
  for (const row of ftsResults) {
    // FTS rank in sqlite fts5 is negative, closer to 0 is better
    const ftsScore = Math.min(1.0, Math.max(0.1, 1.0 / (1.0 + Math.abs(row.fts_rank || 0))));
    scoredMap.set(row.id, {
      ...row,
      ftsScore,
      vectorScore: 0,
      finalScore: 0
    });
  }

  // Process vector similarity scores
  for (const chunk of allChunks) {
    let chunkTf = {};
    if (chunk.embedding) {
      try {
        chunkTf = JSON.parse(chunk.embedding);
      } catch (e) {
        chunkTf = computeTermFrequencies(tokenize(chunk.content));
      }
    } else {
      chunkTf = computeTermFrequencies(tokenize(chunk.content));
    }

    const vecSim = cosineSimilarity(queryTf, chunkTf);
    if (vecSim > 0.05 || scoredMap.has(chunk.id)) {
      const existing = scoredMap.get(chunk.id) || {
        ...chunk,
        ftsScore: 0,
        vectorScore: 0,
        finalScore: 0
      };
      existing.vectorScore = vecSim;
      scoredMap.set(chunk.id, existing);
    }
  }

  // Calculate final score with Source Priority Multiplier
  // Prioritas 1 & 2: PMI WIRA (PRIMARY) -> 1.5x multiplier
  // Prioritas 3 & 4: SJA (SUPPLEMENTARY) -> 1.0x multiplier
  const results = [];
  for (const item of scoredMap.values()) {
    let priorityMultiplier = 1.0;
    if (item.authority === 'PRIMARY') {
      priorityMultiplier = 1.5;
    } else if (item.authority === 'SECONDARY') {
      priorityMultiplier = 1.25;
    } else if (item.authority === 'SUPPLEMENTARY') {
      priorityMultiplier = 1.0;
    } else {
      priorityMultiplier = 0.8;
    }

    // Hybrid formula: (0.4 * ftsScore + 0.6 * vectorScore) * priorityMultiplier
    const rawScore = (item.ftsScore * 0.4 + item.vectorScore * 0.6);
    item.finalScore = rawScore * priorityMultiplier;

    if (item.finalScore >= minScore) {
      results.push(item);
    }
  }

  results.sort((a, b) => b.finalScore - a.finalScore);
  return results.slice(0, limit);
}

export function detectSourceConflict(chunks) {
  if (!chunks || chunks.length < 2) return { hasConflict: false };

  const sources = new Set(chunks.map(c => c.source_title));
  if (sources.size > 1) {
    // Check if there are different authorities present (e.g. PRIMARY vs SUPPLEMENTARY)
    const hasPrimary = chunks.some(c => c.authority === 'PRIMARY');
    const hasSupplementary = chunks.some(c => c.authority === 'SUPPLEMENTARY');

    if (hasPrimary && hasSupplementary) {
      return {
        hasConflict: true,
        message: 'Terdapat perbedaan informasi atau terminologi antara sumber resmi PMI dan sumber pelengkap (SJA). Sistem memprioritaskan panduan resmi PMI WIRA sebagai rujukan utama.'
      };
    }
  }

  return { hasConflict: false };
}
