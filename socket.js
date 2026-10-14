
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

function setupSocket(io, deps) {
  const {
    db,
    auth,
    rag,
    smartRoute,
    normalizeAttachment,
    getAttachmentText,
    isRagReady
  } = deps;

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = auth.verify(token);

      if (!decoded?.sub) {
        return next(new Error("Invalid session"));
      }

      socket.data.userId = String(decoded.sub);

      next();
    } catch {
      next(new Error("Invalid session"));
    }
  });

  io.on("connection", socket => {
    const userId = socket.data.userId;

    let generationRunning = false;

    const heartbeat = setInterval(() => {
      if (socket.connected) {
        socket.emit("heartbeat", { time: Date.now() });
      }
    }, 15000);

    socket.on("message", async payload => {
      if (generationRunning) {
        socket.emit(
          "errorMessage",
          "A response is already being generated. Please wait or stop it first."
        );

        return;
      }

      generationRunning = true;
      socket.generationStopped = false;
      socket.activeStream = null;

      try {
        const safePayload =
          payload && typeof payload === "object" ? payload : {};

        const text = String(safePayload.text || "").trim();

        const normalizedAttachment = normalizeAttachment(
          safePayload.attachment
        );

        const image =
          typeof safePayload.image === "string"
            ? safePayload.image
            : null;

        const documentId = normalizeDocumentId(
          safePayload.documentId
        );

        console.log("📨 Incoming chat payload:", {
          text: text.slice(0, 50),
          documentId,
          provider: safePayload.provider,
          conversationId: safePayload.conversationId
        });

        if (!text && !image && !normalizedAttachment) {
          throw new Error("Enter a message or attach a file.");
        }

        const usage = await auth.consumeUsage(userId);

        if (!usage.allowed) {
          socket.emit("rateLimit", {
            message: "Daily message limit reached."
          });

          return;
        }

        socket.emit("usage", usage);

        let conversationId = safePayload.conversationId || null;

        let conversation = conversationId
          ? await db.getConversation({
              ownerId: userId,
              conversationId
            })
          : null;

        if (!conversation) {
          conversation = await db.createConversation({
            ownerId: userId,
            title: String(text || "New chat").slice(0, 60),
            provider: safePayload.provider,
            model: safePayload.model
          });

          conversationId = String(conversation._id);

          socket.emit("conversationCreated", { conversation });
        }

        const attachmentContent = normalizedAttachment
          ? getAttachmentText(normalizedAttachment)
          : "";

        if (
          isRagReady() &&
          normalizedAttachment?.kind === "document" &&
          attachmentContent.trim()
        ) {
          try {
            await rag.ingest({
              ownerId: String(userId),
              title: normalizedAttachment.name || "Attachment",
              text: attachmentContent,
              type: "attachment",
              metadata: {
                conversationId: String(conversationId),
                mimeType: normalizedAttachment.type
              }
            });

            socket.emit(
              "status",
              "Document indexed to knowledge base"
            );
          } catch (error) {
            console.warn(
              "Attachment indexing failed:",
              error.message
            );
          }
        }

        const savedUserContent =
          text || attachmentContent || "[Attachment]";

        if (db.isEnabled()) {
          await db.appendMessage({
            ownerId: userId,
            conversationId,
            role: "user",
            content: savedUserContent,
            documentId: documentId,
            attachmentName: normalizedAttachment?.name,
            attachmentType: normalizedAttachment?.type
          });
        }

        socket.emit("generationStart", { conversationId });

        const result = await smartRoute({
          ownerId: String(userId),
          conversationId,
          text,
          primary: safePayload.provider || "auto",
          model: safePayload.model,
          preference: safePayload.preference || "auto",
          fallback: safePayload.fallbackEnabled !== false,
          image,
          attachment: null,
          documentId,
          onStatus: status => {
            if (socket.connected) {
              socket.emit("status", status);
            }
          },
          onChunk: chunk => {
            if (socket.connected && !socket.generationStopped) {
              socket.emit("chunk", {
                text: String(chunk || "")
              });
            }
          }
        });

        if (socket.generationStopped) {
          return;
        }

        if (db.isEnabled()) {
          await db.appendMessage({
            ownerId: userId,
            conversationId,
            role: "assistant",
            content: String(result.answer || ""),
            provider: result.name,
            model: result.model,
            documentId: documentId
          });
        }

        if (socket.connected) {
          socket.emit("reply", {
            text: String(result.answer || ""),
            provider: result.name,
            model: result.model,
            fallback: result.fallback,
            conversationId,
            nlp: result.nlp || null,
            rag: result.rag || null
          });

          socket.emit("generationComplete", { conversationId });
          socket.emit("status", "");
        }
      } catch (error) {
        console.error("Socket message error:", error);

        if (socket.connected && !socket.generationStopped) {
          socket.emit(
            "errorMessage",
            error.message || "Message processing failed."
          );

          socket.emit("status", "");
        }
      } finally {
        generationRunning = false;
        socket.activeStream = null;
        socket.generationStopped = false;
      }
    });

    socket.on("stopGeneration", () => {
      socket.generationStopped = true;

      if (socket.activeStream) {
        try {
          socket.activeStream.destroy();
        } catch {}

        socket.activeStream = null;
      }

      if (socket.connected) {
        socket.emit("generationStopped");
        socket.emit("status", "");
      }

      generationRunning = false;
    });

    socket.on("disconnect", () => {
      clearInterval(heartbeat);

      socket.generationStopped = true;

      if (socket.activeStream) {
        try {
          socket.activeStream.destroy();
        } catch {}

        socket.activeStream = null;
      }

      generationRunning = false;
    });
  });
}

module.exports = setupSocket;