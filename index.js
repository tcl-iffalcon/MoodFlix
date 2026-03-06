const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const NodeCache = require("node-cache");
require("dotenv").config();

const TMDB_KEY = process.env.TMDB_API_KEY || "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const cache = new NodeCache({ stdTTL: 3600 });

// ─── Ruh Hali → TMDB Eşleme Tablosu ───────────────────────────────────────────
const MOOD_MAP = {
  mutlu: {
    label: "😄 Mutlu & Enerjik",
    genres: [35, 16],           // Comedy, Animation
    keywords: [9717, 155477],   // feel-good, uplifting
    sort: "popularity.desc",
  },
  duygusal: {
    label: "😢 Duygusal",
    genres: [18, 10749],        // Drama, Romance
    keywords: [9748, 10683],    // emotional, touching
    sort: "vote_average.desc",
  },
  stresli: {
    label: "😰 Kaçmak İstiyorum",
    genres: [12, 14],           // Adventure, Fantasy
    keywords: [4379, 9882],     // escapism, fantasy world
    sort: "popularity.desc",
  },
  heyecan: {
    label: "😱 Heyecan İstiyorum",
    genres: [28, 53],           // Action, Thriller
    keywords: [10084, 3801],    // suspense, adrenaline
    sort: "popularity.desc",
  },
  dusunmek: {
    label: "🧠 Düşünmek İstiyorum",
    genres: [878, 9648],        // Sci-Fi, Mystery
    keywords: [10540, 14526],   // thought-provoking, philosophical
    sort: "vote_average.desc",
  },
  rahatlamak: {
    label: "😴 Rahatlamak İstiyorum",
    genres: [99, 35],           // Documentary, Comedy
    keywords: [207317, 9882],   // cozy, light
    sort: "vote_average.desc",
  },
  korku: {
    label: "👻 Korku Gecesi",
    genres: [27],               // Horror
    keywords: [10218, 6152],    // atmospheric horror, slasher
    sort: "popularity.desc",
  },
  nostalji: {
    label: "🕰️ Nostalji",
    genres: [18, 35],
    keywords: [158718, 276130], // 80s, 90s
    sort: "vote_average.desc",
    releaseDateMax: "1999-12-31",
  },
};

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
    ...Object.entries(MOOD_MAP).map(([id, mood]) => ({
      id: `mood_${id}_movie`,
      type: "movie",
      name: mood.label,
      extra: [{ name: "skip", isRequired: false }],
    })),
    ...Object.entries(MOOD_MAP).map(([id, mood]) => ({
      id: `mood_${id}_series`,
      type: "series",
      name: mood.label,
      extra: [{ name: "skip", isRequired: false }],
    })),
  ],
};

const builder = new addonBuilder(manifest);

// ─── TMDB'den İçerik Çek ──────────────────────────────────────────────────────
async function fetchFromTMDB(mood, type, page = 1) {
  const cacheKey = `${mood}_${type}_${page}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const cfg = MOOD_MAP[mood];
  if (!cfg) return [];

  const mediaType = type === "series" ? "tv" : "movie";
  const params = {
    api_key: TMDB_KEY,
    with_genres: cfg.genres.join(","),
    sort_by: cfg.sort,
    page,
    "vote_count.gte": 100,
    include_adult: false,
    language: "tr-TR",
  };

  if (cfg.releaseDateMax) {
    params[mediaType === "movie" ? "release_date.lte" : "first_air_date.lte"] =
      cfg.releaseDateMax;
  }

  try {
    const url = `${TMDB_BASE}/discover/${mediaType}`;
    const { data } = await axios.get(url, { params });

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
    console.error(`TMDB hata [${mood}/${type}]:`, err.message);
    return [];
  }
}

// ─── Catalog Handler ──────────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const match = id.match(/^mood_(.+)_(movie|series)$/);
  if (!match) return { metas: [] };

  const [, mood, moodType] = match;
  if (moodType !== type) return { metas: [] };

  const page = extra?.skip ? Math.floor(extra.skip / 20) + 1 : 1;
  const metas = await fetchFromTMDB(mood, type, page);

  return { metas };
});

// ─── Meta Handler ─────────────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ type, id }) => {
  if (!id.startsWith("tmdb:")) return { meta: null };

  const tmdbId = id.replace("tmdb:", "");
  const cacheKey = `meta_${type}_${tmdbId}`;
  const cached = cache.get(cacheKey);
  if (cached) return { meta: cached };

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
