const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const API_KEY = process.env.GEMINI_KEY;

app.post("/chat", async (req, res) => {
  const userMessage = (req.body?.message || "").trim();
  if (!userMessage) return res.json({ reply: "Please type a message." });

  try {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" +
      process.env.GEMINI_KEY;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 256 }
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running"));