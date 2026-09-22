import jwt from 'jsonwebtoken';
import { db } from '../db/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'helpme_pmr_wira_secret_key_2026_super_secure';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Token otentikasi tidak ditemukan. Silakan login terlebih dahulu.'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(`
      SELECT id, name, username, email, role, pmr_level, status 
      FROM users 
      WHERE id = ? AND status = 'ACTIVE'
    `).get(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Sesi pengguna tidak valid atau akun dinonaktifkan.'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      error: 'Token kedaluwarsa atau tidak valid.'
    });
  }
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(`
      SELECT id, name, username, email, role, pmr_level, status 
      FROM users 
      WHERE id = ? AND status = 'ACTIVE'
    `).get(decoded.id);
    req.user = user || null;
  } catch (e) {
    req.user = null;
  }
  next();
}

export function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Akses ditolak. Pengguna belum diautentikasi.'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Akses terlarang. Diperlukan peran: ${roles.join(' atau ')}. Peran Anda: ${req.user.role}`
      });
    }

    next();
  };
}

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      pmr_level: user.pmr_level
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}
