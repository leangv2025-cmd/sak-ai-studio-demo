const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const GEMINI_KEY = process.env.GEMINI_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;

function jsonError(res, message, status = 400, extra = {}) {
  return res.status(status).json({ ok: false, error: message, ...extra });
}

/**
 * Gemini REST helper (v1)
 */
async function geminiGenerateContent({ model, body }) {
  if (!GEMINI_KEY) throw new Error("Missing GEMINI_KEY env var.");

  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": GEMINI_KEY,
    },
    body: JSON.stringify(body),
  });

  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // If Google returns HTML or non-json, surface it safely
    throw new Error(`Gemini non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!r.ok) {
    const msg = data?.error?.message || `Gemini error (${r.status})`;
    throw new Error(msg);
  }
  return data;
}

/**
 * CHAT endpoint
 * Uses: gemini-2.5-flash
 */
app.post("/chat", async (req, res) => {
  try {
    const userMessage = String(req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!userMessage) return res.json({ ok: true, reply: "Please type a message." });

    // Build contents from short history (optional)
    const contents = [];
    for (const h of history.slice(-12)) {
      if (!h?.role || !h?.text) continue;
      contents.push({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: String(h.text) }],
      });
    }
    contents.push({ role: "user", parts: [{ text: userMessage }] });

    const data = await geminiGenerateContent({
      model: "gemini-2.5-flash",
      body: {
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
      },
    });

    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ||
      data?.error?.message ||
      "No response";

    return res.json({ ok: true, reply });
  } catch (e) {
    return res.json({ ok: false, reply: "Server error: " + e.message });
  }
});

/**
 * IMAGE endpoint
 * Uses: gemini-2.5-flash-image
 * Returns: { ok:true, imageDataUrl:"data:image/png;base64,....", text:"(optional)" }
 */
app.post("/image", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return jsonError(res, "Please type an image prompt.");

    const data = await geminiGenerateContent({
      model: "gemini-2.5-flash-image",
      body: {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          // IMPORTANT: ask for IMAGE output
          responseModalities: ["IMAGE", "TEXT"],
        },
      },
    });

    const parts = data?.candidates?.[0]?.content?.parts || [];
    let imageInline = null;
    let textOut = "";

    for (const p of parts) {
      if (p?.inlineData?.data && p?.inlineData?.mimeType) {
        imageInline = p.inlineData;
        break;
      }
      if (p?.text) textOut += p.text;
    }

    if (!imageInline) {
      return jsonError(res, "No image returned. Try a different prompt.");
    }

    const mime = imageInline.mimeType || "image/png";
    const b64 = imageInline.data;
    const imageDataUrl = `data:${mime};base64,${b64}`;

    return res.json({ ok: true, imageDataUrl, text: textOut || "" });
  } catch (e) {
    return jsonError(res, "Image error: " + e.message, 500);
  }
});

/**
 * TTS voices (dynamic) - to support Khmer/English + Male/Female
 */
let cachedVoices = { ts: 0, data: null };
async function getTtsVoices() {
  if (!GOOGLE_TTS_API_KEY) throw new Error("Missing GOOGLE_TTS_API_KEY env var.");

  const now = Date.now();
  if (cachedVoices.data && now - cachedVoices.ts < 60 * 60 * 1000) {
    return cachedVoices.data;
  }

  const url = `https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(
    GOOGLE_TTS_API_KEY
  )}`;

  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) {
    throw new Error(data?.error?.message || `TTS voices error (${r.status})`);
  }

  cachedVoices = { ts: now, data };
  return data;
}

function pickVoice(voicesList, languageCode, genderWanted) {
  const voices = voicesList?.voices || [];

  // Filter by language first
  const langMatches = voices.filter((v) =>
    Array.isArray(v.languageCodes) && v.languageCodes.includes(languageCode)
  );

  // Then by gender (FEMALE/MALE)
  const genderMatches = langMatches.filter((v) => v.ssmlGender === genderWanted);

  // Prefer "Standard" then "Wavenet"/others if present
  const preferred = (arr) => {
    const standard = arr.find((v) => String(v.name || "").includes("Standard"));
    return standard || arr[0] || null;
  };

  return preferred(genderMatches) || preferred(langMatches) || null;
}

app.get("/tts/voices", async (req, res) => {
  try {
    const data = await getTtsVoices();

    // Only send what frontend needs, and focus on English + Khmer
    const filtered = (data.voices || []).filter((v) => {
      const langs = v.languageCodes || [];
      return langs.includes("en-US") || langs.includes("km-KH");
    });

    return res.json({
      ok: true,
      voices: filtered.map((v) => ({
        name: v.name,
        languageCodes: v.languageCodes,
        ssmlGender: v.ssmlGender,
        naturalSampleRateHertz: v.naturalSampleRateHertz,
      })),
    });
  } catch (e) {
    return jsonError(res, "Voices error: " + e.message, 500);
  }
});

/**
 * TTS endpoint
 * Input: { text, languageCode: "en-US"|"km-KH", gender:"FEMALE"|"MALE", speakingRate?, pitch? }
 * Output: { ok:true, audioContent:"base64..." }
 */
app.post("/tts", async (req, res) => {
  try {
    if (!GOOGLE_TTS_API_KEY) {
      return jsonError(res, "Missing GOOGLE_TTS_API_KEY in Railway Variables.");
    }

    const text = String(req.body?.text || "").trim();
    if (!text) return jsonError(res, "Please type text for TTS.");

    const languageCode = String(req.body?.languageCode || "en-US");
    const gender = String(req.body?.gender || "FEMALE").toUpperCase();
    const speakingRate = Number(req.body?.speakingRate ?? 1.0);
    const pitch = Number(req.body?.pitch ?? 0);

    const voicesList = await getTtsVoices();
    const voice = pickVoice(voicesList, languageCode, gender);

    if (!voice?.name) {
      return jsonError(res, `No voice found for ${languageCode} + ${gender}.`);
    }

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(
      GOOGLE_TTS_API_KEY
    )}`;

    const body = {
      input: { text },
      voice: { languageCode, name: voice.name, ssmlGender: gender },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: isFinite(speakingRate) ? speakingRate : 1.0,
        pitch: isFinite(pitch) ? pitch : 0,
      },
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (!r.ok) {
      return jsonError(res, data?.error?.message || `TTS error (${r.status})`, r.status);
    }

    return res.json({ ok: true, audioContent: data.audioContent, voiceUsed: voice.name });
  } catch (e) {
    return jsonError(res, "TTS error: " + e.message, 500);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on", PORT));