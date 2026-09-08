const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

async function supabase(path, options = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || "Veritabanı hatası");
  }

  return data;
}

function getUser(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  try {
    return jwt.verify(
      header.slice(7),
      process.env.JWT_SECRET
    );
  } catch {
    return null;
  }
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(
      req.url,
      "https://yaristutkusu.vercel.app"
    );

    const route = url.pathname
      .replace(/^\/api\/?/, "")
      .replace(/\/$/, "");

    // API TEST
    if (req.method === "GET" && route === "status") {
      return res.json({
        success: true,
        message: "YarışTutkusu API çalışıyor!"
      });
    }

    // ÜYE KAYIT
    if (req.method === "POST" && route === "register") {

      const {
        username,
        email,
        password
      } = req.body || {};

      if (
        !username ||
        !email ||
        !password ||
        password.length < 6
      ) {
        return res.status(400).json({
          error:
            "Kullanıcı adı, e-posta ve en az 6 karakterlik şifre gerekli."
        });
      }

      const cleanUsername = username.trim();
      const cleanEmail = email.trim().toLowerCase();

      const existing = await supabase(
        `users?select=id&or=(username.eq.${encodeURIComponent(
          cleanUsername
        )},email.eq.${encodeURIComponent(
          cleanEmail
        )})`
      );

      if (existing.length > 0) {
        return res.status(409).json({
          error:
            "Bu kullanıcı adı veya e-posta zaten kayıtlı."
        });
      }

      const passwordHash =
        await bcrypt.hash(password, 12);

      const users = await supabase("users", {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify([
          {
            username: cleanUsername,
            email: cleanEmail,
            password_hash: passwordHash
          }
        ])
      });

      const user = users[0];

      return res.json({
        token: createToken(user),
        user: {
          id: user.id,
          username: user.username,
          email: user.email
        }
      });
    }

    // GİRİŞ
    if (req.method === "POST" && route === "login") {

      const {
        email,
        password
      } = req.body || {};

      const users = await supabase(
        `users?select=id,username,email,password_hash&email=eq.${encodeURIComponent(
          (email || "").trim().toLowerCase()
        )}&limit=1`
      );

      const user = users[0];

      if (
        !user ||
        !(await bcrypt.compare(
          password || "",
          user.password_hash
        ))
      ) {
        return res.status(401).json({
          error: "E-posta veya şifre hatalı."
        });
      }

      return res.json({
        token: createToken(user),
        user: {
          id: user.id,
          username: user.username,
          email: user.email
        }
      });
    }

    // KULLANICI BİLGİSİ
    if (req.method === "GET" && route === "me") {

      const user = getUser(req);

      if (!user) {
        return res.status(401).json({
          error: "Giriş yapmanız gerekiyor."
        });
      }

      const users = await supabase(
        `users?select=id,username,email,created_at&id=eq.${encodeURIComponent(
          user.id
        )}&limit=1`
      );

      return res.json({
        user: users[0]
      });
    }

    // TAHMİNLERİ GETİR
    if (
      req.method === "GET" &&
      route === "predictions"
    ) {

      const predictions = await supabase(
        "predictions?select=id,title,content,horse,created_at,users(username)&order=id.desc&limit=50"
      );

      return res.json({
        predictions: predictions.map(p => ({
          id: p.id,
          title: p.title,
          content: p.content,
          horse: p.horse,
          created_at: p.created_at,
          username:
            p.users?.username || "Üye"
        }))
      });
    }

    // TAHMİN PAYLAŞ
    if (
      req.method === "POST" &&
      route === "predictions"
    ) {

      const user = getUser(req);

      if (!user) {
        return res.status(401).json({
          error:
            "Tahmin paylaşmak için giriş yapmalısınız."
        });
      }

      const {
        title,
        content,
        horse
      } = req.body || {};

      if (!title || !content) {
        return res.status(400).json({
          error:
            "Başlık ve tahmin metni gerekli."
        });
      }

      const predictions =
        await supabase("predictions", {
          method: "POST",
          headers: {
            Prefer: "return=representation"
          },
          body: JSON.stringify([
            {
              user_id: user.id,
              title: title.trim(),
              content: content.trim(),
              horse: (horse || "").trim()
            }
          ])
        });

      return res.status(201).json({
        prediction: predictions[0]
      });
    }

    return res.status(404).json({
      error: "API endpoint bulunamadı."
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error:
        "Sunucu hatası. Veritabanı ayarlarını kontrol edin."
    });
  }
};
