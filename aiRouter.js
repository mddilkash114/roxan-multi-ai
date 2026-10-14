/*function createAIRouter(deps) {
  const {
    db,
    local,
    aiBrain,
    rag,
    nlp,
    providers,
    maxChars,
    ragReady,
    setNlpReady,
    isNlpReady,
    getTimeAnswer,
    getDateAnswer,
    configured,
    modelFor,
    normalizeRagSources,
    dedupeSources
  } = deps;

  function normalizeDocumentId(value) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return null;
    }

    const id = String(value).trim();

    return id || null;
  }

  function detectDirectIntent(text) {
    const value = String(text || "")
      .trim()
      .toLowerCase();

    if (
      /^(hi|hello|hey|hii|namaste|good morning|good afternoon|good evening)[!.?]*$/i.test(
        value
      )
    ) {
      return "greeting";
    }

    if (
      /^(what(?:'s| is)?\s+(the\s+)?current\s+time|what\s+time\s+is\s+it|time\s+now|tell\s+me\s+the\s+time)[!.?]*$/i.test(
        value
      )
    ) {
      return "time.get";
    }

    if (
      /^(what(?:'s| is)?\s+(the\s+)?(current\s+)?date|what\s+date\s+is\s+it|today(?:'s)?\s+date)[!.?]*$/i.test(
        value
      )
    ) {
      return "date.get";
    }

    return null;
  }

  function historyFor(rows, text) {
    const prior = rows.slice(-10).map(message => ({
      role: message.role,
      content:
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content || "")
    }));

    if (text) {
      prior.push({
        role: "user",
        content: text
      });
    }

    return prior;
  }

  function orderForRouting(primary, preference) {
    if (preference === "auto") {
      const textHint = String(primary || "").toLowerCase();

      return order(
        primary,
        textHint === "auto" ? "best-quality" : textHint
      );
    }

    return order(primary, preference || "specific");
  }

  function order(primary, preference) {
    const quality = ["groq", "openrouter", "google", "openai"];
    const fast = ["groq", "openrouter", "google", "openai"];
    const cheap = ["groq", "openrouter", "google", "openai"];

    if (preference === "best-quality") return quality;
    if (preference === "fastest") return fast;
    if (preference === "lowest-cost") return cheap;

    const result = [];

    if (primary && primary !== "auto") {
      result.push(primary);
    }

    for (const provider of quality) {
      if (!result.includes(provider)) {
        result.push(provider);
      }
    }

    return result;
  }

  async function route({
    ownerId,
    conversationId,
    text,
    primary,
    model,
    preference,
    fallback,
    image,
    documentId = null,
    systemPrompt,
    onStatus,
    onChunk
  }) {
    if (text.length > maxChars) {
      throw new Error(
        `Message is too long. Maximum ${maxChars} characters.`
      );
    }

    const rows = db.isEnabled()
      ? await db.getMessages({
          ownerId,
          conversationId,
          limit: 200
        })
      : local.get(conversationId)?.messages || [];

    const selectedDocumentId = normalizeDocumentId(documentId);

    const conversationHistory = systemPrompt
      ? []
      : rows.slice(-10);

    console.log("🧠 route history:", {
      original: rows.length,
      sent: conversationHistory.length,
      documentId: selectedDocumentId,
      systemPromptActive: Boolean(systemPrompt)
    });

    const response = await aiBrain.ask(text || "", {
      provider: primary || "auto",
      model: model || null,
      conversationHistory,
      image: image || null,
      attachment: null,
      systemPrompt: systemPrompt || null,
      stream: true,
      onChunk: onChunk || null,
      fallbackEnabled: fallback !== false,
      webSearchEnabled: process.env.WEB_SEARCH_ENABLED === "true"
    });

    return {
      name: response.provider,
      model: response.model,
      answer: response.content,
      fallback: response.provider !== (primary || "auto")
    };
  }

  async function smartRoute({
    ownerId,
    conversationId,
    text,
    primary,
    model,
    preference,
    fallback,
    image,
    documentId = null,
    onStatus,
    onChunk
  }) {
    const directIntent = detectDirectIntent(text);

    if (directIntent === "greeting") {
      return {
        name: "nlp",
        model: "built-in",
        answer: "Hello! How can I help you?",
        fallback: false,
        nlp: {
          intent: "greeting",
          score: 1
        },
        rag: null
      };
    }

    if (directIntent === "time.get") {
      return {
        name: "nlp",
        model: "built-in",
        answer: getTimeAnswer(),
        fallback: false,
        nlp: {
          intent: "time.get",
          score: 1
        },
        rag: null
      };
    }

    if (directIntent === "date.get") {
      return {
        name: "nlp",
        model: "built-in",
        answer: getDateAnswer(),
        fallback: false,
        nlp: {
          intent: "date.get",
          score: 1
        },
        rag: null
      };
    }

    if (!isNlpReady()) {
      await nlp.waitUntilReady();
      setNlpReady(true);
    }

    onStatus?.("Analyzing intent...");

    let nlpResult = null;

    try {
      nlpResult = await nlp.process(text);
    } catch (error) {
      console.warn("NLP process failed:", error.message);
    }

    const intent = nlpResult?.intent || "";

    const normalizedText = String(text || "")
      .trim()
      .toLowerCase();

    const documentHint =
      /\b(document|file|pdf|notes|uploaded|upload|knowledge\s+base|according\s+to\s+(my|the)\s+(file|document))\b/i;

    const selectedDocumentId = normalizeDocumentId(documentId);

    const needsRAG =
      ragReady() &&
      (
        Boolean(selectedDocumentId) ||
        ["document.query", "search"].includes(intent) ||
        documentHint.test(normalizedText)
      );

    console.log("Roxan route:", {
      text: String(text || "").slice(0, 80),
      directIntent,
      nlpIntent: nlpResult?.intent || null,
      nlpScore: nlpResult?.score ?? null,
      nlpScoreType: typeof nlpResult?.score,
      selectedDocumentId,
      needsRAG
    });

    let ragContext = "";
    let ragSources = [];

    if (ragReady() && needsRAG) {
      onStatus?.("Searching your documents...");

      try {
        const ragResult = await rag.buildContext({
          ownerId: String(ownerId),
          query: text,
          topK: Number(process.env.RAG_TOP_K || 5),
          documentId: selectedDocumentId
        });

        console.log("📚 RAG result:", {
          found: ragResult.found,
          count: ragResult.count,
          sources: ragResult.sources?.map(s => s.title)
        });

        console.log(
          "RAG source details:",
          ragResult.sources?.map(source => ({
            documentId: source.documentId,
            title: source.title,
            chunkIndex: source.chunkIndex
          }))
        );

        if (ragResult.found) {
          ragContext = String(ragResult.context || "").slice(
            0,
            Number(process.env.RAG_MAX_CONTEXT_CHARS || 12000)
          );

          ragSources = dedupeSources(
            normalizeRagSources(ragResult.sources)
          );

          console.log(
            "RAG context length:",
            ragContext.length
          );

          onStatus?.(
            `Found ${ragSources.length} relevant sources`
          );
        }
      } catch (error) {
        console.warn("RAG search failed:", error.message);
      }
    }

    const systemPrompt = ragContext
      ? [
          "You are Roxan, a document question-answering assistant.",
          "Answer only from the CURRENT DOCUMENT CONTEXT below.",
          "Do not use previous conversation answers as document evidence.",
          "Do not mix information from different documents.",
          "For list questions, include every item supported by the context.",
          "Do not invent unsupported details.",
          "If the answer is not present in the context, say so clearly.",
          "",
          "CURRENT DOCUMENT CONTEXT:",
          ragContext,
          "",
          "USER QUESTION:",
          text
        ].join("\n")
      : "";

    onStatus?.("Generating response...");

    const result = await route({
      ownerId,
      conversationId,
      text,
      primary,
      model,
      preference,
      fallback,
      image,
      documentId: selectedDocumentId,
      systemPrompt,
      onStatus,
      onChunk
    });

    return {
      ...result,
      nlp: nlpResult,
      rag: ragSources.length
        ? {
            sources: ragSources
          }
        : null
    };
  }

  return {
    route,
    smartRoute,
    historyFor,
    orderForRouting,
    order
  };
}

module.exports = createAIRouter;
*/


function createAIRouter(deps) {
  const {
    db,
    local,
    aiBrain,
    rag,
    nlp,
    providers,
    maxChars,
    ragReady,
    setNlpReady,
    isNlpReady,
    getTimeAnswer,
    getDateAnswer,
    configured,
    modelFor,
    normalizeRagSources,
    dedupeSources
  } = deps;

  function normalizeDocumentId(value) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return null;
    }

    const id = String(value).trim();

    return id || null;
  }

  function historyFor(rows, text) {
    const prior = rows.slice(-10).map(message => ({
      role: message.role,
      content:
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content || "")
    }));

    if (text) {
      prior.push({
        role: "user",
        content: text
      });
    }

    return prior;
  }

  function orderForRouting(primary, preference) {
    if (preference === "auto") {
      const textHint = String(primary || "").toLowerCase();

      return order(
        primary,
        textHint === "auto" ? "best-quality" : textHint
      );
    }

    return order(primary, preference || "specific");
  }

  function order(primary, preference) {
    const quality = ["groq", "openrouter", "google", "openai"];
    const fast = ["groq", "openrouter", "google", "openai"];
    const cheap = ["groq", "openrouter", "google", "openai"];

    if (preference === "best-quality") return quality;
    if (preference === "fastest") return fast;
    if (preference === "lowest-cost") return cheap;

    const result = [];

    if (primary && primary !== "auto") {
      result.push(primary);
    }

    for (const provider of quality) {
      if (!result.includes(provider)) {
        result.push(provider);
      }
    }

    return result;
  }

  async function route({
    ownerId,
    conversationId,
    text,
    primary,
    model,
    preference,
    fallback,
    image,
    documentId = null,
    systemPrompt,
    onStatus,
    onChunk
  }) {
    if (text.length > maxChars) {
      throw new Error(
        `Message is too long. Maximum ${maxChars} characters.`
      );
    }

    const rows = db.isEnabled()
      ? await db.getMessages({
          ownerId,
          conversationId,
          limit: 200
        })
      : local.get(conversationId)?.messages || [];

    const selectedDocumentId = normalizeDocumentId(documentId);

    const conversationHistory = systemPrompt
      ? []
      : rows.slice(-10);

    console.log("🧠 route history:", {
      original: rows.length,
      sent: conversationHistory.length,
      documentId: selectedDocumentId,
      systemPromptActive: Boolean(systemPrompt)
    });

    const response = await aiBrain.ask(text || "", {
      provider: primary || "auto",
      model: model || null,
      conversationHistory,
      image: image || null,
      attachment: null,
      systemPrompt: systemPrompt || null,
      stream: true,
      onChunk: onChunk || null,
      fallbackEnabled: fallback !== false,
      webSearchEnabled: process.env.WEB_SEARCH_ENABLED === "true"
    });

    return {
      name: response.provider,
      model: response.model,
      answer: response.content,
      fallback: response.provider !== (primary || "auto")
    };
  }

  async function smartRoute({
    ownerId,
    conversationId,
    text,
    primary,
    model,
    preference,
    fallback,
    image,
    documentId = null,
    onStatus,
    onChunk
  }) {
    if (!isNlpReady()) {
      await nlp.waitUntilReady();
      setNlpReady(true);
    }

    onStatus?.("Analyzing intent...");

    let nlpResult = null;

    try {
      nlpResult = await nlp.process(text, String(conversationId || ""));
    } catch (error) {
      console.warn("NLP process failed:", error.message);
    }

    const refusalFollowUpPattern =
      /^(why|explain|reason|how come|what for|because)[\s!.?,]*$/i;

    const isRefusalFollowUp =
      refusalFollowUpPattern.test(String(text || "").trim()) &&
      nlp.hasContext(String(conversationId), "refusal");

    if (isRefusalFollowUp) {
      console.log("🚫 Refusal follow-up detected — sending to AI with context");

      const refusalSystemPrompt = [
        "The user is asking WHY you refused their previous request.",
        "Explain the reason clearly and politely.",
        "Suggest legal and ethical alternatives.",
        "Be helpful and non-judgmental.",
        "Do NOT repeat the exact same refusal message.",
        "",
        "Provide:",
        "1. Clear reason for refusal",
        "2. Legal/ethical concerns",
        "3. Alternative suggestions",
        "4. Offer to help with something else"
      ].join("\n");

      const result = await route({
        ownerId,
        conversationId,
        text: "User is asking why you refused their previous request. Explain the reason clearly and suggest legal/ethical alternatives. Do NOT repeat the same refusal message.",
        primary,
        model,
        preference,
        fallback,
        image,
        documentId: selectedDocumentId,
        systemPrompt: refusalSystemPrompt,
        onStatus,
        onChunk
      });

      return {
        ...result,
        nlp: nlpResult,
        refusal: true,
        rag: null
      };
    }

    const instantIntents = [
      "greeting",
      "help",
      "thanks",
      "goodbye",
      "confirm.yes",
      "confirm.no",
      "time.get",
      "date.get"
    ];

    const rawIntent = nlpResult?.intent || "";
    const rawScore = Number(nlpResult?.score || 0);

    const isInstantIntent =
      instantIntents.includes(rawIntent) &&
      rawScore >= 0.9;

    const intent = isInstantIntent ? rawIntent : "None";

    const normalizedText = String(text || "")
      .trim()
      .toLowerCase();

    const documentHint =
      /\b(document|file|pdf|notes|uploaded|upload|knowledge\s+base|according\s+to\s+(my|the)\s+(file|document))\b/i;

    const selectedDocumentId = normalizeDocumentId(documentId);

    const needsRAG =
      ragReady() &&
      (
        Boolean(selectedDocumentId) ||
        ["document.query", "search"].includes(intent) ||
        documentHint.test(normalizedText)
      );

    console.log("Roxan route:", {
      text: String(text || "").slice(0, 80),
      rawIntent,
      rawScore,
      finalIntent: intent,
      isInstantIntent,
      source: nlpResult?.source || "none",
      selectedDocumentId,
      needsRAG
    });

    if (isInstantIntent) {
      let answer = nlpResult?.answer;

      if (intent === "time.get") {
        answer = getTimeAnswer();
      } else if (intent === "date.get") {
        answer = getDateAnswer();
      }

      if (answer) {
        console.log(`Instant reply from NLP (${nlpResult.source}): ${rawIntent}`);

        return {
          name: "nlp",
          model: "built-in",
          answer,
          fallback: false,
          nlp: nlpResult,
          rag: null
        };
      }
    }

    let ragContext = "";
    let ragSources = [];

    if (ragReady() && needsRAG) {
      onStatus?.("Searching your documents...");

      try {
        const ragResult = await rag.buildContext({
          ownerId: String(ownerId),
          query: text,
          topK: Number(process.env.RAG_TOP_K || 5),
          documentId: selectedDocumentId
        });

        console.log("📚 RAG result:", {
          found: ragResult.found,
          count: ragResult.count,
          sources: ragResult.sources?.map(s => s.title)
        });

        console.log(
          "RAG source details:",
          ragResult.sources?.map(source => ({
            documentId: source.documentId,
            title: source.title,
            chunkIndex: source.chunkIndex
          }))
        );

        if (ragResult.found) {
          ragContext = String(ragResult.context || "").slice(
            0,
            Number(process.env.RAG_MAX_CONTEXT_CHARS || 12000)
          );

          ragSources = dedupeSources(
            normalizeRagSources(ragResult.sources)
          );

          console.log(
            "RAG context length:",
            ragContext.length
          );

          onStatus?.(
            `Found ${ragSources.length} relevant sources`
          );
        }
      } catch (error) {
        console.warn("RAG search failed:", error.message);
      }
    }

    const systemPrompt = ragContext
      ? [
          "You are Roxan, a document question-answering assistant.",
          "Answer only from the CURRENT DOCUMENT CONTEXT below.",
          "Do not use previous conversation answers as document evidence.",
          "Do not mix information from different documents.",
          "For list questions, include every item supported by the context.",
          "Do not invent unsupported details.",
          "If the answer is not present in the context, say so clearly.",
          "",
          "CURRENT DOCUMENT CONTEXT:",
          ragContext,
          "",
          "USER QUESTION:",
          text
        ].join("\n")
      : "";

    onStatus?.("Generating response...");

    const result = await route({
      ownerId,
      conversationId,
      text,
      primary,
      model,
      preference,
      fallback,
      image,
      documentId: selectedDocumentId,
      systemPrompt,
      onStatus,
      onChunk
    });

    const refusalPatterns = [
      /I'm sorry, but I can't/i,
      /I cannot help/i,
      /I'm unable to/i,
      /I can't assist with that/i,
      /I cannot assist/i,
      /I'm not able to/i,
      /I must decline/i
    ];

    const isRefusal = refusalPatterns.some(
      pattern => pattern.test(result.answer || "")
    );

    if (isRefusal) {
      console.log("🚫 Refusal detected — saving context");

      nlp.setContext(String(conversationId), "refusal");

      return {
        ...result,
        nlp: nlpResult,
        refusal: true,
        rag: ragSources.length
          ? {
              sources: ragSources
            }
          : null
      };
    }

    return {
      ...result,
      nlp: nlpResult,
      rag: ragSources.length
        ? {
            sources: ragSources
          }
        : null
    };
  }

  return {
    route,
    smartRoute,
    historyFor,
    orderForRouting,
    order
  };
}

module.exports = createAIRouter;