require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Server } = require("socket.io");
const multer = require("multer");
const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");
const mailer = require("./mailer");
const setupSocket = require("./socket");
const createAIRouter = require("./aiRouter");

const providers = require("./config");
const db = require("./db");
const auth = require("./auth");
const aiBrain = require("./aiBrain");
const rag = require("./rag");
const nlp = require("./nlp");

const app = express();

const server = http.createServer(app);

server.timeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

const PORT = Number(process.env.PORT || 5000);
const MAX_CHARS = Number(process.env.MAX_MESSAGE_CHARS || 12000);
const MAX_MB = Number(process.env.MAX_FILE_MB || 10);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_MB * 1024 * 1024
  }
});

const local = new Map();

let ragReady = false;
let nlpReady = false;

async function initializeAI() {
  try {
    await nlp.waitUntilReady();
    nlpReady = true;
    console.log("NLP ready");
  } catch (error) {
    console.error("NLP initialization failed:", error.message);
  }

  try {
    if (process.env.RAG_ENABLED === "true") {
      ragReady = await rag.initialize();

      console.log(`RAG ${ragReady ? "ready" : "disabled"}`);
    } else {
      console.log("RAG disabled");
    }
  } catch (error) {
    console.error("RAG initialization failed:", error.message);
  }
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();

    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

function getAttachmentText(attachment) {
  if (!attachment) {
    return "";
  }

  if (typeof attachment === "string") {
    return attachment;
  }

  if (typeof attachment.text === "string") {
    return attachment.text;
  }

  if (Array.isArray(attachment.text)) {
    return attachment.text
      .map(item => {
        if (typeof item === "string") {
          return item;
        }

        return item?.text || item?.str || "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (attachment.text && typeof attachment.text === "object") {
    if (typeof attachment.text.text === "string") {
      return attachment.text.text;
    }

    if (typeof attachment.text.content === "string") {
      return attachment.text.content;
    }

    return JSON.stringify(attachment.text, null, 2);
  }

  if (typeof attachment.content === "string") {
    return attachment.content;
  }

  return "";
}

function normalizeAttachment(attachment) {
  if (!attachment) {
    return null;
  }

  if (typeof attachment === "string") {
    return {
      name: "document",
      type: "text/plain",
      kind: "document",
      text: attachment
    };
  }

  return {
    name: attachment.name || "document",
    type: attachment.type || "application/octet-stream",
    kind: attachment.kind || "document",
    text: getAttachmentText(attachment)
  };
}

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(
  express.json({
    limit: "15mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

app.use(
  "/api",
  (req, res, next) => {
    const publicRoutes = [
      "/health",
      "/auth/register",
      "/auth/login",
      "/models"
    ];

    if (publicRoutes.includes(req.path)) {
      return next();
    }

    auth
      .getUserFromRequest(req)
      .then(user => {
        if (!user && db.isEnabled()) {
          return res.status(401).json({
            error: "Authentication required"
          });
        }

        req.user = user || { id: "anonymous" };

        next();
      })
      .catch(() => {
        res.status(401).json({
          error: "Invalid session"
        });
      });
  }
);

function configured(provider) {
  return Boolean(
    provider?.key &&
      provider?.endpoint &&
      provider?.model &&
      Array.isArray(provider?.models) &&
      provider.models.length > 0
  );
}

function modelFor(name, requested) {
  const provider = providers[name];

  if (!provider) {
    return null;
  }

  if (
    requested &&
    Array.isArray(provider.models) &&
    provider.models.includes(requested)
  ) {
    return requested;
  }

  return provider.model || provider.models?.[0] || null;
}

function openAIHeaders(provider) {
  return {
    Authorization: `Bearer ${provider.key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": `http://localhost:${PORT}`,
    "X-Title": "Roxan"
  };
}

function extractGoogle(data) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map(item => item.text || "")
      .join("") || ""
  );
}

function getBrainUsage() {
  if (typeof aiBrain.getUsageStats === "function") {
    return aiBrain.getUsageStats();
  }

  return {
    count: aiBrain.usage?.count || 0,
    date: aiBrain.usage?.date || new Date().toISOString().slice(0, 10),
    dailyLimit:
      aiBrain.dailyLimit ||
      Number(
        process.env.AI_DAILY_LIMIT ||
          process.env.DAILY_MESSAGE_LIMIT ||
          100
      )
  };
}

function getTimeAnswer() {
  return `Current time: ${new Date().toLocaleTimeString()}`;
}

function getDateAnswer() {
  return `Today is: ${new Date().toLocaleDateString()}`;
}

function normalizeRagSources(sources) {
  if (!Array.isArray(sources)) {
    return [];
  }

  return sources.map(source => ({
    title: String(source.title || "Untitled"),
    type: String(source.type || "document"),
    score: Number(source.score || 0),
    preview: String(source.preview || "")
  }));
}

function dedupeSources(sources) {
  if (!Array.isArray(sources)) {
    return [];
  }

  const seen = new Map();

  for (const source of sources) {
    if (!source) {
      continue;
    }

    const key = String(
      source.documentId ||
        source.id ||
        source.title ||
        source.preview ||
        ""
    ).trim();

    if (!key) {
      continue;
    }

    const existing = seen.get(key);

    if (
      !existing ||
      Number(source.score || 0) > Number(existing.score || 0)
    ) {
      seen.set(key, source);
    }
  }

  return Array.from(seen.values());
}

const aiRouter = createAIRouter({
  db,
  local,
  aiBrain,
  rag,
  nlp,
  providers,
  maxChars: MAX_CHARS,

  ragReady: () => ragReady,

  setNlpReady: value => {
    nlpReady = value;
  },

  isNlpReady: () => nlpReady,

  getTimeAnswer,
  getDateAnswer,
  normalizeRagSources,
  dedupeSources
});
app.get("/api/health", (req, res) => {
  try {
    const brainStatus = aiBrain.getProviderStatus();

    const enabledProviders = Object.values(brainStatus).filter(
      provider => provider.configured
    ).length;

    res.json({
      ok: true,
      mongo: db.isEnabled(),
      nlp: {
        ready: nlpReady
      },
      rag: {
        enabled: process.env.RAG_ENABLED === "true",
        ready: ragReady
      },
      providers: Object.fromEntries(
        Object.entries(providers).map(([name, provider]) => [
          name,
          configured(provider)
        ])
      ),
      aiBrain: {
        enabled: process.env.USE_AI_BRAIN !== "false",
        enabledCount: enabledProviders,
        providers: brainStatus,
        usage: getBrainUsage()
      }
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get("/api/models", (req, res) => {
  const modelList = {};

  for (const [name, provider] of Object.entries(providers)) {
    modelList[name] = {
      configured: configured(provider),
      models: provider.models || [],
      vision: provider.supportsVision || false
    };
  }

  res.json(modelList);
});
app.post("/api/auth/register", async (req, res) => {
    try {
        const user = await auth.register(req.body);
        res.json({
            user,
            verificationRequired: true,
            emailSent: user.emailSent,
            message: "Account created. Please check your email and click the verification link to activate your account."
        });
    } catch (error) {
        res.status(400).json({
            error: error.message
        });
    }
});

app.post("/api/auth/verify-email", async (req, res) => {
    try {
        const user = await auth.verifyEmail({ token: req.body?.token });
        res.json({
            user,
            token: auth.createSession(user),
            verified: true
        });
    } catch (error) {
        res.status(400).json({
            error: error.message
        });
    }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const user = await auth.login(req.body);

    res.json({
      user,
      token: auth.createSession(user)
    });
  } catch (error) {
    res.status(401).json({
      error: error.message
    });
  }
});

app.get("/api/auth/me", (req, res) => {
  res.json({
    user: req.user || null
  });
});

app.get("/api/conversations", async (req, res) => {
    try {
        const ownerId = String(req.user.id);

        const search =
            typeof req.query.search === "string"
                ? req.query.search.trim()
                : "";

        const conversations =
            await db.listConversations({
                ownerId,
                query: search,
                includeArchived:
                    req.query.archived === "true"
            });

        res.json(
            Array.isArray(conversations)
                ? conversations
                : []
        );
    } catch (error) {
        console.error(
            "GET /api/conversations failed:",
            error
        );

        res.status(500).json({
            error: "Could not load conversations."
        });
    }
});
app.post("/api/conversations", async (req, res) => {
  try {
    const conversation = await db.createConversation({
      ownerId: req.user.id,
      title: String(req.body.title || "New chat"),
      provider: req.body.provider,
      model: req.body.model
    });

    res.json(conversation);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/conversations/:id/messages", async (req, res) => {
  try {
    const messages = await db.getMessages({
      ownerId: req.user.id,
      conversationId: req.params.id
    });

    res.json(messages);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.patch("/api/conversations/:id", async (req, res) => {
  try {
    const conversation = await db.updateConversation({
      ownerId: req.user.id,
      conversationId: req.params.id,
      changes: req.body
    });

    if (!conversation) {
      return res.status(404).json({
        error: "Conversation not found"
      });
    }

    res.json(conversation);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.delete("/api/conversations/:id", async (req, res) => {
  try {
    const deleted = await db.deleteConversation({
      ownerId: req.user.id,
      conversationId: req.params.id
    });

    res.json({ deleted });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    const dbStats = await db.stats(req.user.id);

    res.json({
      ...dbStats,
      aiBrain: {
        usage: getBrainUsage(),
        providers: aiBrain.getProviderStatus()
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post(
  "/api/attachments",
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          error: "No file selected"
        });
      }

      const ext = path.extname(file.originalname).toLowerCase();

      let text = null;

      if ([".txt", ".csv", ".md", ".json"].includes(ext)) {
        text = file.buffer.toString("utf8");
      } else if (ext === ".pdf") {
        text = await extractPdfText(file.buffer);
      } else if (ext === ".docx") {
        const result = await mammoth.extractRawText({
          buffer: file.buffer
        });

        text = result.value;
      } else if (
        file.mimetype &&
        file.mimetype.startsWith("image/")
      ) {
        return res.json({
          name: file.originalname,
          type: file.mimetype,
          kind: "image",
          data: `data:${file.mimetype};base64,${file.buffer.toString(
            "base64"
          )}`
        });
      } else {
        return res.status(400).json({
          error:
            "Supported files: images, PDF, DOCX, TXT, CSV, MD, JSON"
        });
      }

      const cleanText = String(text || "").slice(0, 100000);

      if (
        [".txt", ".csv", ".md", ".json", ".pdf", ".docx"].includes(ext) &&
        !cleanText.trim()
      ) {
        return res.status(400).json({
          error: "No readable text was found in this file."
        });
      }

      return res.json({
        name: file.originalname,
        type: file.mimetype || "application/octet-stream",
        kind: "document",
        text: cleanText
      });
    } catch (error) {
      console.error("Attachment parsing error:", error);

      return res.status(400).json({
        error: `Could not read file: ${
          error.message || "Unknown file parsing error"
        }`
      });
    }
  }
);

app.post("/api/nlp/analyze", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();

    if (!text) {
      return res.status(400).json({
        error: "Text required"
      });
    }

    if (!nlpReady) {
      await nlp.waitUntilReady();
      nlpReady = true;
    }

    const result = await nlp.process(text);

    res.json(result);
  } catch (error) {
    console.error("NLP analyze error:", error);

    res.status(500).json({
      error: "NLP analysis failed"
    });
  }
});

app.post("/api/rag/ingest", async (req, res) => {
  try {
    if (!ragReady) {
      return res.status(503).json({
        error: "RAG service unavailable"
      });
    }

    const { title, text, type, metadata } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({
        error: "Text required"
      });
    }

    if (String(text).length > 500000) {
      return res.status(413).json({
        error: "Text too large"
      });
    }

    const result = await rag.ingest({
      ownerId: String(req.user.id),
      title: title || "Untitled",
      text: String(text),
      type: type || "text",
      metadata: metadata || {}
    });

    res.json(result);
  } catch (error) {
    console.error("RAG ingest error:", error);

    res.status(500).json({
      error: "Document ingestion failed"
    });
  }
});

app.post("/api/rag/search", async (req, res) => {
  try {
    if (!ragReady) {
      return res.status(503).json({
        error: "RAG service unavailable"
      });
    }

    const {
      query,
      topK = 5,
      documentId = null
    } = req.body || {};

    if (!query || !String(query).trim()) {
      return res.status(400).json({
        error: "Query required"
      });
    }

    const results = await rag.search({
      ownerId: String(req.user.id),
      query: String(query),
      topK: Number(topK),
      documentId: documentId ? String(documentId) : null
    });

    res.json({ results });
  } catch (error) {
    console.error("RAG search error:", error);

    res.status(500).json({
      error: "RAG search failed"
    });
  }
});

app.post("/api/rag/context", async (req, res) => {
  try {
    if (!ragReady) {
      return res.status(503).json({
        error: "RAG service unavailable"
      });
    }

    const {
      query,
      topK = 5,
      documentId = null
    } = req.body || {};

    if (!query || !String(query).trim()) {
      return res.status(400).json({
        error: "Query required"
      });
    }

    const result = await rag.buildContext({
      ownerId: String(req.user.id),
      query: String(query),
      topK: Number(topK),
      documentId: documentId ? String(documentId) : null
    });

    res.json(result);
  } catch (error) {
    console.error("RAG context error:", error);

    res.status(500).json({
      error: "Context building failed"
    });
  }
});
app.get("/api/rag/documents", async (req, res) => {
  try {
    if (!ragReady) {
      return res.json([]);
    }

    const documents = await rag.listDocuments(String(req.user.id));

    res.json(documents);
  } catch (error) {
    console.error("RAG document list error:", error);

    res.status(500).json({
      error: "Could not load documents"
    });
  }
});

app.delete("/api/rag/documents/:id", async (req, res) => {
  try {
    if (!ragReady) {
      return res.status(503).json({
        error: "RAG service unavailable"
      });
    }

    const result = await rag.deleteDocument({
      ownerId: String(req.user.id),
      documentId: req.params.id
    });

    res.json(result);
  } catch (error) {
    console.error("RAG document delete error:", error);

    res.status(500).json({
      error: "Could not delete document"
    });
  }
});

app.get("/api/rag/stats", async (req, res) => {
  try {
    if (!ragReady) {
      return res.json({
        documents: 0,
        chunks: 0
      });
    }

    const stats = await rag.stats(String(req.user.id));

    res.json(stats);
  } catch (error) {
    console.error("RAG stats error:", error);

    res.status(500).json({
      error: "Could not load RAG stats"
    });
  }
});

setupSocket(io, {
  db,
  auth,
  rag,
  smartRoute: aiRouter.smartRoute,
  normalizeAttachment,
  getAttachmentText,

  isRagReady: () => ragReady
});

(async () => {
  try {
    await db.connectDatabase();

    
  } catch (error) {
    console.error("MongoDB:", error.message);
  }

  await initializeAI();

  try {
    const brainStatus = aiBrain.getProviderStatus();

    const enabledProviders = Object.values(brainStatus).filter(
      provider => provider.configured
    ).length;

    console.log(`AI Brain: ${enabledProviders} providers enabled`);

    console.log(
      "AI Brain provider status:",
      Object.fromEntries(
        Object.entries(brainStatus).map(([name, provider]) => [
          name,
          {
            configured: provider.configured,
            model: provider.model
          }
        ])
      )
    );
  } catch (error) {
    console.error("AI Brain initialization error:", error.message);
  }

  server.listen(PORT, () => {
    console.log(`Roxan running at http://localhost:${PORT}`);
  });
})();

process.on("SIGINT", async () => {
  try {
    await db.closeDatabase();
  } catch {}

  process.exit(0);
});

process.on("SIGTERM", async () => {
  try {
    await db.closeDatabase();
  } catch {}

  process.exit(0);
});