const express = require("express");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

function jsonError(res, code, message, extra) {
  return res.status(code).json({
    ok: false,
    error: message,
    ...(extra ? { extra } : {})
  });
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "sak-ai-studio",
    hasGeminiKey: !!process.env.GEMINI_KEY,
    hasTtsKey: !!process.env.GOOGLE_TTS_API_KEY,
    chatModel: process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash",
    imageModel: process.env.GEMINI_IMAGE_MODEL || ""
  });
});

/**
 * CHAT: Gemini generateContent
 */
app.post("/chat", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_KEY;
    if (!apiKey) return jsonError(res, 400, "Missing GEMINI_KEY in server environment.");

    const userMessage = String(req.body?.message || "").trim();
    if (!userMessage) return res.json({ ok: true, reply: "Please type a message." });

    const model = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent?key=" +
      encodeURIComponent(apiKey);

    const payload = {
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch (e) {
      return jsonError(res, 500, "Gemini returned non-JSON (often 404/HTML). Check model + key.", { sample: text.slice(0, 180) });
    }

    if (!r.ok || data.error) {
      return jsonError(res, r.status || 500, data?.error?.message || "Gemini error", data?.error);
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") ||
      "No response";

    return res.json({ ok: true, reply });
  } catch (e) {
    return jsonError(res, 500, "Server error in /chat", { message: e.message });
  }
});

/**
 * TTS: Google Cloud Text-to-Speech (API KEY)
 * POST /tts  { text, languageCode, gender }
 */
app.post("/tts", async (req, res) => {
  try {
    const ttsKey = process.env.GOOGLE_TTS_API_KEY;
    if (!ttsKey) return jsonError(res, 400, "Missing GOOGLE_TTS_API_KEY in server environment.");

    const text = String(req.body?.text || "").trim();
    const languageCode = String(req.body?.languageCode || "en-US").trim();
    const gender = String(req.body?.gender || "FEMALE").trim(); // FEMALE|MALE

    if (!text) return jsonError(res, 400, "Please provide text.");

    // NOTE: Khmer voices depend on availability. languageCode km-KH is correct for Khmer.
    // voice name is optional; Google will pick one if not specified.
    const url =
      "https://texttospeech.googleapis.com/v1/text:synthesize?key=" +
      encodeURIComponent(ttsKey);

    const body = {
      input: { text },
      voice: { languageCode, ssmlGender: gender },
      audioConfig: { audioEncoding: "MP3" }
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const respText = await r.text();
    let data;
    try { data = JSON.parse(respText); }
    catch (e) {
      return jsonError(res, 500, "TTS returned non-JSON. (Often API not enabled or wrong key).", { sample: respText.slice(0, 180) });
    }

    if (!r.ok || data.error) {
      return jsonError(res, r.status || 500, data?.error?.message || "TTS error", data?.error);
    }

    if (!data.audioContent) {
      return jsonError(res, 500, "TTS returned no audioContent.", data);
    }

    return res.json({
      ok: true,
      audioContent: data.audioContent,
      voiceUsed: languageCode + " / " + gender
    });
  } catch (e) {
    return jsonError(res, 500, "Server error in /tts", { message: e.message });
  }
});

/**
 * IMAGE: Gemini image endpoint
 * IMPORTANT:
 * - Different accounts/models may vary.
 * - This code expects your model supports image generation and returns inlineData (base64).
 *
 * POST /image { prompt }
 */
app.post("/image", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_KEY;
    if (!apiKey) return jsonError(res, 400, "Missing GEMINI_KEY in server environment.");

    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return jsonError(res, 400, "Please provide prompt.");

    const model = process.env.GEMINI_IMAGE_MODEL;
    if (!model) {
      return jsonError(res, 400, "Missing GEMINI_IMAGE_MODEL. Set it in Railway Variables to a model that supports image generation.");
    }

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent?key=" +
      encodeURIComponent(apiKey);

    // Ask model for image
    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 256 }
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); }
    catch (e) {
      return jsonError(res, 500, "Image model returned non-JSON (check model name).", { sample: raw.slice(0, 180) });
    }

    if (!r.ok || data.error) {
      return jsonError(res, r.status || 500, data?.error?.message || "Image model error", data?.error);
    }

    // Try to find inline image data
    const parts = data?.candidates?.[0]?.content?.parts || [];
    let found = null;

    for (const p of parts) {
      // common shape: { inlineData: { mimeType, data } }
      if (p && p.inlineData && p.inlineData.data) {
        found = p.inlineData;
        break;
      }
      // some shapes: { inline_data: { mime_type, data } }
      if (p && p.inline_data && p.inline_data.data) {
        found = { mimeType: p.inline_data.mime_type || "image/png", data: p.inline_data.data };
        break;
      }
    }

    if (!found) {
      return jsonError(res, 500, "No image data returned. Your model may not support image output for generateContent.", {
        tip: "Set GEMINI_IMAGE_MODEL to a supported image model from ListModels."
      });
    }

    const mime = found.mimeType || "image/png";
    const b64 = found.data;
    const imageDataUrl = "data:" + mime + ";base64," + b64;

    return res.json({ ok: true, imageDataUrl });
  } catch (e) {
    return jsonError(res, 500, "Server error in /image", { message: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on port", PORT));