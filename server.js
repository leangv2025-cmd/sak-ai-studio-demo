// server.js
// SAK AI Studio Demo - Chat + Voice(TTS) + Image(Imagen)
// Node 18+ / 20+ / 22+ (Railway OK)

const express = require("express");
const path = require("path");

// Node 18+ has global fetch. If not, install node-fetch and uncomment below.
// const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
app.use(express.json({ limit: "3mb" }));
app.use(express.static(__dirname));

// ===== ENV =====
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY || "";

// Chat model (Gemini text)
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
// Image model (Imagen)
const IMAGEN_MODEL = process.env.IMAGEN_MODEL || "imagen-4.0-generate-001";

// ===== Helpers =====
function normalizePrompt(raw, maxLen = 900) {
  let s = String(raw || "").trim();
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

async function fetchJson(url, options) {
  const r = await fetch(url, options);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  const text = await r.text();

  // Prevent "Unexpected token <"
  if (!ct.includes("application/json")) {
    const snippet = text.slice(0, 260);
    throw new Error(`Non-JSON response (${r.status}). ${snippet}`);
  }

  const data = JSON.parse(text);
  if (!r.ok) {
    const msg = data?.error?.message || `Request failed (${r.status})`;
    throw new Error(msg);
  }
  return data;
}

// Rewrite long prompt into short Imagen-friendly prompt using Gemini text model
async function rewriteImagePrompt(longPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    CHAT_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

  const data = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Rewrite this into a SHORT, clear Imagen prompt (max 220 chars). " +
                "Keep only subject + setting + style + lighting + camera. Remove extra details, age words, and unsafe terms.\n\n" +
                longPrompt,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.35, maxOutputTokens: 120 },
    }),
  });

  const shortText =
    data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("").trim() || "";

  return normalizePrompt(shortText, 220);
}

function extractImageB64(data) {
  return (
    data?.predictions?.[0]?.bytesBase64Encoded ||
    data?.predictions?.[0]?.image?.bytesBase64Encoded ||
    data?.predictions?.[0]?.imageBytes ||
    data?.predictions?.[0]?.image?.imageBytes ||
    ""
  );
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
    const contents = [];

    // Optional history (last 10)
    for (const h of history.slice(-10)) {
      const role = h?.role === "user" ? "user" : "model";
      const text = String(h?.text || "").trim();
      if (text) contents.push({ role, parts: [{ text }] });
    }

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
          maxOutputTokens: 700,
        },
      }),
    });

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text || "")
        .join("")
        .trim() || "No response";

    return res.json({ reply });
  } catch (e) {
    return res.json({ reply: "Server error: " + e.message });
  }
});

// ===== VOICE (Google Cloud Text-to-Speech) =====
// Client: { text, languageCode:"en-US"|"km-KH", gender:"FEMALE"|"MALE", voiceType?:"neural"|"standard" }
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

    const byLang = voices.filter((v) => (v.languageCodes || []).includes(languageCode));
    const byLangGender = byLang.filter(
      (v) => String(v.ssmlGender || "").toUpperCase() === gender
    );

    const isNeural = (name) => /Neural2|Wavenet|WaveNet/i.test(name || "");

    const preferNeural = (arr) => arr.find((v) => isNeural(v.name)) || arr[0];
    const preferStandard = (arr) => arr.find((v) => !isNeural(v.name)) || arr[0];

    const chosen =
      voiceType === "standard"
        ? preferStandard(byLangGender) || preferStandard(byLang) || preferStandard(voices)
        : preferNeural(byLangGender) || preferNeural(byLang) || preferNeural(voices);

    if (!chosen?.name) {
      return res.json({ audioUrl: "", error: "No available voice found for this language/gender." });
    }

    const synthUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(
      GOOGLE_TTS_API_KEY
    )}`;

    const synthBody = {
      input: { text: text.slice(0, 4000) },
      voice: {
        languageCode,
        name: chosen.name, // IMPORTANT
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

    return res.json({
      audioUrl: `data:audio/mpeg;base64,${audioContent}`,
      voiceName: chosen.name,
    });
  } catch (e) {
    return res.json({ audioUrl: "", error: "TTS error: " + e.message });
  }
});

// ===== IMAGE (Imagen REST predict) =====
// Client sends: { prompt, aspectRatio }
app.post("/image", async (req, res) => {
  if (!GEMINI_KEY)
    return res.json({ imageDataUrl: "", error: "Missing GEMINI_KEY in server variables." });

  const aspectRatio = String(req.body?.aspectRatio || "1:1");
  let prompt = normalizePrompt(req.body?.prompt || "", 900);
  if (!prompt) return res.json({ imageDataUrl: "", error: "Please type a prompt." });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    IMAGEN_MODEL
  )}:predict`;

  async function callImagen(p) {
    const body = {
      instances: [{ prompt: p }],
      parameters: {
        sampleCount: 1,
        aspectRatio,
        personGeneration: "allow_adult",
      },
    };

    return await fetchJson(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_KEY,
      },
      body: JSON.stringify(body),
    });
  }

  try {
    // Try 1: original prompt
    let data = await callImagen(prompt);
    let b64 = extractImageB64(data);

    // Try 2: rewrite prompt if empty
    if (!b64) {
      const shortPrompt = await rewriteImagePrompt(prompt);
      data = await callImagen(shortPrompt);
      b64 = extractImageB64(data);

      if (!b64) {
        return res.json({
          imageDataUrl: "",
          error:
            "No image data returned. Try simpler prompt or remove sensitive words (child/teen/girl/weapon/blood etc.).",
        });
      }
    }

    return res.json({ imageDataUrl: `data:image/png;base64,${b64}` });
  } catch (e) {
    return res.json({ imageDataUrl: "", error: "Image error: " + e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on", PORT));