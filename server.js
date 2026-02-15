const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const GEMINI_KEY = process.env.GEMINI_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;

// -----------------------------
// Helpers
// -----------------------------
function safeJson(res, status, obj) {
  return res.status(status).json(obj);
}

async function fetchJson(url, options) {
  const r = await fetch(url, options);
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// -----------------------------
// CHAT (Gemini generateContent)
// -----------------------------
app.post("/chat", async (req, res) => {
  const userMessage = (req.body?.message || "").trim();
  if (!userMessage) return safeJson(res, 400, { reply: "Please type a message." });
  if (!GEMINI_KEY) return safeJson(res, 400, { reply: "Missing GEMINI_KEY in Railway Variables." });

  try {
    // Use model that you confirmed works
    const model = req.body?.model || "models/gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(
      model.replace("models/", "")
    )}:generateContent?key=${GEMINI_KEY}`;

    const payload = {
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
    };

    const { ok, data } = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      data?.error?.message ||
      "No response";

    return safeJson(res, ok ? 200 : 400, { reply });
  } catch (e) {
    return safeJson(res, 500, { reply: "Server error: " + e.message });
  }
});

// -----------------------------
// IMAGE (Gemini generateContent with image response)
// Note: Some Gemini image generation setups differ by account.
// This endpoint is a simple placeholder that returns text if image not available.
// If your current image works already, keep your existing endpoint.
// -----------------------------
app.post("/image", async (req, res) => {
  const prompt = (req.body?.prompt || "").trim();
  if (!prompt) return safeJson(res, 400, { error: "Missing prompt" });
  if (!GEMINI_KEY) return safeJson(res, 400, { error: "Missing GEMINI_KEY in Railway Variables." });

  try {
    // If your project already has working image endpoint, replace here with your existing logic.
    // For demo: returns a message only.
    return safeJson(res, 200, {
      ok: true,
      note:
        "Image endpoint placeholder. If you already connected Gemini image, keep your working /image code here."
    });
  } catch (e) {
    return safeJson(res, 500, { error: e.message });
  }
});

// -----------------------------
// TTS (Google Cloud Text-to-Speech)
// Voice selector: Khmer/English + Male/Female
// -----------------------------
app.post("/tts", async (req, res) => {
  try {
    const text = (req.body?.text || "").trim();
    const lang = (req.body?.lang || "km").trim(); // "km" or "en"
    const gender = (req.body?.gender || "FEMALE").trim().toUpperCase(); // FEMALE|MALE

    if (!text) return safeJson(res, 400, { error: "Missing text" });
    if (!GOOGLE_TTS_API_KEY)
      return safeJson(res, 400, { error: "Missing GOOGLE_TTS_API_KEY in Railway Variables." });

    const languageCode = lang === "km" ? "km-KH" : "en-US";

    // Try best guess voice names (may vary by account/region).
    // If name not available, API will error -> we fallback to no "name".
    const voiceNameMap = {
      "km-KH": { FEMALE: "km-KH-Standard-A", MALE: "km-KH-Standard-B" },
      "en-US": { FEMALE: "en-US-Standard-C", MALE: "en-US-Standard-B" }
    };

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`;

    const tryCall = async (useName) => {
      const voiceObj = {
        languageCode,
        ssmlGender: gender === "MALE" ? "MALE" : "FEMALE"
      };
      if (useName) {
        const suggested = voiceNameMap?.[languageCode]?.[voiceObj.ssmlGender];
        if (suggested) voiceObj.name = suggested;
      }

      return await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: voiceObj,
          audioConfig: { audioEncoding: "MP3" }
        })
      });
    };

    // 1) try with voice name
    let r1 = await tryCall(true);

    // 2) if fails, try without voice name (lets Google auto-pick)
    if (!r1.ok) {
      let r2 = await tryCall(false);
      if (!r2.ok) {
        const msg = r2?.data?.error?.message || r1?.data?.error?.message || "TTS error";
        return safeJson(res, 400, { error: msg, languageCode, gender });
      }
      r1 = r2;
    }

    return safeJson(res, 200, {
      audioContent: r1.data.audioContent,
      used: { languageCode, gender }
    });
  } catch (e) {
    return safeJson(res, 500, { error: e.message });
  }
});

// -----------------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on " + PORT));