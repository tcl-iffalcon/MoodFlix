const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");
require("dotenv").config();

const TMDB_KEY = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const cache = new NodeCache({ stdTTL: 3600 });

// ─── Ruh Hali Tanımları ───────────────────────────────────────────────────────
// TMDB film ve dizi tür ID'leri farklıdır!
// Film:  Action=28, Thriller=53, Sci-Fi=878, Animation=16, Family=10751
// Dizi:  Action&Adventure=10759, Sci-Fi&Fantasy=10765, Animation=16, Family=10751
// Ortak: Drama=18, Comedy=35, Horror=27, Mystery=9648, Crime=80, Documentary=99, Romance=10749

// TMDB Film türleri: 28=Action, 53=Thriller, 878=SciFi, 27=Horror, 14=Fantasy
//   12=Adventure, 18=Drama, 35=Comedy, 80=Crime, 9648=Mystery, 99=Documentary
//   10749=Romance, 10751=Family, 16=Animation
// TMDB TV türleri:   10759=Action&Adventure, 10765=SciFi&Fantasy, 27=Horror
//   18=Drama, 35=Comedy, 80=Crime, 9648=Mystery, 99=Documentary, 10751=Family, 16=Animation
// NOT: Tek tür kullanmak en doğru eşleşmeyi sağlar

const MOODS = {
  mutlu: {
    label: "😄 Mutlu & Enerjik",
    movieGenres: [35],    // Comedy
    tvGenres:    [35],    // Comedy
    sort: "popularity.desc",
  },
  romantik: {
    label: "🌹 Romantik Akşam",
    movieGenres: [10749], // Romance
    tvGenres:    [18],    // Drama (TV'de Romance türü yok)
    sort: "vote_average.desc",
  },
  duygusal: {
    label: "😢 İyi Bir Ağlama",
    movieGenres: [18],    // Drama
    tvGenres:    [18],    // Drama
    sort: "vote_average.desc",
    voteMin: 300,
  },
  aksiyon: {
    label: "💥 Aksiyon & Gerilim",
    movieGenres: [28],    // Action
    tvGenres:    [10759], // Action & Adventure
    sort: "popularity.desc",
  },
  fantezi: {
    label: "🧙 Fantezi & Macera",
    movieGenres: [14],    // Fantasy
    tvGenres:    [10765], // Sci-Fi & Fantasy
    sort: "popularity.desc",
  },
  gizem: {
    label: "🔍 Suç & Gizem",
    movieGenres: [80],    // Crime
    tvGenres:    [80],    // Crime
    sort: "popularity.desc",
  },
  bilimkurgu: {
    label: "🚀 Bilim Kurgu",
    movieGenres: [878],   // Science Fiction
    tvGenres:    [10765], // Sci-Fi & Fantasy
    sort: "popularity.desc",
  },
  korku: {
    label: "👻 Korku Gecesi",
    movieGenres: [27],    // Horror
    tvGenres:    [27],    // Horror
    sort: "popularity.desc",
  },
  belgesel: {
    label: "🎙️ Belgesel & Gerçek",
    movieGenres: [99],    // Documentary
    tvGenres:    [99],    // Documentary
    sort: "popularity.desc",
  },
  nostalji: {
    label: "🕰️ Nostalji",
    movieGenres: [18],    // Drama
    tvGenres:    [18],    // Drama
    sort: "vote_average.desc",
    voteMin: 200,
    yearMax: "1999",
  },
};

const MOOD_KEYS = Object.keys(MOODS);
const MOOD_LABELS = MOOD_KEYS.map((k) => MOODS[k].label);

// ─── Manifest ─────────────────────────────────────────────────────────────────
const manifest = {
  id: "community.moodflix",
  version: "1.0.0",
  name: "MoodFlix",
  description: "Stremio ve Nuvio'da ruh haline göre film ve dizi keşfet. 🎬",
  logo: `${process.env.ADDON_URL || "http://localhost:7000"}/logo.svg`,
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  idPrefixes: ["tmdb:"],
  catalogs: [
    {
      id: "moodflix_all",
      type: "movie",
      name: "🎬 MoodFlix",
      extra: [
        { name: "genre", isRequired: false, options: MOOD_LABELS },
        { name: "skip", isRequired: false },
      ],
    },
    {
      id: "moodflix_all_series",
      type: "series",
      name: "📺 MoodFlix",
      extra: [
        { name: "genre", isRequired: false, options: MOOD_LABELS },
        { name: "skip", isRequired: false },
      ],
    },
  ],
};

const builder = new addonBuilder(manifest);

// ─── TMDB Fetch (tek sayfa) ──────────────────────────────────────────────────
async function fetchMoodPage(moodKey, type, page) {
  const cacheKey = `${moodKey}_${type}_p${page}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const cfg = MOODS[moodKey];
  const mediaType = type === "series" ? "tv" : "movie";
  const genres = type === "series" ? cfg.tvGenres : cfg.movieGenres;

  const params = {
    api_key: TMDB_KEY,
    with_genres: genres.join(","),  // Tek tür kullandığımız için AND/OR fark etmez
    sort_by: cfg.sort,
    page,
    "vote_count.gte": type === "series" ? (cfg.voteMin || 200) : (cfg.voteMin || 1000),
    "vote_average.gte": cfg.yearMax ? 7.0 : (type === "series" ? 6.0 : 6.5),
    include_adult: false,
    language: "en-US",
  };

  if (cfg.yearMax) {
    params[mediaType === "movie" ? "release_date.lte" : "first_air_date.lte"] =
      `${cfg.yearMax}-12-31`;
  } else {
    params[mediaType === "movie" ? "release_date.gte" : "first_air_date.gte"] = "2010-01-01";
  }

  try {
    const { data } = await axios.get(`${TMDB_BASE}/discover/${mediaType}`, { params });
    const results = (data.results || [])
      .filter((item) => item.poster_path)
      .map((item) => ({
        id: `tmdb:${item.id}`,
        type,
        name: item.title || item.name,
        poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
        background: item.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
          : null,
        description: item.overview,
        releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4),
        imdbRating: item.vote_average ? item.vote_average.toFixed(1) : null,
      }));

    cache.set(cacheKey, results);
    return results;
  } catch (err) {
    console.error(`TMDB hata [${moodKey}/${type}] sayfa ${page}:`, err.message);
    return [];
  }
}

// ─── 75 İçerik için 4 Sayfa Çek ──────────────────────────────────────────────
async function fetchMood(moodKey, type, skip = 0) {
  const ITEMS_PER_PAGE = 20;
  const TARGET = 75;
  const startPage = Math.floor(skip / ITEMS_PER_PAGE) + 1;
  const pagesToFetch = Math.ceil(TARGET / ITEMS_PER_PAGE); // 4 sayfa

  const pages = await Promise.all(
    Array.from({ length: pagesToFetch }, (_, i) => fetchMoodPage(moodKey, type, startPage + i))
  );

  // Tüm sayfaları birleştir, tekrarları temizle, 75'e kırp
  const seen = new Set();
  const results = pages
    .flat()
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, TARGET);

  return results;
}

// ─── Catalog Handler ──────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const isMovie = id === "moodflix_all" && type === "movie";
  const isSeries = id === "moodflix_all_series" && type === "series";
  if (!isMovie && !isSeries) return { metas: [] };

  const selectedGenre = extra?.genre;
  const skip = extra?.skip ? Number(extra.skip) : 0;

  // Filtre seçildiyse: sadece o mood, 75 içerik
  if (selectedGenre) {
    const moodKey = MOOD_KEYS.find((k) => MOODS[k].label === selectedGenre);
    if (!moodKey) return { metas: [] };
    const metas = await fetchMood(moodKey, type, skip);
    return { metas };
  }

  // Filtre yoksa: tüm moodlardan 6'şar içerik, ana sayfa stili
  const allResults = await Promise.all(
    MOOD_KEYS.map((key) => fetchMood(key, type, 0))
  );

  const metas = allResults.flatMap((items) => items.slice(0, 6));
  return { metas };
});

// ─── Meta Handler ─────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ type, id }) => {
  if (!id.startsWith("tmdb:")) return { meta: null };

  const tmdbId = id.replace("tmdb:", "");
  const cacheKey = `meta_${type}_${tmdbId}`;
  const hit = cache.get(cacheKey);
  if (hit) return { meta: hit };

  const mediaType = type === "series" ? "tv" : "movie";

  try {
    const { data } = await axios.get(`${TMDB_BASE}/${mediaType}/${tmdbId}`, {
      params: {
        api_key: TMDB_KEY,
        language: "tr-TR",
        append_to_response: "credits,videos",
      },
    });

    const meta = {
      id,
      type,
      name: data.title || data.name,
      poster: data.poster_path
        ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
        : null,
      background: data.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`
        : null,
      description: data.overview,
      releaseInfo: (data.release_date || data.first_air_date || "").substring(0, 4),
      imdbRating: data.vote_average ? data.vote_average.toFixed(1) : null,
      genres: (data.genres || []).map((g) => g.name),
      cast: (data.credits?.cast || []).slice(0, 5).map((a) => a.name),
      director: (data.credits?.crew || [])
        .filter((c) => c.job === "Director")
        .slice(0, 2)
        .map((d) => d.name),
      trailers: (data.videos?.results || [])
        .filter((v) => v.site === "YouTube" && v.type === "Trailer")
        .slice(0, 1)
        .map((v) => ({ source: v.key, type: "Trailer" })),
    };

    cache.set(cacheKey, meta);
    return { meta };
  } catch (err) {
    console.error(`Meta hata [${id}]:`, err.message);
    return { meta: null };
  }
});

// ─── Sunucu ───────────────────────────────────────────────────="────────────
const PORT = process.env.PORT || 7000;
const express = require("express");
const fs = require("fs");
const path = require("path");
const { getRouter } = require("stremio-addon-sdk");

const app = express();

// Logo endpoint
app.get("/logo.svg", (req, res) => {
  const logoPath = path.join(__dirname, "logo.svg");
  if (fs.existsSync(logoPath)) {
    res.setHeader("Content-Type", "image/svg+xml");
    fs.createReadStream(logoPath).pipe(res);
  } else {
    res.status(404).send("Not found");
  }
});

// Stremio addon router'ı Express'e bağla
app.use("/", getRouter(builder.getInterface()));

app.listen(PORT, () => {
  console.log(`🎬 MoodFlix çalışıyor → http://localhost:${PORT}/manifest.json`);
  console.log(`🖼️  Logo         → http://localhost:${PORT}/logo.svg`);
});
