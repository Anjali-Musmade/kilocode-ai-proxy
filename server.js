/*
server.js
Node.js AI Proxy for Speckit-like /specify commands

Features:
- POST /generate  -> reads repo files from Azure DevOps, builds a "Speckit" prompt, sends to LLM provider, returns generated content
- POST /save      -> writes the generated content back to the Azure DevOps repo (create or update file)

Environment variables (use a .env file or set in your environment):
- AZDO_ORG
- AZDO_PROJECT
- AZDO_REPO_ID          // repo id or name
- AZDO_PERSONAL_ACCESS_TOKEN
- LLM_PROVIDER          // 'openrouter' | 'openai' | 'azure'
- OPENROUTER_API_KEY    // if using OpenRouter
- OPENAI_API_KEY        // if using OpenAI
- AZURE_OPENAI_ENDPOINT // if using Azure OpenAI
- PORT (optional)

Install dependencies:
 npm init -y
 npm i express axios dotenv body-parser

Notes:
- This is a focused POC. In production add authentication, rate limiting, robust error handling and logging, request validation, and input sanitization.
*/

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

// -----------------------------
// CONFIG
// -----------------------------
const LLM_PROVIDER = process.env.LLM_PROVIDER || "azure";
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_KEY = process.env.OPENAI_API_KEY;
const AZURE_MODEL_DEPLOYMENT = process.env.AZURE_MODEL_DEPLOYMENT;
const PORT = process.env.PORT || 5000;

// -----------------------------
// CHAT COMPLETION ENDPOINT
// -----------------------------
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  try {
    if (LLM_PROVIDER !== "azure") {
      return res.status(400).json({ error: "Set LLM_PROVIDER=azure" });
    }

    if (!AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_KEY || !AZURE_MODEL_DEPLOYMENT) {
      return res.status(500).json({
        error:
          "Missing env vars: AZURE_OPENAI_ENDPOINT, OPENAI_API_KEY, AZURE_MODEL_DEPLOYMENT"
      });
    }

    const url = `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_MODEL_DEPLOYMENT}/chat/completions?api-version=2024-02-01`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": AZURE_OPENAI_KEY
      },
      body: JSON.stringify({
        messages,
        max_tokens: 2000,
        temperature: 0.7,
        stream: false
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Azure Error:", result);
      return res.status(500).json({ error: result });
    }

    res.json({
      reply: result.choices?.[0]?.message?.content || ""
    });

  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------
// START SERVER
// -----------------------------
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));


