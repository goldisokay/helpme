// Rate Limiting Middleware for HelpMe! Chatbot
// Policy:
// - SUPER_ADMIN: Unlimited / Bebas kuota & batasan waktu dari sistem HelpMe!
// - ADMIN: 60 pesan per menit
// - USER & GUEST: 20 pesan per menit
// Catatan: Batasan kuota eksternal dari Google Gemini API tetap berlaku sesuai tier akun Google.

const userRequestCounts = new Map();
const WINDOW_MS = 60 * 1000; // 1 Menit

export function chatRateLimiter(req, res, next) {
  // SUPER_ADMIN memiliki akses UNLIMITED tanpa batasan dari aplikasi
  if (req.user && req.user.role === 'SUPER_ADMIN') {
    return next();
  }

  // Identifier: user ID jika login, atau IP jika tamu (guest)
  const identifier = req.user ? `user_${req.user.id}` : `ip_${req.ip || req.connection.remoteAddress || 'unknown'}`;
  const now = Date.now();

  const userRecord = userRequestCounts.get(identifier) || { count: 0, startTime: now };

  // Reset window jika waktu 1 menit telah berlalu
  if (now - userRecord.startTime > WINDOW_MS) {
    userRecord.count = 0;
    userRecord.startTime = now;
  }

  // Tentukan batas maksimal
  const maxLimit = (req.user && req.user.role === 'ADMIN') ? 60 : 20;

  if (userRecord.count >= maxLimit) {
    const remainingSeconds = Math.ceil((WINDOW_MS - (now - userRecord.startTime)) / 1000);
    return res.status(429).json({
      success: false,
      error: `Batas pengiriman pesan tercapai (${maxLimit} pertanyaan/menit). Silakan tunggu ${remainingSeconds} detik lagi.`,
      retry_after_seconds: remainingSeconds
    });
  }

  userRecord.count++;
  userRequestCounts.set(identifier, userRecord);
  next();
}

// Periodic cleanup of expired rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of userRequestCounts.entries()) {
    if (now - record.startTime > WINDOW_MS * 5) {
      userRequestCounts.delete(key);
    }
  }
}, 5 * 60 * 1000);
