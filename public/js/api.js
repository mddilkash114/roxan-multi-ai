const API_BASE = window.location.origin;

const api = async (url, opt = {}) => {
    const headers = {
        ...(opt.body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        ...(opt.headers || {})
    };

    const token = localStorage.getItem("roxanToken");

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const fullUrl = url.startsWith("http")
        ? url
        : `${API_BASE}${url}`;

    const response = await fetch(fullUrl, {
        credentials: "include",
        ...opt,
        headers
    });

    if (!response.ok) {
        const error = await response
            .json()
            .catch(() => ({}));

        throw new Error(
            error.error ||
            error.message ||
            `Request failed: ${response.status}`
        );
    }

    return response.status === 204
        ? null
        : response.json();
};

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function stringifyValue(value) {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "string") {
        return value;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function cleanCitations(text) {
    if (!text) return "";

    let cleaned = String(text);

  
    cleaned = cleaned.replace(
        /(\w+(?:\s+\w+)*)\s*【\d+†[^】]+】/g,
        "$1"
    );
    cleaned = cleaned.replace(/【\d+†[^】]+】/g, "");
    cleaned = cleaned.replace(/\[\d+†[^]]+\]/g, "");
    cleaned = cleaned.replace(/【[^】]*†[^】]*】/g, "");

    cleaned = cleaned.replace(/[ \t]{2,}/g, " ");
    cleaned = cleaned.replace(/[ \t]+([.,!?;:])/g, "$1");

    return cleaned.trim();
}

function renderMarkdown(text) {
    if (!text) {
        return "";
    }

    const cleaned = cleanCitations(text);

    if (
        typeof marked !== "undefined" &&
        typeof DOMPurify !== "undefined"
    ) {
        marked.setOptions({
            breaks: true,
            gfm: true
        });

        return DOMPurify.sanitize(
            marked.parse(cleaned)
        );
    }

    return escapeHtml(cleaned).replace(/\n/g, "<br>");
}
window.api = api;
window.escapeHtml = escapeHtml;
window.stringifyValue = stringifyValue;
window.renderMarkdown = renderMarkdown;