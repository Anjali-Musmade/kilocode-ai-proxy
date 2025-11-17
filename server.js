import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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

    if (!prompt)
      return res.status(400).json({ error: "No prompt provided" });

    console.log("🔵 Prompt:", prompt);

    // ---------------------------------------------------------
    // Detect /specify.* command and run AZDO PIPELINE instead
    // ---------------------------------------------------------
    if (prompt.startsWith("/specify.")) {
      const step = prompt.split(".")[1];

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

      console.log("🚀 Triggering Azure Pipeline for step:", step);

      const runResp = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(":" + AZDO_PAT).toString("base64"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const runData = await runResp.json();

      return res.json({
        output: `Pipeline triggered for step: ${step}`,
        pipelineRunId: runData?.id || null
      });
    }

    // ---------------------------------------------------------
    // Otherwise: normal OpenRouter AI prompt
    // ---------------------------------------------------------
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

    const aiData = await aiResp.json();
    const text = aiData?.choices?.[0]?.message?.content || "";

    res.json({ output: text });

  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
app.listen(process.env.PORT || 5000, () => {
  console.log("🚀 Speckit AI Proxy (correct version) running");
});
