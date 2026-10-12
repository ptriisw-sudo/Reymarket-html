const express = require('express');
const session = require('express-session');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'rey-market.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.transaction = callback => () => {
  db.exec('BEGIN');
  try { const result = callback(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
};
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS topups (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, method TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), service TEXT NOT NULL, device_group TEXT NOT NULL, ecid TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'pending', result TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL, amount INTEGER NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);

app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], scriptSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } } }));
app.use(express.json({ limit: '20kb' }));
app.use(session({ secret: process.env.SESSION_SECRET || 'dev-only-change-this-secret-before-deploying', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 } }));
app.use(express.static(path.join(__dirname, 'public')));

const emailOk = v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
const rupiah = v => Number.isSafeInteger(v) && v >= 10000 && v <= 100000000;
const getUser = id => db.prepare('SELECT id,name,email,balance,role,created_at FROM users WHERE id=?').get(id);
function auth(req, res, next) { if (!req.session.userId) return res.status(401).json({ error: 'Silakan login terlebih dahulu.' }); req.user = getUser(req.session.userId); if (!req.user) return res.status(401).json({ error: 'Sesi tidak berlaku. Silakan login lagi.' }); next(); }
function admin(req, res, next) { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Akses khusus admin.' }); next(); }

app.post('/api/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80 || !emailOk(email) || typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Isi nama, email valid, dan kata sandi minimal 8 karakter.' });
  try { const role = process.env.ADMIN_EMAIL && email.toLowerCase() === process.env.ADMIN_EMAIL.trim().toLowerCase() ? 'admin' : 'user'; const info = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(name.trim(), email.toLowerCase(), await bcrypt.hash(password, 12), role); req.session.userId = info.lastInsertRowid; res.status(201).json({ user: getUser(info.lastInsertRowid) }); }
  catch (e) { res.status(409).json({ error: 'Email sudah digunakan.' }); }
});
app.post('/api/login', async (req, res) => { const { email, password } = req.body || {}; if (!emailOk(email) || typeof password !== 'string') return res.status(400).json({ error: 'Email atau kata sandi tidak valid.' }); const row = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase()); if (!row || !(await bcrypt.compare(password, row.password_hash))) return res.status(401).json({ error: 'Email atau kata sandi salah.' }); req.session.userId = row.id; res.json({ user: getUser(row.id) }); });
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));
app.get('/api/data', auth, (req, res) => res.json({ user: req.user, orders: db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id), topups: db.prepare('SELECT * FROM topups WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id), transactions: db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id) }));

app.post('/api/topups', auth, (req, res) => { const { amount, method, note } = req.body || {}; if (!rupiah(amount) || !['transfer', 'ewallet', 'manual'].includes(method) || (note && (typeof note !== 'string' || note.length > 300))) return res.status(400).json({ error: 'Nominal Rp10.000–Rp100.000.000 dan metode top-up tidak valid.' }); const info = db.prepare('INSERT INTO topups(user_id,amount,method,note) VALUES(?,?,?,?)').run(req.user.id, amount, method, note || ''); res.status(201).json({ id: info.lastInsertRowid, status: 'pending', message: 'Permintaan dicatat. Saldo menunggu konfirmasi admin.' }); });
app.post('/api/orders', auth, (req, res) => { const { service, deviceGroup, ecid, note } = req.body || {}; const allowed = ['A12/A13', 'A7/A11']; const validEcid = typeof ecid === 'string' && /^(?:[0-9A-Fa-f]{16}|[0-9A-Fa-f]{8})$/.test(ecid.trim()); if (!['ecid_register', 'fmi_check'].includes(service) || !allowed.includes(deviceGroup) || !validEcid || (note && (typeof note !== 'string' || note.length > 500))) return res.status(400).json({ error: 'Layanan, kelompok perangkat, ECID (8 atau 16 karakter heksadesimal), atau catatan tidak valid.' }); const info = db.prepare('INSERT INTO orders(user_id,service,device_group,ecid,note) VALUES(?,?,?,?,?)').run(req.user.id, service, deviceGroup, ecid.trim().toUpperCase(), note || ''); res.status(201).json({ id: info.lastInsertRowid, status: 'pending', message: 'Permintaan dicatat untuk pemeriksaan manual.' }); });

// ADMIN: create the first admin by setting ADMIN_EMAIL before starting the server.
if (process.env.ADMIN_EMAIL) { const email = process.env.ADMIN_EMAIL.toLowerCase(); db.prepare("UPDATE users SET role='admin' WHERE email=?").run(email); }
app.get('/api/admin/overview', auth, admin, (req, res) => res.json({ users: db.prepare('SELECT id,name,email,balance,role,created_at FROM users ORDER BY id DESC').all(), topups: db.prepare('SELECT t.*,u.email FROM topups t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC').all(), orders: db.prepare('SELECT o.*,u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC').all() }));
app.post('/api/admin/topups/:id/confirm', auth, admin, (req, res) => { const tx = db.transaction(() => { const item = db.prepare("SELECT * FROM topups WHERE id=? AND status='pending'").get(Number(req.params.id)); if (!item) throw new Error('Top-up tidak ditemukan atau sudah diproses.'); db.prepare("UPDATE topups SET status='confirmed' WHERE id=?").run(item.id); db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(item.amount, item.user_id); db.prepare('INSERT INTO transactions(user_id,type,amount,description) VALUES(?,?,?,?)').run(item.user_id, 'credit', item.amount, `Top-up #${item.id} dikonfirmasi`); }); try { tx(); res.json({ ok: true }); } catch(e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/orders/:id/status', auth, admin, (req, res) => { const { status, result } = req.body || {}; if (!['processing', 'completed', 'rejected'].includes(status) || (result && (typeof result !== 'string' || result.length > 1000))) return res.status(400).json({ error: 'Status atau hasil tidak valid.' }); const out = db.prepare('UPDATE orders SET status=?,result=? WHERE id=?').run(status, result || '', Number(req.params.id)); if (!out.changes) return res.status(404).json({ error: 'Order tidak ditemukan.' }); res.json({ ok: true }); });

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Rey Market berjalan di http://localhost:${PORT}`));
