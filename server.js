const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const API_KEY = process.env.GEMINI_KEY;

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
        API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userMessage }] }],
        }),
      }
    );

    const data = await response.json();
    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response";

    res.json({ reply });
  } catch (error) {
    res.json({ reply: "Error connecting AI" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running"));