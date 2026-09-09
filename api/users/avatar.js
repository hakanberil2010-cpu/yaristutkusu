const jwt = require("jsonwebtoken");

function json(res, status, data) {
  res.status(status).json(data);
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

async function readBody(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }

    return req.body;
  }

  return await new Promise((resolve) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

module.exports = async function handler(req, res) {

  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      message: "Sadece POST isteği kabul edilir."
    });
  }

  const user = getUser(req);

  if (!user) {
    return json(res, 401, {
      success: false,
      message: "Giriş yapmalısınız."
    });
  }

  try {

    const body = await readBody(req);
    const avatar = body.avatar;

    if (!avatar || !avatar.includes("base64,")) {
      return json(res, 400, {
        success: false,
        message: "Geçerli bir fotoğraf gönderilmedi."
      });
    }

    const parts = avatar.split(",");
    const meta = parts[0];
    const base64Data = parts[1];

    const mimeMatch = meta.match(/data:(.*?);base64/);

    const mimeType = mimeMatch
      ? mimeMatch[1]
      : "image/jpeg";

    let extension = "jpg";

    if (mimeType === "image/png") {
      extension = "png";
    } else if (mimeType === "image/webp") {
      extension = "webp";
    }

    const filePath = `${user.id}.${extension}`;

    const fileBuffer = Buffer.from(
      base64Data,
      "base64"
    );

    const uploadUrl =
      `${process.env.SUPABASE_URL}/storage/v1/object/avatars/${filePath}`;

    const uploadResponse = await fetch(uploadUrl, {
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
        message: "Fotoğraf Supabase'e yüklenemedi."
      });
    }

    const avatarUrl =
      `${process.env.SUPABASE_URL}/storage/v1/object/public/avatars/${filePath}`;

    const updateResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/users?id=eq.${user.id}`,
      {
        method: "PATCH",

        headers: {
          "Authorization":
            `Bearer ${process.env.SUPABASE_SECRET_KEY}`,

          "apikey":
            process.env.SUPABASE_SECRET_KEY,

          "Content-Type":
            "application/json",

          "Prefer":
            "return=minimal"
        },

        body: JSON.stringify({
          avatar_url: avatarUrl
        })
      }
    );

    if (!updateResponse.ok) {

      const errorText =
        await updateResponse.text();

      console.error(
        "User update error:",
        errorText
      );

      return json(res, 500, {
        success: false,
        message: "Profil fotoğrafı kullanıcıya kaydedilemedi."
      });
    }

    return json(res, 200, {
      success: true,
      avatar_url: avatarUrl
    });

  } catch (error) {

    console.error(
      "Avatar API error:",
      error
    );

    return json(res, 500, {
      success: false,
      message: "Profil fotoğrafı yüklenirken hata oluştu."
    });
  }
};
