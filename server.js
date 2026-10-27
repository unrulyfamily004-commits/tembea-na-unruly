require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('Set JWT_SECRET to a random value of at least 32 characters.');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'tembea-media';

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS listings (
      id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('adventure','event')),
      title TEXT NOT NULL, location TEXT NOT NULL, date TEXT, price INTEGER NOT NULL DEFAULT 0,
      slots INTEGER NOT NULL DEFAULT 0, category TEXT DEFAULT '', description TEXT DEFAULT '',
      image TEXT DEFAULT '', published BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id BIGSERIAL PRIMARY KEY, listing_id BIGINT REFERENCES listings(id) ON DELETE SET NULL,
      name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT DEFAULT '', people INTEGER NOT NULL DEFAULT 1,
      payment_reference TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
      payment_status TEXT NOT NULL DEFAULT 'unverified', notes TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', email TEXT DEFAULT '',
      message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (email && password) {
    const existing = await pool.query('SELECT id FROM admins WHERE email=$1', [email]);
    if (!existing.rowCount) {
      await pool.query('INSERT INTO admins(email,password_hash) VALUES($1,$2)', [email, await bcrypt.hash(password, 12)]);
      console.log('Initial administrator account created from environment variables.');
    }
  }
}

const dbReady = initDb();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false }));
// Local development fallback only. On Vercel, public assets are served from /public and uploads use Supabase Storage.
if (process.env.NODE_ENV !== 'production') {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
  app.use(express.static(path.join(__dirname, 'public')));
}
app.use('/api', asyncRoute(async (req, res, next) => { await dbReady; next(); }));
const auth = (req, res, next) => {
  try {
    const token = req.cookies.admin_session;
    if (!token) return res.status(401).json({ error: 'Sign in required' });
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Session expired. Please sign in again.' }); }
};
const clean = v => String(v ?? '').trim();
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, database: 'connected' });
}));
app.get('/api/listings', asyncRoute(async (req, res) => {
  const conditions = ['published=TRUE']; const args = [];
  if (['adventure', 'event'].includes(req.query.type)) { args.push(req.query.type); conditions.push(`type=$${args.length}`); }
  const search = clean(req.query.q).slice(0, 80);
  if (search) { args.push(`%${search}%`); const n = args.length; conditions.push(`(title ILIKE $${n} OR location ILIKE $${n} OR category ILIKE $${n})`); }
  const result = await pool.query(`SELECT * FROM listings WHERE ${conditions.join(' AND ')} ORDER BY (date IS NULL), date ASC, id DESC`, args);
  res.json(result.rows);
}));
app.post('/api/bookings', asyncRoute(async (req, res) => {
  const name = clean(req.body.name), phone = clean(req.body.phone), email = clean(req.body.email);
  const people = Number(req.body.people), listingId = Number(req.body.listing_id), reference = clean(req.body.payment_reference);
  if (name.length < 2 || name.length > 100 || !/^[+\d ()-]{7,20}$/.test(phone) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || !Number.isInteger(people) || people < 1 || people > 30 || !Number.isInteger(listingId)) return res.status(400).json({ error: 'Please check your details and try again.' });
  const found = await pool.query('SELECT * FROM listings WHERE id=$1 AND published=TRUE', [listingId]);
  const item = found.rows[0];
  if (!item) return res.status(404).json({ error: 'This activity is no longer available.' });
  if (item.slots > 0 && people > item.slots) return res.status(400).json({ error: 'Not enough spaces are currently available. Please contact us.' });
  const result = await pool.query('INSERT INTO bookings(listing_id,name,phone,email,people,payment_reference) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [listingId, name, phone, email, people, reference.slice(0, 100)]);
  res.status(201).json({ message: 'Booking request received. Please follow the M-Pesa payment instructions and contact us to confirm your booking.', booking_id: result.rows[0].id, payment: { business: 'Tembea na Unruly', contact_person: 'Leone Lotira', phone: '0700006391', till_number: '8698470' }, status: 'pending', payment_status: 'unverified' });
}));
app.post('/api/contact', asyncRoute(async (req, res) => {
  const name = clean(req.body.name), message = clean(req.body.message), phone = clean(req.body.phone), email = clean(req.body.email);
  if (name.length < 2 || message.length < 5 || message.length > 3000) return res.status(400).json({ error: 'Please enter your name and a message.' });
  await pool.query('INSERT INTO messages(name,phone,email,message) VALUES($1,$2,$3,$4)', [name, phone.slice(0, 30), email.slice(0, 150), message]);
  res.status(201).json({ message: 'Thanks for reaching out. We will get back to you.' });
}));
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = clean(req.body.email).toLowerCase(), password = String(req.body.password || '');
  const result = await pool.query('SELECT * FROM admins WHERE email=$1', [email]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.cookie('admin_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000, path: '/' });
  res.json({ message: 'Signed in', email: user.email });
}));
app.post('/api/auth/logout', (req, res) => { res.clearCookie('admin_session', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' }); res.json({ message: 'Signed out' }); });
app.get('/api/auth/me', auth, (req, res) => res.json({ email: req.admin.email }));
app.get('/api/admin/bookings', auth, asyncRoute(async (req, res) => {
  const r = await pool.query('SELECT b.*,l.title AS listing_title,l.date AS listing_date FROM bookings b LEFT JOIN listings l ON l.id=b.listing_id ORDER BY b.id DESC'); res.json(r.rows);
}));
app.patch('/api/admin/bookings/:id', auth, asyncRoute(async (req, res) => {
  const status = clean(req.body.status), payment = clean(req.body.payment_status);
  if (!['pending', 'confirmed', 'cancelled'].includes(status) || !['unverified', 'verified', 'rejected'].includes(payment)) return res.status(400).json({ error: 'Invalid status' });
  const r = await pool.query('UPDATE bookings SET status=$1,payment_status=$2 WHERE id=$3 RETURNING id', [status, payment, Number(req.params.id)]);
  if (!r.rowCount) return res.status(404).json({ error: 'Booking not found' }); res.json({ message: 'Booking updated' });
}));
app.get('/api/admin/listings', auth, asyncRoute(async (req, res) => { const r = await pool.query('SELECT * FROM listings ORDER BY id DESC'); res.json(r.rows); }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype) || /^video\/(mp4|webm|quicktime)$/.test(file.mimetype);
  cb(ok ? null : new Error('Only image or video files are allowed'), ok);
} });
app.post('/api/admin/upload', auth, upload.single('media'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a media file' });
  if (!supabase) return res.status(503).json({ error: 'Media storage is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.' });
  const ext = path.extname(req.file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
  const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, req.file.buffer, { contentType: req.file.mimetype, cacheControl: '3600', upsert: false });
  if (error) { console.error('Supabase Storage upload failed:', error.message); return res.status(502).json({ error: 'Media upload failed. Check the Supabase Storage bucket configuration.' }); }
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
  res.status(201).json({ url: data.publicUrl, filename: fileName });
}));
app.post('/api/admin/listings', auth, asyncRoute(async (req, res) => {
  const type = clean(req.body.type), title = clean(req.body.title), location = clean(req.body.location), price = Number(req.body.price || 0), slots = Number(req.body.slots || 0);
  if (!['adventure', 'event'].includes(type) || title.length < 3 || title.length > 160 || location.length < 2 || !Number.isFinite(price) || price < 0 || !Number.isInteger(slots) || slots < 0) return res.status(400).json({ error: 'Please complete the required fields correctly.' });
  const r = await pool.query('INSERT INTO listings(type,title,location,date,price,slots,category,description,image,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [type, title, location, clean(req.body.date) || null, Math.round(price), slots, clean(req.body.category).slice(0, 80), clean(req.body.description).slice(0, 4000), clean(req.body.image).slice(0, 1000), req.body.published === false ? false : true]);
  res.status(201).json(r.rows[0]);
}));
app.put('/api/admin/listings/:id', auth, asyncRoute(async (req, res) => {
  const found = await pool.query('SELECT * FROM listings WHERE id=$1', [Number(req.params.id)]); const old = found.rows[0];
  if (!old) return res.status(404).json({ error: 'Listing not found' });
  const v = { ...old, ...req.body };
  if (!['adventure', 'event'].includes(v.type) || clean(v.title).length < 3 || clean(v.location).length < 2 || !Number.isFinite(Number(v.price)) || Number(v.price) < 0 || !Number.isInteger(Number(v.slots)) || Number(v.slots) < 0) return res.status(400).json({ error: 'Invalid listing details' });
  await pool.query('UPDATE listings SET type=$1,title=$2,location=$3,date=$4,price=$5,slots=$6,category=$7,description=$8,image=$9,published=$10 WHERE id=$11', [v.type, clean(v.title), clean(v.location), clean(v.date) || null, Number(v.price), Number(v.slots), clean(v.category), clean(v.description), clean(v.image), v.published === true || v.published === 1 || v.published === 'true', old.id]);
  res.json({ message: 'Listing updated' });
}));
app.delete('/api/admin/listings/:id', auth, asyncRoute(async (req, res) => { const r = await pool.query('DELETE FROM listings WHERE id=$1 RETURNING id', [Number(req.params.id)]); if (!r.rowCount) return res.status(404).json({ error: 'Listing not found' }); res.json({ message: 'Listing deleted' }); }));
app.get('/api/admin/messages', auth, asyncRoute(async (req, res) => { const r = await pool.query('SELECT * FROM messages ORDER BY id DESC'); res.json(r.rows); }));
app.use((err, req, res, next) => {
  console.error(err.message || err);
  const message = err.message === 'File too large' ? 'File is too large (25 MB maximum)' : err.message === 'Only image or video files are allowed' ? err.message : 'Request could not be processed';
  res.status(err.message === 'File too large' ? 413 : 400).json({ error: message });
});

// Vercel detects and serves the exported Express application. Local development starts a listener.
if (require.main === module) {
  dbReady.then(() => app.listen(PORT, () => console.log(`Tembea na Unruly running at http://localhost:${PORT}`))).catch(err => { console.error('Startup failed:', err); process.exit(1); });
} else {
  dbReady.catch(err => console.error('Database initialization failed:', err));
}
module.exports = app;
