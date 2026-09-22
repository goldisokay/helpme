import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import { db, initDatabase } from '../server/db/database.js';
import { signToken } from '../server/middleware/auth.js';

initDatabase();

console.log('--- RUNNING TEST: AUTHENTICATION & RBAC ---');

// Test 1: User Login Verification with Bcrypt
const user = db.prepare(`SELECT * FROM users WHERE username = 'wira'`).get();
assert(user, 'User wira must exist in database');
assert.strictEqual(user.role, 'USER', 'Role must be USER');
assert.strictEqual(user.pmr_level, 'WIRA', 'PMR level must be WIRA');

const validPass = bcrypt.compareSync('PmrWira123!', user.password_hash);
assert.strictEqual(validPass, true, 'Valid password must match hash');

const wrongPass = bcrypt.compareSync('WrongPassword!', user.password_hash);
assert.strictEqual(wrongPass, false, 'Wrong password must be rejected');

// Test 2: Admin and SuperAdmin roles
const admin = db.prepare(`SELECT * FROM users WHERE username = 'admin'`).get();
assert(admin, 'Admin must exist');
assert.strictEqual(admin.role, 'ADMIN', 'Role must be ADMIN');

const superAdmin = db.prepare(`SELECT * FROM users WHERE username = 'superadmin'`).get();
assert(superAdmin, 'SuperAdmin must exist');
assert.strictEqual(superAdmin.role, 'SUPER_ADMIN', 'Role must be SUPER_ADMIN');

// Test 3: JWT Token generation
const token = signToken(user);
assert(token && typeof token === 'string', 'Token must be valid string');

console.log('✓ Authentication & RBAC tests passed successfully!');
