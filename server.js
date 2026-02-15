const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const API_KEY = process.env.GEMINI_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

app.post("/chat", async (req, res) => {
  const userMessage = (req.body?.message || "").trim();
  if (!userMessage) return res.json({ reply: "Please type a message." });
  if (!API_KEY) return res.json({ reply: "Missing GEMINI_KEY in Railway Variables." });

  try {
    const url =
      "https://generativelanguage.googleapis.com/v1/models/" +
      MODEL +
      ":generateContent?key=" +
      encodeURIComponent(API_KEY);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 256 }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.json({
        reply: data?.error?.message || `Gemini API error (${response.status})`
      });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ||
      "No response";

    return res.json({ reply });
  } catch (error) {
    return res.json({ reply: "Server error: " + error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running"));