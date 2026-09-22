# 🚑 HelpMe! — Panduan Pertolongan Pertama untuk PMR WIRA

> **Tagline:** *"Panduan Pertolongan Pertama untuk PMR WIRA"*  
> **Platform:** Web Application & Grounded RAG Assistant  
> **Sasaran:** Anggota Palang Merah Remaja (PMR) Tingkat WIRA (SMA/Sederajat)

---

## 1. Tentang HelpMe!

**HelpMe!** adalah platform edukasi dan asisten rujukan cerdas pertolongan pertama yang dibangun khusus untuk anggota PMR tingkat WIRA di Indonesia. Berbeda dari chatbot umum yang sering kali berhalusinasi atau mencampuradukkan standar medis, HelpMe! menerapkan konsep **Source of Truth** yang sangat ketat: setiap jawaban AI berlandaskan pada dokumen panduan resmi yang telah diverifikasi oleh administrator, dengan rujukan bab dan nomor halaman fisik yang jelas.

### Sumber Knowledge Base Awal:
1. **Pertolongan Pertama — Palang Merah Remaja Tingkat Wira** *(Otoritas: PRIMARY)*
   - Penerbit: Palang Merah Indonesia (PMI) Pusat
   - Edisi: Pertama, Juni 2008
   - ISBN: `978-979-3575-41-4`
   - Berkas Asal: `Guidebook pertolongan pertama/2.3. PP PMR WIRA.pdf`
2. **SJA First Aid Reference Guide — English** *(Otoritas: SUPPLEMENTARY)*
   - Penerbit: St. John Ambulance
   - Status: Rujukan Pelengkap Internasional (Supplementary)
   - Berkas Asal: `Guidebook pertolongan pertama/SJA-First-Aid-Reference-Guide-English.pdf`

---

## 2. Arsitektur Sistem

```text
Pengguna / Anggota PMR
       ↓
Input Pertanyaan
       ↓
Safety Layer (Deteksi Kedaruratan & Banner Medis)
       ↓
Hybrid Search Engine (FTS5 BM25 + Vector Cosine Similarity)
       ↓
Penyaringan Prioritas Sumber (Status = ACTIVE, Bobot PMI PRIMARY > SJA SUPPLEMENTARY)
       ↓
Deteksi Konflik Sumber (Conflict Detection)
       ↓
Google Gemini API / Grounded Synthesizer Server-Side
       ↓
Jawaban Terstruktur + Sitasi Sumber & Halaman Buku Fisik + Traceability
       ↓
Penyimpanan Riwayat Sesi, Log AI, Audit Trail & Feedback Pengguna
```

---

## 3. Komponen Teknologi

- **Backend:** Node.js (v26) & Express.js.
- **Database:** SQLite 3 murni via `node:sqlite` (DatabaseSync) dengan modul **FTS5 (Full-Text Search)** untuk performa tinggi tanpa dependensi kompilasi eksternal.
- **AI & Grounding:** Google Gemini API (`gemini-1.5-flash`) dengan *Strict Grounding System Prompt* dan *Fallback Grounded Synthesizer* otomatis.
- **Security:** Bcrypt password hashing, JSON Web Token (JWT) session, Role-Based Access Control (RBAC), Security Headers, Proteksi SQL Injection (parameterized queries), dan Proteksi Prompt Injection.
- **Frontend:** Responsive Web App murni (HTML5, Vanilla CSS3 bertema PMR Humaniter modern dengan Glassmorphism dan dark/light contrast, JavaScript ES Modules).

---

## 4. Akun Bawaan (Demo Credentials)

Sistem telah dilengkapi akun demo untuk pengujian langsung:

| Peran (Role) | Username | Email | Password | Hak Akses |
| :--- | :--- | :--- | :--- | :--- |
| **SUPER_ADMIN** | `superadmin` | `superadmin@helpme.pmi.id` | `SuperAdmin123!` | Akses penuh, manajemen role, konfigurasi sistem, rollback materi |
| **ADMIN** | `admin` | `admin@helpme.pmi.id` | `AdminPmr123!` | Upload dokumen, kelola materi, review center, aktivasi versi, inspeksi QC AI |
| **USER (WIRA)** | `wira` | `wira@helpme.pmi.id` | `PmrWira123!` | Tanya HelpMe!, ensiklopedia materi, riwayat chat, feedback |

---

## 5. Menjalankan Aplikasi Secara Lokal

### Prasyarat:
- Node.js (v20+ disarankan v26)
- pnpm atau npm

### Langkah Instalasi:
```bash
# 1. Masuk ke direktori proyek
cd "/home/inirafi/Documents/YCWC PROJECT LOMBA"

# 2. Salin konfigurasi environment
cp .env.example .env

# 3. Instal dependensi
pnpm install

# 4. Inisialisasi Database & Ekstraksi PDF Otomatis (Seed)
pnpm run seed

# 5. Jalankan Pengujian Otomatis
pnpm test

# 6. Jalankan Server
pnpm start
```
Aplikasi akan aktif dan dapat diakses melalui peramban di: **`http://localhost:3000`**

---

## 6. Variabel Lingkungan (`.env`)

```env
PORT=3000
NODE_ENV=development
JWT_SECRET=helpme_pmr_wira_secret_key_2026_super_secure
DATABASE_PATH=./data/helpme.db
GEMINI_API_KEY=               # Masukkan API Key Google Gemini Anda (opsional, sistem memiliki fallback grounded engine)
GEMINI_MODEL=gemini-1.5-flash
SYSTEM_LANGUAGE=id
ENABLE_STRICT_RAG=true
MAX_UPLOAD_SIZE_MB=50
```

---

## 7. Fitur Unggulan

### A. First Aid Safety Layer (Deteksi Kedaruratan Medis)
Mendeteksi pertanyaan kondisi gawat darurat (pingsan, henti napas, henti jantung, perdarahan hebat, syok, keracunan, gigitan ular). Sistem secara otomatis menampilkan **Banner Kedaruratan Medis ⚠️** yang mengingatkan pengguna untuk segera menghubungi nomor darurat **118 / 119** atau meminta bantuan pembina PMR dan fasilitas kesehatan.

### B. Format Jawaban Terstruktur (Anti-Halusinasi)
Setiap jawaban AI disajikan secara konsisten dengan format:
- `### 🩹 Jawaban` (Inti penjelasan medis dasar)
- `### 📋 Yang dapat dilakukan` (Langkah praktis penolong PMR Wira)
- `### ⚠️ Perhatikan` (Prinsip 3A: Aman Diri, Lingkungan, Korban & hal terlarang)
- `### 🚑 Kapan mencari bantuan?` (Tanda bahaya rujukan medis)
- `### 📚 Sumber` (Sitasi nama dokumen, edisi, bab, dan nomor halaman)

### C. Source Traceability
Setiap jawaban AI menyimpan ID potongan knowledge (*chunk*). Pengguna dan admin dapat mengklik tombol **Traceability** untuk melihat teks asli dokumen buku cetak dan nomor halaman fisik sumber jawaban.

### D. Sistem Multi-Versi & Non-Destructive (No Hard Delete)
- Sumber dan materi menggunakan status bertingkat: `ACTIVE`, `DRAFT`, `PENDING_REVIEW`, `SUPERSEDED`, `ARCHIVED`, `DISABLED`.
- Jika panduan versi baru diaktifkan, versi lama tidak dihapus melainkan otomatis ditandai sebagai `SUPERSEDED`.
- Mendukung perbandingan perbedaan (*Version Diff Viewer*) antara dua versi sebelum diaktifkan.

### E. Fitur Rollback Materi
Administrator dapat mengembalikan (*rollback*) materi ke versi sebelumnya kapan saja dengan satu klik. Tindakan ini secara otomatis dicatat dalam **Audit Trail Log** lengkap dengan nama administrator, alasan, dan stempel waktu.

### F. Umpan Balik (Feedback) & AI Quality Control
Pengguna dapat memberikan feedback 👍 (*Membantu*) atau 👎 (*Tidak Membantu*) beserta alasan. Admin dapat meninjau log pertanyaan pengguna, memeriksa skor keyakinan (*confidence*), dan menandai (*flag*) jawaban yang memerlukan investigasi rujukan.

---

## 8. Panduan Administrator

### Cara Menambahkan atau Memperbarui Panduan PMI di Masa Depan:
1. Masuk sebagai `admin` atau `superadmin`.
2. Buka menu **Admin Panel** → Tab **Ingestion / Upload**.
3. Pilih Sumber (atau buat Sumber baru jika ada pedoman baru).
4. Masukkan Nomor Versi Baru (misalnya `2.0`), Edisi, dan Bab.
5. Unggah berkas PDF, TXT, atau Markdown.
6. Sistem akan mengekstrak teks, memecahnya menjadi *chunks*, membuat indeks vektor/FTS5, dan menyimpannya dengan status **DRAFT**.
7. Buka Tab **Review Center** untuk memeriksa potongan teks.
8. Klik **Setujui & Aktifkan**. Versi baru kini berstatus `ACTIVE`, dan versi lama otomatis berpindah ke status `SUPERSEDED` tanpa perlu mengubah baris kode apapun pada aplikasi.

---

## 9. Struktur Direktori Proyek

```text
├── Guidebook pertolongan pertama/
│   ├── 2.3. PP PMR WIRA.pdf
│   └── SJA-First-Aid-Reference-Guide-English.pdf
├── server/
│   ├── index.js                  # Entry point Express.js
│   ├── db/
│   │   ├── database.js           # Skema SQLite & FTS5
│   │   └── seed.js               # Parser PDF & Ingestion
│   ├── middleware/
│   │   ├── auth.js               # Otentikasi JWT & RBAC
│   │   └── audit.js              # Pencatat Audit Trail
│   ├── services/
│   │   ├── ragService.js         # Hybrid search & safety layer
│   │   ├── vectorService.js      # Vector similarity & TF-IDF
│   │   └── geminiService.js      # Gemini API & Grounded Synthesizer
│   └── routes/
│       ├── authRoutes.js         # Register, login, profile
│       ├── chatRoutes.js         # Sesi chat, RAG Q&A, feedback
│       ├── materialRoutes.js     # Ensiklopedia, versioning, rollback
│       ├── sourceRoutes.js       # Sumber, aktivasi, compare diff
│       ├── adminRoutes.js        # Dashboard, review, audit, QC
│       └── uploadRoutes.js       # Ingestion PDF/TXT/MD
├── public/
│   ├── index.html                # Antarmuka SPA HelpMe!
│   ├── css/
│   │   ├── main.css              # Design system PMR Wira
│   │   └── components.css        # Komponen chat, modal, drawer, diff
│   └── js/
│       ├── api.js                # API Client
│       ├── state.js              # State Management & Toasts
│       └── app.js                # App Controller & Routing
├── tests/
│   ├── auth.test.js              # Uji coba otentikasi & peran
│   ├── rag.test.js               # Uji coba RAG, safety & anti-halusinasi
│   ├── versioning.test.js        # Uji coba versioning & supersede
│   └── security.test.js          # Uji coba keamanan XSS, SQLi, injection
├── .env.example
├── .gitignore
├── package.json
└── README.md
```
