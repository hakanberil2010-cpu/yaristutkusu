const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_IN_PRODUCTION";

const db = new Database("yaristutkusu.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  horse TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({error:"Giriş yapmanız gerekiyor."});
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({error:"Oturum geçersiz veya süresi dolmuş."});
  }
}

app.post("/api/register", async (req,res) => {
  const {username,email,password} = req.body || {};
  if (!username || !email || !password || password.length < 6)
    return res.status(400).json({error:"Kullanıcı adı, e-posta ve en az 6 karakterlik şifre gerekli."});
  try {
    const hash = await bcrypt.hash(password, 12);
    const info = db.prepare("INSERT INTO users(username,email,password_hash) VALUES(?,?,?)")
      .run(username.trim(), email.trim().toLowerCase(), hash);
    const token = jwt.sign({id:info.lastInsertRowid, username:username.trim()}, JWT_SECRET, {expiresIn:"7d"});
    res.json({token, user:{id:info.lastInsertRowid, username:username.trim()}});
  } catch (e) {
    res.status(409).json({error:"Bu kullanıcı adı veya e-posta zaten kayıtlı."});
  }
});

app.post("/api/login", async (req,res) => {
  const {email,password} = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email=?").get((email||"").trim().toLowerCase());
  if (!user || !(await bcrypt.compare(password||"", user.password_hash)))
    return res.status(401).json({error:"E-posta veya şifre hatalı."});
  const token = jwt.sign({id:user.id, username:user.username}, JWT_SECRET, {expiresIn:"7d"});
  res.json({token, user:{id:user.id, username:user.username}});
});

app.get("/api/me", auth, (req,res) => {
  const user = db.prepare("SELECT id,username,email,created_at FROM users WHERE id=?").get(req.user.id);
  res.json({user});
});

app.get("/api/predictions", (req,res) => {
  const rows = db.prepare(`
    SELECT p.id,p.title,p.content,p.horse,p.created_at,u.username
    FROM predictions p JOIN users u ON u.id=p.user_id
    ORDER BY p.id DESC LIMIT 50
  `).all();
  res.json({predictions:rows});
});

app.post("/api/predictions", auth, (req,res) => {
  const {title,content,horse} = req.body || {};
  if (!title || !content) return res.status(400).json({error:"Başlık ve tahmin metni gerekli."});
  const info = db.prepare("INSERT INTO predictions(user_id,title,content,horse) VALUES(?,?,?,?)")
    .run(req.user.id, title.trim(), content.trim(), (horse||"").trim());
  const row = db.prepare(`
    SELECT p.id,p.title,p.content,p.horse,p.created_at,u.username
    FROM predictions p JOIN users u ON u.id=p.user_id WHERE p.id=?
  `).get(info.lastInsertRowid);
  res.json({prediction:row});
});

app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT, () => console.log(`YarışTutkusu http://localhost:${PORT}`));
