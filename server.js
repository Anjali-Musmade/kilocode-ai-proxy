import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// CORRECT CORS for Azure DevOps extension
app.use(
  cors({
    origin: [
      "*",
      "https://dev.azure.com",
      "https://*.visualstudio.com",
      "https://anjalimusmade.gallery.vsassets.io"
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.options("*", cors());

// LOAD ENV VARIABLES
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AZDO_PAT = process.env.AZDO_PAT;
const ORG = process.env.AZDO_ORG;
const PROJECT = process.env.AZDO_PROJECT;
const PIPELINE_ID = process.env.AZDO_PIPELINE_ID;

// =============================================================
//   MAIN AI ENDPOINT
// =============================================================
app.post("/api/ai", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "No prompt provided" });
    }

    console.log("🔵 Incoming Prompt:", prompt);

    // ---------------------------------------------------------
    // Detect /specify.* — trigger Azure DevOps Pipeline
    // ---------------------------------------------------------
    if (prompt.startsWith("/specify.")) {
      const step = prompt.split(".")[1];
      console.log("🚀 Triggering pipeline step:", step);

      const url = `https://dev.azure.com/${ORG}/${PROJECT}/_apis/pipelines/${PIPELINE_ID}/runs?api-version=7.1-preview.1`;

      const body = {
        resources: {
          repositories: {
            self: { ref: "refs/heads/main" }
          }
        },
        templateParameters: {
          specStep: step
        }
      };

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(":" + AZDO_PAT).toString("base64"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        console.error("❌ Pipeline error:", data);
        return res.status(500).json({
          error: "Pipeline failed",
          details: data
        });
      }

      return res.json({
        output: `Pipeline triggered for step: ${step}`,
        pipelineRunId: data?.id || null
      });
    }

    // ---------------------------------------------------------
    // Otherwise send prompt to OpenRouter AI
    // ---------------------------------------------------------
    console.log("🤖 Sending to OpenRouter...");

    const aiResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.1-8b-instruct",
        messages: [{ role: "user", content: prompt }]
      })
    });

    const aiData = await aiResp.json().catch(() => ({}));

    if (!aiResp.ok) {
      console.error("❌ OpenRouter error:", aiData);
      return res.status(500).json({
        error: "OpenRouter request failed",
        details: aiData
      });
    }

    const output = aiData?.choices?.[0]?.message?.content || "";
    console.log("✅ AI Response OK");

    return res.json({ output });

  } catch (err) {
    console.error("🔥 SERVER CRASH:", err);
    return res.status(500).json({ error: err.message });
  }
});

// =============================================================
app.listen(process.env.PORT || 5000, () => {
  console.log("🚀 Speckit AI Proxy running on Render");
});
