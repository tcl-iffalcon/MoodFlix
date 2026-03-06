# 🎬 MoodFlix — Stremio Eklentisi

Ruh haline göre film ve dizi keşfet.

## Kurulum

```bash
npm install
npm start
```

## Stremio'ya Ekle

Eklenti çalıştıktan sonra Stremio'da şu adresi ekle:

```
http://localhost:7000/manifest.json
```

> Sunucuya deploy edersen `localhost` yerine sunucu adresini kullan.

## Kataloglar

| Katalog | Tür |
|---|---|
| 😄 Mutlu & Enerjik | Komedi, Animasyon |
| 😢 Duygusal | Drama, Romantik |
| 😰 Kaçmak İstiyorum | Macera, Fantezi |
| 😱 Heyecan İstiyorum | Aksiyon, Gerilim |
| 🧠 Düşünmek İstiyorum | Bilim Kurgu, Gizem |
| 😴 Rahatlamak İstiyorum | Belgesel, Komedi |
| 👻 Korku Gecesi | Korku |
| 🕰️ Nostalji | Klasikler (1999 öncesi) |

## Stream

Bu eklenti yalnızca **katalog ve metadata** sağlar.  
Stream için **Meteor** eklentisini Stremio'ya eklemen gerekiyor:

```
https://meteorfortheweebs.midnightignite.me/.../manifest.json
```

## Ortam Değişkenleri

| Değişken | Açıklama |
|---|---|
| `TMDB_API_KEY` | TMDB API anahtarın |
| `PORT` | Sunucu portu (varsayılan: 7000) |
