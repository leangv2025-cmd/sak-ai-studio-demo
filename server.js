const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const GEMINI_KEY = process.env.GEMINI_KEY;

// ===== RATE LIMIT =====
let userHits = {};

function checkLimit(ip) {
  const now = Date.now();
  if (!userHits[ip]) userHits[ip] = [];
  userHits[ip] = userHits[ip].filter(t => now - t < 60000);

  if (userHits[ip].length > 20) return false;
  userHits[ip].push(now);
  return true;
}

// ===== CHAT =====
app.post("/chat", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  if (!checkLimit(ip)) {
    return res.json({ reply: "Rate limit reached. Please wait 1 minute." });
  }

  const userMessage = (req.body?.message || "").trim();
  if (!userMessage) return res.json({ reply: "Type a message." });

  try {
    const systemPrompt = `
You are SAK AI Studio assistant.
Give clear, structured answers.
Support Khmer and English.
Be helpful and professional.
`;

    const finalPrompt = systemPrompt + "\nUser: " + userMessage;

    const url =
      "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=" +
      GEMINI_KEY;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: finalPrompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800
        }
      }),
    });

    const data = await r.json();

    const reply =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ||
      data?.error?.message ||
      "No response";

    console.log("CHAT:", userMessage);
    return res.json({ reply });

  } catch (err) {
    return res.json({ reply: "Server error: " + err.message });
  }
});

// ===== SIMPLE ADMIN LOG =====
app.get("/admin/logs", (req, res) => {
  res.json({
    users: Object.keys(userHits).length,
    hits: userHits
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running"));