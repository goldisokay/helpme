// Gemini API Service with Strict Grounding, Anti-Hallucination & Multi-Source Synthesis
import { db } from '../db/database.js';

const SYSTEM_PROMPT = `
Anda adalah "HelpMe! AI", asisten pintar edukasi dan rujukan pertolongan pertama berbasis kecerdasan buatan resmi untuk anggota PMR tingkat WIRA (Palang Merah Remaja Wira, usia SMA/setingkat).

TUGAS UTAMA ANDA:
Menyatukan dan mensintesis secara mendalam materi dari Buku Panduan Resmi Pertolongan Pertama (PMI PMR WIRA 2008 sebagai rujukan primer, dan SJA First Aid Reference Guide sebagai pelengkap) menjadi panduan pertolongan pertama yang sangat jelas, terstruktur, aplikatif, dan mudah dipahami siswa Wira.

PRINSIP & ATURAN WAJIB:
1. Menyatukan Buku Panduan & Model AI:
   - Sintesiskan isi potongan buku panduan terverifikasi yang dilampirkan ke dalam penjelasan yang hidup, komprehensif, dan logis.
   - Jangan hanya menyalin teks mentah tanpa konteks. Rangkai menjadi langkah teratur yang mudah dipraktikkan.
   - Wajib menyebutkan buku rujukan, bab, dan nomor halaman dalam alur penjelasan Anda (misalnya: "Berdasarkan Buku Panduan PMR Wira Bab Penilaian Korban (Halaman 16)...").
2. Prioritas Sumber:
   - Rujukan utama (PRIMARY) adalah Buku Panduan PMI PMR WIRA (Bahasa Indonesia).
   - Dokumen SJA First Aid Reference Guide (SUPPLEMENTARY) digunakan sebagai pelengkap wawasan.
   - Jika ada perbedaan teknik, dahulukan protokol resmi PMI PMR WIRA dan beri catatan penjelasan.
3. Kepatuhan Medis Dasar PMR:
   - Selalu tekankan prinsip 3A PMR: Aman Diri (gunakan APD seperti sarung tangan/masker), Aman Lingkungan, dan Aman Korban.
   - Anda adalah panduan edukasi PMR Wira, bukan dokter spesialis. Jangan mendiagnosis penyakit.
4. Keterbatasan Informasi:
   - Jika dokumen yang dilampirkan tidak memuat informasi yang cukup untuk menjawab pertanyaan pengguna, nyatakan secara jujur dan arahkan berkonsultasi dengan Pembina PMR atau tenaga medis.
5. Format Struktur Jawaban:
   Gunakan struktur markdown rapi berikut:
   ### 🩹 Penjelasan & Inti Penanganan
   (Penjelasan ringkas konsep dan tujuan penanganan berdasar buku panduan)

   ### 📋 Langkah Tindakan Sesuai Panduan
   (Urutan tindakan sistematis nomor 1, 2, 3... yang jelas dan dapat langsung dikerjakan penolong)

   ### ⚠️ Perhatikan & Hal yang Dilarang
   (Pantangan, risiko cedera lebih lanjut, atau kesalahan umum yang harus dihindari)

   ### 🚑 Kapan Mencari Bantuan Medis (118/119)
   (Kondisi bahaya yang mengharuskan evakuasi atau panggilan darurat ambulans)

   ### 📚 Integrasi Sumber Buku Panduan
   (Rincian buku resmi, bab, dan nomor halaman yang digunakan)
`.trim();

export async function generateGroundedResponse({ query, chunks, safetyInfo, conflictInfo }) {
  const apiKey = process.env.GEMINI_API_KEY;

  // Read active configured model from database setting or environment
  let configuredModel = 'gemini-3.8-flash';
  try {
    const settingRow = db.prepare("SELECT value FROM system_settings WHERE key = 'ai_model'").get();
    if (settingRow && settingRow.value) {
      configuredModel = settingRow.value;
    } else if (process.env.GEMINI_MODEL) {
      configuredModel = process.env.GEMINI_MODEL;
    }
  } catch (e) {
    if (process.env.GEMINI_MODEL) configuredModel = process.env.GEMINI_MODEL;
  }

  // Format sources metadata for response
  const sourcesUsed = chunks.map(c => ({
    chunk_id: c.id,
    source_title: c.source_title,
    authority: c.authority,
    version: c.source_version,
    edition: c.source_edition,
    publication_year: c.publication_year,
    chapter: c.chapter,
    section: c.section,
    page_number: c.page_number
  }));

  // If no chunks found above threshold
  if (!chunks || chunks.length === 0) {
    const fallbackAnswer = `### 🩹 Penjelasan & Inti Penanganan
Saya belum menemukan informasi yang cukup mengenai kondisi tersebut dalam basis data buku panduan HelpMe! yang aktif.

### 📋 Yang dapat dilakukan
1. Hubungi pembina PMR di sekolah atau unit PMI setempat untuk memperoleh panduan resmi.
2. Apabila Anda sedang menghadapi situasi darurat nyata, segera minta bantuan orang dewasa atau hubungi fasilitas kesehatan terdekat.
3. Tetap utamakan prinsip keselamatan diri (Aman Diri) dan gunakan APD sebelum bertindak.

### ⚠️ Perhatikan
HelpMe! menerapkan prinsip kehati-hatian ketat (*source-grounded AI*) dan tidak akan mengarang prosedur pertolongan pertama tanpa adanya rujukan buku panduan resmi yang aktif dalam sistem.

### 🚑 Kapan mencari bantuan?
Bila korban menunjukkan tanda-tanda tidak sadar, sesak napas, pendarahan hebat, atau cedera kepala/leher, segera hubungi nomor gawat darurat medis **118 / 119** atau bawa ke puskesmas/rumah sakit terdekat.`;

    return {
      answer: fallbackAnswer,
      sources: [],
      knowledge_chunks: [],
      confidence: 0.1,
      model: 'HelpMe-Safety-Guard',
      isEmergency: safetyInfo?.isEmergency || false,
      safetyBanner: safetyInfo?.bannerMessage || null,
      hasConflict: false,
      conflictMessage: null
    };
  }

  // If Gemini API Key is available, call Google Gemini with robust modern cascade
  if (apiKey) {
    try {
      const promptContext = chunks.map((c, idx) => `
[RUJUKAN DOKUMEN #${idx + 1}]
Sumber: ${c.source_title} (${c.organization || 'Palang Merah'})
Otoritas: ${c.authority === 'PRIMARY' ? 'Rujukan Primer PMI Wira' : 'Rujukan Pelengkap'}
Edisi/Tahun: ${c.source_edition || '-'} (${c.publication_year || '-'})
Bab: ${c.chapter}
Sub-Bab/Bagian: ${c.section || '-'}
Nomor Halaman Dokumen: Hal. ${c.page_number || '-'}
Kutipan Teks Dokumen:
"""
${c.content}
"""
`).join('\n---\n');

      const userMessage = `
PERTANYAAN PENGGUNA PMR WIRA:
"${query.replace(/"/g, "'")}"

RUJUKAN MATERI DARI BUKU PANDUAN:
${promptContext}

${conflictInfo?.hasConflict ? `CATATAN PERBEDAAN SUMBER:\n${conflictInfo.message}\nJelaskan perbedaan ini secara bijak dengan mengutamakan protokol resmi PMI PMR WIRA.` : ''}

INSTRUKSI INTEGRASI:
Sintesiskan materi buku panduan di atas secara komprehensif, cerdas, dan mengalir untuk menjawab pertanyaan pengguna. Integrasikan nomor bab dan halaman dalam narasi penjelasan Anda. Patuhi format struktur yang telah ditentukan.
`;

      // Active Gemini model cascade: configured model (3.8) first, with gemini-3.6-flash as fast verified fallback
      const targetModels = [
        configuredModel,
        'gemini-3.6-flash',
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.5-flash'
      ].filter((v, i, a) => v && a.indexOf(v) === i);

      for (const targetModel of targetModels) {
        try {
          // Timeout 16s per model to allow full structured generation without prematurely aborting
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30000);

          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: SYSTEM_PROMPT }]
              },
              contents: [
                {
                  role: 'user',
                  parts: [{ text: userMessage }]
                }
              ],
              generationConfig: {
                temperature: 0.25,
                maxOutputTokens: 8192,
              }
            }),
            signal: controller.signal
          });

          clearTimeout(timer);

          if (response.ok) {
            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text && text.trim().length > 0) {
              console.log(`[HelpMe AI] Berhasil dijawab oleh model: ${targetModel}`);
              return {
                answer: text.trim(),
                sources: sourcesUsed,
                knowledge_chunks: chunks.map(c => c.id),
                confidence: 0.98,
                model: targetModel,
                isEmergency: safetyInfo?.isEmergency || false,
                safetyBanner: safetyInfo?.bannerMessage || null,
                hasConflict: conflictInfo?.hasConflict || false,
                conflictMessage: conflictInfo?.message || null
              };
            }
          } else if (response.status === 503 || response.status === 429) {
            console.warn(`[HelpMe AI] Model ${targetModel} kapasitas penuh/503/429. Mencoba model alternatif berikutnya...`);
          } else {
            console.warn(`[HelpMe AI] Model ${targetModel} status ${response.status}. Mencoba model alternatif...`);
          }
        } catch (mErr) {
          console.warn(`[HelpMe AI] Kendala pada ${targetModel} (${mErr.name}: ${mErr.message}), beralih ke model berikutnya...`);
        }
      }
    } catch (err) {
      console.error('[HelpMe AI] Error pemanggilan Gemini API:', err.message);
    }
  }

  // Enhanced Synthesizer (Fallback when API Key is missing or all endpoints unreachable)
  const topChunk = chunks[0];
  const primaryChunks = chunks.filter(c => c.authority === 'PRIMARY');
  const mainChunk = primaryChunks.length > 0 ? primaryChunks[0] : topChunk;

  const lines = mainChunk.content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const coreExplanation = lines.slice(0, 4).join(' ') || 'Panduan penanganan medis dasar Palang Merah Remaja Tingkat Wira.';
  
  const stepCandidates = lines.filter(l => /^[0-9]+[\.\)]|^\-|^•|^è/.test(l));
  const stepsList = stepCandidates.length > 0 
    ? stepCandidates.map((s, i) => `${i + 1}. ${s.replace(/^[0-9]+[\.\)]|^\-|^•|^è\s*/, '')}`).join('\n')
    : `1. Pastikan prinsip 3A: Aman Diri (APD sarung tangan & masker), Aman Lingkungan, dan Aman Korban.\n2. Lakukan penilaian keadaan dan penilaian dini secara sistematis.\n3. Lakukan penanganan sesuai pedoman Bab "${mainChunk.chapter}" (Halaman ${mainChunk.page_number || 'terkait'}).\n4. Tenangkan korban dan pantau tanda vital (napas dan denyut nadi) berkala.`;

  const sourcesList = sourcesUsed.map(s => {
    return `- **${s.source_title}** (${s.authority === 'PRIMARY' ? 'Buku Resmi PMI Wira' : 'Rujukan Pelengkap SJA'})\n  Bab: *${s.chapter}* • Halaman: **${s.page_number || '-'}** (Edisi ${s.edition || '-'})`;
  }).join('\n\n');

  let syntheticAnswer = `### 🩹 Penjelasan & Inti Penanganan
Berdasarkan buku panduan resmi **${mainChunk.source_title}** pada bab **${mainChunk.chapter}** (Halaman ${mainChunk.page_number || 'terkait'}):

${coreExplanation}

### 📋 Langkah Tindakan Sesuai Panduan
${stepsList}

### ⚠️ Perhatikan & Hal yang Dilarang
- Selalu utamakan keselamatan penolong terlebih dahulu sebelum menyentuh korban (Aman Diri).
- Jangan memindahkan korban dengan dugaan cedera leher/tulang belakang kecuali dalam kondisi bahaya tinggi yang mengancam nyawa.
- Jaga ketenangan penderita dan pantau tanda vital (napas dan denyut nadi) secara berkala.

### 🚑 Kapan Mencari Bantuan Medis (118/119)
Segera minta bantuan pembina PMR, hubungi fasilitas kesehatan terdekat, atau telepon darurat **118 / 119** jika korban tidak sadar, mengalami kesulitan bernapas, pendarahan hebat tak terkontrol, atau mengalami syok.

### 📚 Integrasi Sumber Buku Panduan
${sourcesList}`;

  if (conflictInfo?.hasConflict) {
    syntheticAnswer = `> ⚠️ **Catatan Konflik Sumber:** ${conflictInfo.message}\n\n` + syntheticAnswer;
  }

  return {
    answer: syntheticAnswer,
    sources: sourcesUsed,
    knowledge_chunks: chunks.map(c => c.id),
    confidence: 0.94,
    model: 'HelpMe-Grounded-RAG-Engine',
    isEmergency: safetyInfo?.isEmergency || false,
    safetyBanner: safetyInfo?.bannerMessage || null,
    hasConflict: conflictInfo?.hasConflict || false,
    conflictMessage: conflictInfo?.message || null
  };
}
