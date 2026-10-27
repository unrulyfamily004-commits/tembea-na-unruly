require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('Set JWT_SECRET to a random value of at least 32 characters in .env'); process.exit(1);
}
const app = express();
const PORT = Number(process.env.PORT || 3000);
const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS listings (id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('adventure','event')), title TEXT NOT NULL, location TEXT NOT NULL, date TEXT, price INTEGER NOT NULL DEFAULT 0, slots INTEGER NOT NULL DEFAULT 0, category TEXT DEFAULT '', description TEXT DEFAULT '', image TEXT DEFAULT '', published INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY, listing_id INTEGER, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT DEFAULT '', people INTEGER NOT NULL DEFAULT 1, payment_reference TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', payment_status TEXT NOT NULL DEFAULT 'unverified', notes TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(listing_id) REFERENCES listings(id));
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', email TEXT DEFAULT '', message TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminEmail && adminPassword && !db.prepare('SELECT id FROM admins WHERE email=?').get(adminEmail.toLowerCase())) {
  db.prepare('INSERT INTO admins(email,password_hash) VALUES(?,?)').run(adminEmail.toLowerCase(), bcrypt.hashSync(adminPassword, 12));
  console.log('Initial administrator account created from environment variables.');
}
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' }}));
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:false}));
app.use(cookieParser());
app.use('/api/auth/login', rateLimit({windowMs:15*60*1000, max:8, standardHeaders:true, legacyHeaders:false}));
app.use('/uploads', express.static(path.join(__dirname,'uploads')));
app.use(express.static(path.join(__dirname,'public')));
const auth = (req,res,next) => {
  try { const token = req.cookies.admin_session; if (!token) return res.status(401).json({error:'Sign in required'}); req.admin = jwt.verify(token,process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({error:'Session expired. Please sign in again.'}); }
};
const clean = v => String(v ?? '').trim();
app.get('/api/listings',(req,res)=>{
 const type = ['adventure','event'].includes(req.query.type) ? req.query.type : null;
 const q = `%${clean(req.query.q).slice(0,80)}%`;
 let sql='SELECT * FROM listings WHERE published=1'; const args=[];
 if(type){sql+=' AND type=?';args.push(type)}
 if(clean(req.query.q)){sql+=' AND (title LIKE ? OR location LIKE ? OR category LIKE ?)';args.push(q,q,q)}
 sql+=' ORDER BY date IS NULL, date ASC, id DESC';
 res.json(db.prepare(sql).all(...args));
});
app.post('/api/bookings',(req,res)=>{
 const name=clean(req.body.name), phone=clean(req.body.phone), email=clean(req.body.email), people=Number(req.body.people), listingId=Number(req.body.listing_id), reference=clean(req.body.payment_reference);
 if(name.length<2 || name.length>100 || !/^[+\d ()-]{7,20}$/.test(phone) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || !Number.isInteger(people) || people<1 || people>30 || !Number.isInteger(listingId)) return res.status(400).json({error:'Please check your details and try again.'});
 const item=db.prepare('SELECT * FROM listings WHERE id=? AND published=1').get(listingId);
 if(!item) return res.status(404).json({error:'This activity is no longer available.'});
 if(item.slots>0 && people>item.slots) return res.status(400).json({error:'Not enough spaces are currently available. Please contact us.'});
 const info=db.prepare('INSERT INTO bookings(listing_id,name,phone,email,people,payment_reference) VALUES(?,?,?,?,?,?)').run(listingId,name,phone,email,people,reference.slice(0,100));
 res.status(201).json({message:'Booking request received. Please follow the M-Pesa payment instructions and contact us to confirm your booking.',booking_id:info.lastInsertRowid, payment:{business:'Tembea na Unruly',contact_person:'Leone Lotira',phone:'0700006391',till_number:'8698470'},status:'pending',payment_status:'unverified'});
});
app.post('/api/contact',(req,res)=>{
 const name=clean(req.body.name), message=clean(req.body.message), phone=clean(req.body.phone), email=clean(req.body.email);
 if(name.length<2 || message.length<5 || message.length>3000) return res.status(400).json({error:'Please enter your name and a message.'});
 db.prepare('INSERT INTO messages(name,phone,email,message) VALUES(?,?,?,?)').run(name,phone.slice(0,30),email.slice(0,150),message);
 res.status(201).json({message:'Thanks for reaching out. We will get back to you.'});
});
app.post('/api/auth/login', async (req,res)=>{
 const email=clean(req.body.email).toLowerCase(), password=String(req.body.password||'');
 const user=db.prepare('SELECT * FROM admins WHERE email=?').get(email);
 if(!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:'Invalid email or password'});
 const token=jwt.sign({id:user.id,email:user.email},process.env.JWT_SECRET,{expiresIn:'8h'});
 res.cookie('admin_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:8*60*60*1000});
 res.json({message:'Signed in',email:user.email});
});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('admin_session',{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production'});res.json({message:'Signed out'});});
app.get('/api/auth/me',auth,(req,res)=>res.json({email:req.admin.email}));
app.get('/api/admin/bookings',auth,(req,res)=>res.json(db.prepare(`SELECT b.*,l.title AS listing_title,l.date AS listing_date FROM bookings b LEFT JOIN listings l ON l.id=b.listing_id ORDER BY b.id DESC`).all()));
app.patch('/api/admin/bookings/:id',auth,(req,res)=>{
 const status=clean(req.body.status), payment=clean(req.body.payment_status);
 if(!['pending','confirmed','cancelled'].includes(status) || !['unverified','verified','rejected'].includes(payment)) return res.status(400).json({error:'Invalid status'});
 const result=db.prepare('UPDATE bookings SET status=?,payment_status=? WHERE id=?').run(status,payment,Number(req.params.id));
 if(!result.changes) return res.status(404).json({error:'Booking not found'}); res.json({message:'Booking updated'});
});
app.get('/api/admin/listings',auth,(req,res)=>res.json(db.prepare('SELECT * FROM listings ORDER BY id DESC').all()));
const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,path.join(__dirname,'uploads')),filename:(req,file,cb)=>cb(null,Date.now()+'-'+Math.random().toString(36).slice(2,10)+path.extname(file.originalname).toLowerCase())});
const upload=multer({storage,limits:{fileSize:25*1024*1024},fileFilter:(req,file,cb)=>{const ok=/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)||/^video\/(mp4|webm|quicktime)$/.test(file.mimetype);cb(ok?null:new Error('Only image or video files are allowed'),ok)}});
app.post('/api/admin/upload',auth,upload.single('media'),(req,res)=>{if(!req.file)return res.status(400).json({error:'Choose a media file'});res.status(201).json({url:'/uploads/'+req.file.filename,filename:req.file.filename});});
app.post('/api/admin/listings',auth,(req,res)=>{
 const type=clean(req.body.type),title=clean(req.body.title),location=clean(req.body.location),price=Number(req.body.price||0),slots=Number(req.body.slots||0);
 if(!['adventure','event'].includes(type)||title.length<3||title.length>160||location.length<2||!Number.isFinite(price)||price<0||!Number.isInteger(slots)||slots<0) return res.status(400).json({error:'Please complete the required fields correctly.'});
 const info=db.prepare('INSERT INTO listings(type,title,location,date,price,slots,category,description,image,published) VALUES(?,?,?,?,?,?,?,?,?,?)').run(type,title,location,clean(req.body.date),price,slots,clean(req.body.category).slice(0,80),clean(req.body.description).slice(0,4000),clean(req.body.image).slice(0,500),req.body.published===false?0:1);
 res.status(201).json(db.prepare('SELECT * FROM listings WHERE id=?').get(info.lastInsertRowid));
});
app.put('/api/admin/listings/:id',auth,(req,res)=>{
 const old=db.prepare('SELECT * FROM listings WHERE id=?').get(Number(req.params.id));if(!old)return res.status(404).json({error:'Listing not found'});
 const v={...old,...req.body}; if(!['adventure','event'].includes(v.type)||clean(v.title).length<3||clean(v.location).length<2||Number(v.price)<0||Number(v.slots)<0)return res.status(400).json({error:'Invalid listing details'});
 db.prepare('UPDATE listings SET type=?,title=?,location=?,date=?,price=?,slots=?,category=?,description=?,image=?,published=? WHERE id=?').run(v.type,clean(v.title),clean(v.location),clean(v.date),Number(v.price),Number(v.slots),clean(v.category),clean(v.description),clean(v.image),v.published?1:0,old.id);res.json({message:'Listing updated'});
});
app.delete('/api/admin/listings/:id',auth,(req,res)=>{const r=db.prepare('DELETE FROM listings WHERE id=?').run(Number(req.params.id));if(!r.changes)return res.status(404).json({error:'Listing not found'});res.json({message:'Listing deleted'});});
app.get('/api/admin/messages',auth,(req,res)=>res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC').all()));
app.use((err,req,res,next)=>{console.error(err.message);res.status(400).json({error:err.message==='File too large'?'File is too large (25 MB maximum)':'Request could not be processed'});});
app.listen(PORT,()=>console.log(`Tembea na Unruly running at http://localhost:${PORT}`));
