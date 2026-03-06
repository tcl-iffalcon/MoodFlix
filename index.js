const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");
require("dotenv").config();

const TMDB_KEY = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const cache = new NodeCache({ stdTTL: 3600 });

// ─── Ruh Hali Tanımları ───────────────────────────────────────────────────────
const MOODS = {
  mutlu:      { label: "😄 Mutlu & Enerjik",      genres: [35, 16],    sort: "popularity.desc" },
  duygusal:   { label: "😢 Duygusal",              genres: [18, 10749], sort: "vote_average.desc" },
  stresli:    { label: "😰 Kaçmak İstiyorum",      genres: [12, 14],    sort: "popularity.desc" },
  heyecan:    { label: "😱 Heyecan İstiyorum",     genres: [28, 53],    sort: "popularity.desc" },
  dusunmek:   { label: "🧠 Düşünmek İstiyorum",    genres: [878, 9648], sort: "vote_average.desc" },
  rahatlamak: { label: "😴 Rahatlamak İstiyorum",  genres: [99, 35],    sort: "vote_average.desc" },
  korku:      { label: "👻 Korku Gecesi",           genres: [27],        sort: "popularity.desc" },
  nostalji:   { label: "🕰️ Nostalji",              genres: [18, 35],    sort: "vote_average.desc", yearMax: "1999" },
};

const MOOD_KEYS = Object.keys(MOODS);
const MOOD_LABELS = MOOD_KEYS.map((k) => MOODS[k].label);

// ─── Manifest ─────────────────────────────────────────────────────────────────
const manifest = {
  id: "community.nuviomood",
  version: "1.0.0",
  name: "NuvioMood",
  description: "Ruh haline göre film ve dizi keşfet 🎬",
  logo: "https://i.imgur.com/qFuHMcl.png",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  idPrefixes: ["tmdb:"],
  catalogs: [
    {
      id: "nuviomood_all",
      type: "movie",
      name: "🎬 NuvioMood",
      extra: [
        { name: "genre", isRequired: false, options: MOOD_LABELS },
        { name: "skip", isRequired: false },
      ],
    },
    {
      id: "nuviomood_all_series",
      type: "series",
      name: "📺 NuvioMood",
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

  const params = {
    api_key: TMDB_KEY,
    with_genres: cfg.genres.join(","),
    sort_by: cfg.sort,
    page,
    "vote_count.gte": 150,
    include_adult: false,
    language: "tr-TR",
  };

  if (cfg.yearMax) {
    params[mediaType === "movie" ? "release_date.lte" : "first_air_date.lte"] =
      `${cfg.yearMax}-12-31`;
  }

  try {
    const { data } = await axios.get(`${TMDB_BASE}/discover/${mediaType}`, { params });
    const results = (data.results || []).map((item) => ({
      id: `tmdb:${item.id}`,
      type,
      name: item.title || item.name,
      poster: item.poster_path
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : null,
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
  const isMovie = id === "nuviomood_all" && type === "movie";
  const isSeries = id === "nuviomood_all_series" && type === "series";
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

// ─── Sunucu ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`🎬 NuvioMood çalışıyor → http://localhost:${PORT}/manifest.json`);
