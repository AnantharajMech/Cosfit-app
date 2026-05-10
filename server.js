'use strict';
require('dotenv').config();

const express    = require('express');
const Database   = require('better-sqlite3');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const rateLimit  = require('express-rate-limit');
const helmet     = require('helmet');
const cors       = require('cors');
const compression = require('compression');
const morgan     = require('morgan');
const path       = require('path');
const crypto     = require('crypto');
const { body, validationResult } = require('express-validator');

// ════════════════════════════════════════════════════════════════
// ENVIRONMENT CONFIG
// ════════════════════════════════════════════════════════════════
const PORT       = process.env.PORT || 3000;
const NODE_ENV   = process.env.NODE_ENV || 'development';
const IS_PROD    = NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXP    = process.env.JWT_EXPIRES_IN || '7d';
const ADM_EXP    = process.env.ADMIN_JWT_EXPIRES_IN || '12h';
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || '';
const DB_PATH    = process.env.DB_PATH || './cosfit.db';
const ALLOWED    = process.env.ALLOWED_ORIGIN || '*';

// ════════════════════════════════════════════════════════════════
// DATABASE INITIALISATION
// ════════════════════════════════════════════════════════════════
const db = new Database(DB_PATH, { verbose: IS_PROD ? null : undefined });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    username         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone            TEXT NOT NULL,
    password         TEXT NOT NULL,
    avatar           TEXT DEFAULT '😊',
    plan             TEXT,
    plan_name        TEXT,
    plan_activated_at TEXT,
    goal             TEXT DEFAULT 'general',
    pref             TEXT DEFAULT 'all',
    age              TEXT,
    weight           TEXT,
    height           TEXT,
    gender           TEXT DEFAULT 'm',
    address          TEXT DEFAULT '',
    joined_at        TEXT NOT NULL,
    last_login       TEXT,
    is_active        INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS admins (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    role      TEXT NOT NULL,
    username  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password  TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS otps (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL COLLATE NOCASE,
    code       TEXT NOT NULL,
    type       TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    user_name      TEXT NOT NULL,
    user_username  TEXT,
    user_phone     TEXT,
    user_address   TEXT,
    items          TEXT NOT NULL,
    subtotal       REAL NOT NULL,
    delivery       REAL NOT NULL DEFAULT 0,
    gst            REAL NOT NULL DEFAULT 0,
    platform_fee   REAL NOT NULL DEFAULT 0,
    total          REAL NOT NULL,
    status_idx     INTEGER NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'Cash on Delivery',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    goal        TEXT NOT NULL,
    meal        TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    calories    INTEGER DEFAULT 0,
    protein     REAL DEFAULT 0,
    carbs       REAL DEFAULT 0,
    fat         REAL DEFAULT 0,
    price       REAL NOT NULL,
    emoji       TEXT DEFAULT '🍱',
    tag         TEXT,
    prep_time   TEXT DEFAULT '15m',
    is_active   INTEGER NOT NULL DEFAULT 1,
    in_stock    INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plans (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    price      REAL NOT NULL,
    period     TEXT NOT NULL,
    save_badge TEXT,
    is_popular INTEGER NOT NULL DEFAULT 0,
    color      TEXT DEFAULT '#4ade80',
    features   TEXT NOT NULL DEFAULT '[]',
    is_active  INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS plan_activations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    user_name    TEXT NOT NULL,
    user_username TEXT,
    user_phone   TEXT,
    plan_id      TEXT NOT NULL,
    plan_name    TEXT NOT NULL,
    plan_price   REAL NOT NULL,
    plan_per     TEXT NOT NULL,
    activated_at TEXT NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'Paid',
    is_active    INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    icon       TEXT,
    label      TEXT NOT NULL,
    message    TEXT NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status_idx, created_at);
  CREATE INDEX IF NOT EXISTS idx_menu_goal_meal ON menu_items(goal, meal);
  CREATE INDEX IF NOT EXISTS idx_otps_ident     ON otps(identifier, type);
  CREATE INDEX IF NOT EXISTS idx_notifs_user    ON notifications(user_id, is_read);
`);

// ════════════════════════════════════════════════════════════════
// SEED DATA (runs only on first start)
// ════════════════════════════════════════════════════════════════
const seedAll = db.transaction(() => {
  // Admin accounts — hashed on first seed
  const adminsData = [
    { id:1, name:'Anantharaje Einstein', role:'Super Admin', username:'Anantharajmech', raw:'ananthaarthi160893' },
    { id:2, name:'Aarthi',               role:'Manager',     username:'Aarthimech',     raw:'aarthiananth160893' },
    { id:3, name:'Ajith',                role:'Staff',        username:'Ajithmech',      raw:'ajithmerga160893'  },
  ];
  const insAdmin = db.prepare('INSERT OR IGNORE INTO admins (id,name,role,username,password,is_active) VALUES (?,?,?,?,?,1)');
  for (const a of adminsData) insAdmin.run(a.id, a.name, a.role, a.username, bcrypt.hashSync(a.raw, 12));

  // Default settings
  const defaults = {
    delivery_charge:'40', free_delivery_min:'400', platform_fee:'10', gst:'5',
    app_name:'Cosfit', tagline:'Eat Smart · Live Strong', currency:'₹',
    support_phone:'8778148899', support_email:'anantharajeinstein@gmail.com',
  };
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
  for (const [k,v] of Object.entries(defaults)) insSetting.run(k,v);

  // Plans
  const plansData = [
    { id:'w', label:'Weekly',  price:499,  period:'week',  save_badge:null,        is_popular:0, color:'#60a5fa', features:['Personalized meal plan','Calorie & macro tracking','Free delivery on all orders','Priority customer support','Daily health tips'] },
    { id:'m', label:'Monthly', price:1499, period:'month', save_badge:'Save 25%',  is_popular:1, color:'#4ade80', features:['Everything in Weekly','Advanced nutrition analytics','Chef special exclusive items','Dedicated health coach','Weekly progress reports','Meal prep guidance'] },
    { id:'y', label:'Yearly',  price:9999, period:'year',  save_badge:'Save 58%',  is_popular:0, color:'#fbbf24', features:['Everything in Monthly','Annual health assessment','Exclusive premium recipes','Family plan for 4 members','Priority chef requests','Premium VIP badge','Yearly health report'] },
  ];
  const insPlan = db.prepare('INSERT OR IGNORE INTO plans (id,label,price,period,save_badge,is_popular,color,features) VALUES (?,?,?,?,?,?,?,?)');
  for (const p of plansData) insPlan.run(p.id,p.label,p.price,p.period,p.save_badge,p.is_popular,p.color,JSON.stringify(p.features));

  // Menu items (only if empty)
  const menuCount = db.prepare('SELECT COUNT(*) as c FROM menu_items').get().c;
  if (menuCount === 0) {
    const now = Date.now();
    const insMenu = db.prepare('INSERT INTO menu_items (goal,meal,name,description,calories,protein,carbs,fat,price,emoji,tag,prep_time,is_active,in_stock,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?)');
    const M = [
      // WEIGHT LOSS
      ['weight_loss','breakfast','Green Detox Smoothie','Spinach, apple, ginger, lemon',185,5,32,3,129,'🥤','Detox','5m'],
      ['weight_loss','breakfast','Oats Berry Bowl','Rolled oats, mixed berries, chia seeds',240,9,38,5,149,'🥣','High Fiber','8m'],
      ['weight_loss','breakfast','Egg White Wrap','3 egg whites, spinach, whole grain',210,22,18,4,169,'🌯','Protein','10m'],
      ['weight_loss','breakfast','Watermelon Mint Juice','Fresh watermelon, mint, lime',90,1,22,0,89,'🍉','Low Cal','3m'],
      ['weight_loss','lunch','Grilled Chicken Salad','Lettuce, tomato, cucumber, lemon dressing',320,34,12,11,229,'🥗','Low Carb','15m'],
      ['weight_loss','lunch','Millet Khichdi','Foxtail millet, moong dal, turmeric',290,13,48,5,179,'🍲','Gluten Free','18m'],
      ['weight_loss','lunch','Tuna Quinoa Bowl','Quinoa, tuna, avocado, cherry tomato',380,36,28,12,279,'🥙','Omega-3','12m'],
      ['weight_loss','dinner','Steamed Fish & Greens','Tilapia, broccoli, beans, lemon',310,38,10,12,259,'🐟','Heart Healthy','20m'],
      ['weight_loss','dinner','Moong Dal Soup','Green lentil, ginger, pepper, coriander',195,13,28,3,139,'🍵','Digestive','15m'],
      ['weight_loss','dinner','Zucchini Noodles','Zucchini, cherry tomato, basil pesto',225,8,20,11,199,'🍝','Low Carb','12m'],
      // MUSCLE GAIN
      ['muscle_gain','breakfast','Protein Power Bowl','4 eggs, oats, banana, peanut butter',620,42,58,18,219,'💪','Muscle Fuel','12m'],
      ['muscle_gain','breakfast','Chicken Omelette','Chicken strips, 3 eggs, cheese, peppers',540,48,8,22,239,'🍳','High Protein','12m'],
      ['muscle_gain','breakfast','Mass Gainer Shake','Milk, banana, oats, whey, almond butter',780,55,80,20,249,'🥛','Mass Builder','5m'],
      ['muscle_gain','lunch','Chicken Quinoa Feast','250g grilled chicken, quinoa, broccoli',680,56,55,16,329,'🍗','Muscle Gain','20m'],
      ['muscle_gain','lunch','Paneer Power Thali','Paneer tikka, brown rice, dal, salad',720,44,72,24,299,'🧀','Vegetarian','22m'],
      ['muscle_gain','lunch','Salmon Rice Bowl','Grilled salmon, jasmine rice, edamame',660,52,60,18,349,'🍣','Omega-3','18m'],
      ['muscle_gain','dinner','Steak & Sweet Potato','Lean beef steak, sweet potato mash',690,54,48,22,389,'🥩','Iron Rich','25m'],
      ['muscle_gain','dinner','Tuna Pasta Bake','Whole wheat pasta, tuna, tomato sauce',610,46,65,12,269,'🍝','High Protein','20m'],
      ['muscle_gain','dinner','Egg Bhurji & Roti','Scrambled eggs, 2 whole wheat rotis',520,38,42,18,189,'🥚','Classic','15m'],
      // GENERAL
      ['general','breakfast','Avocado Toast','Multigrain bread, avocado, seeds, lemon',310,10,34,16,179,'🥑','Healthy Fat','8m'],
      ['general','breakfast','Idli Sambar','3 idlis, sambar, coconut chutney',280,9,52,3,119,'🫕','Traditional','10m'],
      ['general','breakfast','Masala Dosa','Crispy dosa, potato masala, chutneys',370,8,62,10,149,'🫓','Traditional','15m'],
      ['general','breakfast','Banana Walnut Smoothie','Banana, walnut, dates, almond milk',340,8,48,12,149,'🍌','Energy','5m'],
      ['general','lunch','Dal Tadka & Brown Rice','Yellow dal, ghee, brown rice, pickle',440,18,72,8,159,'🍚','Classic','18m'],
      ['general','lunch','Chicken Biryani Bowl','Basmati rice, chicken, saffron, raita',520,32,62,14,249,'🍛','Flavourful','25m'],
      ['general','lunch','Veggie Buddha Bowl','Roasted veg, chickpeas, tahini, greens',420,16,58,14,219,'🥗','Plant Based','15m'],
      ['general','lunch','Rajma Chawal','Red kidney beans, white rice, salad',480,20,78,8,149,'🫘','Protein Rich','20m'],
      ['general','dinner','Palak Paneer & Roti','Spinach gravy, cottage cheese, 2 rotis',390,22,44,14,189,'🥬','Iron Rich','20m'],
      ['general','dinner','Grilled Veg Platter','Mixed grilled veg, hummus, pita bread',320,12,48,8,199,'🫕','Light','15m'],
      ['general','dinner','Fish Curry & Rice','Tilapia fish curry, steamed basmati rice',430,36,52,10,229,'🐠','Omega-3','22m'],
    ];
    for (const m of M) insMenu.run(...m, now, now);
  }
});
seedAll();

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════
const genOTP      = () => String(Math.floor(100000 + Math.random() * 900000));
const mkToken     = (payload, exp) => jwt.sign(payload, JWT_SECRET, { expiresIn: exp });
const chkToken    = (token) => jwt.verify(token, JWT_SECRET);
const validate    = (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return res.status(400).json({ error: e.array()[0].msg }); next(); };
const getSettings = () => db.prepare('SELECT key, value FROM settings').all().reduce((o,r) => ({...o,[r.key]:r.value}), {});

const storeOTP = (identifier, code, type) => {
  db.prepare('DELETE FROM otps WHERE identifier=? AND type=?').run(identifier.toLowerCase(), type);
  db.prepare('INSERT INTO otps (identifier,code,type,expires_at,created_at) VALUES (?,?,?,?,?)')
    .run(identifier.toLowerCase(), code, type, Date.now() + 10*60*1000, Date.now());
};

const checkOTP = (identifier, code, type) => {
  const r = db.prepare('SELECT * FROM otps WHERE identifier=? AND type=? AND used=0 ORDER BY created_at DESC LIMIT 1')
    .get(identifier.toLowerCase(), type);
  if (!r)             return { ok:false, msg:'OTP not found. Please request a new one.' };
  if (Date.now()>r.expires_at) return { ok:false, msg:'OTP has expired. Please request a new one.' };
  if (r.code !== code) return { ok:false, msg:'Wrong OTP. Please check and try again.' };
  db.prepare('UPDATE otps SET used=1 WHERE id=?').run(r.id);
  return { ok:true };
};

const sendEmail = async (to, subject, html) => {
  if (!GMAIL_USER || !GMAIL_PASS) {
    console.log(`\n📧 [MOCK EMAIL] To: ${to}\n   Subject: ${subject}\n   (Configure GMAIL_USER & GMAIL_APP_PASSWORD to send real emails)\n`);
    return false;
  }
  const t = nodemailer.createTransport({ service:'gmail', auth:{ user:GMAIL_USER, pass:GMAIL_PASS } });
  await t.sendMail({ from:`Cosfit 🥗 <${GMAIL_USER}>`, to, subject, html });
  return true;
};

const emailOTPHtml = (name, otp, purpose='Reset') => `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f5f5f5;border-radius:16px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#4ade80,#22c55e);padding:28px 32px">
    <h1 style="color:#fff;margin:0;font-size:28px;font-weight:900">🥗 Cosfit</h1>
    <p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:14px">Eat Smart · Live Strong</p>
  </div>
  <div style="padding:32px;background:#fff">
    <h2 style="color:#060c08;font-size:20px;margin:0 0 12px">Password ${purpose} OTP</h2>
    <p style="color:#555;line-height:1.6">Hi <strong>${name}</strong>,</p>
    <p style="color:#555;line-height:1.6">Here is your One-Time Password (OTP):</p>
    <div style="background:#060c08;border-radius:14px;padding:28px;text-align:center;margin:24px 0">
      <span style="color:#4ade80;font-size:40px;font-weight:900;letter-spacing:10px">${otp}</span>
    </div>
    <p style="color:#777;font-size:13px">⏱ Valid for <strong>10 minutes</strong>. Do not share this OTP with anyone.</p>
    <p style="color:#999;font-size:12px;margin-top:24px">If you didn't request this, please ignore this email. Your account is safe.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="color:#bbb;font-size:11px;text-align:center">© 2024 Cosfit · Coscoom Creative Tech Solutions</p>
  </div>
</div>`;

const menuToFoods = (rows) => {
  const out = {
    weight_loss:{ breakfast:[], lunch:[], dinner:[] },
    muscle_gain:{ breakfast:[], lunch:[], dinner:[] },
    general:    { breakfast:[], lunch:[], dinner:[] },
  };
  for (const r of rows) {
    if (out[r.goal]?.[r.meal]) out[r.goal][r.meal].push({
      id:r.id, name:r.name, desc:r.description, cal:r.calories,
      p:r.protein, c:r.carbs, f:r.fat, price:r.price,
      emoji:r.emoji, tag:r.tag, time:r.prep_time,
      active:!!r.is_active, stock:!!r.in_stock,
    });
  }
  return out;
};

const safeUser = (u) => {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
};

// ════════════════════════════════════════════════════════════════
// EXPRESS APP
// ════════════════════════════════════════════════════════════════
const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: IS_PROD ? ALLOWED : '*', credentials: true }));
app.use(compression());
app.use(morgan(IS_PROD ? 'combined' : 'dev'));
app.use(express.json({ limit:'10mb' }));
app.use(express.urlencoded({ extended:true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate Limiters ───────────────────────────────────────────
const authLim = rateLimit({ windowMs:15*60*1000, max:10, message:{ error:'Too many attempts. Try again in 15 minutes.' }, standardHeaders:true, legacyHeaders:false });
const otpLim  = rateLimit({ windowMs:60*1000,    max:3,  message:{ error:'Too many OTP requests. Wait 1 minute.' } });
const apiLim  = rateLimit({ windowMs:60*1000,    max:120, message:{ error:'Too many requests.' } });
app.use('/api/', apiLim);

// ── Auth Middleware ─────────────────────────────────────────
const requireUser = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ','');
    if (!token) return res.status(401).json({ error:'Authentication required' });
    const dec = chkToken(token);
    if (dec.type !== 'user') return res.status(401).json({ error:'Invalid token' });
    const u = db.prepare('SELECT * FROM users WHERE id=? AND is_active=1').get(dec.id);
    if (!u) return res.status(401).json({ error:'Account not found or disabled' });
    req.user = u; next();
  } catch { res.status(401).json({ error:'Invalid or expired token. Please sign in again.' }); }
};

const requireAdmin = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ','');
    if (!token) return res.status(401).json({ error:'Admin authentication required' });
    const dec = chkToken(token);
    if (dec.type !== 'admin') return res.status(403).json({ error:'Admin access required' });
    const a = db.prepare('SELECT * FROM admins WHERE id=? AND is_active=1').get(dec.id);
    if (!a) return res.status(401).json({ error:'Admin account not found' });
    req.admin = a; next();
  } catch { res.status(401).json({ error:'Invalid or expired admin token.' }); }
};

// ════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', authLim, [
  body('name').trim().isLength({ min:2 }).withMessage('Name must be at least 2 characters'),
  body('username').trim().isLength({ min:3 }).matches(/^[a-z0-9_.]+$/i).withMessage('Username: min 3 chars, letters/numbers/_ only'),
  body('email').isEmail().normalizeEmail().withMessage('Invalid email address'),
  body('phone').matches(/^\d{10}$/).withMessage('Phone must be 10 digits'),
  body('password').isLength({ min:6 }).withMessage('Password must 
