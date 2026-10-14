function models(
    envName,
    fallback
) {
    return String(
        process.env[envName] ||
            fallback ||
            ""
    )
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
}

function number(
    envName,
    fallback
) {
    const value = Number(
        process.env[envName]
    );

    return Number.isFinite(value)
        ? value
        : fallback;
}

function decimal(
    envName,
    fallback
) {
    const value = Number(
        process.env[envName]
    );

    return Number.isFinite(value)
        ? value
        : fallback;
}

const providers = {
    openai: {
        name: "openai",

        key:
            process.env.OPENAI_API_KEY ||
            "",

        endpoint:
            process.env.OPENAI_ENDPOINT ||
            "https://api.openai.com/v1/chat/completions",

        model:
            process.env.OPENAI_MODEL ||
            "gpt-4o-mini",

        models: models(
            "OPENAI_MODELS",
            process.env.OPENAI_MODEL ||
                "gpt-4o-mini"
        ),

        supportsVision:
            String(
                process.env.OPENAI_VISION ||
                    "true"
            ) === "true",

        maxTokens: number(
            "OPENAI_MAX_TOKENS",
            4000
        ),

        temperature: decimal(
            "OPENAI_TEMPERATURE",
            0.7
        ),

        priority: number(
            "OPENAI_PRIORITY",
            4
        )
    },

    google: {
        name: "google",

        key:
            process.env.GOOGLE_API_KEY ||
            "",

        endpoint:
            process.env.GOOGLE_ENDPOINT ||
            "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",

        model:
            process.env.GOOGLE_MODEL ||
            "gemini-3.6-flash",

        models: models(
            "GOOGLE_MODELS",
            process.env.GOOGLE_MODEL ||
                "gemini-3.6-flash"
        ),

        supportsVision:
            String(
                process.env.GOOGLE_VISION ||
                    "true"
            ) === "true",

        maxTokens: number(
            "GOOGLE_MAX_TOKENS",
            4000
        ),

        temperature: decimal(
            "GOOGLE_TEMPERATURE",
            0.7
        ),

        priority: number(
            "GOOGLE_PRIORITY",
            3
        )
    },

    groq: {
        name: "groq",

        key:
            process.env.GROQ_API_KEY ||
            "",

        endpoint:
            process.env.GROQ_ENDPOINT ||
            "https://api.groq.com/openai/v1/chat/completions",

        model:
            process.env.GROQ_MODEL ||
            "openai/gpt-oss-120b",

        models: models(
            "GROQ_MODELS",
            process.env.GROQ_MODEL ||
                "openai/gpt-oss-120b"
        ),

        supportsVision:
            String(
                process.env.GROQ_VISION ||
                    "false"
            ) === "true",

        maxTokens: number(
            "GROQ_MAX_TOKENS",
            4000
        ),

        temperature: decimal(
            "GROQ_TEMPERATURE",
            0.7
        ),

        priority: number(
            "GROQ_PRIORITY",
            1
        )
    },

    openrouter: {
        name: "openrouter",

        key:
            process.env.OPENROUTER_API_KEY ||
            "",

        endpoint:
            process.env.OPENROUTER_ENDPOINT ||
            "https://openrouter.ai/api/v1/chat/completions",

        model:
            process.env.OPENROUTER_MODEL ||
            "openrouter/free",

        models: models(
            "OPENROUTER_MODELS",
            process.env.OPENROUTER_MODEL ||
                "openrouter/free"
        ),

        supportsVision:
            String(
                process.env.OPENROUTER_VISION ||
                    "false"
            ) === "true",

        maxTokens: number(
            "OPENROUTER_MAX_TOKENS",
            4000
        ),

        temperature: decimal(
            "OPENROUTER_TEMPERATURE",
            0.7
        ),

        priority: number(
            "OPENROUTER_PRIORITY",
            2
        )
    }
};

module.exports = providers;