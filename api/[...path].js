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

    // ÜYELERİ GETİR
if (path === "users" && req.method === "GET") {
  const users = await supabase(
    "users?select=id,name,created_at,avatar_url&order=created_at.desc"
  );

  return json(res, 200, {
    success: true,
    users: (users || []).map(user => ({
      id: user.id,
      username: user.name,
created_at: user.created_at,
avatar_url: user.avatar_url
    }))
  });
}// TAHMİNLERİ GETİR
    // PROFİL FOTOĞRAFI YÜKLE
if (path === "users/avatar" && req.method === "POST") {

  const user = getUser(req);

  if (!user) {
    return json(res, 401, {
      success: false,
      message: "Giriş yapmalısınız."
    });
  }

  try {

    const { avatar } = req.body || {};

    if (!avatar || !avatar.includes("base64,")) {
      return json(res, 400, {
        success: false,
        message: "Geçerli bir fotoğraf gönderilmedi."
      });
    }

    const parts = avatar.split(",");

    const meta = parts[0];
    const base64Data = parts[1];

    const mimeMatch =
      meta.match(/data:(.*?);base64/);

    const mimeType =
      mimeMatch
        ? mimeMatch[1]
        : "image/jpeg";

    const extension =
      mimeType === "image/png"
        ? "png"
        : mimeType === "image/webp"
          ? "webp"
          : "jpg";

    const filePath =
      `${user.id}.${extension}`;

    const fileBuffer =
      Buffer.from(base64Data, "base64");

    const uploadUrl =
      `${process.env.SUPABASE_URL}/storage/v1/object/avatars/${filePath}`;

    const uploadResponse =
      await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Authorization":
            `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
          "apikey":
            process.env.SUPABASE_SECRET_KEY,
          "Content-Type":
            mimeType,
          "x-upsert":
            "true"
        },
        body: fileBuffer
      });

    if (!uploadResponse.ok) {

      const errorText =
        await uploadResponse.text();

      console.error(
        "Avatar upload error:",
        errorText
      );

      return json(res, 500, {
        success: false,
        message: "Fotoğraf yüklenemedi."
      });

    }

    const avatarUrl =
      `${process.env.SUPABASE_URL}/storage/v1/object/public/avatars/${filePath}`;

    await supabase(
      `users?id=eq.${user.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          avatar_url: avatarUrl
        })
      }
    );

    return json(res, 200, {
      success: true,
      avatar_url: avatarUrl
    });

  } catch (error) {

    console.error(error);

    return json(res, 500, {
      success: false,
      message: "Profil fotoğrafı kaydedilemedi."
    });

  }
}
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
// YORUMLARI GETİR
if (path === "comments" && req.method === "GET") {

  const predictionId = req.query.prediction_id;

  if (!predictionId) {
    return json(res, 400, {
      success: false,
      message: "Tahmin ID gerekli."
    });
  }

  const comments = await supabase(
    `comments?prediction_id=eq.${predictionId}&select=id,content,created_at,user_id,prediction_id,users(name,avatar_url)&order=created_at.asc`
  );

  return json(res, 200, {
    success: true,
    comments: (comments || []).map(comment => ({
      id: comment.id,
      prediction_id: comment.prediction_id,
      user_id: comment.user_id,
      content: comment.content,
      created_at: comment.created_at,
      username: comment.users?.name || "Üye",
      avatar_url: comment.users?.avatar_url || null
    }))
  });
}


// YORUM EKLE
if (path === "comments" && req.method === "POST") {

  const user = getUser(req);

  if (!user) {
    return json(res, 401, {
      success: false,
      message: "Yorum yazmak için giriş yapmalısınız."
    });
  }

  const {
    prediction_id,
    content
  } = req.body || {};

  const cleanContent =
    String(content || "").trim();

  if (!prediction_id || !cleanContent) {
    return json(res, 400, {
      success: false,
      message: "Yorum boş bırakılamaz."
    });
  }

  if (cleanContent.length > 500) {
    return json(res, 400, {
      success: false,
      message: "Yorum en fazla 500 karakter olabilir."
    });
  }

  const created = await supabase(
    "comments",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        prediction_id: Number(prediction_id),
        user_id: user.id,
        content: cleanContent
      })
    }
  );

  return json(res, 201, {
    success: true,
    comment: created?.[0] || null
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
