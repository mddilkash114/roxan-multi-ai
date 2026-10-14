const axios = require("axios");
const providers = require("./config");

class AIBrain {
  constructor() {
    this.providers = providers;

    this.routing = {
      strategy:
        process.env.AI_ROUTING_STRATEGY ||
        "auto",

      fallbackEnabled:
        String(
          process.env.AI_FALLBACK_ENABLED ||
            "true"
        ) === "true"
    };

    this.dailyLimit = Number(
      process.env.AI_DAILY_LIMIT || 100
    );

    this.usage = {
      count: 0,
      date: this.today()
    };
  }

  today() {
    return new Date()
      .toISOString()
      .slice(0, 10);
  }

  getProviderStatus() {
    const status = {};

    for (const [
      name,
      provider
    ] of Object.entries(this.providers)) {
      status[name] = {
        name: provider.name || name,
        configured:
          this.isConfigured(provider),
        models: provider.models || [],
        model: provider.model || null,
        vision:
          provider.supportsVision || false,
        priority:
          provider.priority ?? 999
      };
    }

    return status;
  }

  getUsageStats() {
    return {
      count: this.usage.count,
      date: this.usage.date,
      dailyLimit: this.dailyLimit,
      remaining: Math.max(
        0,
        this.dailyLimit -
          this.usage.count
      )
    };
  }

  getProvider(name) {
    return this.providers[name] || null;
  }

  isConfigured(provider) {
    return Boolean(
      provider &&
        provider.key &&
        provider.endpoint &&
        provider.model &&
        Array.isArray(provider.models) &&
        provider.models.length > 0
    );
  }

  getEnabledProviders() {
    return Object.entries(
      this.providers
    )
      .filter(([, provider]) =>
        this.isConfigured(provider)
      )
      .map(([name, provider]) => ({
        ...provider,
        name
      }))
      .sort(
        (a, b) =>
          (a.priority ?? 999) -
          (b.priority ?? 999)
      );
  }

  getPreferredProvider() {
    const enabled =
      this.getEnabledProviders();

    if (!enabled.length) {
      return null;
    }

    if (
      this.routing.strategy ===
      "best-quality"
    ) {
      const item = enabled.find(
        provider =>
          provider.name === "openai"
      );

      return item
        ? item.name
        : enabled[0].name;
    }

    if (
      this.routing.strategy ===
      "fastest"
    ) {
      const item = enabled.find(
        provider =>
          provider.name === "groq"
      );

      return item
        ? item.name
        : enabled[0].name;
    }

    if (
      this.routing.strategy ===
      "lowest-cost"
    ) {
      const item = enabled.find(
        provider =>
          provider.name ===
          "openrouter"
      );

      return item
        ? item.name
        : enabled[0].name;
    }

    return enabled[0].name;
  }

  getValidModel(
    providerName,
    requestedModel
  ) {
    const provider =
      this.getProvider(providerName);

    if (!provider) {
      return null;
    }

    const models = Array.isArray(
      provider.models
    )
      ? provider.models
      : [];

    if (
      requestedModel &&
      models.includes(requestedModel)
    ) {
      return requestedModel;
    }

    if (
      provider.model &&
      models.includes(provider.model)
    ) {
      return provider.model;
    }

    return (
      models[0] ||
      provider.model ||
      null
    );
  }

  checkUsageLimit() {
    const today = this.today();

    if (this.usage.date !== today) {
      this.usage = {
        count: 0,
        date: today
      };
    }

    return (
      this.usage.count <
      this.dailyLimit
    );
  }

  incrementUsage() {
    this.usage.count += 1;
  }

  attachmentToText(attachment) {
    if (!attachment) {
      return "";
    }

    if (typeof attachment === "string") {
      return attachment;
    }

    if (
      typeof attachment.text ===
      "string"
    ) {
      return attachment.text;
    }

    if (
      Array.isArray(attachment.text)
    ) {
      return attachment.text
        .map(item => {
          if (
            typeof item === "string"
          ) {
            return item;
          }

          return (
            item?.text ||
            item?.str ||
            ""
          );
        })
        .filter(Boolean)
        .join("\n");
    }

    if (
      attachment.text &&
      typeof attachment.text ===
        "object"
    ) {
      if (
        typeof attachment.text
          .text === "string"
      ) {
        return attachment.text.text;
      }

      if (
        typeof attachment.text
          .content === "string"
      ) {
        return attachment.text.content;
      }

      return JSON.stringify(
        attachment.text,
        null,
        2
      );
    }

    if (
      typeof attachment.content ===
      "string"
    ) {
      return attachment.content;
    }

    return "";
  }

  buildMessages(
    question,
    conversationHistory = [],
    systemPrompt = null,
    image = null,
    attachment = null
  ) {
    const messages = [];

    if (
      systemPrompt &&
      String(systemPrompt).trim()
    ) {
      messages.push({
        role: "system",
        content: String(systemPrompt)
      });
    }

    if (
      Array.isArray(conversationHistory)
    ) {
      for (const message of conversationHistory) {
        if (
          !message ||
          !message.role ||
          message.content ===
            undefined ||
          message.content === null
        ) {
          continue;
        }

        const allowedRoles = [
          "system",
          "user",
          "assistant"
        ];

        messages.push({
          role: allowedRoles.includes(
            message.role
          )
            ? message.role
            : "user",
          content: message.content
        });
      }
    }

    const cleanQuestion = String(
      question || ""
    );

    let content = cleanQuestion;

    if (image) {
      content = [
        {
          type: "text",
          text: cleanQuestion
        },
        {
          type: "image_url",
          image_url: {
            url: String(image)
          }
        }
      ];
    }

    const attachmentText =
      this.attachmentToText(
        attachment
      );

    if (attachmentText.trim()) {
      if (Array.isArray(content)) {
        content.push({
          type: "text",
          text: [
            "Attached document:",
            attachmentText
          ].join("\n\n")
        });
      } else {
        content = [
          cleanQuestion,
          "",
          "Attached document:",
          attachmentText
        ].join("\n");
      }
    }

    messages.push({
      role: "user",
      content
    });

    return messages;
  }

  async callProvider(
    providerName,
    options
  ) {
    const provider =
      this.getProvider(providerName);

    if (!provider) {
      throw new Error(
        `Provider "${providerName}" does not exist.`
      );
    }

    if (!this.isConfigured(provider)) {
      throw new Error(
        `Provider "${providerName}" is not configured.`
      );
    }

    if (
      options.image &&
      !provider.supportsVision
    ) {
      throw new Error(
        `${providerName} does not support image input.`
      );
    }

    if (providerName === "google") {
      return this.callGoogle(
        provider,
        options
      );
    }

    return this.callOpenAICompatible(
      providerName,
      provider,
      options
    );
  }

  async callGoogle(provider, options) {
    const {
      messages,
      model,
      temperature,
      maxTokens
    } = options;

    const endpoint =
      provider.endpoint.replace(
        "{model}",
        encodeURIComponent(model)
      );

    const systemMessage =
      messages.find(
        message =>
          message.role === "system"
      );

    const contents = messages
      .filter(
        message =>
          message.role !== "system"
      )
      .map(message => {
        const parts = [];

        if (
          Array.isArray(message.content)
        ) {
          for (const item of message.content) {
            if (item.type === "text") {
              const text = String(
                item.text || ""
              );

              if (text.trim()) {
                parts.push({ text });
              }
            }

            if (
              item.type ===
                "image_url" &&
              item.image_url?.url
            ) {
              const url = String(
                item.image_url.url
              );

              if (
                url.startsWith("data:")
              ) {
                const match =
                  url.match(
                    /^data:([^;]+);base64,(.+)$/
                  );

                if (match) {
                  parts.push({
                    inline_data: {
                      mime_type:
                        match[1],
                      data: match[2]
                    }
                  });
                }
              }
            }
          }
        } else {
          const text = String(
            message.content || ""
          );

          if (text.trim()) {
            parts.push({ text });
          }
        }

        return {
          role:
            message.role === "assistant"
              ? "model"
              : "user",
          parts
        };
      })
      .filter(
        item => item.parts.length > 0
      );

    const body = {
      contents,
      generationConfig: {
        temperature:
          temperature ??
          provider.temperature ??
          0.7,
        maxOutputTokens:
          maxTokens ??
          provider.maxTokens ??
          2000
      },
      tools: [
        {
          google_search: {}
        }
      ]
    };

    if (systemMessage) {
      body.systemInstruction = {
        parts: [
          {
            text: String(
              systemMessage.content ||
                ""
            )
          }
        ]
      };
    }

    try {
      const response =
        await axios.post(
          `${endpoint}?key=${encodeURIComponent(
            provider.key
          )}`,
          body,
          {
            headers: {
              "Content-Type":
                "application/json"
            },
            timeout: 120000,
            validateStatus:
              () => true
          }
        );

      if (
        response.status < 200 ||
        response.status >= 300
      ) {
        throw new Error(
          response.data?.error?.message ||
            `Google request failed: ${response.status}`
        );
      }

      const content =
        response.data?.candidates?.[0]
          ?.content?.parts
          ?.map(part => part.text || "")
          .join("") || "";

      if (!content.trim()) {
        throw new Error(
          "Google returned an empty response."
        );
      }

      return content;
    } catch (error) {
      throw this.normalizeError(
        "google",
        error
      );
    }
  }

  async callOpenAICompatible(
    providerName,
    provider,
    options
  ) {
    const {
      messages,
      model,
      temperature,
      maxTokens,
      stream,
      onChunk,
      webSearchEnabled
    } = options;

    const headers = {
      Authorization:
        `Bearer ${provider.key}`,
      "Content-Type":
        "application/json"
    };

    if (
      providerName === "openrouter"
    ) {
      headers["HTTP-Referer"] =
        process.env.OPENROUTER_REFERER ||
        "http://localhost:5000";

      headers["X-Title"] =
        process.env.OPENROUTER_TITLE ||
        "Roxan AI";
    }

    const requestBody = {
      model,
      messages,
      temperature:
        temperature ??
        provider.temperature ??
        0.7,
      max_tokens:
        maxTokens ??
        provider.maxTokens ??
        2000,
      stream: Boolean(stream)
    };

    if (providerName === "groq" && webSearchEnabled) {
      requestBody.tools = [
        {
          type: "browser_search"
        }
      ];
    }

    if (
      providerName === "openrouter" &&
      webSearchEnabled &&
      process.env.OPENROUTER_WEB_SEARCH === "true"
    ) {
      requestBody.plugins = [
        {
          id: "web",
          max_results: Number(
            process.env.OPENROUTER_MAX_RESULTS || 5
          )
        }
      ];
    }

    try {
      const response =
        await axios.post(
          provider.endpoint,
          requestBody,
          {
            headers,
            responseType: stream
              ? "stream"
              : "json",
            timeout: 120000,
            validateStatus:
              () => true
          }
        );

      if (
        response.status < 200 ||
        response.status >= 300
      ) {
        let message =
          `Request failed with status code ${response.status}`;

        if (
          response.data &&
          typeof response.data.on ===
            "function"
        ) {
          const errorData =
            await this.readStream(
              response.data
            );

          message =
            errorData?.error?.message ||
            errorData?.error ||
            errorData?.message ||
            message;
        } else {
          message =
            response.data?.error
              ?.message ||
            response.data?.error ||
            response.data?.message ||
            message;
        }

        throw new Error(
          String(message)
        );
      }

      if (stream) {
        return this.handleStream(
          response.data,
          onChunk
        );
      }

      const content =
        response.data?.choices?.[0]
          ?.message?.content || "";

      if (!String(content).trim()) {
        throw new Error(
          `${providerName} returned an empty response.`
        );
      }

      return content;
    } catch (error) {
      throw this.normalizeError(
        providerName,
        error
      );
    }
  }

  async handleStream(
    stream,
    onChunk
  ) {
    return new Promise(
      (resolve, reject) => {
        let fullText = "";
        let buffer = "";
        let settled = false;

        const processLine = line => {
          const trimmed = line.trim();

          if (
            !trimmed ||
            !trimmed.startsWith(
              "data:"
            )
          ) {
            return;
          }

          const data =
            trimmed.slice(5).trim();

          if (data === "[DONE]") {
            return;
          }

          try {
            const parsed =
              JSON.parse(data);

            const text =
              parsed?.choices?.[0]
                ?.delta?.content || "";

            if (text) {
              fullText += text;

              if (
                typeof onChunk ===
                "function"
              ) {
                onChunk(text);
              }
            }
          } catch {
          }
        };

        stream.on(
          "data",
          chunk => {
            buffer += chunk.toString();

            const lines =
              buffer.split("\n");

            buffer =
              lines.pop() || "";

            for (const line of lines) {
              processLine(line);
            }
          }
        );

        stream.on(
          "end",
          () => {
            if (buffer.trim()) {
              processLine(buffer);
            }

            if (!fullText.trim()) {
              reject(
                new Error(
                  "Provider returned an empty streamed response."
                )
              );

              return;
            }

            settled = true;
            resolve(fullText);
          }
        );

        stream.on(
          "error",
          error => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          }
        );

        stream.on(
          "aborted",
          () => {
            if (!settled) {
              settled = true;

              reject(
                new Error(
                  "Provider stream was aborted."
                )
              );
            }
          }
        );
      }
    );
  }

  async readStream(stream) {
    return new Promise(resolve => {
      let output = "";

      stream.on(
        "data",
        chunk => {
          output += chunk.toString();
        }
      );

      stream.on(
        "end",
        () => {
          try {
            resolve(
              JSON.parse(output)
            );
          } catch {
            resolve({
              error: output
            });
          }
        }
      );

      stream.on(
        "error",
        error => {
          resolve({
            error: error.message
          });
        }
      );
    });
  }

  normalizeError(
    providerName,
    error
  ) {
    const status =
      error?.status ||
      error?.response?.status;

    const data =
      error?.data ||
      error?.response?.data;

    let message =
      error?.message ||
      "Unknown provider error";

    if (data?.error?.message) {
      message =
        data.error.message;
    } else if (
      typeof data?.error ===
      "string"
    ) {
      message = data.error;
    } else if (data?.message) {
      message = data.message;
    }

    const normalized =
      new Error(String(message));

    normalized.provider =
      providerName;

    normalized.status = status;
    normalized.data = data;

    return normalized;
  }

  async ask(
    question,
    options = {}
  ) {
    const {
      provider = "auto",
      model = null,
      temperature = null,
      maxTokens = null,
      image = null,
      attachment = null,
      conversationHistory = [],
      systemPrompt = null,
      stream = false,
      onChunk = null,
      attemptedProviders = [],
      fallbackEnabled = true,
      webSearchEnabled = false
    } = options;

    const enabled =
      this.getEnabledProviders();

    if (!enabled.length) {
      throw new Error(
        "No AI providers configured. Please add at least one API key."
      );
    }

    const attempted = new Set(
      attemptedProviders
    );

    let providerToUse = provider;

    if (
      !providerToUse ||
      providerToUse === "auto"
    ) {
      providerToUse =
        this.getPreferredProvider();
    }

    if (!providerToUse) {
      throw new Error(
        "No available AI provider."
      );
    }

    if (
      attempted.has(providerToUse)
    ) {
      const next = enabled.find(
        item =>
          !attempted.has(item.name)
      );

      if (!next) {
        throw new Error(
          "All configured AI providers failed."
        );
      }

      providerToUse = next.name;
    }

    let providerConfig =
      this.getProvider(providerToUse);

    if (
      !providerConfig ||
      !this.isConfigured(providerConfig)
    ) {
      const next = enabled.find(
        item =>
          !attempted.has(item.name) &&
          item.name !== providerToUse
      );

      if (!next) {
        throw new Error(
          `Provider "${providerToUse}" is not configured.`
        );
      }

      providerToUse = next.name;
      providerConfig = next;
    }

    if (!this.checkUsageLimit()) {
      throw new Error(
        "Daily message limit reached. Please try again tomorrow."
      );
    }

    const finalModel =
      this.getValidModel(
        providerToUse,
        model
      );

    if (!finalModel) {
      throw new Error(
        `No valid model configured for ${providerToUse}.`
      );
    }
const baseSystemPrompt = [
      "You are Roxan, a helpful AI assistant.",
      "",
      "RESPONSE FORMATTING RULES (CRITICAL):",
      "1. ALWAYS use Markdown formatting for all responses.",
      "2. TABLES - MUST use pipes:",
      "   | Header 1 | Header 2 |",
      "   |----------|----------|",
      "   | Data 1   | Data 2   |",
      "   NEVER use tab-separated tables.",
      "   ALWAYS include header separator row.",
      "   Each row MUST be on its own line.",
      "3. HEADINGS: ## Main, ### Sub",
      "4. BOLD: **text**, ITALIC: *text*",
      "5. LISTS: - item or 1. item",
      "6. CODE BLOCKS: use ```language",
      "7. INLINE CODE: use `backticks`",
      "8. BLOCKQUOTES: > quote",
      "9. LINKS: [Title](URL)",
      "10. NEVER use citations like [1][2].",
      "11. ALWAYS add blank lines between sections.",
      "",
      "EXAMPLE PROPER RESPONSE:",
      "## AI News Update",
      "Here are the latest stories:",
      "| # | Story | Source |",
      "|---|-------|--------|",
      "| 1 | OpenAI | Ars Technica |",
      "| 2 | Mistral | The Next Web |",
      "### Key Points",
      "- **Regulation** is increasing",
      "- **Open models** are growing",
      "**Bottom line:** AI is evolving rapidly.",
      "",
      "CRITICAL BEHAVIOR RULES:",
      "1. NEVER give the same refusal twice in a row.",
      "2. If you refuse a request, ALWAYS explain WHY.",
      "3. If user asks 'why', 'explain', or 'reason', provide a clear explanation.",
      "4. After refusing, ALWAYS suggest legal/ethical alternatives.",
      "5. Maintain conversation context across messages.",
      "6. Be polite and helpful, even when refusing.",
      "7. Never repeat the exact same refusal message.",
      "",
      "REFUSAL BEHAVIOR EXAMPLE:",
      "User: 'How to hack a website'",
      "You: 'I cannot help with hacking as it is illegal and unethical.'",
      "User: 'Why'",
      "You: 'Hacking is a cyber crime punishable under IT Act. It can cause:",
      "  1. Financial loss to victims",
      "  2. Privacy breaches",
      "  3. Legal consequences (imprisonment + fine)",
      "If you are interested in cybersecurity, I can help with:",
      "  - Ethical hacking courses (CEH, OSCP)",
      "  - Bug bounty programs (HackerOne, Bugcrowd)",
      "  - Legal penetration testing certifications",
      "  - Cybersecurity career guidance'",
      "",
      "IMPORTANT:",
      "- Never repeat the exact same refusal message.",
      "- Always provide value even when refusing.",
      "- Suggest alternatives.",
      "- Keep tone helpful and non-judgmental.",
      "",
      systemPrompt || ""
    ].join("\n");
const enhancedSystemPrompt = webSearchEnabled
  ? [
      "You are Roxan, a live data assistant.",
      "When answering questions about current events, weather, news, or real-time data:",
      "1. ALWAYS prioritize the MOST RECENT data from web search results.",
      "2. If different sources give conflicting data, use the LATEST one.",
      "3. NEVER mix general knowledge with live data.",
      "4. ALWAYS cite the source with URL when available.",
      "5. If data seems contradictory, say so honestly.",
      "6. For weather, prioritize: temperature, current conditions, humidity, wind.",
      "7. Do NOT add general climate information unless asked.",
      "",
      `Current date: ${new Date().toISOString().slice(0, 10)}`,
      "",
      baseSystemPrompt
    ].join("\n")
  : baseSystemPrompt;

    const messages =
      this.buildMessages(
        question,
        conversationHistory,
        enhancedSystemPrompt,
        image,
        attachment
      );

    const currentAttempted = [
      ...new Set([
        ...attemptedProviders,
        providerToUse
      ])
    ];

    try {
      const content =
        await this.callProvider(
          providerToUse,
          {
            messages,
            model: finalModel,
            temperature:
              temperature !== null
                ? temperature
                : providerConfig.temperature,
            maxTokens:
              maxTokens !== null
                ? maxTokens
                : providerConfig.maxTokens,
            image,
            stream,
            onChunk,
            webSearchEnabled
          }
        );

      if (!String(content).trim()) {
        throw new Error(
          `${providerToUse} returned an empty response.`
        );
      }

      this.incrementUsage();

      return {
        success: true,
        provider: providerToUse,
        model: finalModel,
        content,
        timestamp:
          new Date().toISOString()
      };
    } catch (error) {
      console.error(
        `${providerToUse} failed:`,
        {
          status:
            error.status ||
            error?.response?.status,
          message: error.message,
          data:
            error.data ||
            error?.response?.data
        }
      );

      const allowFallback =
        fallbackEnabled &&
        this.routing.fallbackEnabled;

      if (!allowFallback) {
        throw error;
      }

      const next = enabled.find(
        item =>
          !currentAttempted.includes(
            item.name
          )
      );

      if (!next) {
        throw new Error(
          `All configured AI providers failed. Last error: ${error.message}`
        );
      }

      return this.ask(question, {
        ...options,
        provider: next.name,
        model: null,
        attemptedProviders:
          currentAttempted
      });
    }
  }
}

module.exports = new AIBrain();