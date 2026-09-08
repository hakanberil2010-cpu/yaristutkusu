const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

function json(res, status, data) {
  res.status(status).json(data);
}

function getPath(req) {
  const raw = (req.url || "").split("?")[0];
  const clean = raw.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  return clean || "status";
}

function getUser(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

async function supabase(path, options = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new Error("Supabase ortam değişkenleri eksik.");

  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!response.ok) {
    throw new Error(data?.message || data?.hint || text || "Veritabanı hatası");
  }
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const path = getPath(req);

    if (path === "status" && req.method === "GET") {
      return json(res, 200, {
        success: true,
        site: "YarışTutkusu",
        message: "API başarıyla çalışıyor."
      });
    }

    if (path === "register" && req.method === "POST") {
      const { name, email, password } = req.body || {};
      if (!name || !email || !password) {
        return json(res, 400, { success: false, message: "Ad, e-posta ve şifre zorunludur." });
      }
      if (String(password).length < 6) {
        return json(res, 400, { success: false, message: "Şifre en az 6 karakter olmalıdır." });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const existing = await supabase(
        `users?select=id&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`
      );

      if (existing?.length) {
        return json(res, 409, { success: false, message: "Bu e-posta adresi zaten kayıtlı." });
      }

      const password_hash = await bcrypt.hash(String(password), 10);
      const created = await supabase("users", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          name: String(name).trim(),
          email: normalizedEmail,
          password_hash
        })
      });

      const user = created[0];
      const token = jwt.sign(
        { id: user.id, name: user.name, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return json(res, 201, {
        success: true,
        token,
        user: { id: user.id, name: user.name, email: user.email }
      });
    }

    if (path === "login" && req.method === "POST") {
      const { email, password } = req.body || {};
      const normalizedEmail = String(email || "").trim().toLowerCase();

      if (!normalizedEmail || !password) {
        return json(res, 400, { success: false, message: "E-posta ve şifre zorunludur." });
      }

      const rows = await supabase(
        `users?select=id,name,email,password_hash&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`
      );

      if (!rows?.length) {
        return json(res, 401, { success: false, message: "E-posta veya şifre hatalı." });
      }

      const user = rows[0];
      const valid = await bcrypt.compare(String(password), user.password_hash);

      if (!valid) {
        return json(res, 401, { success: false, message: "E-posta veya şifre hatalı." });
      }

      const token = jwt.sign(
        { id: user.id, name: user.name, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return json(res, 200, {
        success: true,
        token,
        user: { id: user.id, name: user.name, email: user.email }
      });
    }

    if (path === "me" && req.method === "GET") {
      const user = getUser(req);
      if (!user) {
        return json(res, 401, { success: false, message: "Oturum geçersiz veya bulunamadı." });
      }
      return json(res, 200, {
        success: true,
        user: { id: user.id, name: user.name, email: user.email }
      });
    }

    if (path === "predictions" && req.method === "GET") {
      const rows = await supabase(
        "predictions?select=id,user_id,title,content,created_at,users(name)&order=created_at.desc"
      );
      return json(res, 200, { success: true, predictions: rows || [] });
    }

    if (path === "predictions" && req.method === "POST") {
      const user = getUser(req);
      if (!user) {
        return json(res, 401, {
          success: false,
          message: "Tahmin paylaşmak için giriş yapmalısınız."
        });
      }

      const { title, content } = req.body || {};
      if (!title || !content) {
        return json(res, 400, {
          success: false,
          message: "Başlık ve tahmin metni zorunludur."
        });
      }

      const created = await supabase("predictions", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          user_id: user.id,
          title: String(title).trim(),
          content: String(content).trim()
        })
      });

      return json(res, 201, { success: true, prediction: created[0] });
    }

    return json(res, 404, { success: false, message: "API endpoint bulunamadı." });
  } catch (error) {
    console.error(error);
    return json(res, 500, {
      success: false,
      message: error.message || "Sunucu hatası."
    });
  }
};
