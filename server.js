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

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json({ limit: '2mb' }));

const AZDO_ORG = process.env.AZDO_ORG;
const AZDO_PROJECT = process.env.AZDO_PROJECT;
const AZDO_REPO_ID = process.env.AZDO_REPO_ID;
const AZDO_PAT = process.env.AZDO_PERSONAL_ACCESS_TOKEN;

const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT; // e.g. https://your-resource.openai.azure.com

if (!AZDO_ORG || !AZDO_PROJECT || !AZDO_REPO_ID || !AZDO_PAT) {
  console.warn('Warning: Missing some AZDO_* environment variables. Reading/writing repo will fail until configured.');
}

// Basic Azure DevOps helper for reading/writing files
const azdoAxios = axios.create({
  baseURL: `https://dev.azure.com/${AZDO_ORG}/${AZDO_PROJECT}/_apis/git/repositories/${AZDO_REPO_ID}`,
  headers: {
    'Content-Type': 'application/json',
    Authorization: AZDO_PAT ? `Basic ${Buffer.from(':' + AZDO_PAT).toString('base64')}` : undefined,
  },
  params: { 'api-version': '7.1-preview.1' }
});

async function getFileContentFromRepo(path) {
  // path should start with '/'
  try {
    const resp = await azdoAxios.get(`/items`, {
      params: { path, includeContent: true }
    });
    if (resp && resp.data && resp.data.content) return resp.data.content;
    return null;
  } catch (err) {
    // For POC, return null if not found
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

async function pushFileToRepo(path, content, commitMessage = 'Speckit AI: update') {
  // Create a new push with a single ref update and change
  // For simplicity we create a new commit on the default branch (refs/heads/main). Adjust as needed.
  const branchRef = 'refs/heads/main';
  try {
    // 1. Get the latest commit of the branch
    const refsResp = await azdoAxios.get('/refs', { params: { filter: 'heads/main' } });
    if (!refsResp.data || refsResp.data.length === 0) throw new Error('Cannot find main branch refs');
    const oldObjectId = refsResp.data[0].objectId;

    // 2. Create a blob (base64) and a tree + commit
    // Azure DevOps simple approach: use the "pushes" API
    const pushBody = {
      refUpdates: [{ name: branchRef, oldObjectId }],
      commits: [{
        comment: commitMessage,
        changes: [
          {
            changeType: 'add', // 'add' or 'edit' - for idempotency could be 'edit' if exists
            item: { path },
            newContent: { content, contentType: 'rawtext' }
          }
        ]
      }]
    };
    const pushResp = await azdoAxios.post('/pushes', pushBody);
    return pushResp.data;
  } catch (err) {
    // If add fails because file exists, attempt edit
    if (err.response && err.response.data && err.response.data.message && /already exists/i.test(err.response.data.message)) {
      // Try edit: changeType = 'edit'
      const branchRef2 = 'refs/heads/main';
      const refsResp = await azdoAxios.get('/refs', { params: { filter: 'heads/main' } });
      const oldObjectId = refsResp.data[0].objectId;
      const pushBody = {
        refUpdates: [{ name: branchRef2, oldObjectId }],
        commits: [{
          comment: commitMessage,
          changes: [
            {
              changeType: 'edit',
              item: { path },
              newContent: { content, contentType: 'rawtext' }
            }
          ]
        }]
      };
      const pushResp = await azdoAxios.post('/pushes', pushBody);
      return pushResp.data;
    }
    throw err;
  }
}

// LLM integration: provider-agnostic wrapper
async function callLLM(prompt, opts = {}) {
  const messages = [
    { role: 'system', content: 'You are Speckit AI — follow the project constitution and produce clear, structured outputs.' },
    { role: 'user', content: prompt }
  ];

  if (LLM_PROVIDER === 'openrouter') {
    if (!OPENROUTER_API_KEY) throw new Error('Missing OPENROUTER_API_KEY');
    const body = {
      model: 'gpt-4o-mini', // example; change as available/desired
      messages,
      max_tokens: opts.max_tokens || 1500,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2
    };
    const resp = await axios.post('https://api.openrouter.ai/v1/chat/completions', body, {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
    });
    // OpenRouter returns choices[0].message.content typically
    return resp.data.choices[0].message.content;
  }

  if (LLM_PROVIDER === 'openai') {
    if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
    const body = {
      model: 'gpt-4o-mini',
      messages,
      max_tokens: opts.max_tokens || 1500,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2
    };
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', body, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }
    });
    return resp.data.choices[0].message.content;
  }

  if (LLM_PROVIDER === 'azure') {
    if (!AZURE_OPENAI_ENDPOINT || !OPENAI_API_KEY) throw new Error('Missing Azure OpenAI config');
    // Example for Azure OpenAI Chat Completions API
    const url = `${AZURE_OPENAI_ENDPOINT}/openai/deployments/your-deployment-id/chat/completions?api-version=2023-10-01`;
    const body = { messages, max_tokens: opts.max_tokens || 1500 };
    const resp = await axios.post(url, body, { headers: { 'api-key': OPENAI_API_KEY } });
    return resp.data.choices[0].message.content;
  }

  throw new Error('Unknown LLM_PROVIDER');
}

function buildSpeckitPrompt(userPrompt, repoFiles) {
  // repoFiles: { 'constitution.md': '...', 'spec.md': '...' }
  // Construct a clear instruction for LLM to simulate /specify.* behaviour
  let p = `You are Speckit AI. The user requested: ${userPrompt}\n\n`;
  p += 'Project files provided below. Use them as context and follow the project constitution rules when generating output.\n\n';
  for (const [name, content] of Object.entries(repoFiles)) {
    p += `--- BEGIN FILE: ${name} ---\n`;
    p += content ? content.substring(0, 50_000) : '(empty)'; // limit just in case
    p += `\n--- END FILE: ${name} ---\n\n`;
  }

  p += `Produce the requested Speckit output. Use headings, numbered lists, and be concise. If you need to create a new file, output only the file content with a top line "FILE: <path>" so the caller can detect it.`;
  return p;
}

// POST /generate
// Body: { command: '/specify.specification', prompt: 'Add an API', files: [optional list of repo file paths to include] }
app.post('/generate', async (req, res) => {
  try {
    const { command, prompt: userPrompt, files } = req.body;
    if (!command || !userPrompt) return res.status(400).json({ error: 'command and prompt are required' });

    // Default files to gather when not provided
    const fileCandidates = files && files.length ? files : [
      '/.specify/constitution.md',
      '/.specify/plan.md',
      '/.specify/spec.md',
      '/.specify/tasks.md'
    ];

    const repoFiles = {};
    for (const f of fileCandidates) {
      try {
        const c = await getFileContentFromRepo(f);
        repoFiles[f.replace(/\//g, '')] = c || '';
      } catch (err) {
        // ignore missing files for POC
        repoFiles[f.replace(/\//g, '')] = '';
      }
    }

    const builtPrompt = buildSpeckitPrompt(`${command}: ${userPrompt}`, repoFiles);

    const result = await callLLM(builtPrompt, { max_tokens: 2000 });

    // Return the AI output directly
    res.json({ output: result });
  } catch (err) {
    console.error('Error in /generate', err.message || err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// POST /save
// Body: { path: '/.specify/generated/spec.md', content: '...', commitMessage: '...'}
app.post('/save', async (req, res) => {
  try {
    const { path, content, commitMessage } = req.body;
    if (!path || typeof content !== 'string') return res.status(400).json({ error: 'path and content required' });

    const pushResp = await pushFileToRepo(path, content, commitMessage || 'Speckit AI update');
    res.json({ success: true, push: pushResp });
  } catch (err) {
    console.error('Error in /save', err.message || err.response && err.response.data || err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => console.log(`Speckit AI Proxy listening on ${PORT} (LLM_PROVIDER=${LLM_PROVIDER})`));
