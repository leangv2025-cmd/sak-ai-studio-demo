const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const API_KEY = process.env.GEMINI_KEY;

// change model here or set Railway variable GEMINI_MODEL
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// list available models (debug)
app.get("/models", async (req, res) => {
  try {
    if (!API_KEY) return res.status(400).json({ error: "Missing GEMINI_KEY" });

    const url =
      "https://generativelanguage.googleapis.com/v1/models?key=" +
      encodeURIComponent(API_KEY);

    const r = await fetch(url);
    const data = await r.json();
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

async function generateText(modelId, userMessage) {
  const url =
    `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=` +
    encodeURIComponent(API_KEY);

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 256 }
    })
  });

  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

app.post("/chat", async (req, res) => {
  const userMessage = (req.body?.message || "").trim();
  if (!userMessage) return res.json({ reply: "Please type a message." });
  if (!API_KEY) return res.json({ reply: "Missing GEMINI_KEY in Railway Variables." });

  try {
    // try default model first
    let result = await generateText(DEFAULT_MODEL, userMessage);

    // fallback if model not found
    const errMsg = result?.data?.error?.message || "";
    const isModelNotFound =
      errMsg.includes("not found") || errMsg.includes("is not supported");

    if (!result.ok && isModelNotFound) {
      // fallback models (often available)
      const fallbacks = ["gemini-2.0-flash", "gemini-1.0-pro"];
      for (const m of fallbacks) {
        result = await generateText(m, userMessage);
        if (result.ok) break;
      }
    }

    if (!result.ok) {
      return res.json({
        reply: result?.data?.error?.message || `Gemini API error (${result.status})`
      });
    }

    const reply =
      result?.data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ||
      "No response";

    return res.json({ reply });
  } catch (error) {
    return res.json({ reply: "Server error: " + error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running"));