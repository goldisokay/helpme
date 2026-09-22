import assert from 'node:assert';
import { checkEmergencySafety, searchKnowledgeChunks, detectSourceConflict } from '../server/services/ragService.js';
import { generateGroundedResponse } from '../server/services/geminiService.js';

console.log('--- RUNNING TEST: RAG RETRIEVAL, SAFETY & GROUNDING ---');

// Test 1: Emergency Safety Detection
const emergencyQuery = 'Korban pingsan tidak sadar dan henti napas di lapangan';
const safetyCheck = checkEmergencySafety(emergencyQuery);
assert.strictEqual(safetyCheck.isEmergency, true, 'Emergency keywords must be detected');
assert(safetyCheck.bannerMessage.includes('PERHATIAN'), 'Banner message must contain warning');

const nonEmergencyQuery = 'Berapa jumlah rongga dalam tubuh manusia menurut anatomi dasar?';
const nonEmergencySafety = checkEmergencySafety(nonEmergencyQuery);
assert.strictEqual(nonEmergencySafety.isEmergency, false, 'Non-emergency query must not trigger safety banner');

// Test 2: RAG Hybrid Search on Active Chunks
const chunks = searchKnowledgeChunks({ query: 'penilaian korban denyut nadi napas' });
assert(chunks.length > 0, 'RAG search must return matching chunks');
const pmiChunk = chunks.find(c => c.source_title === 'Pertolongan Pertama');
assert(pmiChunk, 'Top results must include PMI PMR WIRA official guidebook');
assert(pmiChunk.chapter.toLowerCase().includes('penilaian'), 'Must match Penilaian Korban chapter');
assert(pmiChunk.page_number >= 13, 'Page number must match physical book reference (hal 13-22)');

// Test 3: Grounded Response Generation
const response = await generateGroundedResponse({
  query: 'Bagaimana langkah penilaian penderita?',
  chunks,
  safetyInfo: safetyCheck,
  conflictInfo: { hasConflict: false }
});

assert(response.answer.includes('### 🩹 Jawaban'), 'Response must contain structured section: Jawaban');
assert(response.answer.includes('### 📋 Yang dapat dilakukan'), 'Response must contain structured section: Yang dapat dilakukan');
assert(response.answer.includes('### ⚠️ Perhatikan'), 'Response must contain structured section: Perhatikan');
assert(response.answer.includes('### 📚 Sumber'), 'Response must contain structured section: Sumber');
assert(response.sources.length > 0, 'Response must return verified source citations');

// Test 4: Anti-Hallucination on Irrelevant Query
const irrelevantChunks = searchKnowledgeChunks({ query: 'resep kue coklat kering dan cara memasak opor ayam', minScore: 0.3 });
assert.strictEqual(irrelevantChunks.length, 0, 'Irrelevant query should return no chunks above threshold');

const fallbackResponse = await generateGroundedResponse({
  query: 'resep kue coklat',
  chunks: [],
  safetyInfo: { isEmergency: false },
  conflictInfo: { hasConflict: false }
});
assert(fallbackResponse.answer.includes('belum menemukan informasi yang cukup'), 'Must state insufficient information instead of hallucinating');

console.log('✓ RAG, Safety & Grounding tests passed successfully!');
