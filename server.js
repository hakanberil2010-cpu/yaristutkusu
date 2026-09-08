const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/status", (req, res) => {
  res.json({ success: true, site: "YarışTutkusu", message: "Site başarıyla çalışıyor." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`YarışTutkusu çalışıyor: http://localhost:${PORT}`));
