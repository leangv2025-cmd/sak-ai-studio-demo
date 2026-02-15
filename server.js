const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

// ENV
const GEMINI_KEY = process.env.GEMINI_KEY; // same key for Gemini API + Imagen (AI Studio key)
const CHAT_MODEL = process.env.CHAT_MODEL || "gemini-2.5-flash"; // you already confirmed this works
const IMAGEN_MODEL = process.env.IMAGEN_MODEL || "imagen-4.0-generate-001"; // from Imagen docs
const PORT = process.env.PORT || 8080;

function mustKey(res){
  if(!GEMINI_KEY){
    res.status(400).json({ error: "Missing GEMINI_KEY in Railway Variables." });
    return true;
  }
  return false;
}

// ===== CHAT =====
app.post("/chat", async (req, res) => {
  if(mustKey(res)) return;

  const userMessage = (req.body?.message || "").trim();
  if (!userMessage) return res.json({ reply: "Please type a message." });

  // Optional history from frontend
  const history = Array.isArray(req.body?.history) ? req.body.history : [];

  // Build contents: include last messages if provided
  const contents = [];
  for (const item of history.slice(-12)) {
    if (!item?.text) continue;
    contents.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: String(item.text) }]
    });
  }
  // Ensure current message is last
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_KEY
      },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
      }),
    });

    const data = await response.json();

    const reply =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ||
      data?.error?.message ||
      "No response";

    return res.json({ reply });
  } catch (error) {
    return res.json({ reply: "Server error: " + error.message });
  }
});

// ===== IMAGE (IMAGEN) =====
// Returns base64 image bytes (first image)
app.post("/image", async (req, res) => {
  if(mustKey(res)) return;

  const prompt = (req.body?.prompt || "").trim();
  if(!prompt) return res.json({ error: "Please provide prompt." });

  try{
    // Imagen REST uses :predict per official docs 2
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict`;

    const r = await fetch(url, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-goog-api-key": GEMINI_KEY
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1 }
      })
    });

    const data = await r.json();

    // Typical response has predictions[0].bytesBase64Encoded or similar depending model
    const b64 =
      data?.predictions?.[0]?.bytesBase64Encoded ||
      data?.predictions?.[0]?.image?.imageBytes ||
      data?.error?.message;

    if(!b64 || typeof b64 !== "string") {
      return res.json({ error: data?.error?.message || "No image returned." });
    }

    // If b64 is actually an error message
    if(b64.includes("not found") || b64.includes("Error") || b64.includes("permission")) {
      return res.json({ error: b64 });
    }

    return res.json({ imageBase64: b64 });
  }catch(e){
    return res.json({ error: e.message });
  }
});

// ===== TTS =====
// NOTE: If your current Google TTS already works, keep your existing endpoint.
// This is only a template hook.
app.post("/tts", async (req, res) => {
  const text = (req.body?.text || "").trim();
  if(!text) return res.json({ error: "Please provide text." });

  // If you already have Google TTS working in your own way, keep it.
  // Here we just return error as placeholder to avoid breaking.
  return res.json({ error: "TTS endpoint not implemented here. Keep your existing Google TTS connection." });
});

app.listen(PORT, () => console.log("Server running on", PORT));