import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// ⭐ Put your OpenRouter API key here
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "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";

app.get("/", (req, res) => {
  res.send("Speckit AI Proxy Running...");
});

app.post("/api/ai", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    console.log("🔵 Incoming prompt:", prompt);

    // Send request to OpenRouter
    const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,   // ⭐ KEY GOES HERE
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost",                // Required by OpenRouter
        "X-Title": "Speckit AI Proxy"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.1-8b-instruct",
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await apiRes.json();

    if (!data || !data.choices || !data.choices[0]) {
      return res.status(500).json({ error: "Invalid OpenRouter response", raw: data });
    }

    const output = data.choices[0].message.content;
    console.log("🟢 AI Response:", output);

    res.json({ output });

  } catch (err) {
    console.error("🔥 Error:", err);
    res.status(500).json({ error: "Proxy server failed", details: err.toString() });
  }
});

app.listen(5000, () => console.log("🚀 AI Proxy running on http://localhost:5000"));
