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

// TMDB TV türleri (film türlerinden FARKLI):
// 10759=Action&Adventure, 10765=Sci-Fi&Fantasy, 10768=War&Politics
// 16=Animation, 35=Comedy, 80=Crime, 99=Documentary, 18=Drama
// 10751=Family, 10762=Kids, 9648=Mystery, 10764=Reality, 10766=Soap, 37=Western
// NOT: with_genres'da | (pipe) = OR, , (comma) = AND

const MOODS = {
  mutlu: {
    label: "😄 Mutlu & Enerjik",
    movieGenres: [35, 10751],   // Comedy, Family
    tvGenres:    [35, 10751, 16], // Comedy, Family, Animation
    sort: "popularity.desc",
  },
  romantik: {
    label: "🌹 Romantik Akşam",
    movieGenres: [10749, 18],   // Romance, Drama
    tvGenres:    [18],          // TV'de Romance türü yok, Drama yeterli
    sort: "vote_average.desc",
  },
  duygusal: {
    label: "😢 İyi Bir Ağlama",
    movieGenres: [18],          // Drama
    tvGenres:    [18],          // Drama
    sort: "vote_average.desc",
    voteMin: 500,
  },
  aksiyon: {
    label: "💥 Aksiyon & Gerilim",
    movieGenres: [28, 53],      // Action, Thriller
    tvGenres:    [10759, 80],   // Action & Adventure, Crime
    sort: "popularity.desc",
  },
  fantezi: {
    label: "🧙 Fantezi & Macera",
    movieGenres: [14, 12],      // Fantasy, Adventure
    tvGenres:    [10765, 10759],// Sci-Fi & Fantasy, Action & Adventure
    sort: "popularity.desc",
  },
  gizem: {
    label: "🔍 Suç & Gizem",
    movieGenres: [80, 9648],    // Crime, Mystery
    tvGenres:    [80, 9648],    // Crime, Mystery — her ikisi TV'de de var
    sort: "popularity.desc",
  },
  bilimkurgu: {
    label: "🚀 Bilim Kurgu",
    movieGenres: [878],         // Science Fiction
    tvGenres:    [10765],       // Sci-Fi & Fantasy
    sort: "popularity.desc",
  },
  korku: {
    label: "👻 Korku Gecesi",
    movieGenres: [27, 53],      // Horror, Thriller
    tvGenres:    [27, 9648],    // Horror, Mystery — TV'de Thriller yok
    sort: "popularity.desc",
  },
  belgesel: {
    label: "🎙️ Belgesel & Gerçek",
    movieGenres: [99],          // Documentary
    tvGenres:    [99],          // Documentary — TV'de de var
    sort: "popularity.desc",
  },
  nostalji: {
    label: "🕰️ Nostalji",
    movieGenres: [18, 35],      // Drama, Comedy
    tvGenres:    [18, 35],      // Drama, Comedy
    sort: "vote_average.desc",
    voteMin: 500,
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

// ─── TMDB Fetch ───────────────────────────────────────────────────────────────
async function fetchMood(moodKey, type, page = 1) {
  const cacheKey = `${moodKey}_${type}_${page}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const cfg = MOODS[moodKey];
  const mediaType = type === "series" ? "tv" : "movie";
  const genres = type === "series" ? cfg.tvGenres : cfg.movieGenres;

  const params = {
    api_key: TMDB_KEY,
    with_genres: genres.join("|"),  // | = OR, , = AND — OR çok daha fazla sonuç verir
    sort_by: cfg.sort,
    page,
    "vote_count.gte": type === "series" ? (cfg.voteMin ? Math.floor(cfg.voteMin / 5) : 200) : (cfg.voteMin || 1000),
    "vote_average.gte": cfg.yearMax ? 7.0 : (type === "series" ? 6.0 : 6.5),
    include_adult: false,
    language: "en-US",
  };

  if (cfg.yearMax) {
    // Nostalji: 1999 öncesi
    params[mediaType === "movie" ? "release_date.lte" : "first_air_date.lte"] =
      `${cfg.yearMax}-12-31`;
  } else {
    // Diğerleri: 2010 sonrası — güncel ve popüler içerikler
    params[mediaType === "movie" ? "release_date.gte" : "first_air_date.gte"] = "2010-01-01";
  }

  try {
    const { data } = await axios.get(`${TMDB_BASE}/discover/${mediaType}`, { params });
    // Poster eksik olanlar için en-US ile tekrar çekmeye gerek yok,
    // TMDB w500 poster_path her zaman İngilizce poster döner, dil bağımsız
    const results = (data.results || [])
      .filter((item) => item.poster_path) // postersiz içerikleri filtrele
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
    console.error(`TMDB hata [${moodKey}/${type}]:`, err.message);
    return [];
  }
}

// ─── Catalog Handler ──────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const isMovie = id === "moodflix_all" && type === "movie";
  const isSeries = id === "moodflix_all_series" && type === "series";
  if (!isMovie && !isSeries) return { metas: [] };

  const selectedGenre = extra?.genre;
  const page = extra?.skip ? Math.floor(Number(extra.skip) / 20) + 1 : 1;

  // Filtre seçildiyse: sadece o mood
  if (selectedGenre) {
    const moodKey = MOOD_KEYS.find((k) => MOODS[k].label === selectedGenre);
    if (!moodKey) return { metas: [] };
    const metas = await fetchMood(moodKey, type, page);
    return { metas };
  }

  // Filtre yoksa: tüm moodlardan 6'şar içerik, ana sayfa stili
  const allResults = await Promise.all(
    MOOD_KEYS.map((key) => fetchMood(key, type, 1))
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
