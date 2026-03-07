const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");
require("dotenv").config();

const TMDB_KEY = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const cache = new NodeCache({ stdTTL: 3600 });

// ─── Ruh Hali Tanımları ───────────────────────────────────────────────────────
const MOODS = {
  mutlu:      { label: "😄 Mutlu & Enerjik",   movieGenres: [35],    tvGenres: [35],    sort: "popularity.desc" },
  romantik:   { label: "🌹 Romantik Akşam",    movieGenres: [10749], tvGenres: [18],    sort: "vote_average.desc" },
  duygusal:   { label: "😢 İyi Bir Ağlama",    movieGenres: [18],    tvGenres: [18],    sort: "vote_average.desc", voteMin: 300 },
  aksiyon:    { label: "💥 Aksiyon & Gerilim", movieGenres: [28],    tvGenres: [10759], sort: "popularity.desc" },
  fantezi:    { label: "🧙 Fantezi & Macera",  movieGenres: [14],    tvGenres: [10765], sort: "popularity.desc" },
  gizem:      { label: "🔍 Suç & Gizem",       movieGenres: [80],    tvGenres: [80],    sort: "popularity.desc" },
  bilimkurgu: { label: "🚀 Bilim Kurgu",        movieGenres: [878],   tvGenres: [10765], sort: "popularity.desc" },
  korku:      { label: "👻 Korku Gecesi",       movieGenres: [27],    tvGenres: [27],    sort: "popularity.desc" },
  belgesel:   { label: "🎙️ Belgesel & Gerçek", movieGenres: [99],    tvGenres: [99],    sort: "popularity.desc" },
  nostalji:   { label: "🕰️ Nostalji",          movieGenres: [18],    tvGenres: [18],    sort: "vote_average.desc", voteMin: 200, yearMax: "1999" },
};

const MOOD_KEYS   = Object.keys(MOODS);
const MOOD_LABELS = MOOD_KEYS.map((k) => MOODS[k].label);

// ─── İkinci Kademe Filtreler ──────────────────────────────────────────────────
// Stremio, extra içinde birden fazla filtre destekler.
// Kullanıcı önce mood (genre) seçer; ardından isteğe bağlı puan ve yıl seçebilir.

const RATING_OPTIONS = [
  { label: "⭐ Tüm Puanlar", min: 0   },
  { label: "⭐ 6+",          min: 6.0 },
  { label: "⭐ 7+",          min: 7.0 },
  { label: "⭐ 8+",          min: 8.0 },
  { label: "⭐ 9+",          min: 9.0 },
];
const RATING_LABELS = RATING_OPTIONS.map((r) => r.label);

const YEAR_OPTIONS = [
  { label: "📅 Tüm Yıllar",     from: null,   to: null   },
  { label: "📅 1980 ve öncesi", from: null,   to: "1980" },
  { label: "📅 1980'ler",       from: "1980", to: "1989" },
  { label: "📅 1990'lar",       from: "1990", to: "1999" },
  { label: "📅 2000'ler",       from: "2000", to: "2009" },
  { label: "📅 2010'lar",       from: "2010", to: "2019" },
  { label: "📅 2020 ve sonrası",from: "2020", to: null   },
];
const YEAR_LABELS = YEAR_OPTIONS.map((y) => y.label);

// ─── Manifest ─────────────────────────────────────────────────────────────────
const manifest = {
  id: "community.moodflix",
  version: "1.2.0",
  name: "MoodFlix",
  description: "Stremio ve Nuvio'da ruh haline göre film ve dizi keşfet. 🎬",
  logo: `${process.env.ADDON_URL || "http://localhost:7000"}/logo.svg`,
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  idPrefixes: ["tmdb:"],
  behaviorHints: {
    configurable: true,
    configurationRequired: false,
  },
  catalogs: [
    {
      id: "moodflix_all",
      type: "movie",
      name: "🎬 MoodFlix",
      extra: [
        { name: "genre",  isRequired: false, options: MOOD_LABELS   },
        { name: "rating", isRequired: false, options: RATING_LABELS },
        { name: "year",   isRequired: false, options: YEAR_LABELS   },
        { name: "skip",   isRequired: false },
      ],
    },
    {
      id: "moodflix_all_series",
      type: "series",
      name: "📺 MoodFlix",
      extra: [
        { name: "genre",  isRequired: false, options: MOOD_LABELS   },
        { name: "rating", isRequired: false, options: RATING_LABELS },
        { name: "year",   isRequired: false, options: YEAR_LABELS   },
        { name: "skip",   isRequired: false },
      ],
    },
  ],
};

const builder = new addonBuilder(manifest);

// ─── Extra'dan filtre değerlerini çöz ────────────────────────────────────────
function resolveFilters(extra) {
  const ratingOpt = RATING_OPTIONS.find((r) => r.label === extra?.rating);
  const minRating = ratingOpt ? ratingOpt.min : 0;

  const yearOpt = YEAR_OPTIONS.find((y) => y.label === extra?.year);
  const yearFrom = yearOpt ? yearOpt.from : null;
  const yearTo   = yearOpt ? yearOpt.to   : null;

  return { minRating, yearFrom, yearTo };
}

// ─── TMDB Fetch (tek sayfa) ──────────────────────────────────────────────────
async function fetchMoodPage(moodKey, type, page, filters) {
  const { minRating, yearFrom, yearTo } = filters;
  const cacheKey = `${moodKey}_${type}_p${page}_r${minRating}_y${yearFrom}-${yearTo}`;

  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const cfg       = MOODS[moodKey];
  const mediaType = type === "series" ? "tv" : "movie";
  const genres    = type === "series" ? cfg.tvGenres : cfg.movieGenres;

  // Nostalji mood'u kendi yıl kısıtını korur; diğerlerinde kullanıcı filtresi geçerli
  const effectiveYearMax = cfg.yearMax || (yearTo   ? yearTo   : null);
  const effectiveYearMin = cfg.yearMax ? null       : (yearFrom ? yearFrom : null);
  const effectiveRating  = minRating > 0 ? minRating : (cfg.yearMax ? 7.0 : 6.0);

  const params = {
    api_key:            TMDB_KEY,
    with_genres:        genres.join(","),
    sort_by:            cfg.sort,
    page,
    "vote_count.gte":   type === "series" ? (cfg.voteMin || 200) : (cfg.voteMin || 500),
    "vote_average.gte": effectiveRating,
    include_adult:      false,
    language:           "en-US",
  };

  const dateField = mediaType === "movie" ? "release_date" : "first_air_date";
  if (effectiveYearMax) params[`${dateField}.lte`] = `${effectiveYearMax}-12-31`;
  if (effectiveYearMin) params[`${dateField}.gte`] = `${effectiveYearMin}-01-01`;

  try {
    const { data } = await axios.get(`${TMDB_BASE}/discover/${mediaType}`, { params });
    const results  = (data.results || [])
      .filter((item) => item.poster_path)
      .map((item) => ({
        id:          `tmdb:${item.id}`,
        type,
        name:        item.title || item.name,
        poster:      `https://image.tmdb.org/t/p/w500${item.poster_path}`,
        background:  item.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
          : null,
        description: item.overview,
        releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4),
        imdbRating:  item.vote_average ? item.vote_average.toFixed(1) : null,
      }));

    cache.set(cacheKey, results);
    return results;
  } catch (err) {
    console.error(`TMDB hata [${moodKey}/${type}] sayfa ${page}:`, err.message);
    return [];
  }
}

// ─── 75 İçerik için 4 Sayfa Çek ──────────────────────────────────────────────
async function fetchMood(moodKey, type, skip = 0, filters = {}) {
  const ITEMS_PER_PAGE = 20;
  const TARGET         = 75;
  const startPage      = Math.floor(skip / ITEMS_PER_PAGE) + 1;
  const pagesToFetch   = Math.ceil(TARGET / ITEMS_PER_PAGE);

  const pages = await Promise.all(
    Array.from({ length: pagesToFetch }, (_, i) =>
      fetchMoodPage(moodKey, type, startPage + i, filters)
    )
  );

  const seen    = new Set();
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
  const isMovie  = id === "moodflix_all"        && type === "movie";
  const isSeries = id === "moodflix_all_series" && type === "series";
  if (!isMovie && !isSeries) return { metas: [] };

  const filters = resolveFilters(extra);
  const skip    = extra?.skip ? Number(extra.skip) : 0;

  console.log(
    `🎬 [${type}] mood=${extra?.genre || "tümü"} | ` +
    `puan≥${filters.minRating} | ` +
    `yıl: ${filters.yearFrom || "∞"}-${filters.yearTo || "∞"}`
  );

  // Mood seçildiyse: o mood + filtrelerle sonuçlar
  if (extra?.genre) {
    const moodKey = MOOD_KEYS.find((k) => MOODS[k].label === extra.genre);
    if (!moodKey) return { metas: [] };
    const metas = await fetchMood(moodKey, type, skip, filters);
    return { metas };
  }

  // Ana sayfa: tüm moodlardan 6'şar içerik
  const allResults = await Promise.all(
    MOOD_KEYS.map((key) => fetchMood(key, type, 0, filters))
  );
  const metas = allResults.flatMap((items) => items.slice(0, 6));
  return { metas };
});

// ─── Meta Handler ─────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ type, id }) => {
  if (!id.startsWith("tmdb:")) return { meta: null };

  const tmdbId   = id.replace("tmdb:", "");
  const cacheKey = `meta_${type}_${tmdbId}`;
  const hit      = cache.get(cacheKey);
  if (hit) return { meta: hit };

  const mediaType = type === "series" ? "tv" : "movie";

  try {
    const { data } = await axios.get(`${TMDB_BASE}/${mediaType}/${tmdbId}`, {
      params: {
        api_key:            TMDB_KEY,
        language:           "tr-TR",
        append_to_response: "credits,videos",
      },
    });

    const meta = {
      id,
      type,
      name:        data.title || data.name,
      poster:      data.poster_path
        ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
        : null,
      background:  data.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`
        : null,
      description: data.overview,
      releaseInfo: (data.release_date || data.first_air_date || "").substring(0, 4),
      imdbRating:  data.vote_average ? data.vote_average.toFixed(1) : null,
      genres:      (data.genres || []).map((g) => g.name),
      cast:        (data.credits?.cast || []).slice(0, 5).map((a) => a.name),
      director:    (data.credits?.crew || [])
        .filter((c) => c.job === "Director")
        .slice(0, 2)
        .map((d) => d.name),
      trailers:    (data.videos?.results || [])
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

// ─── Sunucu ───────────────────────────────────────────────────────────────────
const PORT    = process.env.PORT || 7000;
const express = require("express");
const fs      = require("fs");
const path    = require("path");
const { getRouter } = require("stremio-addon-sdk");

const app = express();

// Configure sayfası
app.get("/configure", (req, res) => {
  const p = path.join(__dirname, "configure.html");
  if (fs.existsSync(p)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    fs.createReadStream(p).pipe(res);
  } else {
    res.status(404).send("Configure page not found");
  }
});

// Logo
app.get("/logo.svg", (req, res) => {
  const p = path.join(__dirname, "logo.svg");
  if (fs.existsSync(p)) {
    res.setHeader("Content-Type", "image/svg+xml");
    fs.createReadStream(p).pipe(res);
  } else {
    res.status(404).send("Not found");
  }
});

app.use("/", getRouter(builder.getInterface()));

app.listen(PORT, () => {
  console.log(`🎬 MoodFlix çalışıyor → http://localhost:${PORT}/manifest.json`);
  console.log(`⚙️  Configure     → http://localhost:${PORT}/configure`);
  console.log(`🖼️  Logo          → http://localhost:${PORT}/logo.svg`);
});
