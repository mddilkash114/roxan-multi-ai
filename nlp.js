const { NlpManager } = require("node-nlp");

class RoxanNLP {
  constructor() {
    this.manager = new NlpManager({
      languages: ["en"],
      forceNER: true,
      nlu: {
        log: false
      }
    });

    this.ready = false;
    this.trainingPromise = this.train();

    this.chatContext = new Map();

    this.exactPhrases = {
      greeting: [
        "hello", "hi", "hey", "hii", "hiii", "hlo", "helo", "yo", "sup",
        "namaste", "namaskar", "good morning", "good afternoon", "good evening",
        "good day", "howdy", "what's up", "whatsup", "wassup", "morning", "evening"
      ],
      help: [
        "help", "help me", "i need help", "can you help",
        "what can you do", "what are your capabilities"
      ],
      "time.get": [
        "what time is it", "what's the time", "current time", "time now",
        "tell me the time", "time please", "what is the time"
      ],
      "date.get": [
        "what is today's date", "what's today's date", "what date is it",
        "what day is it", "today's date", "current date", "what is the date"
      ],
      thanks: [
        "thanks", "thank you", "thx", "ty", "appreciate it", "many thanks"
      ],
      goodbye: [
        "bye", "goodbye", "see you", "good night", "take care", "farewell",
        "see ya", "later", "bye bye"
      ],
      "confirm.yes": [
        "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "correct", "right", "indeed"
      ],
      "confirm.no": [
        "no", "nope", "nah", "negative", "cancel", "stop", "never"
      ]
    };

    this.contextPatterns = {
      thanks: /\b(thank|thanks|thx|grateful|appreciate|cheers)\b/i,
      greeting: /\b(hello|hi|hey|namaste|greetings|morning|evening|afternoon)\b/i,
      goodbye: /\b(bye|goodbye|farewell|see you|later)\b/i,
      "confirm.yes": /\b(yes|yeah|yep|sure|ok|okay|correct|right|indeed)\b/i,
      "confirm.no": /\b(no|nope|nah|negative|cancel|stop|never)\b/i,
      "time.get": /\b(time|clock|hour)\b/i,
      "date.get": /\b(date|day|today)\b/i,
      help: /\b(help|assist|support|guide)\b/i,
      refusal: /\b(why|explain|reason|because|how come|what for)\b/i
    };

    this.intentAnswers = {
      greeting: "Hello! How can I help you today?",
      help: "I can help with code writing, debugging, document Q&A, translation, summarization, and general questions.",
      thanks: "You're welcome! Happy to help.",
      goodbye: "Goodbye! Feel free to come back anytime.",
      "confirm.yes": null,
      "confirm.no": null,
      "time.get": null,
      "date.get": null,
      refusal: "I refused because that request may involve illegal, unethical, or harmful activities. However, I can suggest legal alternatives if you're interested."
    };
  }

  async train() {
    const m = this.manager;

    const addDocuments = (intent, phrases) => {
      for (const phrase of phrases) {
        m.addDocument("en", phrase, intent);
      }
    };

    addDocuments("greeting", [
      "hello", "hi", "hey", "hey there", "hi there", "hello there",
      "good morning", "good afternoon", "good evening", "good day",
      "greetings", "namaste", "namaskar", "yo", "hi how are you",
      "hello how are you", "hey how are you", "hey what's up",
      "what's up", "howdy", "sup", "hii", "hiii", "hlo", "helo",
      "wassup", "whatsup", "hiya", "heya", "hello there friend",
      "hi friend", "hey buddy", "good to see you", "nice to meet you",
      "long time no see", "morning", "evening", "afternoon",
      "how are you doing", "how do you do"
    ]);

    addDocuments("help", [
      "help me", "i need help", "can you help", "can you help me",
      "support", "what can you do", "what are you capable of",
      "show me what you can do", "list your features", "how can you help",
      "what are your capabilities", "i need assistance", "help",
      "assist me", "guide me", "show me around", "what features do you have",
      "tell me what you can do", "how do i use this", "what can you help with"
    ]);

    addDocuments("weather.get", [
      "what is the weather", "what's the weather", "weather today",
      "how is the weather", "weather forecast", "is it raining",
      "is it sunny", "temperature outside", "how hot is it",
      "how cold is it", "weather in my city", "what is the temperature",
      "what's the temperature", "check the weather", "weather report",
      "what is the weather like", "how's the weather", "weather right now",
      "current weather", "weather update", "is it cloudy",
      "will it rain today", "weather conditions", "what's the forecast",
      "temperature today"
    ]);

    addDocuments("time.get", [
      "what time is it", "what is the time", "what's the time",
      "current time", "tell me the time", "time please", "time now",
      "what is the current time", "can you tell me the time",
      "do you know the time", "what time is it now", "what time do we have",
      "current time please", "give me the time", "tell me the current time",
      "what is the time now", "time check", "what is the time right now",
      "what's the time right now", "what's the current time",
      "time right now", "current time now", "what's the time now",
      "what time is it right now", "can you tell me the current time",
      "show me the time", "display the time", "clock please",
      "what does the clock say", "how late is it", "how early is it",
      "time of day", "current hour", "what hour is it",
      "give me the current time"
    ]);

    addDocuments("date.get", [
      "what is today's date", "what's today's date", "what is the date",
      "what's the date", "what day is it", "what day is today",
      "today's date", "current date", "what is the current date",
      "what date is it", "can you tell me the date", "date please",
      "tell me the date", "which date is today", "give me today's date",
      "what date is today", "what is today", "today",
      "tell me today's date", "show me today's date", "what's the day today",
      "date today", "date check", "what is the date today",
      "what's the date today", "current date please", "give me the date",
      "what's today's day", "what is the day", "what day of the week is it",
      "day of the week", "current day", "today's day", "which day is it",
      "what's the current date", "date right now", "show me the date",
      "display the date", "date now", "what is today's day"
    ]);

    addDocuments("code.write", [
      "write code for me", "help me code", "create a program",
      "write javascript code", "write python code", "generate code",
      "can you write code", "write a function", "write a script",
      "help me write code", "create a function", "create a class",
      "build a program", "write me some code", "code this for me",
      "implement this function", "i need code for", "write an algorithm",
      "generate a script", "code for me", "make a function",
      "make a program", "create an app", "build this for me",
      "write the code", "write some code", "code it for me",
      "i want code", "give me code", "produce code"
    ]);

    addDocuments("code.debug", [
      "debug this code", "fix my code", "why is my code not working",
      "find the bug", "my code has an error", "fix this error",
      "why doesn't this work", "what's wrong with my code",
      "help me debug", "find the issue in this code", "my code is broken",
      "solve this error", "fix this function", "there is a bug in my code",
      "debug this", "code error", "why is this failing", "can you debug",
      "debug my code", "fix the bug", "code not working",
      "my code fails", "what is the issue", "there's a problem in code",
      "code has a problem"
    ]);

    addDocuments("code.explain", [
      "explain this code", "what does this code do", "explain the program",
      "how does this code work", "what does this function do",
      "explain this function", "walk me through this code",
      "help me understand this code", "what is happening in this code",
      "explain what this code does", "describe this code",
      "break down this code", "explain this snippet", "explain the logic",
      "walk me through this", "what is this code for",
      "tell me about this code", "clarify this code",
      "make sense of this code", "what is this function"
    ]);

    addDocuments("translate", [
      "translate this", "convert to hindi", "translate into english",
      "in spanish please", "translate to french", "translate this text",
      "can you translate", "translate this for me",
      "how do you say this in", "what is this in english",
      "give me the translation", "translate the following",
      "in german please", "translate to japanese",
      "translate this sentence", "translate this phrase",
      "translate this word", "convert this to", "how to say in",
      "translate please", "help me translate", "i need a translation",
      "translate into", "change language to", "convert language to"
    ]);

    addDocuments("summarize", [
      "summarize this", "give me a summary", "short version",
      "make this shorter", "sum up", "tldr", "condense this",
      "short summary", "summarize the text", "give me the key points",
      "what are the main points", "brief summary",
      "summarize this for me", "make a summary",
      "summarize the content", "sum it up", "shorten this",
      "briefly summarize", "key takeaways", "main ideas",
      "what is the gist", "summary please", "give me a brief",
      "compact version"
    ]);

    addDocuments("web.search", [
      "search the web", "google this", "look up online",
      "find on internet", "search online for", "look up on google",
      "web search", "find information online", "search the internet",
      "browse the web for", "search on google", "google it",
      "look up on internet", "search website", "find it online"
    ]);

    addDocuments("document.query", [
      "what does the document say", "what does the document contain",
      "what is in the document", "what is this document about",
      "what is the document about", "according to my files",
      "according to my document", "according to the document",
      "from my notes", "in the pdf", "search my documents",
      "search in my files", "find in the document", "what does my pdf say",
      "tell me about the document", "summarize the document",
      "explain the document", "what is written in the document",
      "from the document", "in the document", "look in my files",
      "check my documents", "what does this file say", "from the pdf",
      "according to the pdf", "from my uploaded file",
      "in my uploaded document", "search the uploaded document",
      "based on the document", "based on my file",
      "what does the file contain", "what does the pdf contain",
      "read the document", "read the pdf", "find in my document",
      "look in the pdf", "from my document", "in my document",
      "in my pdf", "in my file", "what's in the document",
      "what's in my document", "what's in the pdf",
      "check the document", "check the pdf", "inspect the document",
      "review the document", "look at the document", "examine the pdf",
      "analyze the document"
    ]);

    addDocuments("file.upload", [
      "upload a file", "attach document", "add a file",
      "upload document", "attach a file", "upload this file",
      "attach this document", "add this file", "attach a pdf",
      "upload a pdf", "how do i upload", "how do i attach",
      "upload file please", "add a document", "upload documents",
      "attach file", "upload pdf", "attach pdf", "how to upload",
      "how to attach"
    ]);

    addDocuments("goodbye", [
      "bye", "goodbye", "see you", "thanks bye", "bye bye",
      "see you later", "talk to you later", "catch you later",
      "good night", "bye for now", "i have to go", "see you soon",
      "farewell", "take care", "until next time", "later",
      "gotta go", "i'm leaving", "good bye", "bye now"
    ]);

    addDocuments("thanks", [
      "thank you", "thanks", "appreciate it", "thanks a lot",
      "thank you so much", "many thanks", "thanks for your help",
      "thank you for your help", "grateful", "cheers",
      "thanks buddy", "thanks friend", "thank you very much",
      "much appreciated", "i appreciate it", "thanks a ton",
      "thanks so much", "thank you kindly", "big thanks", "ty"
    ]);

    addDocuments("confirm.yes", [
      "yes", "yeah", "yep", "yup", "sure", "ok", "okay",
      "correct", "right", "indeed", "affirmative", "of course",
      "absolutely", "definitely"
    ]);

    addDocuments("confirm.no", [
      "no", "nope", "nah", "negative", "not really", "no thanks",
      "no thank you", "don't", "do not", "cancel", "stop",
      "never", "not at all"
    ]);

    const languages = {
      hindi: ["hindi", "हिंदी"],
      english: ["english"],
      spanish: ["spanish", "español"],
      french: ["french", "français"],
      german: ["german", "deutsch"],
      japanese: ["japanese", "日本語"],
      chinese: ["chinese", "mandarin", "中文"],
      arabic: ["arabic", "عربية"],
      russian: ["russian", "русский"],
      portuguese: ["portuguese", "português"],
      italian: ["italian", "italiano"],
      korean: ["korean", "한국어"],
      bengali: ["bengali", "bangla"],
      tamil: ["tamil"],
      telugu: ["telugu"],
      marathi: ["marathi"],
      gujarati: ["gujarati"],
      urdu: ["urdu"],
      punjabi: ["punjabi"],
      kannada: ["kannada"],
      malayalam: ["malayalam"],
      nepali: ["nepali"],
      sinhala: ["sinhala"],
      thai: ["thai"],
      vietnamese: ["vietnamese"],
      turkish: ["turkish"],
      dutch: ["dutch"],
      polish: ["polish"],
      swedish: ["swedish"],
      greek: ["greek"]
    };

    for (const [name, values] of Object.entries(languages)) {
      m.addNamedEntityText("language", name, ["en"], values);
    }

    const programmingLanguages = {
      javascript: ["javascript", "js", "node", "nodejs", "node.js"],
      typescript: ["typescript", "ts"],
      python: ["python", "py"],
      java: ["java"],
      cpp: ["c++", "cpp", "c plus plus"],
      c: ["c language", "c programming"],
      csharp: ["c#", "csharp", "c sharp"],
      go: ["golang", "go"],
      rust: ["rust"],
      php: ["php"],
      ruby: ["ruby"],
      swift: ["swift"],
      kotlin: ["kotlin"],
      scala: ["scala"],
      dart: ["dart"],
      r: ["r language"],
      matlab: ["matlab"],
      perl: ["perl"],
      lua: ["lua"],
      haskell: ["haskell"],
      elixir: ["elixir"],
      erlang: ["erlang"],
      clojure: ["clojure"],
      fsharp: ["f#", "fsharp"],
      objectivec: ["objective-c", "objc"],
      groovy: ["groovy"],
      julia: ["julia"],
      nim: ["nim"],
      crystal: ["crystal"],
      zig: ["zig"]
    };

    for (const [name, values] of Object.entries(programmingLanguages)) {
      m.addNamedEntityText("programming", name, ["en"], values);
    }

    const cities = {
      delhi: ["delhi", "new delhi"],
      mumbai: ["mumbai", "bombay"],
      bangalore: ["bangalore", "bengaluru"],
      chennai: ["chennai", "madras"],
      kolkata: ["kolkata", "calcutta"],
      hyderabad: ["hyderabad"],
      pune: ["pune"],
      ahmedabad: ["ahmedabad"],
      jaipur: ["jaipur"],
      lucknow: ["lucknow"],
      newyork: ["new york", "nyc"],
      london: ["london"],
      paris: ["paris"],
      tokyo: ["tokyo"],
      beijing: ["beijing"],
      shanghai: ["shanghai"],
      singapore: ["singapore"],
      dubai: ["dubai"],
      sydney: ["sydney"],
      melbourne: ["melbourne"],
      toronto: ["toronto"],
      vancouver: ["vancouver"],
      losangeles: ["los angeles", "la"],
      chicago: ["chicago"],
      houston: ["houston"],
      berlin: ["berlin"],
      madrid: ["madrid"],
      rome: ["rome"],
      moscow: ["moscow"],
      istanbul: ["istanbul"]
    };

    for (const [name, values] of Object.entries(cities)) {
      m.addNamedEntityText("city", name, ["en"], values);
    }

    m.addAnswer("en", "greeting", "Hello! How can I help you today?");
    m.addAnswer("en", "greeting", "Hi there! What can I do for you?");
    m.addAnswer("en", "greeting", "Hey! How can I assist you today?");
    m.addAnswer("en", "greeting", "Hello! What can I help you with?");

    m.addAnswer("en", "help", "I can help you with coding, documents, translation, summaries, and more.");
    m.addAnswer("en", "help", "I can assist with writing code, debugging, explaining concepts, translating, summarizing, and answering questions from your documents.");
    m.addAnswer("en", "help", "I can help with many tasks: code writing, debugging, document Q&A, translation, summarization, and general questions.");

    m.addAnswer("en", "weather.get", "I need your location to check the weather. Please tell me your city.");
    m.addAnswer("en", "weather.get", "Please share your city or location to check the weather.");

    m.addAnswer("en", "goodbye", "Goodbye! Feel free to come back anytime.");
    m.addAnswer("en", "goodbye", "See you later! Have a great day.");
    m.addAnswer("en", "goodbye", "Bye! Come back soon.");

    m.addAnswer("en", "thanks", "You're welcome! Happy to help.");
    m.addAnswer("en", "thanks", "Anytime! Let me know if you need anything else.");
    m.addAnswer("en", "thanks", "My pleasure! Happy to assist.");

    m.addAnswer("en", "file.upload", "You can attach a file using the paperclip icon in the chat input. Supported formats: PDF, DOCX, TXT, CSV, MD, JSON, and images.");
    m.addAnswer("en", "file.upload", "To upload a file, click the paperclip icon at the bottom of the chat. Supported: PDF, DOCX, TXT, CSV, MD, JSON, and images.");

    await m.train();

    this.ready = true;
    console.log("NLP training completed");
  }

  async waitUntilReady() {
    await this.trainingPromise;
  }

  setContext(chatId, intent) {
    if (!chatId) return;

    if (!this.chatContext.has(chatId)) {
      this.chatContext.set(chatId, new Set());
    }

    this.chatContext.get(chatId).add(intent);
  }

  hasContext(chatId, intent) {
    if (!chatId) return false;

    const context = this.chatContext.get(chatId);
    return context ? context.has(intent) : false;
  }

  clearContext(chatId) {
    if (chatId) {
      this.chatContext.delete(chatId);
    }
  }

  matchExactIntent(text) {
    const lower = text.toLowerCase().trim();

    for (const [intent, phrases] of Object.entries(this.exactPhrases)) {
      if (phrases.includes(lower)) {
        return intent;
      }
    }

    return null;
  }

  matchContextIntent(text, chatId) {
    if (!chatId) return null;

    for (const [intent, pattern] of Object.entries(this.contextPatterns)) {
      if (this.hasContext(chatId, intent) && pattern.test(text)) {
        return intent;
      }
    }

    return null;
  }

  getAnswerForIntent(intent) {
    return this.intentAnswers[intent] || null;
  }

  async process(text, chatId = null) {
    await this.waitUntilReady();

    const input = String(text || "").trim();

    if (!input) {
      return {
        intent: "None",
        score: 0,
        entities: [],
        answer: null,
        confidence: "low",
        source: "empty"
      };
    }

    const exactIntent = this.matchExactIntent(input);

    if (exactIntent) {
      this.setContext(chatId, exactIntent);

      return {
        intent: exactIntent,
        score: 1,
        entities: [],
        answer: this.getAnswerForIntent(exactIntent),
        confidence: "high",
        source: "exact"
      };
    }

    const contextIntent = this.matchContextIntent(input, chatId);

    if (contextIntent) {
      return {
        intent: contextIntent,
        score: 0.9,
        entities: [],
        answer: this.getAnswerForIntent(contextIntent),
        confidence: "high",
        source: "context"
      };
    }

    const result = await this.manager.process("en", input);

    const rawScore = Number(result.score || 0);
    const threshold = Number(process.env.NLP_CONFIDENCE_THRESHOLD || 0.9);

    const hasRealIntent =
      result.intent &&
      result.intent !== "None" &&
      result.intent !== "unknown" &&
      rawScore >= threshold;

    if (hasRealIntent) {
      this.setContext(chatId, result.intent);
    }

    return {
      intent: hasRealIntent ? result.intent : "None",
      score: hasRealIntent ? rawScore : 0,
      entities: hasRealIntent ? result.entities || [] : [],
      answer: hasRealIntent ? result.answer || null : null,
      confidence: hasRealIntent
        ? rawScore >= 0.95 ? "high" : "medium"
        : "low",
      source: hasRealIntent ? "model" : "no-match"
    };
  }

  getIntents() {
    return this.manager.nluManager?.intents || {};
  }
}

module.exports = new RoxanNLP();