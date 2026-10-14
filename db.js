const { MongoClient, ObjectId } = require("mongodb");

let client = null;
let database = null;
let connected = false;

async function connectDatabase() {
  if (client && connected) {
    return client;
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn("MONGODB_URI not set — running in memory mode");
    return null;
  }

  try {
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000
    });

    await client.connect();

    database = client.db(
      process.env.MONGODB_DB_NAME || "roxan"
    );

    await database.command({ ping: 1 });

    connected = true;

    console.log("MongoDB connected");

    return client;
  } catch (error) {
    console.error(
      "MongoDB connection failed:",
      error.message
    );

    client = null;
    database = null;
    connected = false;

    return null;
  }
}

async function closeDatabase() {
  if (client) {
    try {
      await client.close();
    } catch {}

    client = null;
    database = null;
    connected = false;
  }
}

function isEnabled() {
  return connected && database !== null;
}

function getDatabase() {
  return database;
}

function getClient() {
  return client;
}

function toObjectId(id) {
  if (!id) return null;

  try {
    if (id instanceof ObjectId) return id;

    const value = String(id);

    if (!ObjectId.isValid(value)) {
      return null;
    }

    return new ObjectId(value);
  } catch {
    return null;
  }
}

async function createConversation({
  ownerId,
  title = "New chat",
  provider = null,
  model = null
}) {
  if (!isEnabled()) {
    return {
      _id: `local-${Date.now()}`,
      ownerId,
      title,
      provider,
      model,
      archived: false,
      pinned: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  const now = new Date();

  const doc = {
    ownerId: String(ownerId),
    title: String(title || "New chat").slice(0, 120),
    provider: provider || null,
    model: model || null,
    archived: false,
    pinned: false,
    createdAt: now,
    updatedAt: now
  };

  const result = await database
    .collection("conversations")
    .insertOne(doc);

  return {
    ...doc,
    _id: result.insertedId,
    messageCount: 0
  };
}

async function getConversation({
  ownerId,
  conversationId
}) {
  if (!isEnabled()) return null;

  const oid = toObjectId(conversationId);
  if (!oid) return null;

  return database
    .collection("conversations")
    .findOne({
      _id: oid,
      ownerId: String(ownerId)
    });
}

async function listConversations({
  ownerId,
  query = "",
  includeArchived = false
}) {
  if (!isEnabled()) return [];

  const owner = String(ownerId);
  const filter = { ownerId: owner };

  if (!includeArchived) {
    filter.archived = { $ne: true };
  }

  const cleanQuery = String(query || "").trim();

  if (cleanQuery) {
    filter.title = {
      $regex: cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i"
    };
  }

  const conversations = await database
    .collection("conversations")
    .find(filter)
    .sort({ pinned: -1, updatedAt: -1 })
    .limit(100)
    .toArray();

  if (!conversations.length) {
    return [];
  }

  const stringIds = conversations.map(c => String(c._id));
  const objectIds = conversations
    .map(c => toObjectId(c._id))
    .filter(Boolean);

  const counts = await database
    .collection("messages")
    .aggregate([
      {
        $match: {
          ownerId: owner,
          $or: [
            { conversationId: { $in: stringIds } },
            { conversationId: { $in: objectIds } }
          ]
        }
      },
      {
        $group: {
          _id: { $toString: "$conversationId" },
          count: { $sum: 1 }
        }
      }
    ])
    .toArray();

  const countMap = new Map(
    counts.map(c => [String(c._id), c.count])
  );

  return conversations.map(c => ({
    ...c,
    messageCount: countMap.get(String(c._id)) || 0
  }));
}

async function updateConversation({
  ownerId,
  conversationId,
  changes = {}
}) {
  if (!isEnabled()) return null;

  const oid = toObjectId(conversationId);
  if (!oid) return null;

  const update = {
    updatedAt: new Date()
  };

  if (typeof changes.title === "string") {
    update.title =
      changes.title.trim().slice(0, 120) || "New chat";
  }

  if (typeof changes.archived === "boolean") {
    update.archived = changes.archived;
  }

  if (typeof changes.pinned === "boolean") {
    update.pinned = changes.pinned;
  }

  if (changes.provider) {
    update.provider = changes.provider;
  }

  if (changes.model) {
    update.model = changes.model;
  }

  await database
    .collection("conversations")
    .updateOne(
      {
        _id: oid,
        ownerId: String(ownerId)
      },
      { $set: update }
    );

  return database
    .collection("conversations")
    .findOne({
      _id: oid,
      ownerId: String(ownerId)
    });
}

async function deleteConversation({
  ownerId,
  conversationId
}) {
  if (!isEnabled()) return false;

  const oid = toObjectId(conversationId);
  if (!oid) return false;

  const result = await database
    .collection("conversations")
    .deleteOne({
      _id: oid,
      ownerId: String(ownerId)
    });

  await database
    .collection("messages")
    .deleteMany({
      $or: [
        { conversationId: String(conversationId) },
        { conversationId: oid }
      ],
      ownerId: String(ownerId)
    });

  return result.deletedCount > 0;
}

async function appendMessage({
  ownerId,
  conversationId,
  role,
  content,
  provider = null,
  model = null,
  attachmentName = null,
  attachmentType = null
}) {
  if (!isEnabled()) return null;

  const now = new Date();

  const doc = {
    ownerId: String(ownerId),
    conversationId: String(conversationId),
    role,
    content: String(content || ""),
    provider: provider || null,
    model: model || null,
    attachmentName: attachmentName || null,
    attachmentType: attachmentType || null,
    createdAt: now
  };

  const result = await database
    .collection("messages")
    .insertOne(doc);

  await database
    .collection("conversations")
    .updateOne(
      {
        _id: toObjectId(conversationId),
        ownerId: String(ownerId)
      },
      {
        $set: { updatedAt: now }
      }
    );

  return {
    ...doc,
    _id: result.insertedId
  };
}

async function getMessages({
  ownerId,
  conversationId,
  limit = 200
}) {
  if (!isEnabled()) return [];

  const oid = toObjectId(conversationId);
  const cidString = String(conversationId);

  const rows = await database
    .collection("messages")
    .find({
      ownerId: String(ownerId),
      $or: [
        { conversationId: cidString },
        ...(oid ? [{ conversationId: oid }] : [])
      ]
    })
    .sort({ createdAt: 1 })
    .limit(Number(limit) || 200)
    .toArray();

  return rows;
}

async function stats(ownerId) {
  if (!isEnabled()) {
    return {
      conversations: 0,
      totalMessages: 0,
      assistantByProvider: []
    };
  }

  const owner = String(ownerId);

  const [conversations, totalMessages, assistantByProvider] =
    await Promise.all([
      database
        .collection("conversations")
        .countDocuments({ ownerId: owner }),

      database
        .collection("messages")
        .countDocuments({ ownerId: owner }),

      database
        .collection("messages")
        .aggregate([
          {
            $match: {
              ownerId: owner,
              role: "assistant",
              provider: { $ne: null }
            }
          },
          {
            $group: {
              _id: "$provider",
              messages: { $sum: 1 }
            }
          },
          {
            $sort: { messages: -1 }
          }
        ])
        .toArray()
    ]);

  return {
    conversations,
    totalMessages,
    assistantByProvider
  };
}

module.exports = {
  connectDatabase,
  closeDatabase,
  isEnabled,
  getDatabase,
  getClient,
  toObjectId,
  createConversation,
  getConversation,
  listConversations,
  updateConversation,
  deleteConversation,
  appendMessage,
  getMessages,
  stats
};