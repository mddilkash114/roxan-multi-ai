let socket = null;

window.socket = null;

function connectSocket() {
    const token = localStorage.getItem("roxanToken");

    if (!token) {
        return;
    }

    if (socket) {
        socket.disconnect();
    }

    socket = io({
        auth: { token },
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });

    window.socket = socket;

    socket.on("connect", () => {
        setStatus("Connected");
        console.log("Socket connected:", socket.id);
    });

    socket.on("disconnect", reason => {
        if (isGenerating) {
            setGeneratingState(false);

            if (lastUserMessage) {
                showRetryButton();
            }
        }

        setStatus("Disconnected. Reconnecting...");
    });

    socket.on("connect_error", error => {
        console.error("WebSocket error:", error);

        if (lastUserMessage) {
            showRetryButton();
        }

        setStatus("Connection error");
    });

    socket.on("authRequired", () => {
        localStorage.removeItem("roxanToken");

        location.reload();
    });

    socket.on("conversationCreated", data => {
        if (data?.conversation) {
            conversationId = String(data.conversation._id);

            loadChats();
        }
    });

    socket.on("generationStart", () => {
        streamCancelled = false;

        setGeneratingState(true);

        streamNode = null;
    });

    socket.on("chunk", data => {
        const chunk = String(data?.text || "");

        if (!chunk) {
            return;
        }

        if (streamCancelled) {
            return;
        }

        clearWelcome();

        const wasNearBottom = isNearBottom(messages);

        if (!streamNode) {
            streamNode = createStreamingMessage();

            streamNode.dataset.raw = "";
            streamNode.dataset.streaming = "true";
        }

        if (!streamNode) {
            return;
        }

        streamNode.dataset.raw += chunk;

        streamNode.innerHTML = renderMarkdown(streamNode.dataset.raw);

        if (wasNearBottom) {
            scrollToBottom();
        }
    });

    socket.on("reply", data => {
        if (!data) {
            return;
        }

        removeRetryButton();

        const answer = String(data.text || "");

        const meta = [
            data.provider || "",
            data.model || "",
            data.fallback ? "fallback" : ""
        ]
            .filter(Boolean)
            .join(" · ");

        if (
            streamNode &&
            streamNode.dataset.streaming === "true"
        ) {
            streamNode.innerHTML = renderMarkdown(answer);

            streamNode.dataset.streaming = "false";

            streamNode = null;
        } else {
            appendMessage(answer, "assistant", meta);
        }

        if (data.nlp) {
            console.log(
                "NLP:",
                data.nlp.intent,
                `${Math.round((data.nlp.score || 0) * 100)}%`
            );
        }

        setGeneratingState(false);
        setStatus("");
        loadChats();

        if (ragDocList) {
            loadRagDocuments();
        }
    });

    socket.on("generationStopped", () => {
        streamCancelled = true;

        streamNode = null;

        setGeneratingState(false);

        setStatus("Generation stopped");
    });

    socket.on("status", message => {
        setStatus(message || "");
    });

    socket.on("errorMessage", message => {
        if (streamCancelled) {
            return;
        }

        if (streamNode) {
            streamNode.remove();
            streamNode = null;
        }

        appendMessage(
            `Error: ${message}`,
            "assistant",
            "Error"
        );

        setGeneratingState(false);
        setStatus("");
        showRetryButton();
    });

    socket.on("rateLimit", data => {
        if (streamNode) {
            streamNode.remove();
            streamNode = null;
        }

        setGeneratingState(false);

        setStatus(
            data?.message ||
            "Rate limit reached"
        );

        showRetryButton();
    });

    socket.on("usage", data => {
        if (usageBadge) {
            usageBadge.textContent =
                data?.remaining !== null && data?.remaining !== undefined
                    ? `${data.remaining} left today`
                    : "";
        }
    });
}

function disconnectSocket() {
    if (socket) {
        socket.disconnect();
        socket = null;
        window.socket = null;
    }
}

window.connectSocket = connectSocket;
window.disconnectSocket = disconnectSocket;