const express = require("express");
const fetch = require("node-fetch");

const app = express();

app.use(express.json({ limit: "5mb" }));
app.use(express.static(__dirname)); // serve index.html, css, etc.

const GEMINI_KEY = process.env.GEMINI_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;

// -------- helpers ----------
function sendJson(res, code, obj) {
  res.status(code).set("Content-Type", "application/json").send(JSON.stringify(obj));
}

async function fetchJson(url, options) {
  const r = await fetch(url, options);
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

// -----------------------------
// CHAT (Gemini)
// -----------------------------
app.post("/chat", async (req, res) => {
  const userMessage = (req.body?.message || "").trim();
  if (!userMessage) return sendJson(res, 400, { reply: "Please type a message." });
  if (!GEMINI_KEY) return sendJson(res, 400, { reply: "Missing GEMINI_KEY in Railway Variables." });

  try {
    const model = (req.body?.model || "models/gemini-2.5-flash").replace("models/", "");
    const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${GEMINI_KEY}`;

    const payload = {
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
    };

    const r = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const reply =
      r?.data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ||
      r?.data?.error?.message ||
      "No response";

    return sendJson(res, r.ok ? 200 : 400, { reply });
  } catch (e) {
    return sendJson(res, 500, { reply: "Server error: " + e.message });
  }
});

// -----------------------------
// TTS (Google Cloud Text-to-Speech)
// -----------------------------
app.post("/tts", async (req, res) => {
  const text = (req.body?.text || "").trim();
  const lang = (req.body?.lang || "km").trim();         // km | en
  const gender = (req.body?.gender || "FEMALE").toUpperCase(); // FEMALE | MALE

  if (!text) return sendJson(res, 400, { error: "Missing text" });
  if (!GOOGLE_TTS_API_KEY) return sendJson(res, 400, { error: "Missing GOOGLE_TTS_API_KEY in Railway Variables." });

  const languageCode = lang === "km" ? "km-KH" : "en-US";
  const ssmlGender = gender === "MALE" ? "MALE" : "FEMALE";

  // Best-effort voice name (if not exist, auto fallback)
  const voiceNameMap = {
    "km-KH": { FEMALE: "km-KH-Standard-A", MALE: "km-KH-Standard-B" },
    "en-US": { FEMALE: "en-US-Standard-C", MALE: "en-US-Standard-B" },
  };

  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`;

  async function callTTS(useName) {
    const voice = { languageCode, ssmlGender };
    if (useName) {
      const v = voiceNameMap?.[languageCode]?.[ssmlGender];
      if (v) voice.name = v;
    }
    return await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice,
        audioConfig: { audioEncoding: "MP3" }
      })
    });
  }

  try {
    let r = await callTTS(true);
    if (!r.ok) r = await callTTS(false);

    if (!r.ok) {
      return sendJson(res, 400, {
        error: r?.data?.error?.message || "TTS failed",
        hint: "If you see HTML here, your endpoint is not hit. Ensure Railway runs server.js."
      });
    }

    return sendJson(res, 200, {
      audioContent: r.data.audioContent,
      used: { languageCode, ssmlGender }
    });
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
});

// -----------------------------
// IMAGE (IMPORTANT)
// -----------------------------
// ⚠️ If your image generation already worked before, paste your working logic here.
// This endpoint currently returns JSON to avoid the <!DOCTYPE error.
app.post("/image", async (req, res) => {
  const prompt = (req.body?.prompt || "").trim();
  if (!prompt) return sendJson(res, 400, { error: "Missing prompt" });

  // ✅ Keep JSON response so frontend never breaks
  return sendJson(res, 200, {
    ok: true,
    note: "Image endpoint is connected on your side? If it stopped, paste your old working /image code here.",
  });
});

// -----------------------------
// JSON 404 for API routes (prevents HTML <!DOCTYPE>)
// -----------------------------
app.use((req, res, next) => {
  if (req.path === "/tts" || req.path === "/image" || req.path === "/chat") {
    return sendJson(res, 404, { error: "API route not found: " + req.path });
  }
  next();
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on " + PORT));