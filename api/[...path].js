const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

function json(res, status, data) {
  return res.status(status).json(data);
}

function getPath(req) {
  const raw = (req.url || "").split("?")[0];
  const clean = raw.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  return clean || "status";
}

function getUser(req) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) {
    return null;
  }

  try {
    return jwt.verify(
      auth.slice(7),
      process.env.JWT_SECRET
    );
  } catch {
    return null;
  }
}

async function supabase(path, options = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!base || !key) {
    throw new Error("Supabase ortam değişkenleri eksik.");
  }

  const response = await fetch(
    `${base}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.hint ||
      text ||
      "Veritabanı hatası"
    );
  }

  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const path = getPath(req);

    // API DURUM
    if (path === "status" && req.method === "GET") {
      return json(res, 200, {
        success: true,
        site: "YarışTutkusu",
        message: "API başarıyla çalışıyor."
      });
    }

    // KAYIT
    if (path === "register" && req.method === "POST") {
      const {
        username,
        name,
        email,
        password
      } = req.body || {};

      const cleanName = String(
        username ?? name ?? ""
      ).trim();

      const cleanEmail = String(
        email ?? ""
      ).trim().toLowerCase();

      if (!cleanName || !cleanEmail || !password) {
        return json(res, 400, {
          success: false,
          message: "Kullanıcı adı, e-posta ve şifre zorunludur."
        });
      }

      if (String(password).length < 6) {
        return json(res, 400, {
          success: false,
          message: "Şifre en az 6 karakter olmalıdır."
        });
      }

      const existing = await supabase(
        `users?select=id&email=eq.${encodeURIComponent(cleanEmail)}&limit=1`
      );

      if (existing?.length) {
        return json(res, 409, {
          success: false,
          message: "Bu e-posta adresi zaten kayıtlı."
        });
      }

      const password_hash = await bcrypt.hash(
        String(password),
        10
      );

      const created = await supabase(
        "users",
        {
          method: "POST",
          headers: {
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            name: cleanName,
            email: cleanEmail,
            password_hash
          })
        }
      );

      const user = created[0];

      const token = jwt.sign(
        {
          id: user.id,
          name: user.name,
          email: user.email
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "7d"
        }
      );

      return json(res, 201, {
        success: true,
        token,
        user: {
          id: user.id,
          username: user.name,
          email: user.email
        }
      });
    }

    // GİRİŞ
    if (path === "login" && req.method === "POST") {
      const {
        email,
        password
      } = req.body || {};

      const cleanEmail = String(
        email ?? ""
      ).trim().toLowerCase();

      if (!cleanEmail || !password) {
        return json(res, 400, {
          success: false,
          message: "E-posta ve şifre zorunludur."
        });
      }

      const users = await supabase(
        `users?select=id,name,email,password_hash&email=eq.${encodeURIComponent(cleanEmail)}&limit=1`
      );

      if (!users?.length) {
        return json(res, 401, {
          success: false,
          message: "E-posta veya şifre hatalı."
        });
      }

      const user = users[0];

      const valid = await bcrypt.compare(
        String(password),
        user.password_hash
      );

      if (!valid) {
        return json(res, 401, {
          success: false,
          message: "E-posta veya şifre hatalı."
        });
      }

      const token = jwt.sign(
        {
          id: user.id,
          name: user.name,
          email: user.email
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "7d"
        }
      );

      return json(res, 200, {
        success: true,
        token,
        user: {
          id: user.id,
          username: user.name,
          email: user.email
        }
      });
    }

    // OTURUM KONTROLÜ
    if (path === "me" && req.method === "GET") {
      const authUser = getUser(req);

      if (!authUser) {
        return json(res, 401, {
          success: false,
          message: "Oturum bulunamadı."
        });
      }

      const users = await supabase(
        `users?select=id,name,email&id=eq.${authUser.id}&limit=1`
      );

      if (!users?.length) {
        return json(res, 404, {
          success: false,
          message: "Kullanıcı bulunamadı."
        });
      }

      const user = users[0];

      return json(res, 200, {
        success: true,
        user: {
          id: user.id,
          username: user.name,
          email: user.email
        }
      });
    }

    // TAHMİNLERİ GETİR
    if (path === "predictions" && req.method === "GET") {
      const rows = await supabase(
        "predictions?select=id,user_id,title,horse,content,created_at,users(name)&order=created_at.desc"
      );

      const predictions = (rows || []).map((p) => ({
        id: p.id,
        user_id: p.user_id,
        username: p.users?.name || "Üye",
        title: p.title,
        horse: p.horse || "",
        content: p.content,
        created_at: p.created_at
      }));

      return json(res, 200, {
        success: true,
        predictions
      });
    }

    // TAHMİN PAYLAŞ
    if (path === "predictions" && req.method === "POST") {
      const authUser = getUser(req);

      if (!authUser) {
        return json(res, 401, {
          success: false,
          message: "Tahmin paylaşmak için giriş yapmalısınız."
        });
      }

      const {
        title,
        horse,
        content
      } = req.body || {};

      const cleanTitle = String(
        title ?? ""
      ).trim();

      const cleanHorse = String(
        horse ?? ""
      ).trim();

      const cleanContent = String(
        content ?? ""
      ).trim();

      if (!cleanTitle || !cleanContent) {
        return json(res, 400, {
          success: false,
          message: "Başlık ve tahmin içeriği zorunludur."
        });
      }

      const created = await supabase(
        "predictions",
        {
          method: "POST",
          headers: {
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            user_id: authUser.id,
            title: cleanTitle,
            horse: cleanHorse,
            content: cleanContent
          })
        }
      );

      return json(res, 201, {
        success: true,
        prediction: created[0]
      });
    }

    return json(res, 404, {
      success: false,
      message: "API endpoint bulunamadı."
    });

  } catch (error) {
    console.error(error);

    return json(res, 500, {
      success: false,
      message: error.message || "Sunucu hatası."
    });
  }
};
