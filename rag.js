/*const {
  MongoClient,
  ObjectId
} = require("mongodb");

const axios = require("axios");

class RoxanRAG {
  constructor() {
    this.client = null;
    this.db = null;
    this.documents = null;
    this.embeddings = null;

    this.enabled =
      process.env.RAG_ENABLED === "true";

    this.embeddingProvider =
      process.env.EMBEDDING_PROVIDER ||
      "openai";

    this.embeddingModel =
      process.env.OPENAI_EMBEDDING_MODEL ||
      "text-embedding-3-small";

    this.embeddingDimensions = Number(
      process.env.RAG_EMBEDDING_DIMENSIONS ||
        1536
    );

    this.chunkSize = Number(
      process.env.RAG_CHUNK_SIZE || 500
    );

    this.chunkOverlap = Number(
      process.env.RAG_CHUNK_OVERLAP || 50
    );

    this.topK = Number(
      process.env.RAG_TOP_K || 5
    );

    this.minScore = Number(
      process.env.RAG_MIN_SCORE || 0.45
    );

    this.initialized = false;
  }

  async initialize() {
    if (!this.enabled) {
      console.log("RAG disabled");
      return false;
    }

    if (this.initialized) {
      return true;
    }

    const uri = process.env.MONGODB_URI;

    if (!uri) {
      console.warn(
        "RAG disabled: MONGODB_URI missing"
      );

      this.enabled = false;
      return false;
    }

    try {
      this.client = new MongoClient(uri);

      await this.client.connect();

      this.db = this.client.db(
        process.env.MONGODB_DB_NAME ||
          "roxan"
      );

      this.documents =
        this.db.collection(
          "rag_documents"
        );

      this.embeddings =
        this.db.collection(
          "rag_embeddings"
        );

      await this.documents.createIndex({
        ownerId: 1,
        createdAt: -1
      });

      await this.embeddings.createIndex({
        ownerId: 1,
        documentId: 1
      });

      await this.embeddings.createIndex({
        ownerId: 1,
        text: "text",
        title: "text"
      });

      this.initialized = true;

      console.log("RAG initialized");

      return true;
    } catch (error) {
      console.error(
        "RAG initialization failed:",
        error.message
      );

      this.enabled = false;
      return false;
    }
  }

  normalizeOwnerId(ownerId) {
    return String(ownerId);
  }

  async generateEmbedding(text) {
    const value = String(text || "")
      .slice(0, 8000);

    if (
      this.embeddingProvider !== "openai" ||
      !process.env.OPENAI_API_KEY
    ) {
      return this.simpleEmbedding(
        value,
        this.embeddingDimensions
      );
    }

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/embeddings",
        {
          model: this.embeddingModel,
          input: value,
          dimensions:
            this.embeddingDimensions
        },
        {
          headers: {
            Authorization:
              `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type":
              "application/json"
          },
          timeout: 30000
        }
      );

      const embedding =
        response.data?.data?.[0]?.embedding;

      if (!Array.isArray(embedding)) {
        throw new Error(
          "Invalid embedding response"
        );
      }

      if (
        embedding.length !==
        this.embeddingDimensions
      ) {
        throw new Error(
          `Expected ${this.embeddingDimensions} dimensions, got ${embedding.length}`
        );
      }

      return embedding;
    } catch (error) {
      console.error(
        "Embedding error:",
        error.response?.data ||
          error.message
      );

      return this.simpleEmbedding(
        value,
        this.embeddingDimensions
      );
    }
  }

  simpleEmbedding(
    text,
    size = 1536
  ) {
    const vector =
      new Array(size).fill(0);

    const normalized =
      String(text || "").toLowerCase();

    for (
      let i = 0;
      i < normalized.length;
      i++
    ) {
      const code =
        normalized.charCodeAt(i);

      vector[code % size] += 1;
      vector[(code * 7) % size] += 0.5;
    }

    const norm = Math.sqrt(
      vector.reduce(
        (sum, value) =>
          sum + value * value,
        0
      )
    ) || 1;

    return vector.map(
      value => value / norm
    );
  }

  chunkText(
    text,
    size = this.chunkSize,
    overlap = this.chunkOverlap
  ) {
    const clean = String(text || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!clean) {
      return [];
    }

    const safeSize = Math.max(
      100,
      Number(size)
    );

    const safeOverlap = Math.min(
      Math.max(0, Number(overlap)),
      safeSize - 1
    );

    const chunks = [];
    let start = 0;

    while (start < clean.length) {
      const rawEnd = Math.min(
        start + safeSize,
        clean.length
      );

      let end = rawEnd;

      if (rawEnd < clean.length) {
        const section = clean.slice(
          start,
          rawEnd
        );

        const sentenceBreak = Math.max(
          section.lastIndexOf(". "),
          section.lastIndexOf("? "),
          section.lastIndexOf("! "),
          section.lastIndexOf("; ")
        );

        if (
          sentenceBreak >
          safeSize * 0.5
        ) {
          end =
            start +
            sentenceBreak +
            1;
        }
      }

      const chunk = clean
        .slice(start, end)
        .trim();

      if (chunk.length >= 20) {
        chunks.push(chunk);
      }

      if (end >= clean.length) {
        break;
      }

      const nextStart =
        end - safeOverlap;

      start =
        nextStart <= start
          ? end
          : nextStart;
    }

    return chunks;
  }

  async ingest({
    ownerId,
    documentId,
    title,
    text,
    type = "text",
    metadata = {}
  }) {
    await this.initialize();

    if (!this.initialized) {
      throw new Error(
        "RAG is not initialized"
      );
    }

    const owner =
      this.normalizeOwnerId(ownerId);

    const sourceText = String(
      text || ""
    );

    const chunks =
      this.chunkText(sourceText);

    if (!chunks.length) {
      return {
        chunks: 0,
        message: "No usable text found"
      };
    }

    const docId = documentId
      ? new ObjectId(documentId)
      : new ObjectId();

    const now = new Date();

    await this.documents.updateOne(
      {
        _id: docId,
        ownerId: owner
      },
      {
        $set: {
          ownerId: owner,
          title: title || "Untitled",
          type,
          textLength: sourceText.length,
          chunkCount: chunks.length,
          metadata,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      {
        upsert: true
      }
    );

    await this.embeddings.deleteMany({
      ownerId: owner,
      documentId: docId
    });

    const records = [];

    for (
      let i = 0;
      i < chunks.length;
      i++
    ) {
      const embedding =
        await this.generateEmbedding(
          chunks[i]
        );

      records.push({
        ownerId: owner,
        documentId: docId,
        chunkIndex: i,
        text: chunks[i],
        embedding,
        title: title || "Untitled",
        type,
        metadata,
        createdAt: now
      });
    }

    if (records.length) {
      await this.embeddings.insertMany(
        records
      );
    }

    return {
      documentId: String(docId),
      title: title || "Untitled",
      chunks: chunks.length
    };
  }

  async search({
    ownerId,
    query,
    topK = this.topK,
    documentId = null
  }) {
    await this.initialize();

    if (!this.initialized) {
      return [];
    }

    const owner =
      this.normalizeOwnerId(ownerId);

    const limit = Math.max(
      1,
      Number(topK) || 5
    );

    const filterDocumentId =
      documentId
        ? String(documentId)
        : null;

    try {
      const queryEmbedding =
        await this.generateEmbedding(
          query
        );

      const vectorResults =
        await this.vectorSearch({
          ownerId: owner,
          queryEmbedding,
          topK: limit,
          documentId: filterDocumentId
        });

      if (vectorResults.length) {
        return vectorResults;
      }
    } catch (error) {
      console.warn(
        "Vector search failed. Using keyword search:",
        error.message
      );
    }

    return this.keywordSearch({
      ownerId: owner,
      query,
      topK: limit,
      documentId: filterDocumentId
    });
  }

  async vectorSearch({
    ownerId,
    queryEmbedding,
    topK,
    documentId = null
  }) {
    const filter = {
      ownerId
    };

    if (documentId) {
      filter.documentId =
        new ObjectId(documentId);
    }

    const pipeline = [
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: Math.max(
            topK * 20,
            50
          ),
          limit: topK * 3,
          filter
        }
      },
      {
        $project: {
          _id: 0,
          text: 1,
          title: 1,
          type: 1,
          documentId: 1,
          chunkIndex: 1,
          score: {
            $meta: "vectorSearchScore"
          }
        }
      },
      {
        $match: {
          score: {
            $gte: this.minScore
          }
        }
      },
      {
        $limit: topK
      }
    ];

    return this.embeddings
      .aggregate(pipeline)
      .toArray();
  }

  async keywordSearch({
    ownerId,
    query,
    topK,
    documentId = null
  }) {
    const keywords = String(query || "")
      .toLowerCase()
      .split(/\s+/)
      .map(word =>
        word.replace(
          /[^\p{L}\p{N}_-]/gu,
          ""
        )
      )
      .filter(word => word.length > 2)
      .slice(0, 12);

    if (!keywords.length) {
      return [];
    }

    const regexes = keywords.map(
      word => new RegExp(word, "i")
    );

    const mongoFilter = {
      ownerId,
      $or: regexes.map(regex => ({
        text: regex
      }))
    };

    if (documentId) {
      mongoFilter.documentId =
        new ObjectId(documentId);
    }

    const rows = await this.embeddings
      .find(mongoFilter)
      .limit(topK * 5)
      .toArray();

    const scored = rows.map(row => {
      const lowerText =
        row.text.toLowerCase();

      let score = 0;

      for (const keyword of keywords) {
        const matches =
          lowerText.match(
            new RegExp(keyword, "g")
          ) || [];

        score += matches.length;
      }

      return {
        text: row.text,
        title: row.title,
        type: row.type,
        documentId: row.documentId,
        chunkIndex: row.chunkIndex,
        score: score / keywords.length
      };
    });

    return scored
      .filter(row => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async buildContext({
    ownerId,
    query,
    topK = this.topK,
    documentId = null
  }) {
    const results = await this.search({
      ownerId,
      query,
      topK,
      documentId
    });

    if (!results.length) {
      return {
        context: "",
        sources: [],
        found: false,
        count: 0
      };
    }

    const context = results
      .map((result, index) =>
        [
          `[Source ${index + 1}: ${result.title}]`,
          result.text
        ].join("\n")
      )
      .join("\n\n---\n\n");

    const sourceMap = new Map();

    for (const result of results) {
      const key = [
        result.title || "Untitled",
        result.type || "document"
      ].join("|");

      const current = sourceMap.get(key);

      if (
        !current ||
        Number(result.score || 0) >
          current.score
      ) {
        sourceMap.set(key, {
          title:
            result.title || "Untitled",

          type:
            result.type || "document",

          score:
            Number(result.score || 0),

          preview:
            result.text.slice(0, 160) +
            (result.text.length > 160
              ? "..."
              : "")
        });
      }
    }

    const sources = Array.from(
      sourceMap.values()
    );

    return {
      context,
      sources,
      found: true,
      count: results.length
    };
  }

  async listDocuments(ownerId) {
    await this.initialize();

    if (!this.initialized) {
      return [];
    }

    const owner =
      this.normalizeOwnerId(ownerId);

    return this.documents
      .find({ ownerId: owner })
      .project({
        _id: 1,
        title: 1,
        type: 1,
        chunkCount: 1,
        textLength: 1,
        createdAt: 1
      })
      .sort({
        createdAt: -1
      })
      .toArray();
  }

  async deleteDocument({
    ownerId,
    documentId
  }) {
    await this.initialize();

    if (!this.initialized) {
      throw new Error(
        "RAG is not initialized"
      );
    }

    const owner =
      this.normalizeOwnerId(ownerId);

    const docId = new ObjectId(
      documentId
    );

    await this.documents.deleteOne({
      _id: docId,
      ownerId: owner
    });

    await this.embeddings.deleteMany({
      documentId: docId,
      ownerId: owner
    });

    return {
      deleted: true
    };
  }

  async stats(ownerId) {
    await this.initialize();

    if (!this.initialized) {
      return {
        documents: 0,
        chunks: 0
      };
    }

    const owner =
      this.normalizeOwnerId(ownerId);

    const [
      documents,
      chunks
    ] = await Promise.all([
      this.documents.countDocuments({
        ownerId: owner
      }),
      this.embeddings.countDocuments({
        ownerId: owner
      })
    ]);

    return {
      documents,
      chunks
    };
  }
}

module.exports = new RoxanRAG();

*/

const { MongoClient, ObjectId } = require("mongodb");
const axios = require("axios");

class RoxanRAG {
  constructor() {
    this.client = null;
    this.db = null;
    this.documents = null;
    this.embeddings = null;

    this.enabled = process.env.RAG_ENABLED === "true";
    this.embeddingProvider = process.env.EMBEDDING_PROVIDER || "local";
    this.embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
    this.embeddingDimensions = Number(process.env.RAG_EMBEDDING_DIMENSIONS || 1536);

    this.chunkSize = Number(process.env.RAG_CHUNK_SIZE || 500);
    this.chunkOverlap = Number(process.env.RAG_CHUNK_OVERLAP || 50);
    this.topK = Number(process.env.RAG_TOP_K || 3);
    this.maxContextChars = Number(process.env.RAG_MAX_CONTEXT_CHARS || 4000);
    this.minScore = Number(process.env.RAG_MIN_SCORE || 0.15);
    this.strongScore = Number(process.env.RAG_STRONG_SCORE || 0.5);
    this.minKeywordCoverage = Number(process.env.RAG_MIN_KEYWORD_COVERAGE || 0.5);
    this.minKeywordMatches = Number(process.env.RAG_MIN_KEYWORD_MATCHES || 2);

    this.initialized = false;
  }

  async initialize() {
    if (!this.enabled) {
      console.log("RAG disabled");
      return false;
    }

    if (this.initialized) return true;

    const uri = process.env.MONGODB_URI;

    if (!uri) {
      console.warn("RAG disabled: MONGODB_URI missing");
      this.enabled = false;
      return false;
    }

    try {
      this.client = new MongoClient(uri);
      await this.client.connect();

      this.db = this.client.db(process.env.MONGODB_DB_NAME || "roxan");
      this.documents = this.db.collection("rag_documents");
      this.embeddings = this.db.collection("rag_embeddings");

      await this.documents.createIndex({ ownerId: 1, createdAt: -1 });
      await this.embeddings.createIndex({ ownerId: 1, documentId: 1 });
      await this.embeddings.createIndex({ ownerId: 1, text: "text", title: "text" });

      this.initialized = true;

      console.log("RAG initialized (using shared DB connection)");
      return true;
    } catch (error) {
      console.error("RAG initialization failed:", error.message);
      this.enabled = false;
      return false;
    }
  }

  normalizeOwnerId(ownerId) {
    return String(ownerId);
  }

  async generateEmbedding(text) {
    const value = String(text || "").slice(0, 8000);

    if (this.embeddingProvider === "local" || !process.env.OPENAI_API_KEY) {
      return this.simpleEmbedding(value, this.embeddingDimensions);
    }

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/embeddings",
        {
          model: this.embeddingModel,
          input: value,
          dimensions: this.embeddingDimensions
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 30000
        }
      );

      const embedding = response.data?.data?.[0]?.embedding;

      if (!Array.isArray(embedding)) {
        throw new Error("Invalid embedding response");
      }

      if (embedding.length !== this.embeddingDimensions) {
        throw new Error(
          `Expected ${this.embeddingDimensions} dimensions, got ${embedding.length}`
        );
      }

      return embedding;
    } catch (error) {
      console.error(
        "Embedding error:",
        error.response?.data || error.message
      );

      return this.simpleEmbedding(value, this.embeddingDimensions);
    }
  }

  simpleEmbedding(text, size = 1536) {
    const vector = new Array(size).fill(0);
    const normalized = String(text || "").toLowerCase();
    const words = normalized.split(/\s+/).filter(w => w.length > 2);

    for (const word of words) {
      let hash = 0;

      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash) + word.charCodeAt(i);
        hash = hash & hash;
      }

      const idx = Math.abs(hash) % size;

      vector[idx] += 1;
      vector[(idx * 7) % size] += 0.5;
      vector[(idx * 13) % size] += 0.25;
    }

    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;

    return vector.map(v => v / norm);
  }

  chunkText(text, size = this.chunkSize, overlap = this.chunkOverlap) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();

    if (!clean) return [];

    const safeSize = Math.max(100, Number(size));
    const safeOverlap = Math.min(Math.max(0, Number(overlap)), safeSize - 1);

    const chunks = [];
    let start = 0;

    while (start < clean.length) {
      const rawEnd = Math.min(start + safeSize, clean.length);
      let end = rawEnd;

      if (rawEnd < clean.length) {
        const section = clean.slice(start, rawEnd);

        const sentenceBreak = Math.max(
          section.lastIndexOf(". "),
          section.lastIndexOf("? "),
          section.lastIndexOf("! "),
          section.lastIndexOf("; ")
        );

        if (sentenceBreak > safeSize * 0.5) {
          end = start + sentenceBreak + 1;
        }
      }

      const chunk = clean.slice(start, end).trim();

      if (chunk.length >= 20) chunks.push(chunk);
      if (end >= clean.length) break;

      const nextStart = end - safeOverlap;
      start = nextStart <= start ? end : nextStart;
    }

    return chunks;
  }

  async ingest({ ownerId, documentId, title, text, type = "text", metadata = {} }) {
    await this.initialize();

    if (!this.initialized) {
      throw new Error("RAG is not initialized");
    }

    const owner = this.normalizeOwnerId(ownerId);
    const sourceText = String(text || "");
    const chunks = this.chunkText(sourceText);

    if (!chunks.length) {
      return { chunks: 0, message: "No usable text found" };
    }

    const docId = documentId ? new ObjectId(documentId) : new ObjectId();
    const now = new Date();

    await this.documents.updateOne(
      { _id: docId, ownerId: owner },
      {
        $set: {
          ownerId: owner,
          title: title || "Untitled",
          type,
          textLength: sourceText.length,
          chunkCount: chunks.length,
          metadata,
          updatedAt: now
        },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );

    await this.embeddings.deleteMany({ ownerId: owner, documentId: docId });

    const records = [];
    const batchSize = 10;

    console.log(`📄 Ingesting "${title}" — ${chunks.length} chunks...`);

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await this.generateEmbedding(chunks[i]);

      records.push({
        ownerId: owner,
        documentId: docId,
        chunkIndex: i,
        text: chunks[i],
        embedding,
        title: title || "Untitled",
        type,
        metadata,
        createdAt: now
      });

      if ((i + 1) % batchSize === 0 || i === chunks.length - 1) {
        console.log(`   Progress: ${i + 1}/${chunks.length}`);
      }
    }

    if (records.length) {
      await this.embeddings.insertMany(records);
      console.log(`✅ Ingested ${records.length} chunks`);
    }

    return {
      documentId: String(docId),
      title: title || "Untitled",
      chunks: chunks.length
    };
  }

  async search({ ownerId, query, topK = this.topK, documentId = null }) {
    await this.initialize();

    if (!this.initialized) return [];

    const owner = this.normalizeOwnerId(ownerId);
    const limit = Math.max(1, Number(topK) || 3);
    const filterDocumentId = documentId ? String(documentId) : null;

    try {
      const queryEmbedding = await this.generateEmbedding(query);

      const vectorResults = await this.vectorSearch({
        ownerId: owner,
        queryEmbedding,
        topK: limit,
        documentId: filterDocumentId
      });

      if (vectorResults.length) {
        console.log(`🎯 Vector search: ${vectorResults.length} results`);
        return vectorResults;
      }
    } catch (error) {
      console.warn("Vector search failed. Using keyword search:", error.message);
    }

    return this.keywordSearch({
      ownerId: owner,
      query,
      topK: limit,
      documentId: filterDocumentId
    });
  }

  async vectorSearch({ ownerId, queryEmbedding, topK, documentId = null }) {
    const filter = { ownerId };

    if (documentId) {
      filter.documentId = new ObjectId(documentId);
    }

    const pipeline = [
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: Math.max(topK * 20, 50),
          limit: topK * 3,
          filter
        }
      },
      {
        $project: {
          _id: 0,
          text: 1,
          title: 1,
          type: 1,
          documentId: 1,
          chunkIndex: 1,
          score: { $meta: "vectorSearchScore" }
        }
      },
      {
        $match: {
          score: { $gte: this.minScore }
        }
      },
      { $limit: topK }
    ];

    return this.embeddings.aggregate(pipeline).toArray();
  }

  async keywordSearch({ ownerId, query, topK, documentId = null }) {
    const stopwords = new Set([
      "what", "with", "from", "this", "that", "have", "will", "your",
      "about", "which", "there", "their", "they", "them", "then", "than",
      "when", "where", "here", "into", "onto", "upon", "over", "under",
      "does", "doing", "done", "make", "made", "many", "more", "most",
      "some", "such", "only", "just", "also", "very", "much", "well",
      "like", "need", "want", "know", "tell", "give", "take", "come",
      "could", "would", "should", "might", "must", "shall", "can"
    ]);

    const keywords = String(query || "")
      .toLowerCase()
      .split(/\s+/)
      .map(word => word.replace(/[^\p{L}\p{N}_-]/gu, ""))
      .filter(word => word.length > 3)
      .filter(word => !stopwords.has(word))
      .slice(0, 15);

    if (!keywords.length) {
      console.log("🔍 Keyword search: no keywords extracted");
      return [];
    }

    const mongoFilter = { ownerId };

    if (documentId) {
      mongoFilter.documentId = new ObjectId(documentId);
    }

    const rows = await this.embeddings
      .find(mongoFilter)
      .limit(500)
      .toArray();

    if (!rows.length) {
      console.log(`🔍 Keyword search: no chunks in DB`);
      return [];
    }

    const scored = rows.map(row => {
      const lowerText = String(row.text || "").toLowerCase();

      let matchedKeywords = 0;
      let totalOccurrences = 0;

      for (const keyword of keywords) {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`\\b${escaped}`, "gi");
        const matches = lowerText.match(regex);

        if (matches && matches.length > 0) {
          matchedKeywords++;
          totalOccurrences += matches.length;
        }
      }

      const coverage = keywords.length > 0 ? matchedKeywords / keywords.length : 0;
      const frequencyBoost = Math.min(totalOccurrences / 10, 0.3);
      const finalScore = coverage + frequencyBoost * (1 - coverage);

      return {
        text: row.text,
        title: row.title,
        type: row.type,
        documentId: row.documentId,
        chunkIndex: row.chunkIndex,
        score: finalScore,
        matchedKeywords,
        totalOccurrences,
        coverage
      };
    });

    const filtered = scored
      .filter(row => row.coverage >= this.minKeywordCoverage)
      .filter(row => row.matchedKeywords >= this.minKeywordMatches)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    console.log(
      `🔍 Keyword search: ${keywords.length} keywords, ` +
      `${filtered.length}/${rows.length} chunks matched ` +
      `(coverage>=${this.minKeywordCoverage}, minMatch>=${this.minKeywordMatches})`
    );

    if (filtered.length) {
      console.log(
        `   Top: "${filtered[0].title}" (${(filtered[0].score * 100).toFixed(0)}%, ` +
        `${filtered[0].matchedKeywords} keywords)`
      );
    }

    return filtered;
  }

  async buildContext({ ownerId, query, topK = this.topK, documentId = null }) {
    const results = await this.search({
      ownerId,
      query,
      topK,
      documentId
    });

    if (!results.length) {
      console.log("📚 RAG: No results found");
      return {
        context: "",
        sources: [],
        found: false,
        count: 0
      };
    }

    const hasStrongResult = results.some(
      r => Number(r.score || 0) >= this.strongScore
    );

    if (!hasStrongResult) {
      console.log(
        `📚 RAG: Weak results only (best: ${(
          Math.max(...results.map(r => Number(r.score || 0))) * 100
        ).toFixed(0)}%, threshold: ${(this.strongScore * 100).toFixed(0)}%)`
      );

      return {
        context: "",
        sources: [],
        found: false,
        count: 0
      };
    }

    let context = "";
    const usedResults = [];
    let sourceIndex = 1;

    for (const result of results) {
      const chunk = `[Source ${sourceIndex}: ${result.title}]\n${result.text}`;

      if (context.length + chunk.length > this.maxContextChars) break;

      context += (context ? "\n\n---\n\n" : "") + chunk;
      usedResults.push(result);
      sourceIndex++;
    }

    const sourceMap = new Map();

    for (const result of usedResults) {
      const key = [
        result.title || "Untitled",
        result.type || "document"
      ].join("|");

      const current = sourceMap.get(key);

      if (!current || Number(result.score || 0) > current.score) {
        sourceMap.set(key, {
          documentId: result.documentId,
          chunkIndex: result.chunkIndex,
          title: result.title || "Untitled",
          type: result.type || "document",
          score: Number(result.score || 0),
          preview:
            String(result.text || "").slice(0, 160) +
            (String(result.text || "").length > 160 ? "..." : "")
        });
      }
    }

    const sources = Array.from(sourceMap.values());

    console.log(
      `📚 RAG context built: ${usedResults.length} chunks, ` +
      `${context.length} chars, ${sources.length} unique sources`
    );

    return {
      context,
      sources,
      found: true,
      count: usedResults.length
    };
  }

  async listDocuments(ownerId) {
    await this.initialize();

    if (!this.initialized) return [];

    const owner = this.normalizeOwnerId(ownerId);

    return this.documents
      .find({ ownerId: owner })
      .project({
        _id: 1,
        title: 1,
        type: 1,
        chunkCount: 1,
        textLength: 1,
        createdAt: 1
      })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async deleteDocument({ ownerId, documentId }) {
    await this.initialize();

    if (!this.initialized) {
      throw new Error("RAG is not initialized");
    }

    const owner = this.normalizeOwnerId(ownerId);
    const docId = new ObjectId(documentId);

    await this.documents.deleteOne({
      _id: docId,
      ownerId: owner
    });

    await this.embeddings.deleteMany({
      documentId: docId,
      ownerId: owner
    });

    console.log(`🗑️ RAG document deleted: ${documentId}`);

    return { deleted: true };
  }

  async stats(ownerId) {
    await this.initialize();

    if (!this.initialized) {
      return { documents: 0, chunks: 0 };
    }

    const owner = this.normalizeOwnerId(ownerId);

    const [documents, chunks] = await Promise.all([
      this.documents.countDocuments({ ownerId: owner }),
      this.embeddings.countDocuments({ ownerId: owner })
    ]);

    return { documents, chunks };
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.initialized = false;
      this.client = null;
      this.db = null;
      this.documents = null;
      this.embeddings = null;
      console.log("RAG closed");
    }
  }
}

module.exports = new RoxanRAG();