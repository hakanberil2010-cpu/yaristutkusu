# YarışTutkusu

At yarışı yazıları ve üyelerin tahminlerini paylaşabildiği, yarış programı/kupon/bahis sistemi içermeyen başlangıç web sitesi.

## Özellikler
- Koyu lacivert + altın temalı responsive tasarım
- Ana sayfa, yazılar ve tahminler bölümü
- Üye kayıt / giriş
- Şifrelerin bcrypt ile hashlenmesi
- JWT tabanlı oturum
- SQLite veritabanı
- Üyelerin tahmin paylaşması
- Son tahminlerin herkese açık gösterimi
- Mobil uyum

## Kurulum
Node.js 18+ kurulu olmalı.

```bash
npm install
```

Üretimde mutlaka güçlü bir JWT_SECRET tanımlayın:

```bash
JWT_SECRET="guclu-bir-gizli-anahtar" npm start
```

Windows PowerShell:
```powershell
$env:JWT_SECRET="guclu-bir-gizli-anahtar"
npm start
```

Sonra tarayıcıdan:
`http://localhost:3000`

## Sonraki geliştirmeler
- Profil fotoğrafı ve profil sayfası
- Yorum / beğeni / takip sistemi
- Admin paneli ve içerik moderasyonu
- Makale yönetim paneli
- Görsel yükleme
- E-posta doğrulama ve şifre sıfırlama
- Spam/rate-limit ve daha güçlü güvenlik
- Canlı sunucuya deployment
