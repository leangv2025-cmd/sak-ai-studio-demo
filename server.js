// server.js
// SAK AI Studio Demo - Chat + Voice(TTS) + Image(Imagen)
// Node 18+ / 20+ / 22+ (Railway OK)

const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

// ===== ENV =====
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY || "";

// Chat model (Gemini text)
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
// Image model (Imagen)
const IMAGEN_MODEL = process.env.IMAGEN_MODEL || "imagen-4.0-generate-001";

// ===== Helpers =====
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function fetchJson(url, options) {
  const r = await fetch(url, options);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  const text = await r.text();

  // If not JSON, throw helpful error (prevents "Unexpected token <")
  if (!ct.includes("application/json")) {
    const snippet = text.slice(0, 220);
    throw new Error(`Non-JSON response (${r.status}). ${snippet}`);
  }

  const data = JSON.parse(text);
  if (!r.ok) {
    const msg = data?.error?.message || `Request failed (${r.status})`;
    throw new Error(msg);
  }
  return data;
}

// ===== Health =====
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "sak-ai-studio",
    hasGeminiKey: !!GEMINI_KEY,
    hasTtsKey: !!GOOGLE_TTS_API_KEY,
    chatModel: CHAT_MODEL,
    imageModel: IMAGEN_MODEL,
  });
});

// ===== CHAT (Gemini generateContent) =====
app.post("/chat", async (req, res) => {
  const userMessage = String(req.body?.message || "").trim();
  const history = Array.isArray(req.body?.history) ? req.body.history : [];

  if (!userMessage) return res.json({ reply: "Please type a message." });
  if (!GEMINI_KEY) return res.json({ reply: "Missing GEMINI_KEY in server variables." });

  try {
    // Build contents for Gemini
    const contents = [];

    // Optional history (last 12)
    for (const h of history.slice(-12)) {
      const role = h?.role === "user" ? "user" : "model";
      const text = String(h?.text || "").trim();
      if (text) contents.push({ role, parts: [{ text }] });
    }

    // Current user
    contents.push({ role: "user", parts: [{ text: userMessage }] });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      CHAT_MODEL
    )}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

    const data = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 512,
        },
      }),
    });

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text || "")
        .join("")
        .trim() ||
      "No response";

    return res.json({ reply });
  } catch (e) {
    return res.json({ reply: "Server error: " + e.message });
  }
});

// ===== VOICE (Google Cloud Text-to-Speech) =====
// Client: { text, languageCode: "en-US"|"km-KH", gender: "FEMALE"|"MALE", voiceType?: "neural"|"standard" }
app.post("/tts", async (req, res) => {
  const text = String(req.body?.text || "").trim();
  const languageCode = String(req.body?.languageCode || "en-US");
  const genderRaw = String(req.body?.gender || "FEMALE").toUpperCase();
  const gender = genderRaw === "MALE" ? "MALE" : "FEMALE";
  const voiceType = String(req.body?.voiceType || "neural").toLowerCase(); // neural|standard

  if (!text) return res.json({ audioUrl: "", error: "Please type text for TTS." });
  if (!GOOGLE_TTS_API_KEY)
    return res.json({ audioUrl: "", error: "Missing GOOGLE_TTS_API_KEY in Railway Variables." });

  try {
    const voicesUrl = `https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(
      GOOGLE_TTS_API_KEY
    )}`;
    const voicesData = await fetchJson(voicesUrl, { method: "GET" });
    const voices = Array.isArray(voicesData?.voices) ? voicesData.voices : [];

    // Filter by language + gender
    const byLang = voices.filter((v) => (v.languageCodes || []).includes(languageCode));
    const byLangGender = byLang.filter(
      (v) => String(v.ssmlGender || "").toUpperCase() === gender
    );

    // Prefer neural (WaveNet/Neural2) if available, else fallback to any
    const preferNeural = (arr) =>
      arr.find((v) => /Neural2|Wavenet|WaveNet/i.test(v.name || "")) || arr[0];

    const preferStandard = (arr) =>
      arr.find((v) => !/Neural2|Wavenet|WaveNet/i.test(v.name || "")) || arr[0];

    const chosen =
      (voiceType === "standard"
        ? preferStandard(byLangGender) || preferStandard(byLang) || preferStandard(voices)
        : preferNeural(byLangGender) || preferNeural(byLang) || preferNeural(voices));

    if (!chosen?.name) {
      return res.json({ audioUrl: "", error: "No available voice found for this language/gender." });
    }

    const synthUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(
      GOOGLE_TTS_API_KEY
    )}`;

    // IMPORTANT: always include voice.name (fixes “requires a model name”)
    const synthBody = {
      input: { text: text.slice(0, 4000) },
      voice: {
        languageCode,
        name: chosen.name,        // ✅ required for many voices
        ssmlGender: gender,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.0,
        pitch: 0.0,
      },
    };

    const synthData = await fetchJson(synthUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(synthBody),
    });

    const audioContent = synthData?.audioContent;
    if (!audioContent) return res.json({ audioUrl: "", error: "No audioContent returned from TTS." });

    return res.json({ audioUrl: `data:audio/mpeg;base64,${audioContent}`, voiceName: chosen.name });
  } catch (e) {
    return res.json({ audioUrl: "", error: "TTS error: " + e.message });
  }
});
// ===== IMAGE (Imagen REST predict) =====
// Client sends: { prompt, aspectRatio }
app.post("/image", async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  const aspectRatio = String(req.body?.aspectRatio || "1:1");

  if (!prompt) return res.json({ imageDataUrl: "", error: "Please type a prompt." });
  if (!GEMINI_KEY) return res.json({ imageDataUrl: "", error: "Missing GEMINI_KEY in server variables." });

  try {
    // Imagen REST (official): models/imagen-4.0-generate-001:predict
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      IMAGEN_MODEL
    )}:predict`;

    const body = {
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio,
        // personGeneration default allow_adult, keep safe
        personGeneration: "allow_adult",
      },
    };

    const data = await fetchJson(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_KEY,
      },
      body: JSON.stringify(body),
    });

    // Different backends may return different shapes; handle common ones
    let b64 = "";

    // Common: data.predictions[0].bytesBase64Encoded
    b64 =
      data?.predictions?.[0]?.bytesBase64Encoded ||
      data?.predictions?.[0]?.image?.bytesBase64Encoded ||
      data?.predictions?.[0]?.imageBytes ||
      data?.predictions?.[0]?.image?.imageBytes ||
      "";

    if (!b64 && Array.isArray(data?.predictions) && data.predictions.length) {
      // try any string field
      const p0 = data.predictions[0];
      for (const k of Object.keys(p0)) {
        if (typeof p0[k] === "string" && p0[k].length > 1000) {
          b64 = p0[k];
          break;
        }
      }
    }

    if (!b64) {
      return res.json({
        imageDataUrl: "",
        error: "No image data returned. Check image model and API response format.",
      });
    }

    const imageDataUrl = `data:image/png;base64,${b64}`;
    return res.json({ imageDataUrl });
  } catch (e) {
    return res.json({ imageDataUrl: "", error: "Image error: " + e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on", PORT));