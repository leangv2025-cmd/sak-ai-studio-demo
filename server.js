const express = require("express");
const fetch = require("node-fetch");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

// Use one env name only
const API_KEY = process.env.GEMINI_KEY;

// Helper: call Gemini API (v1)
async function callGemini(userMessage) {
  if (!API_KEY) {
    return { reply: "Missing GEMINI_KEY in Railway Variables." };
  }

  const model = "gemini-1.5-flash-latest"; // safe 최신 alias
  const url =
    `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=` +
    encodeURIComponent(API_KEY);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 256
      }
    })
  });

  const data = await response.json();

  // If Gemini returns an error
  if (!response.ok) {
    return {
      reply: data?.error?.message || `Gemini API error (${response.status})`
    };
  }

  const reply =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .join("") || "No response";

  return { reply };
}

app.post("/chat", async (req, res) => {
  const userMessage = (req.body?.message || "").trim();
  if (!userMessage) return res.json({ reply: "Please type a message." });

  try {
    const result = await callGemini(userMessage);
    return res.json(result);
  } catch (error) {
    return res.json({ reply: "Server error: " + error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running"));