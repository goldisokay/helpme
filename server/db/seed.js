import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { db, initDatabase } from './database.js';
import { tokenize, computeTermFrequencies } from '../services/vectorService.js';
import { logAudit } from '../middleware/audit.js';

const ROOT_DIR = process.cwd();

export async function seedDatabase() {
  console.log('--- Memulai Inisialisasi Database HelpMe! ---');
  initDatabase();

  // 1. Seed Users
  console.log('1. Menyiapkan Akun Pengguna & Administrator...');
  const users = [
    {
      name: 'Super Administrator HelpMe',
      username: 'superadmin',
      email: 'superadmin@helpme.pmi.id',
      password: 'SuperAdmin123!',
      role: 'SUPER_ADMIN',
      pmr_level: 'WIRA',
      status: 'ACTIVE'
    },
    {
      name: 'Admin Pembina PMR',
      username: 'admin',
      email: 'admin@helpme.pmi.id',
      password: 'AdminPmr123!',
      role: 'ADMIN',
      pmr_level: 'WIRA',
      status: 'ACTIVE'
    },
    {
      name: 'Ahmad Wira Pratama',
      username: 'wira',
      email: 'wira@helpme.pmi.id',
      password: 'PmrWira123!',
      role: 'USER',
      pmr_level: 'WIRA',
      status: 'ACTIVE'
    }
  ];

  const insertUserStmt = db.prepare(`
    INSERT OR IGNORE INTO users (name, username, email, password_hash, role, pmr_level, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const u of users) {
    const hash = bcrypt.hashSync(u.password, 10);
    insertUserStmt.run(u.name, u.username, u.email, hash, u.role, u.pmr_level, u.status);
  }

  const superAdmin = db.prepare(`SELECT id FROM users WHERE username = 'superadmin'`).get();

  // 2. Seed Sources & Source Versions
  console.log('2. Menyiapkan Sumber Pengetahuan (Sources & Versions)...');

  // SOURCE 1: PMI PMR WIRA 2008 (PRIMARY)
  let pmiSource = db.prepare(`SELECT id FROM sources WHERE title = 'Pertolongan Pertama' AND organization = 'Palang Merah Indonesia'`).get();
  if (!pmiSource) {
    const res = db.prepare(`
      INSERT INTO sources (title, organization, author, country, language, authority, source_type, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Pertolongan Pertama',
      'Palang Merah Indonesia',
      'Pengurus Pusat PMI / Dr. Hj. Ulla Nuchrawaty Usman, MM / Allan Darwis, dr',
      'Indonesia',
      'Bahasa Indonesia',
      'PRIMARY',
      'GUIDEBOOK',
      'Buku pedoman resmi pertolongan pertama untuk anggota Palang Merah Remaja (PMR) tingkat WIRA diterbitkan oleh PMI Pusat (Edisi Pertama, Juni 2008, ISBN 978-979-3575-41-4).'
    );
    pmiSource = { id: Number(res.lastInsertRowid) };
  }

  let pmiVersion = db.prepare(`SELECT id FROM source_versions WHERE source_id = ? AND version = '1.0'`).get();
  if (!pmiVersion) {
    const res = db.prepare(`
      INSERT INTO source_versions (source_id, version, edition, publication_year, effective_date, status, file_path, uploaded_by, approved_by, approved_at, change_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).run(
      pmiSource.id,
      '1.0',
      'Pertama',
      2008,
      '2008-06-01',
      'ACTIVE',
      'Guidebook pertolongan pertama/2.3. PP PMR WIRA.pdf',
      superAdmin.id,
      superAdmin.id,
      'Versi rujukan resmi awal edisi pertama Juni 2008 PMI Pusat.'
    );
    pmiVersion = { id: Number(res.lastInsertRowid) };
  }

  // SOURCE 2: SJA First Aid Reference Guide (SUPPLEMENTARY)
  let sjaSource = db.prepare(`SELECT id FROM sources WHERE title = 'SJA First Aid Reference Guide'`).get();
  if (!sjaSource) {
    const res = db.prepare(`
      INSERT INTO sources (title, organization, author, country, language, authority, source_type, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'SJA First Aid Reference Guide',
      'St. John Ambulance',
      'St. John Ambulance Canada',
      'Canada / International',
      'English',
      'SUPPLEMENTARY',
      'REFERENCE_MANUAL',
      'International comprehensive first aid reference guide covering Emergency Scene Management, CPR, respiratory protocols, bleeding, and shock management.'
    );
    sjaSource = { id: Number(res.lastInsertRowid) };
  }

  let sjaVersion = db.prepare(`SELECT id FROM source_versions WHERE source_id = ? AND version = '1.0'`).get();
  if (!sjaVersion) {
    const res = db.prepare(`
      INSERT INTO source_versions (source_id, version, edition, publication_year, effective_date, status, file_path, uploaded_by, approved_by, approved_at, change_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).run(
      sjaSource.id,
      '1.0',
      'Comprehensive Edition',
      2025,
      '2025-10-01',
      'ACTIVE',
      'Guidebook pertolongan pertama/SJA-First-Aid-Reference-Guide-English.pdf',
      superAdmin.id,
      superAdmin.id,
      'Pedoman pelengkap internasional SJA (Supplementary) untuk skenario medis tambahan.'
    );
    sjaVersion = { id: Number(res.lastInsertRowid) };
  }

  // 3. Seed Categories
  console.log('3. Menyiapkan Kategori Materi Pertolongan Pertama...');
  const categoriesData = [
    { name: 'Dasar-Dasar Pertolongan Pertama', description: 'Pengertian, tujuan, prinsip dasar, dan kewajiban penolong PMR WIRA' },
    { name: 'Alat Perlindungan Diri (APD)', description: 'Peralatan keselamatan diri, kebersihan, dan sterilitas penolong' },
    { name: 'Anatomi dan Faal Dasar', description: 'Struktur tubuh manusia, rongga tubuh, dan sistem organ utama' },
    { name: 'Penilaian Korban (Assessment)', description: 'Penilaian keadaan (3A), penilaian dini, tanda vital, dan riwayat penderita' },
    { name: 'Cedera Jaringan Lunak & Perdarahan', description: 'Perdarahan luar, perdarahan dalam, luka terbuka, dan penutup luka' },
    { name: 'Cedera Sistem Otot Rangka', description: 'Patah tulang, pembidaian, terkilir sendi (sprain), dan dislokasi' },
    { name: 'Luka Bakar', description: 'Penyebab, derajat keparahan, perhitungan luas luka bakar, dan penanganannya' },
    { name: 'Pemindahan & Evakuasi Korban', description: 'Mekanika tubuh penolong, pemindahan darurat, dan teknik tandu' },
    { name: 'Kedaruratan Medis', description: 'Pingsan, sengatan panas (heatstroke), kram panas, dan hipotermia' },
    { name: 'Keracunan', description: 'Jalur masuk racun ke tubuh, gejala umum, gigitan ular, dan tindakan pertama' },
    { name: 'Rujukan Internasional (SJA Supplementary)', description: 'Protokol scene management internasional dan CPR St. John Ambulance' }
  ];

  const insertCatStmt = db.prepare(`
    INSERT OR IGNORE INTO categories (name, description, status)
    VALUES (?, ?, 'ACTIVE')
  `);
  for (const c of categoriesData) {
    insertCatStmt.run(c.name, c.description);
  }

  // Map category names to IDs
  const catMap = {};
  const allCats = db.prepare(`SELECT id, name FROM categories`).all();
  for (const c of allCats) {
    catMap[c.name] = c.id;
  }

  // 4. Ingest PDF Documents and Populate Knowledge Chunks & Materials
  console.log('4. Mengekstrak dan Mengindeks Dokumen PDF...');

  const pmiPdfPath = path.join(ROOT_DIR, 'Guidebook pertolongan pertama/2.3. PP PMR WIRA.pdf');
  const sjaPdfPath = path.join(ROOT_DIR, 'Guidebook pertolongan pertama/SJA-First-Aid-Reference-Guide-English.pdf');

  // Check if chunks already populated
  const existingChunksCount = db.prepare(`SELECT COUNT(*) as cnt FROM knowledge_chunks`).get().cnt;
  if (existingChunksCount === 0) {
    // Ingest PMI PDF
    console.log('   Mengekstrak Dokumen PMI PMR WIRA 2008...');
    try {
      const pmiText = execSync(`pdftotext "${pmiPdfPath}" -`, { maxBuffer: 20 * 1024 * 1024 }).toString();
      const pmiPages = pmiText.split('\x0c');

      // Define chapter ranges according to physical book numbering
      // PDF page 9 = Book page 1
      const pmiChapters = [
        {
          chapter: 'Pentingnya Pertolongan Pertama',
          categoryName: 'Dasar-Dasar Pertolongan Pertama',
          startPdfPage: 9,
          endPdfPage: 12,
          bookStartPage: 1,
          summary: 'Dasar hukum, pengertian pertolongan pertama, tujuan pertolongan, dan 6 kewajiban pelaku pertolongan pertama PMR WIRA.'
        },
        {
          chapter: 'Alat Perlindungan Diri (APD)',
          categoryName: 'Alat Perlindungan Diri (APD)',
          startPdfPage: 13,
          endPdfPage: 14,
          bookStartPage: 5,
          summary: 'Peralatan perlindungan diri penting seperti sarung tangan lateks, masker penolong, kacamata pelindung, dan pembersih tangan.'
        },
        {
          chapter: 'Mengenali Anatomi dan Faal Dasar',
          categoryName: 'Anatomi dan Faal Dasar',
          startPdfPage: 15,
          endPdfPage: 20,
          bookStartPage: 7,
          summary: 'Posisi anatomis, bidang anatomis tubuh, 5 rongga tubuh manusia, dan 11 sistem tubuh penting.'
        },
        {
          chapter: 'Penilaian Korban',
          categoryName: 'Penilaian Korban (Assessment)',
          startPdfPage: 21,
          endPdfPage: 30,
          bookStartPage: 13,
          summary: 'Langkah penilaian lengkap: Penilaian Keadaan (Aman Diri, Lingkungan, Korban), Penilaian Dini (Respon ASNT), Tanda Vital (Nadi, Napas, Suhu), Riwayat Penderita (KOMPAK), dan Pemeriksaan Berkala.'
        },
        {
          chapter: 'Cedera Jaringan Lunak',
          categoryName: 'Cedera Jaringan Lunak & Perdarahan',
          startPdfPage: 31,
          endPdfPage: 34,
          bookStartPage: 23,
          summary: 'Klasifikasi luka tertutup dan luka terbuka, penanganan perdarahan luar dengan penekanan langsung, elevasi, dan penanganan perdarahan dalam.'
        },
        {
          chapter: 'Cedera Sistem Otot Rangka',
          categoryName: 'Cedera Sistem Otot Rangka',
          startPdfPage: 35,
          endPdfPage: 40,
          bookStartPage: 27,
          summary: 'Patah tulang (fraktur), prinsip dan pedoman umum pembidaian, terkilir sendi (sprain), serta pertolongan cedera anggota gerak.'
        },
        {
          chapter: 'Luka Bakar',
          categoryName: 'Luka Bakar',
          startPdfPage: 41,
          endPdfPage: 44,
          bookStartPage: 33,
          summary: 'Penyebab luka bakar (termal, kimia, listrik, radiasi), pengelompokan derajat 1, 2, dan 3, rumus luas permukaan Rule of Nines, dan penanganan luka bakar dengan air mengalir.'
        },
        {
          chapter: 'Pemindahan Korban',
          categoryName: 'Pemindahan & Evakuasi Korban',
          startPdfPage: 45,
          endPdfPage: 50,
          bookStartPage: 37,
          summary: 'Prinsip mekanika tubuh penolong, pemindahan darurat (tarikan baju, tarikan selimut), pemindahan biasa, serta teknik penggunaan tandu.'
        },
        {
          chapter: 'Kedaruratan Medis',
          categoryName: 'Kedaruratan Medis',
          startPdfPage: 51,
          endPdfPage: 56,
          bookStartPage: 43,
          summary: 'Gejala dan penanganan kasus pingsan (sinkop), paparan panas (kejang panas, kelelahan panas, sengatan panas / heatstroke), dan paparan dingin (hipotermia).'
        },
        {
          chapter: 'Keracunan',
          categoryName: 'Keracunan',
          startPdfPage: 57,
          endPdfPage: 60,
          bookStartPage: 49,
          summary: 'Definisi racun, jalur masuk racun (pencernaan, pernapasan, kontak kulit, suntikan/gigitan), gejala umum keracunan, dan pertolongan pertama gigitan ular.'
        }
      ];

      const insertChunkStmt = db.prepare(`
        INSERT INTO knowledge_chunks (source_version_id, material_id, chapter, section, page_number, content, embedding, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
      `);

      const insertFtsStmt = db.prepare(`
        INSERT INTO knowledge_chunks_fts (chunk_id, chapter, section, content)
        VALUES (?, ?, ?, ?)
      `);

      const insertMaterialStmt = db.prepare(`
        INSERT INTO materials (category_id, title, summary, content, status, current_version_id)
        VALUES (?, ?, ?, ?, 'ACTIVE', NULL)
      `);

      const insertMatVersionStmt = db.prepare(`
        INSERT INTO material_versions (material_id, version, content, source_version_id, change_reason, created_by, approved_by, status)
        VALUES (?, '1.0', ?, ?, 'Inisialisasi materi dari buku panduan resmi PMI WIRA 2008', ?, ?, 'ACTIVE')
      `);

      for (const ch of pmiChapters) {
        // Gather full text for material
        let fullChapterContent = '';
        const chunkEntries = [];

        for (let pIdx = ch.startPdfPage - 1; pIdx < ch.endPdfPage; pIdx++) {
          const pageRaw = pmiPages[pIdx] || '';
          const cleanedText = pageRaw
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .join('\n');

          if (!cleanedText) continue;

          const bookPageNum = ch.bookStartPage + (pIdx - (ch.startPdfPage - 1));
          fullChapterContent += `\n\n--- Halaman ${bookPageNum} ---\n` + cleanedText;

          chunkEntries.push({
            chapter: ch.chapter,
            section: `Halaman ${bookPageNum}`,
            pageNumber: bookPageNum,
            content: cleanedText
          });
        }

        // Create Material
        const catId = catMap[ch.categoryName] || null;
        const matRes = insertMaterialStmt.run(catId, ch.chapter, ch.summary, fullChapterContent.trim());
        const matId = Number(matRes.lastInsertRowid);

        // Create Material Version
        const mvRes = insertMatVersionStmt.run(matId, fullChapterContent.trim(), pmiVersion.id, superAdmin.id, superAdmin.id);
        const mvId = Number(mvRes.lastInsertRowid);

        // Update current_version_id
        db.prepare(`UPDATE materials SET current_version_id = ? WHERE id = ?`).run(mvId, matId);

        // Insert Chunks for this chapter
        for (const chunk of chunkEntries) {
          const tokens = tokenize(chunk.content);
          const tf = computeTermFrequencies(tokens);
          const embJson = JSON.stringify(tf);

          const cRes = insertChunkStmt.run(
            pmiVersion.id,
            matId,
            chunk.chapter,
            chunk.section,
            chunk.pageNumber,
            chunk.content,
            embJson
          );
          const cId = Number(cRes.lastInsertRowid);
          insertFtsStmt.run(cId, chunk.chapter, chunk.section, chunk.content);
        }
      }
      console.log('   Dokumen PMI PMR WIRA berhasil diekstrak dan diindeks.');
    } catch (err) {
      console.error('Error saat ekstraksi PMI PDF:', err);
    }

    // Ingest SJA Guidebook Key Sections (Supplementary)
    console.log('   Mengekstrak Dokumen SJA First Aid Reference Guide (Supplementary)...');
    try {
      const sjaCatId = catMap['Rujukan Internasional (SJA Supplementary)'] || null;
      // Extract key chapters from SJA:
      // Chapter 2: Emergency Scene Management (p. 37-75)
      // Chapter 3: Breathing Emergencies & Choking (p. 76-99)
      // Chapter 5: Cardiac Arrest, CPR, AED & Shock (p. 113-140)
      const sjaKeyRanges = [
        {
          title: 'SJA: Emergency Scene Management (ESM Steps)',
          chapter: 'Emergency Scene Management (ESM)',
          startPage: 37,
          endPage: 54,
          summary: 'St. John Ambulance standard 4-step Emergency Scene Management: Scene survey, Primary survey, Secondary survey, and Ongoing casualty care.'
        },
        {
          title: 'SJA: Respiratory Emergencies & Choking Protocol',
          chapter: 'Breathing Emergencies & Choking',
          startPage: 76,
          endPage: 99,
          summary: 'Recognition and first aid protocol for breathing emergencies, hyperventilation, asthma, anaphylaxis, and conscious/unconscious choking.'
        },
        {
          title: 'SJA: CPR, AED & Shock Management Protocols',
          chapter: 'Cardiac Arrest & CPR Protocols',
          startPage: 113,
          endPage: 135,
          summary: 'International guidelines for Adult/Child/Infant CPR (Cardiopulmonary Resuscitation), Automated External Defibrillator (AED) usage, and shock recognition.'
        }
      ];

      for (const sjaItem of sjaKeyRanges) {
        const sjaText = execSync(
          `pdftotext -f ${sjaItem.startPage} -l ${sjaItem.endPage} "${sjaPdfPath}" -`,
          { maxBuffer: 20 * 1024 * 1024 }
        ).toString();

        const sjaPages = sjaText.split('\x0c');
        let fullSjaContent = '';
        const sjaChunks = [];

        for (let i = 0; i < sjaPages.length; i++) {
          const pgText = sjaPages[i].trim();
          if (!pgText) continue;
          const actualPage = sjaItem.startPage + i;
          fullSjaContent += `\n\n--- Page ${actualPage} ---\n` + pgText;

          sjaChunks.push({
            chapter: sjaItem.chapter,
            section: `Page ${actualPage}`,
            pageNumber: actualPage,
            content: pgText
          });
        }

        // Insert Material
        const matRes = db.prepare(`
          INSERT INTO materials (category_id, title, summary, content, status, current_version_id)
          VALUES (?, ?, ?, ?, 'ACTIVE', NULL)
        `).run(sjaCatId, sjaItem.title, sjaItem.summary, fullSjaContent.trim());
        const matId = Number(matRes.lastInsertRowid);

        const mvRes = db.prepare(`
          INSERT INTO material_versions (material_id, version, content, source_version_id, change_reason, created_by, approved_by, status)
          VALUES (?, '1.0', ?, ?, 'Supplementary international guidelines from St. John Ambulance', ?, ?, 'ACTIVE')
        `).run(matId, fullSjaContent.trim(), sjaVersion.id, superAdmin.id, superAdmin.id);
        const mvId = Number(mvRes.lastInsertRowid);

        db.prepare(`UPDATE materials SET current_version_id = ? WHERE id = ?`).run(mvId, matId);

        // Insert Chunks
        const insertChunkStmt = db.prepare(`
          INSERT INTO knowledge_chunks (source_version_id, material_id, chapter, section, page_number, content, embedding, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
        `);
        const insertFtsStmt = db.prepare(`
          INSERT INTO knowledge_chunks_fts (chunk_id, chapter, section, content)
          VALUES (?, ?, ?, ?)
        `);

        for (const chk of sjaChunks) {
          const tokens = tokenize(chk.content);
          const tf = computeTermFrequencies(tokens);
          const embJson = JSON.stringify(tf);

          const cRes = insertChunkStmt.run(
            sjaVersion.id,
            matId,
            chk.chapter,
            chk.section,
            chk.pageNumber,
            chk.content,
            embJson
          );
          const cId = Number(cRes.lastInsertRowid);
          insertFtsStmt.run(cId, chk.chapter, chk.section, chk.content);
        }
      }
      console.log('   Dokumen SJA First Aid Reference Guide berhasil diekstrak dan diindeks.');
    } catch (err) {
      console.error('Error saat ekstraksi SJA PDF:', err);
    }
  } else {
    console.log(`   Database telah memiliki ${existingChunksCount} knowledge chunks terindeks.`);
  }

  // 5. Initial Audit Log
  logAudit({
    userId: superAdmin.id,
    action: 'INITIAL_SEED_AND_INGESTION',
    entityType: 'SYSTEM',
    entityId: 1,
    newData: {
      sources: 2,
      categories: categoriesData.length,
      status: 'INITIALIZED'
    },
    reason: 'Sistem HelpMe! berhasil diinisialisasi dengan sumber PMI PMR WIRA 2008 & SJA Reference Guide.'
  });

  console.log('--- Inisialisasi Database HelpMe! Selesai Sukses! ---');
}
