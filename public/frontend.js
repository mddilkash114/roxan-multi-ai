const $ = id => document.getElementById(id);
const authScreen = $("authScreen");
const appShell = $("appShell");
const authForm = $("authForm");
const authMode = $("authMode");
const authName = $("authName");
const authEmail = $("authEmail");
const authPassword = $("authPassword");
const authSubmit = $("authSubmit");
const authMessage = $("authMessage");
const usageBadge = $("usageBadge");
const logout = $("logout");
const msgForm = $("msgForm");
const inputText = $("inputText");
const messages = $("messages");
const fileInput = $("fileInput");
const attachmentName = $("attachmentName");
const attachmentPreview = $("attachmentPreview");
const attachmentFileIcon = $("attachmentFileIcon");
const attachmentMeta = $("attachmentMeta");
const attachmentStatus = $("attachmentStatus");
const removeAttachment = $("removeAttachment");
const statusEl = $("status");
const aiProvider = $("aiProvider");
const modelSelect = $("modelSelect");
const preference = $("preference");
const fallbackEnabled = $("fallbackEnabled");
const newChat = $("newChat");
const conversationList = $("conversationList");
const searchChats = $("searchChats");
const refreshChats = $("refreshChats");
const voiceBtn = $("voiceBtn");
const sendBtn = $("sendBtn");
const userProfileBtn = $("userProfileBtn");
const userDropdown = $("userDropdown");
const ragDocList = $("ragDocList");
const ragRefresh = $("ragRefresh");

let conversationId = null;
let pendingAttachment = null;
let streamNode = null;
let modelData = {};
let isGenerating = false;
let streamCancelled = false;
let lastUserMessage = null;
let retryButton = null;
let activeDocumentId = null;
let voiceRecognition = null;
let voiceRecording = false;

let isRegister = false;
let token = localStorage.getItem("roxanToken") || null;

const VOICE_MIC_ICON = "🎙️";

window.debug = window.debug || {};

function showApp() {
    if (authScreen) {
        authScreen.style.display = "none";
        authScreen.hidden = true;
    }

    if (appShell) {
        appShell.style.display = "flex";
        appShell.hidden = false;
    }
}

function showAuth() {
    if (authScreen) {
        authScreen.style.display = "flex";
        authScreen.hidden = false;
    }

    if (appShell) {
        appShell.style.display = "none";
        appShell.hidden = true;
    }
}

function setStatus(text) {
    if (statusEl) {
        statusEl.textContent = text || "";
    }
}
function toggleDropdown() {
    if (!userDropdown) {
        return;
    }

    const isOpen = userDropdown.style.display === "block";

    if (isOpen) {
        userDropdown.style.display = "none";
        userDropdown.hidden = true;
    } else {
        userDropdown.style.display = "block";
        userDropdown.hidden = false;
    }
}

function closeDropdown() {
    if (userDropdown) {
        userDropdown.style.display = "none";
        userDropdown.hidden = true;
    }
}

function appendMessage(text, role = "assistant", meta = "") {
    if (!messages) {
        return null;
    }

    const article = document.createElement("article");

    article.className = `message ${role}`;

    article.innerHTML = `
        <div class="message-body">
            ${renderMarkdown(text)}
        </div>
        ${meta
            ? `
                    <div class="message-meta">
                        ${escapeHtml(meta)}
                    </div>
                `
            : ""
        }
    `;

    messages.appendChild(article);

    return article.querySelector(".message-body");
}

function createStreamingMessage() {
    const node = document.createElement("article");

    node.className = "message assistant";

    node.innerHTML = `
        <div class="message-body"></div>
        <div class="message-meta">
            Streaming...
        </div>
    `;

    messages.appendChild(node);

    return node.querySelector(".message-body");
}

function removeRetryButton() {
    if (retryButton) {
        retryButton.remove();
        retryButton = null;
    }
}

function showRetryButton() {
    removeRetryButton();

    if (!messages || !lastUserMessage) {
        return;
    }

    const userMessages = messages.querySelectorAll(".message.user");

    if (!userMessages.length) {
        return;
    }

    const lastUserArticle = userMessages[userMessages.length - 1];
    const retryWrapper = document.createElement("div");
    retryWrapper.className = "retry-wrapper";

    retryWrapper.innerHTML = `
        <button class="retry-button" type="button" title="Retry" aria-label="Retry">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
        </button>
    `;

    const button = retryWrapper.querySelector(".retry-button");

    button.addEventListener("click", () => {
        retryLastMessage();
    });

    lastUserArticle.appendChild(retryWrapper);

    retryButton = retryWrapper;

    scrollToBottom();
}

function retryLastMessage() {
    if (!lastUserMessage || !window.socket) {
        return;
    }

    removeRetryButton();

    streamCancelled = false;
    setGeneratingState(true);
    setStatus("Retrying...");

    clearWelcome();

    const currentProvider = aiProvider?.value || "auto";
    const currentModel = modelSelect?.value || "";

    console.log("Retrying with provider:", currentProvider, "model:", currentModel);

    const retryPayload = {
        ...lastUserMessage,
        provider: currentProvider,
        model: currentModel,
        preference: preference?.value || "auto",
        fallbackEnabled: fallbackEnabled?.checked ?? true
    };

    lastUserMessage = {
        ...retryPayload
    };

    window.socket.emit("message", retryPayload);
}

function clearWelcome() {
    if (!messages) {
        return;
    }

    const welcome = messages.querySelector(".welcome");

    if (welcome) {
        messages.innerHTML = "";
    }
}

function isNearBottom(element, threshold = 100) {
    if (!element) {
        return true;
    }

    return (
        element.scrollHeight -
        element.scrollTop -
        element.clientHeight <
        threshold
    );
}

function scrollToBottom() {
    if (messages) {
        messages.scrollTop = messages.scrollHeight;
    }
}

async function loadModels() {
    try {
        const response = await api("/api/models");

        modelData = response || {};

        renderModels();
    } catch (error) {
        console.error("Load models error:", error);

        modelData = {};

        if (modelSelect) {
            modelSelect.innerHTML = `
                <option value="">
                    Unable to load models
                </option>
            `;
        }
    }
}

function getProviderData(provider) {
    if (!provider) {
        return null;
    }

    if (modelData[provider]) {
        return modelData[provider];
    }

    if (provider === "google") {
        return modelData.google || modelData.gemini || null;
    }

    if (provider === "gemini") {
        return modelData.gemini || modelData.google || null;
    }

    return null;
}

function renderModels() {
    if (!aiProvider || !modelSelect) {
        return;
    }

    const provider = aiProvider.value;

    if (provider === "auto") {
        modelSelect.innerHTML = `
            <option value="">
                Automatic model
            </option>
        `;

        return;
    }

    const data = getProviderData(provider);

    if (
        !data ||
        !Array.isArray(data.models) ||
        data.models.length === 0
    ) {
        modelSelect.innerHTML = `
            <option value="">
                Not configured
            </option>
        `;

        return;
    }

    modelSelect.innerHTML = data.models
        .map(
            model => `
                    <option value="${escapeHtml(model)}">
                        ${escapeHtml(model)}
                    </option>
                `
        )
        .join("");
}

if (aiProvider) {
    aiProvider.addEventListener("change", renderModels);
}

async function loadChats() {
    if (!conversationList) {
        return;
    }

    try {
        const search =
            searchChats?.value?.trim() || "";

        const url = search
            ? `/api/conversations?search=${encodeURIComponent(search)}`
            : "/api/conversations";

        const items = await api(url);

        conversationList.innerHTML = "";

        if (!items || items.length === 0) {
            conversationList.innerHTML = `
                <p style="color:#64748b;text-align:center;padding:20px;">
                    No chats yet.
                </p>
            `;

            return;
        }

        items.forEach(conv => {
            const row = document.createElement("div");

            row.className = `conversation-row ${
                String(conv._id) === String(conversationId) ? "active" : ""
            }`;

            row.dataset.chatId = String(conv._id);

            const title = conv.title || "New chat";
            const count = Number(conv.messageCount || 0);
            const isPinned = Boolean(conv.pinned);

            const pinIcon = isPinned
                ? `
                    <svg class="pin-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 17v5"/>
                        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
                    </svg>
                `
                : "";

            const pinMenuContent = isPinned
                ? `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="2" y1="2" x2="22" y2="22"/>
                        <path d="M12 17v5"/>
                        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
                    </svg>
                    <span>Unpin</span>
                `
                : `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 17v5"/>
                        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
                    </svg>
                    <span>Pin</span>
                `;

            row.innerHTML = `
                <button
                    class="conversation-open"
                    type="button"
                >
                    <span>
                        ${pinIcon}${escapeHtml(title)}
                    </span>

                    <small>
                        ${count}
                        ${count === 1 ? "message" : "messages"}
                    </small>
                </button>

                <div class="conversation-menu-wrap">
                    <button
                        class="conversation-menu"
                        type="button"
                        aria-label="Options"
                        aria-expanded="false"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/>
                            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
                            <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/>
                        </svg>
                    </button>

                    <div class="conversation-dropdown" hidden>
                        <button class="dropdown-item" data-action="rename" type="button">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 20h9"/>
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                            </svg>
                            <span>Rename</span>
                        </button>

                        <button class="dropdown-item" data-action="pin" type="button">
                            ${pinMenuContent}
                        </button>

                        <button class="dropdown-item" data-action="share" type="button">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                                <polyline points="16 6 12 2 8 6"/>
                                <line x1="12" y1="2" x2="12" y2="15"/>
                            </svg>
                            <span>Share</span>
                        </button>

                        <div class="dropdown-divider"></div>

                        <button class="dropdown-item danger" data-action="delete" type="button">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                <line x1="10" y1="11" x2="10" y2="17"/>
                                <line x1="14" y1="11" x2="14" y2="17"/>
                            </svg>
                            <span>Delete</span>
                        </button>
                    </div>
                </div>
            `;

            row.querySelector(".conversation-open").onclick = () =>
                openChat(conv._id);

            conversationList.appendChild(row);
        });
    } catch (error) {
        console.error("Load chats error:", error);

        setStatus(`Error loading chats: ${error.message}`);
    }
}

async function openChat(id) {
    try {
        conversationId = id;

        conversationList?.querySelectorAll(".conversation-row").forEach(row => {
            row.classList.toggle(
                "active",
                row.dataset.chatId === String(id)
            );
        });

        messages.innerHTML = `
            <div class="welcome">
                <p style="color:#64748b;">Loading messages...</p>
            </div>
        `;

        const rows = await api(`/api/conversations/${id}/messages`);

        const fragment = document.createDocumentFragment();

        rows.forEach(msg => {
            const meta = msg.provider
                ? `${msg.provider}${msg.model ? ` · ${msg.model}` : ""}`
                : "";

            const article = document.createElement("article");
            article.className = `message ${msg.role}`;

            article.innerHTML = `
                <div class="message-body">${renderMarkdown(msg.content)}</div>
                ${meta ? `<div class="message-meta">${escapeHtml(meta)}</div>` : ""}
            `;

            fragment.appendChild(article);
        });

        messages.innerHTML = "";
        messages.appendChild(fragment);

        scrollToBottom();
    } catch (error) {
        setStatus(`Error: ${error.message}`);
    }
}

function startInlineRename(row, currentTitle) {
    return new Promise(resolve => {
        const span = row.querySelector(".conversation-open span");
        const openBtn = row.querySelector(".conversation-open");

        if (!span || !openBtn) {
            resolve(null);
            return;
        }

        const originalTitle = (currentTitle || span.textContent || "").trim();

        const input = document.createElement("input");
        input.type = "text";
        input.className = "inline-rename-input";
        input.value = originalTitle;
        input.maxLength = 120;

        span.style.display = "none";
        openBtn.insertBefore(input, span);

        setTimeout(() => {
            input.focus();
            input.select();
        }, 30);

        let finished = false;

        const cleanup = (shouldSave) => {
            if (finished) return;
            finished = true;

            const value = input.value.trim();

            input.remove();
            span.style.display = "";

            document.removeEventListener("mousedown", onOutsideClick, true);

            resolve(
                shouldSave && value && value !== originalTitle
                    ? value
                    : null
            );
        };

        const onOutsideClick = (e) => {
            if (!input.contains(e.target)) {
                cleanup(true);
            }
        };

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                cleanup(true);
            } else if (e.key === "Escape") {
                e.preventDefault();
                cleanup(false);
            }
        });

        setTimeout(() => {
            document.addEventListener("mousedown", onOutsideClick, true);
        }, 100);
    });
}

function openConfirmModal(title, message, confirmLabel = "Confirm") {
    return new Promise(resolve => {
        const modal = document.getElementById("confirmModal");
        const titleEl = document.getElementById("confirmTitle");
        const msgEl = document.getElementById("confirmMessage");
        const okBtn = document.getElementById("confirmOk");
        const cancelBtn = document.getElementById("confirmCancel");

        if (!modal) {
            resolve(false);
            return;
        }

        titleEl.textContent = title || "Are you sure?";
        msgEl.textContent = message || "This action cannot be undone.";
        okBtn.textContent = confirmLabel;

        modal.hidden = false;

        setTimeout(() => okBtn.focus(), 50);

        const cleanup = () => {
            modal.hidden = true;
            okBtn.removeEventListener("click", onOk);
            cancelBtn.removeEventListener("click", onCancel);
            document.removeEventListener("keydown", onKey);
            modal.removeEventListener("click", onBackdrop);
        };

        const onOk = () => {
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
            } else if (e.key === "Enter") {
                e.preventDefault();
                onOk();
            }
        };

        const onBackdrop = (e) => {
            if (e.target === modal) onCancel();
        };

        okBtn.addEventListener("click", onOk);
        cancelBtn.addEventListener("click", onCancel);
        document.addEventListener("keydown", onKey);
        modal.addEventListener("click", onBackdrop);
    });
}

let shareToastTimer = null;

function showShareToast(text = "Link copied to clipboard") {
    const toast = document.getElementById("shareToast");
    const textEl = document.getElementById("shareToastText");

    if (!toast || !textEl) return;

    textEl.textContent = text;
    toast.hidden = false;

    clearTimeout(shareToastTimer);
    shareToastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 2400);
}

function openShareModal(chatId) {
    const modal = document.getElementById("shareModal");
    const createState = document.getElementById("shareCreateState");
    const linkState = document.getElementById("shareLinkState");
    const closeBtn = document.getElementById("shareCloseBtn");
    const createBtn = document.getElementById("shareCreateBtn");
    const copyBtn = document.getElementById("shareCopyBtn");
    const revokeBtn = document.getElementById("shareRevokeBtn");
    const linkInput = document.getElementById("shareLinkInput");
    const statusText = document.getElementById("shareStatusText");

    if (!modal) return;

    createState.hidden = false;
    linkState.hidden = true;
    statusText.textContent = "";

    modal.hidden = false;

    const cleanup = () => {
        modal.hidden = true;
        closeBtn.removeEventListener("click", onClose);
        createBtn.removeEventListener("click", onCreate);
        copyBtn.removeEventListener("click", onCopy);
        revokeBtn.removeEventListener("click", onRevoke);
        modal.removeEventListener("click", onBackdrop);
    };

    const onClose = () => cleanup();

    const onBackdrop = (e) => {
        if (e.target === modal) cleanup();
    };

    const onCreate = () => {
        const shareUrl = `${window.location.origin}/?chat=${chatId}`;

        linkInput.value = shareUrl;

        createState.hidden = true;
        linkState.hidden = false;

        onCopy();

        linkInput.focus();
        linkInput.select();
    };

    const onCopy = async () => {
        const url = linkInput.value;

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
            } else {
                linkInput.select();
                document.execCommand("copy");
            }

            statusText.textContent = "Copied!";
            showShareToast("Link copied to clipboard");

            setTimeout(() => {
                statusText.textContent = "";
            }, 2000);
        } catch (err) {
            console.error("Copy failed:", err);
            showShareToast("Could not copy link");
        }
    };

    const onRevoke = () => {
        createState.hidden = false;
        linkState.hidden = true;
        linkInput.value = "";
        statusText.textContent = "";
        showShareToast("Link revoked");
    };

    closeBtn.addEventListener("click", onClose);
    createBtn.addEventListener("click", onCreate);
    copyBtn.addEventListener("click", onCopy);
    revokeBtn.addEventListener("click", onRevoke);
    modal.addEventListener("click", onBackdrop);
}

async function handleConversationAction(action, chatId, row) {
    try {
        if (action === "rename") {
            const spanEl = row.querySelector(".conversation-open span");
            let currentTitle = "";

            if (spanEl) {
                const cloned = spanEl.cloneNode(true);
                cloned.querySelectorAll("svg").forEach(svg => svg.remove());
                currentTitle = cloned.textContent.trim();
            }

            const newTitle = await startInlineRename(row, currentTitle);

            if (newTitle) {
                try {
                    await api(`/api/conversations/${chatId}`, {
                        method: "PATCH",
                        body: JSON.stringify({ title: newTitle })
                    });

                    await loadChats();
                } catch (err) {
                    setStatus(`Rename failed: ${err.message}`);
                }
            }

            return;
        }

        if (action === "pin") {
            const isPinned = Boolean(row.querySelector(".pin-icon"));

            await api(`/api/conversations/${chatId}`, {
                method: "PATCH",
                body: JSON.stringify({ pinned: !isPinned })
            });

            await loadChats();

            return;
        }

        if (action === "share") {
            openShareModal(chatId);
            return;
        }

        if (action === "delete") {
            const confirmed = await openConfirmModal(
                "Delete conversation?",
                "This conversation and all its messages will be permanently deleted. This cannot be undone.",
                "Delete"
            );

            if (!confirmed) return;

            await api(`/api/conversations/${chatId}`, {
                method: "DELETE"
            });

            if (String(conversationId) === String(chatId)) {
                conversationId = null;
            }

            await loadChats();

            return;
        }
    } catch (error) {
        setStatus(`Error: ${error.message}`);
    }
}

document.addEventListener("click", event => {
    const menuBtn = event.target.closest(".conversation-menu");
    const menuItem = event.target.closest(
        ".conversation-dropdown .dropdown-item"
    );

    if (menuItem) {
        event.stopPropagation();

        const action = menuItem.dataset.action;
        const dropdown = menuItem.closest(".conversation-dropdown");
        const row = dropdown.closest(".conversation-row");
        const chatId = row?.dataset.chatId;

        dropdown.hidden = true;

        if (chatId) {
            handleConversationAction(action, chatId, row);
        }

        return;
    }

    if (menuBtn) {
        event.stopPropagation();

        const wrap = menuBtn.closest(".conversation-menu-wrap");
        const dropdown = wrap.querySelector(".conversation-dropdown");
        const isOpen = !dropdown.hidden;

        document
            .querySelectorAll(".conversation-dropdown")
            .forEach(d => (d.hidden = true));

        document
            .querySelectorAll(".conversation-menu")
            .forEach(b => b.setAttribute("aria-expanded", "false"));

        if (!isOpen) {
            const rect = menuBtn.getBoundingClientRect();

            const dropdownHeight = 230;
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            const openUpward =
                rect.bottom + dropdownHeight > viewportHeight - 10;

            if (openUpward) {
                dropdown.style.top = "auto";
                dropdown.style.bottom = `${viewportHeight - rect.top + 4}px`;
            } else {
                dropdown.style.bottom = "auto";
                dropdown.style.top = `${rect.bottom + 4}px`;
            }

            dropdown.style.right = `${viewportWidth - rect.right}px`;
            dropdown.style.left = "auto";

            dropdown.hidden = false;
            menuBtn.setAttribute("aria-expanded", "true");
        }

        return;
    }

    if (!event.target.closest(".conversation-dropdown")) {
        document
            .querySelectorAll(".conversation-dropdown")
            .forEach(d => (d.hidden = true));

        document
            .querySelectorAll(".conversation-menu")
            .forEach(b => b.setAttribute("aria-expanded", "false"));
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        document
            .querySelectorAll(".conversation-dropdown")
            .forEach(d => (d.hidden = true));

        document
            .querySelectorAll(".conversation-menu")
            .forEach(b => b.setAttribute("aria-expanded", "false"));

        const shareModal = document.getElementById("shareModal");
        if (shareModal && !shareModal.hidden) {
            shareModal.hidden = true;
        }
    }
});

if (conversationList) {
    conversationList.addEventListener("scroll", () => {
        document
            .querySelectorAll(".conversation-dropdown")
            .forEach(d => (d.hidden = true));

        document
            .querySelectorAll(".conversation-menu")
            .forEach(b => b.setAttribute("aria-expanded", "false"));
    });
}

window.addEventListener("resize", () => {
    document
        .querySelectorAll(".conversation-dropdown")
        .forEach(d => (d.hidden = true));

    document
        .querySelectorAll(".conversation-menu")
        .forEach(b => b.setAttribute("aria-expanded", "false"));
});

function resetChat() {
    conversationId = null;
    activeDocumentId = null;
    lastUserMessage = null;

    removeRetryButton();
    resetAttachment();

    if (inputText) {
        inputText.value = "";
        inputText.style.height = "auto";
    }

    if (messages) {
        messages.innerHTML = `
            <div class="welcome">
                <h2>
                    How can I help you?
                </h2>

                <p>
                    Choose a provider below and start chatting.
                </p>
            </div>
        `;
    }

    setStatus("");

    loadChats();
}

if (newChat) {
    newChat.addEventListener("click", resetChat);
}

if (refreshChats) {
    refreshChats.addEventListener("click", loadChats);
}

if (searchChats) {
    let searchTimer = null;

    searchChats.addEventListener("input", () => {
        clearTimeout(searchTimer);

        searchTimer = setTimeout(loadChats, 250);
    });
}

function getFileIcon(file) {
    const type = file?.type || "";
    const name = file?.name?.toLowerCase() || "";

    if (type.startsWith("image/")) {
        return "🖼️";
    }

    if (type === "application/pdf" || name.endsWith(".pdf")) {
        return "📕";
    }

    if (type.includes("word") || name.endsWith(".docx")) {
        return "📘";
    }

    if (name.endsWith(".csv") || name.endsWith(".json")) {
        return "📊";
    }

    return "📄";
}

function formatFileSize(bytes) {
    if (!bytes) {
        return "";
    }

    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setAttachmentState(state, message) {
    if (!attachmentPreview) {
        return;
    }

    attachmentPreview.classList.remove("is-ready", "is-error");

    if (state === "ready") {
        attachmentPreview.classList.add("is-ready");
    }

    if (state === "error") {
        attachmentPreview.classList.add("is-error");
    }

    if (attachmentStatus) {
        attachmentStatus.textContent = message || "";
    }
}

function showAttachmentPreview(file) {
    if (!attachmentPreview) {
        return;
    }

    attachmentPreview.hidden = false;

    if (attachmentFileIcon) {
        attachmentFileIcon.textContent = getFileIcon(file);
    }

    if (attachmentName) {
        attachmentName.textContent = file.name;
    }

    if (attachmentMeta) {
        attachmentMeta.textContent = [
            file.type || "Unknown file",
            formatFileSize(file.size)
        ]
            .filter(Boolean)
            .join(" · ");
    }

    setAttachmentState("reading", "Reading...");
}

function resetAttachment() {
    pendingAttachment = null;

    if (fileInput) {
        fileInput.value = "";
    }

    if (attachmentPreview) {
        attachmentPreview.hidden = true;

        attachmentPreview.classList.remove("is-ready", "is-error");
    }

    if (attachmentName) {
        attachmentName.textContent = "";
    }

    if (attachmentMeta) {
        attachmentMeta.textContent = "";
    }

    if (attachmentStatus) {
        attachmentStatus.textContent = "";
    }
}

if (fileInput) {
    fileInput.addEventListener("change", async event => {
        const file = event.target.files?.[0];

        if (!file) {
            return;
        }

        showAttachmentPreview(file);

        try {
            const formData = new FormData();

            formData.append("file", file);

            setStatus(`Reading ${file.name}...`);

            const result = await api("/api/attachments", {
                method: "POST",
                body: formData
            });

            if (!result || !result.kind) {
                throw new Error("Invalid attachment response.");
            }

            pendingAttachment = result;

            setAttachmentState("ready", "Ready to send");

            setStatus("File ready to send");
        } catch (error) {
            console.error("Attachment error:", error);

            pendingAttachment = null;

            setAttachmentState("error", "Could not read file");

            setStatus(`Error: ${error.message}`);
        }
    });
}

if (removeAttachment) {
    removeAttachment.addEventListener("click", () => {
        resetAttachment();
        setStatus("");
    });
}

function setGeneratingState(generating) {
    isGenerating = generating;

    if (!sendBtn) {
        return;
    }

    sendBtn.classList.toggle("stop-button", generating);

    sendBtn.textContent = generating ? "Stop" : "Send";

    sendBtn.disabled = false;
}

function stopGeneration() {
    if (!isGenerating || !window.socket) {
        return;
    }

    streamCancelled = true;
    window.socket.emit("stopGeneration");

    setGeneratingState(false);
    setStatus("Generation stopped");

    streamNode = null;
}

if (msgForm) {
    msgForm.addEventListener("submit", event => {
        event.preventDefault();

        if (isGenerating) {
            stopGeneration();
            return;
        }

        const text = inputText?.value.trim() || "";

        if ((!text && !pendingAttachment) || !window.socket) {
            return;
        }

        const provider = aiProvider?.value || "auto";
        const model = modelSelect?.value || "";
        const selectedPreference = preference?.value || "auto";
        const fallback = fallbackEnabled?.checked ?? true;

        clearWelcome();

        appendMessage(
            text || `Attached: ${pendingAttachment?.name || "file"}`,
            "user",
            pendingAttachment
                ? `Attachment: ${pendingAttachment.name}`
                : ""
        );

        const messagePayload = {
            text,
            provider,
            model,
            preference: selectedPreference,
            fallbackEnabled: fallback,
            conversationId,
            documentId: activeDocumentId || null,
            image: pendingAttachment?.kind === "image"
                ? pendingAttachment.data
                : null,
            attachment: pendingAttachment?.kind === "document"
                ? {
                    name: pendingAttachment.name,
                    type: pendingAttachment.type,
                    kind: "document",
                    text: typeof pendingAttachment.text === "string"
                        ? pendingAttachment.text
                        : stringifyValue(pendingAttachment.text)
                }
                : null
        };

        console.log("Sending chat documentId:", messagePayload.documentId);

        lastUserMessage = {
            ...messagePayload
        };

        removeRetryButton();

        streamCancelled = false;
        setGeneratingState(true);

        window.socket.emit("message", messagePayload);

        if (inputText) {
            inputText.value = "";
            inputText.style.height = "auto";
        }

        resetAttachment();
    });
}

if (inputText) {
    inputText.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();

            if (isGenerating) {
                stopGeneration();
                return;
            }

            if (msgForm) {
                msgForm.requestSubmit();
            }
        }
    });

    inputText.addEventListener("input", () => {
        inputText.style.height = "auto";

        inputText.style.height =
            Math.min(inputText.scrollHeight, 200) + "px";
    });
}

function setVoiceButtonIdle() {
    if (!voiceBtn) {
        return;
    }

    voiceBtn.innerHTML = VOICE_MIC_ICON;

    voiceBtn.setAttribute("aria-label", "Start voice recording");

    voiceBtn.title = "Start voice recording";
}

function setVoiceButtonRecording() {
    if (!voiceBtn) {
        return;
    }

    voiceBtn.textContent = "Stop";

    voiceBtn.setAttribute("aria-label", "Stop voice recording");

    voiceBtn.title = "Stop voice recording";
}

function stopVoiceRecording() {
    if (!voiceRecognition) {
        setVoiceButtonIdle();
        return;
    }

    voiceRecording = false;

    setVoiceButtonIdle();

    setStatus("Stopping voice recording...");

    try {
        voiceRecognition.stop();
    } catch {
        try {
            voiceRecognition.abort();
        } catch { }
    }
}

if (voiceBtn) {
    voiceBtn.addEventListener("click", () => {
        if (voiceRecording) {
            stopVoiceRecording();
            return;
        }

        const SpeechRecognition =
            window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            setStatus("Speech recognition is not supported in this browser.");

            return;
        }

        if (voiceRecognition) {
            try {
                voiceRecognition.abort();
            } catch { }

            voiceRecognition = null;
        }

        voiceRecognition = new SpeechRecognition();

        voiceRecognition.lang = "en-US";

        voiceRecognition.interimResults = true;

        voiceRecognition.continuous = true;

        voiceRecognition.maxAlternatives = 1;

        voiceRecognition.onstart = () => {
            voiceRecording = true;

            setStatus("Listening...");

            setVoiceButtonRecording();
        };

        voiceRecognition.onresult = event => {
            if (!inputText) {
                return;
            }

            let finalTranscript = "";
            let interimTranscript = "";

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;

                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            const spokenText = `${finalTranscript}${interimTranscript}`.trim();

            if (spokenText) {
                inputText.value = spokenText;

                inputText.dispatchEvent(
                    new Event("input", { bubbles: true })
                );
            }
        };

        voiceRecognition.onend = () => {
            voiceRecording = false;

            setVoiceButtonIdle();

            setStatus("");

            voiceRecognition = null;
        };

        voiceRecognition.onerror = event => {
            voiceRecording = false;

            setVoiceButtonIdle();

            if (event.error !== "aborted") {
                setStatus(`Voice error: ${event.error}`);
            } else {
                setStatus("");
            }

            voiceRecognition = null;
        };

        try {
            voiceRecognition.start();
        } catch (error) {
            voiceRecording = false;

            setVoiceButtonIdle();

            setStatus(`Voice error: ${error.message}`);

            voiceRecognition = null;
        }
    });
}

async function loadRagDocuments() {
    const list = document.getElementById("ragDocList");
    const count = document.getElementById("ragCount");

    if (!list) {
        return;
    }

    try {
        const documents = await api("/api/rag/documents");

        if (count) {
            count.textContent = documents?.length || 0;
        }

        if (!Array.isArray(documents) || documents.length === 0) {
            list.innerHTML = `
                <p class="rag-empty">
                    No documents indexed.
                </p>
            `;

            return;
        }

        list.innerHTML = documents
            .map(document => {
                const id = escapeHtml(document._id);

                const title = escapeHtml(document.title || "Untitled");

                const chunks = Number(document.chunkCount || 0);

                const textLength = Number(document.textLength || 0);

                const isActive =
                    String(document._id) === String(activeDocumentId);

                return `
                    <div
                        class="rag-doc-item ${isActive ? "active" : ""}"
                        data-id="${id}"
                    >
                        <span class="rag-doc-icon">
                            📄
                        </span>

                        <div class="rag-doc-info">
                            <span class="rag-doc-title">
                                ${title}
                            </span>

                            <span class="rag-doc-meta">
                                ${chunks} chunks ·
                                ${(textLength / 1000).toFixed(1)}k chars
                            </span>
                        </div>

                        <button
                            type="button"
                            class="rag-doc-delete"
                            data-delete-rag="${id}"
                        >
                            ✕
                        </button>
                    </div>
                `;
            })
            .join("");

        list.querySelectorAll("[data-delete-rag]").forEach(button => {
            button.addEventListener("click", event => {
                event.stopPropagation();
                deleteRagDocument(button.dataset.deleteRag);
            });
        });

        list.querySelectorAll(".rag-doc-item").forEach(item => {
            item.addEventListener("click", event => {
                if (event.target.closest("[data-delete-rag]")) {
                    return;
                }

                activeDocumentId = String(item.dataset.id);

                console.log(
                    "Selected document changed:",
                    activeDocumentId
                );

                streamNode = null;
                streamCancelled = false;

                item.parentElement
                    .querySelectorAll(".rag-doc-item")
                    .forEach(row => row.classList.remove("active"));

                item.classList.add("active");

                setStatus("Document selected");
            });
        });
    } catch (error) {
        console.error("Load RAG documents error:", error);

        list.innerHTML = `
            <p class="rag-empty">
                Could not load documents.
            </p>
        `;
    }
}

async function deleteRagDocument(id) {
    if (!id) {
        return;
    }

    if (!window.confirm("Delete this document from the knowledge base?")) {
        return;
    }

    try {
        await api(`/api/rag/documents/${encodeURIComponent(id)}`, {
            method: "DELETE"
        });

        if (String(activeDocumentId) === String(id)) {
            activeDocumentId = null;
        }

        await loadRagDocuments();

        setStatus("Document removed");
    } catch (error) {
        setStatus(`Error: ${error.message}`);
    }
}

async function startApp() {
    showApp();

    await loadUserInfo();

    await loadModels();

    connectSocket();

    await loadChats();

    if (ragDocList) {
        await loadRagDocuments();
    }
}

if (userProfileBtn) {
    userProfileBtn.addEventListener("click", event => {
        event.stopPropagation();

        toggleDropdown();
    });
}

document.addEventListener("click", event => {
    if (
        userProfileBtn &&
        userDropdown &&
        !userProfileBtn.contains(event.target) &&
        !userDropdown.contains(event.target)
    ) {
        closeDropdown();
    }
});

if (authMode) {
    authMode.addEventListener("click", toggleAuthMode);
}

if (authForm) {
    authForm.addEventListener("submit", handleAuthSubmit);
}

if (logout) {
    logout.addEventListener("click", handleLogout);
}

window.debug = {
    socket: () => window.socket,

    conversation: () => conversationId,

    activeDocument: () => activeDocumentId,

    models: () => modelData,

    provider: () => aiProvider?.value,

    selectedModel: () => modelSelect?.value,

    renderModels: () => renderModels(),

    reloadModels: () => loadModels(),

    resetAttachment: () => resetAttachment(),

    stopGeneration: () => stopGeneration(),

    inspectModels: () => ({
        provider: aiProvider?.value,

        selectedModel: modelSelect?.value,

        modelData,

        providerData: getProviderData(aiProvider?.value)
    }),

    setActiveDocument: (id = null) => {
        activeDocumentId = id ? String(id) : null;
        console.log("activeDocumentId =", activeDocumentId);

        if (typeof loadRagDocuments === "function") {
            loadRagDocuments();
        }

        return activeDocumentId;
    },

    getActiveDocument: () => activeDocumentId,

    listDocuments: async () => {
        const docs = await api("/api/rag/documents");

        console.table(
            docs.map(d => ({
                id: d._id,
                title: d.title,
                chunks: d.chunkCount
            }))
        );

        return docs;
    },

    nlpAnalyze: async text =>
        api("/api/nlp/analyze", {
            method: "POST",
            body: JSON.stringify({ text })
        }),

    ragSearch: async (
        query,
        topK = 5,
        documentId = activeDocumentId
    ) =>
        api("/api/rag/search", {
            method: "POST",

            body: JSON.stringify({
                query,
                topK,
                documentId
            })
        }),

    ragContext: async (
        query,
        topK = 5,
        documentId = activeDocumentId
    ) =>
        api("/api/rag/context", {
            method: "POST",

            body: JSON.stringify({
                query,
                topK,
                documentId
            })
        }),

    ragDocuments: async () => api("/api/rag/documents"),

    ragStats: async () => api("/api/rag/stats"),

    ragIngest: async (title, text, type = "text") =>
        api("/api/rag/ingest", {
            method: "POST",
            body: JSON.stringify({ title, text, type })
        }),

    loadRagDocuments: () => loadRagDocuments(),

    retryLastMessage: () => retryLastMessage(),

    showRetryButton: () => showRetryButton(),

    clearToken: () => {
        localStorage.removeItem("roxanToken");

        location.reload();
    }
};

document.addEventListener("DOMContentLoaded", () => {
    setVoiceButtonIdle();

    if (ragRefresh) {
        ragRefresh.addEventListener("click", loadRagDocuments);
    }

    const ragPanel = document.getElementById("ragPanel");
    const ragToggle = document.getElementById("ragToggle");

    if (ragToggle && ragPanel) {
        ragToggle.addEventListener("click", () => {
            ragPanel.classList.toggle("collapsed");
        });
    }

    checkAuthStatus();
});