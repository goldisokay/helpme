import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db/database.js';
import { signToken, authenticateToken } from '../middleware/auth.js';
import { logAudit } from '../middleware/audit.js';

const router = Router();

// REGISTER
router.post('/register', (req, res) => {
  try {
    const { name, username, email, password, pmr_level = 'WIRA' } = req.body;

    if (!name || !username || !email || !password) {
      return res.status(400).json({ success: false, error: 'Semua kolom pendaftaran wajib diisi.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password minimal terdiri dari 6 karakter.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Username atau email sudah terdaftar.' });
    }

    const password_hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO users (name, username, email, password_hash, role, pmr_level, status)
      VALUES (?, ?, ?, ?, 'USER', ?, 'ACTIVE')
    `).run(name.trim(), username.trim().toLowerCase(), email.trim().toLowerCase(), password_hash, pmr_level);

    const userId = Number(result.lastInsertRowid);
    const user = db.prepare('SELECT id, name, username, email, role, pmr_level, status, created_at FROM users WHERE id = ?').get(userId);
    const token = signToken(user);

    logAudit({
      userId,
      action: 'USER_REGISTER',
      entityType: 'USER',
      entityId: userId,
      newData: { username: user.username, role: user.role },
      reason: 'Pendaftaran anggota baru PMR'
    });

    res.status(201).json({
      success: true,
      message: 'Pendaftaran berhasil. Selamat datang di HelpMe! PMR Wira.',
      token,
      user
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server saat pendaftaran.' });
  }
});

// LOGIN
router.post('/login', (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;

    if (!usernameOrEmail || !password) {
      return res.status(400).json({ success: false, error: 'Username/email dan password wajib diisi.' });
    }

    const identifier = usernameOrEmail.trim().toLowerCase();
    const user = db.prepare(`
      SELECT * FROM users 
      WHERE (username = ? OR email = ?) AND status = 'ACTIVE'
    `).get(identifier, identifier);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Username, email, atau password salah.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Username, email, atau password salah.' });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      pmr_level: user.pmr_level,
      status: user.status
    };

    const token = signToken(safeUser);

    logAudit({
      userId: user.id,
      action: 'USER_LOGIN',
      entityType: 'USER',
      entityId: user.id,
      reason: 'Pengguna berhasil masuk ke sistem'
    });

    res.json({
      success: true,
      message: 'Login berhasil.',
      token,
      user: safeUser
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan saat masuk.' });
  }
});

// GET CURRENT USER
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// UPDATE PROFILE
router.put('/profile', authenticateToken, (req, res) => {
  try {
    const { name, email, pmr_level, current_password, new_password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    const oldData = { name: user.name, email: user.email, pmr_level: user.pmr_level };

    let newHash = user.password_hash;
    if (new_password) {
      if (!current_password || !bcrypt.compareSync(current_password, user.password_hash)) {
        return res.status(400).json({ success: false, error: 'Password saat ini tidak cocok.' });
      }
      if (new_password.length < 6) {
        return res.status(400).json({ success: false, error: 'Password baru minimal 6 karakter.' });
      }
      newHash = bcrypt.hashSync(new_password, 10);
    }

    const updatedName = name ? name.trim() : user.name;
    const updatedEmail = email ? email.trim().toLowerCase() : user.email;
    const updatedLevel = pmr_level || user.pmr_level;

    db.prepare(`
      UPDATE users 
      SET name = ?, email = ?, pmr_level = ?, password_hash = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(updatedName, updatedEmail, updatedLevel, newHash, user.id);

    const updatedUser = db.prepare('SELECT id, name, username, email, role, pmr_level, status FROM users WHERE id = ?').get(user.id);

    logAudit({
      userId: user.id,
      action: 'UPDATE_PROFILE',
      entityType: 'USER',
      entityId: user.id,
      oldData,
      newData: { name: updatedName, email: updatedEmail, pmr_level: updatedLevel },
      reason: 'Pengguna memperbarui profil akun'
    });

    res.json({
      success: true,
      message: 'Profil berhasil diperbarui.',
      user: updatedUser
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ success: false, error: 'Gagal memperbarui profil.' });
  }
});

export default router;
