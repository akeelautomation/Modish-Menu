const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env.local");
const MAIN_JS_PATH = path.join(ROOT_DIR, "main.js");
const GENERATE_PAGES_SCRIPT = path.join(__dirname, "generate-recipe-pages.js");
const TMP_DIR = path.join(ROOT_DIR, ".recipe-generator-tmp");
const OPENROUTER_THROTTLE_PATH = path.join(TMP_DIR, "openrouter-last-call.json");
const IMAGE_UPLOAD_CACHE_PATH = path.join(TMP_DIR, "image-upload-cache.json");
const DEFAULT_OPENROUTER_MIN_REQUEST_INTERVAL_MS = 25000;
const DEFAULT_OPENROUTER_RETRY_COOLDOWN_MS = 90000;
const DEFAULT_OPENROUTER_REQUEST_TIMEOUT_MS = 45000;
const DEFAULT_R2_UPLOAD_ATTEMPTS = 6;
const DEFAULT_R2_UPLOAD_TIMEOUT_MS = 45000;
const DEFAULT_R2_UPLOAD_RETRY_BASE_MS = 750;
const DEFAULT_OPENROUTER_FALLBACK_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "openrouter/free",
];
const FREE_MODEL_ALLOWLIST = new Set([
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "openrouter/free",
]);
const JSON_MODE_FREE_MODELS = new Set(["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"]);
const JSON_SCHEMA_FREE_MODELS = new Set(["openrouter/free"]);
const REPAIR_MODEL_ORDER = ["openrouter/free", "google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"];

const ALLOWED_CATEGORIES = [
  "Breakfast",
  "Lunch",
  "Dinner",
  "Desserts",
  "Snacks",
  "Drinks & Cocktails",
  "Soups & Stews",
  "Salads",
  "Baking & Bread",
  "Pasta & Noodles",
  "Vegan",
  "Grilling & BBQ",
];

const REQUIRED_ENV = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "SITE_URL",
];

const R2_REQUIRED_ENV = [
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PUBLIC_BASE_URL",
];

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    });
};

const requireEnv = () => {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment values: ${missing.join(", ")}`);
  }
};

const requireR2Env = () => {
  const missing = R2_REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required R2 environment values: ${missing.join(", ")}`);
  }
};

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const normalizeBaseUrl = (value) => value.replace(/\/+$/, "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseCliArgs = (args) => {
  const options = {
    imagePath: "",
    keywordGuidance: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--keyword-guidance") {
      options.keywordGuidance = String(args[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--keyword-guidance=")) {
      options.keywordGuidance = arg.slice("--keyword-guidance=".length).trim();
      continue;
    }

    if (!options.imagePath) {
      options.imagePath = arg;
    }
  }

  return options;
};

const readIntegerEnv = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const readPositiveIntegerEnv = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const jitter = (ms) => Math.round(ms * (0.75 + Math.random() * 0.5));

const isRetryableStatus = (status) => [408, 409, 425, 429, 500, 502, 503, 504].includes(status);

const fetchWithTimeout = async (url, options, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const parseModelList = (value) =>
  String(value || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

const isAllowedFreeModel = (model) => FREE_MODEL_ALLOWLIST.has(model);

const getRecipeModelOrder = () => {
  const configuredFallbacks = parseModelList(process.env.OPENROUTER_FALLBACK_MODELS);
  const fallbackModels = configuredFallbacks.length ? configuredFallbacks : DEFAULT_OPENROUTER_FALLBACK_MODELS;
  const configuredModels = [process.env.OPENROUTER_MODEL, ...fallbackModels];
  const modelOrder = [];

  for (const model of configuredModels) {
    if (!model || modelOrder.includes(model)) {
      continue;
    }

    if (!isAllowedFreeModel(model)) {
      console.log(`Skipping non-free or unapproved OpenRouter model: ${model}`);
      continue;
    }

    modelOrder.push(model);
  }

  if (!modelOrder.length) {
    throw new Error("No approved free OpenRouter models are configured.");
  }

  return modelOrder;
};

const getRepairModelOrder = () => {
  const configuredModels = [...REPAIR_MODEL_ORDER, ...getRecipeModelOrder()];
  const modelOrder = [];

  for (const model of configuredModels) {
    if (!modelOrder.includes(model) && isAllowedFreeModel(model)) {
      modelOrder.push(model);
    }
  }

  return modelOrder;
};

const readOpenRouterThrottleState = () => {
  if (!fs.existsSync(OPENROUTER_THROTTLE_PATH)) {
    return { lastRequestAt: 0, cooldownUntil: 0 };
  }

  try {
    const state = JSON.parse(fs.readFileSync(OPENROUTER_THROTTLE_PATH, "utf8"));
    return {
      lastRequestAt: Number(state.lastRequestAt) || 0,
      cooldownUntil: Number(state.cooldownUntil) || 0,
    };
  } catch {
    return { lastRequestAt: 0, cooldownUntil: 0 };
  }
};

const writeOpenRouterThrottleState = (state) => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(OPENROUTER_THROTTLE_PATH, JSON.stringify(state));
};

const readImageUploadCache = () => {
  if (!fs.existsSync(IMAGE_UPLOAD_CACHE_PATH)) {
    return { version: 1, uploads: {} };
  }

  try {
    const cache = JSON.parse(fs.readFileSync(IMAGE_UPLOAD_CACHE_PATH, "utf8"));
    return {
      version: 1,
      uploads: cache && typeof cache.uploads === "object" && cache.uploads ? cache.uploads : {},
    };
  } catch {
    return { version: 1, uploads: {} };
  }
};

const writeImageUploadCache = (cache) => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tempPath = `${IMAGE_UPLOAD_CACHE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(cache, null, 2));
  fs.renameSync(tempPath, IMAGE_UPLOAD_CACHE_PATH);
};

const throttleOpenRouter = async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const minRequestIntervalMs = readIntegerEnv(
    "OPENROUTER_MIN_REQUEST_INTERVAL_MS",
    DEFAULT_OPENROUTER_MIN_REQUEST_INTERVAL_MS
  );
  const state = readOpenRouterThrottleState();
  const waitUntil = Math.max(state.lastRequestAt + minRequestIntervalMs, state.cooldownUntil);
  const waitMs = waitUntil - Date.now();

  if (waitMs > 0) {
    console.log(`Waiting ${Math.ceil(waitMs / 1000)}s for OpenRouter pacing...`);
    await sleep(waitMs);
  }

  writeOpenRouterThrottleState({
    lastRequestAt: Date.now(),
    cooldownUntil: Math.max(state.cooldownUntil, Date.now()),
  });
};

const applyOpenRouterRetryCooldown = async (attempt, status) => {
  const baseCooldownMs = readIntegerEnv("OPENROUTER_RETRY_COOLDOWN_MS", DEFAULT_OPENROUTER_RETRY_COOLDOWN_MS);
  const cooldownMs = baseCooldownMs * attempt;
  const state = readOpenRouterThrottleState();
  const cooldownUntil = Date.now() + cooldownMs;

  writeOpenRouterThrottleState({
    lastRequestAt: state.lastRequestAt || Date.now(),
    cooldownUntil: Math.max(state.cooldownUntil, cooldownUntil),
  });

  console.log(`OpenRouter returned ${status}. Cooling down ${Math.ceil(cooldownMs / 1000)}s before retry...`);
  await sleep(cooldownMs);
};

const getContentType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  throw new Error(`Unsupported image type "${ext}". Use JPG, PNG, or WebP.`);
};

const imagePathToDataUrl = (filePath) => {
  const contentType = getContentType(filePath);
  const body = fs.readFileSync(filePath);
  return `data:${contentType};base64,${body.toString("base64")}`;
};

const hmac = (key, value, encoding) => crypto.createHmac("sha256", key).update(value).digest(encoding);
const sha256 = (value, encoding = "hex") => crypto.createHash("sha256").update(value).digest(encoding);

const encodeRfc3986 = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const signR2Request = ({ method, body = Buffer.alloc(0), contentType, objectKey }) => {
  const endpoint = new URL(process.env.R2_ENDPOINT);
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const encodedKey = objectKey.split("/").map(encodeRfc3986).join("/");
  const canonicalUri = `/${bucket}/${encodedKey}`;
  const payloadHash = sha256(body);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const headersToSign = {
    host: endpoint.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  if (contentType) {
    headersToSign["content-type"] = contentType;
  }

  const signedHeaders = Object.keys(headersToSign).sort().join(";");
  const canonicalHeaders = `${Object.keys(headersToSign)
    .sort()
    .map((key) => `${key}:${headersToSign[key]}`)
    .join("\n")}\n`;
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    "aws4_request"
  );
  const signature = hmac(signingKey, stringToSign, "hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    url: `${endpoint.origin}${canonicalUri}`,
    headers: {
      Authorization: authorization,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
  };
};

const putR2Object = async ({ signedRequest, body, attempt }) => {
  const timeoutMs = readPositiveIntegerEnv("R2_UPLOAD_TIMEOUT_MS", DEFAULT_R2_UPLOAD_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(signedRequest.url, {
      method: "PUT",
      headers: signedRequest.headers,
      body,
      signal: controller.signal,
    });

    const responseText = response.ok ? "" : await response.text();
    return { ok: response.ok, status: response.status, statusText: response.statusText, text: responseText };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error.name === "AbortError" ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : error.message,
      text: error.cause?.message || "",
      attempt,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const uploadToR2 = async (imagePath) => {
  const body = fs.readFileSync(imagePath);
  const contentType = getContentType(imagePath);
  const ext = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";
  const imageHash = sha256(body);
  const cache = readImageUploadCache();
  const cachedUpload = cache.uploads[imageHash];

  if (cachedUpload?.url) {
    console.log(`Reusing existing uploaded image for content hash ${imageHash.slice(0, 12)}.`);
    return cachedUpload.url;
  }

  const objectKey = `recipe-generator/images/${imageHash.slice(0, 2)}/${imageHash}${ext}`;
  const signedRequest = signR2Request({ method: "PUT", body, contentType, objectKey });
  const maxAttempts = readPositiveIntegerEnv("R2_UPLOAD_ATTEMPTS", DEFAULT_R2_UPLOAD_ATTEMPTS);
  const retryBaseMs = readPositiveIntegerEnv("R2_UPLOAD_RETRY_BASE_MS", DEFAULT_R2_UPLOAD_RETRY_BASE_MS);
  let lastFailure = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      console.log(`Retrying R2 upload ${attempt}/${maxAttempts}...`);
    }

    const result = await putR2Object({ signedRequest, body, attempt });
    if (result.ok) {
      const url = `${normalizeBaseUrl(process.env.R2_PUBLIC_BASE_URL)}/${objectKey}`;
      cache.uploads[imageHash] = {
        url,
        objectKey,
        contentType,
        size: body.length,
        originalName: path.basename(imagePath),
        uploadedAt: new Date().toISOString(),
      };
      writeImageUploadCache(cache);

      return url;
    }

    lastFailure = result;
    const retryable = result.status === 0 || isRetryableStatus(result.status);
    if (!retryable || attempt === maxAttempts) {
      break;
    }

    const waitMs = jitter(retryBaseMs * 2 ** (attempt - 1));
    console.log(
      `R2 upload attempt ${attempt}/${maxAttempts} failed: ${result.status || "network"} ${result.statusText}. Waiting ${Math.ceil(
        waitMs / 1000
      )}s...`
    );
    await sleep(waitMs);
  }

  throw new Error(
    `R2 upload failed after ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"}: ${lastFailure?.status || "network"} ${
      lastFailure?.statusText || "request failed"
    }${lastFailure?.text ? `\n${lastFailure.text}` : ""}`
  );
};

const buildKeywordGuidanceBlock = (keywordGuidance) => {
  const trimmed = String(keywordGuidance || "").trim();
  if (!trimmed) {
    return "";
  }

  return `

Title and description guidance:
- Try to incorporate one or more of these keywords or phrases in the title or description when it fits the visible dish: ${trimmed}
- You may use the exact wording, a natural variation, or a closely related phrase.
- Do not force every phrase, and keep the recipe accurate to the image.`;
};

const buildPrompt = (keywordGuidance) => `You are creating production recipe content for Modish Menu, an editorial recipe website.

Analyze the food image and infer a realistic recipe from it. Return one strict JSON object only, with no markdown.

Rules:
- Use one category from this exact list: ${ALLOWED_CATEGORIES.join(", ")}.
- The recipe must match the visible dish in the image.
- Use concise editorial copy, not generic filler.
- Ingredients must be specific and usable.
- Instructions must be complete, ordered, and practical.
- Times must be strings like "15 min" or "1 hr 10 min".
- Nutrition may be a reasonable estimate.
- Slug must be lowercase kebab-case.
- Related recipe slugs must be existing recipes from the supplied list when possible.
- Do not include image URLs in the JSON.
${buildKeywordGuidanceBlock(keywordGuidance)}

Existing related recipe slug options:
whipped-ricotta-toast, charred-peach-salad, grilled-salmon-quinoa-power-bowl, teriyaki-salmon-rice-bowl, herb-crusted-roast-chicken, blood-orange-olive-oil-cake, chili-crab-linguine, creamy-mushroom-spinach-penne, coconut-green-curry, crispy-halloumi-hot-honey, rosemary-grapefruit-spritz, roasted-tomato-basil-soup, citrus-fennel-salad, sea-salt-focaccia, harissa-grilled-chicken-skewers

JSON shape:
{
  "slug": "example-recipe-slug",
  "category": "Lunch",
  "title": "Recipe Title",
  "description": "One sentence description.",
  "alt": "Descriptive image alt text",
  "prepTime": "15 min",
  "cookTime": "20 min",
  "servings": "4",
  "difficulty": "Easy",
  "nutrition": {
    "calories": "520",
    "protein": "24g",
    "carbs": "48g",
    "fat": "26g"
  },
  "ingredients": ["..."],
  "instructions": ["..."],
  "related": ["existing-slug", "existing-slug", "existing-slug"]
}`;

const recipeJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "slug",
    "category",
    "title",
    "description",
    "alt",
    "prepTime",
    "cookTime",
    "servings",
    "difficulty",
    "nutrition",
    "ingredients",
    "instructions",
    "related",
  ],
  properties: {
    slug: { type: "string" },
    category: { type: "string", enum: ALLOWED_CATEGORIES },
    title: { type: "string" },
    description: { type: "string" },
    alt: { type: "string" },
    prepTime: { type: "string" },
    cookTime: { type: "string" },
    servings: { type: "string" },
    difficulty: { type: "string" },
    nutrition: {
      type: "object",
      additionalProperties: false,
      required: ["calories", "protein", "carbs", "fat"],
      properties: {
        calories: { type: "string" },
        protein: { type: "string" },
        carbs: { type: "string" },
        fat: { type: "string" },
      },
    },
    ingredients: { type: "array", minItems: 6, items: { type: "string" } },
    instructions: { type: "array", minItems: 4, items: { type: "string" } },
    related: { type: "array", maxItems: 3, items: { type: "string" } },
  },
};

const responseFormatForModel = (model) => {
  if (JSON_SCHEMA_FREE_MODELS.has(model)) {
    return {
      type: "json_schema",
      json_schema: {
        name: "modish_menu_recipe",
        strict: true,
        schema: recipeJsonSchema,
      },
    };
  }

  if (JSON_MODE_FREE_MODELS.has(model)) {
    return { type: "json_object" };
  }

  return null;
};

const extractMessageContent = (payload) => {
  const choice = payload.choices?.[0];
  const message = choice?.message || {};
  const content = message.content;

  if (typeof content === "string" && content.trim()) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.content || "";
      })
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
};

const extractMessageReasoning = (payload) => {
  const reasoning = payload.choices?.[0]?.message?.reasoning;
  return typeof reasoning === "string" ? reasoning.trim() : "";
};

const containsJsonObject = (value) => {
  const text = String(value || "");
  return text.includes("{") && text.includes("}");
};

const summarizeEmptyOpenRouterResponse = (payload) => {
  const choice = payload.choices?.[0] || {};
  const message = choice.message || {};
  const details = {
    finish_reason: choice.finish_reason || choice.native_finish_reason || null,
    error: choice.error || payload.error || null,
    message_keys: Object.keys(message),
    usage: payload.usage || null,
  };

  return JSON.stringify(details);
};

const postOpenRouter = async (body, { model, purpose }) => {
  let lastErrorText = "";
  const requestTimeoutMs = readIntegerEnv(
    "OPENROUTER_REQUEST_TIMEOUT_MS",
    DEFAULT_OPENROUTER_REQUEST_TIMEOUT_MS
  );
  const boundedRequestTimeoutMs = Math.max(1000, requestTimeoutMs);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await throttleOpenRouter();
    console.log(`OpenRouter ${purpose}: ${model} attempt ${attempt}/3`);

    let response;
    try {
      response = await fetchWithTimeout(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.SITE_URL,
            "X-Title": "Modish Menu Recipe Generator",
          },
          body: JSON.stringify(body),
        },
        boundedRequestTimeoutMs
      );
    } catch (error) {
      const timedOut = error.name === "AbortError";
      lastErrorText =
        timedOut
          ? `OpenRouter ${purpose} timed out after ${Math.ceil(boundedRequestTimeoutMs / 1000)}s.`
          : error.message || "OpenRouter request failed before a response was received.";

      if (timedOut || attempt === 3) {
        break;
      }

      console.log(`${lastErrorText} Retrying...`);
      await applyOpenRouterRetryCooldown(attempt, "timeout");
      continue;
    }

    if (response.ok) {
      return response.json();
    }

    lastErrorText = `${response.status} ${response.statusText}\n${await response.text()}`;
    if (response.status === 429) {
      break;
    }

    if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      break;
    }

    await applyOpenRouterRetryCooldown(attempt, response.status);
  }

  throw new Error(`OpenRouter request failed: ${lastErrorText}`);
};

const requestOpenRouterRecipe = async ({ model, imageDataUrl, keywordGuidance }) => {
  const responseFormat = responseFormatForModel(model);
  const body = {
    model,
    reasoning: {
      effort: "none",
      exclude: true,
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt(keywordGuidance) },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    temperature: 0.15,
    max_tokens: 2200,
  };

  if (responseFormat) {
    body.response_format = responseFormat;
    body.provider = { require_parameters: true };
  }

  const payload = await postOpenRouter(body, { model, purpose: "recipe" });

  return {
    content: extractMessageContent(payload),
    reasoning: extractMessageReasoning(payload),
    payload,
  };
};

const requestOpenRouterRepair = async ({ model, sourceText, keywordGuidance }) => {
  const responseFormat = responseFormatForModel(model);
  const body = {
    model,
    reasoning: {
      effort: "none",
      exclude: true,
    },
    messages: [
      {
        role: "user",
        content: `Convert the recipe notes below into one strict JSON object only. Do not explain. Do not include markdown.

Use this exact JSON shape:
{
  "slug": "example-recipe-slug",
  "category": "Lunch",
  "title": "Recipe Title",
  "description": "One sentence description.",
  "alt": "Descriptive image alt text",
  "prepTime": "15 min",
  "cookTime": "20 min",
  "servings": "4",
  "difficulty": "Easy",
  "nutrition": {
    "calories": "520",
    "protein": "24g",
    "carbs": "48g",
    "fat": "26g"
  },
  "ingredients": ["..."],
  "instructions": ["..."],
  "related": ["existing-slug", "existing-slug", "existing-slug"]
}

Allowed categories: ${ALLOWED_CATEGORIES.join(", ")}.
${buildKeywordGuidanceBlock(keywordGuidance)}
Existing related recipe slug options: whipped-ricotta-toast, charred-peach-salad, grilled-salmon-quinoa-power-bowl, teriyaki-salmon-rice-bowl, herb-crusted-roast-chicken, blood-orange-olive-oil-cake, chili-crab-linguine, creamy-mushroom-spinach-penne, coconut-green-curry, crispy-halloumi-hot-honey, rosemary-grapefruit-spritz, roasted-tomato-basil-soup, citrus-fennel-salad, sea-salt-focaccia, harissa-grilled-chicken-skewers.

Recipe notes:
${sourceText}`,
      },
    ],
    temperature: 0,
    max_tokens: 1600,
  };

  if (responseFormat) {
    body.response_format = responseFormat;
    body.provider = { require_parameters: true };
  }

  return postOpenRouter(body, { model, purpose: "repair" });
};

const repairRecipeJson = async ({ sourceText, keywordGuidance }) => {
  let lastError = null;

  for (const model of getRepairModelOrder()) {
    try {
      console.log(`Running JSON repair pass with ${model}...`);
      const payload = await requestOpenRouterRepair({ model, sourceText, keywordGuidance });
      const content = extractMessageContent(payload);

      if (!containsJsonObject(content)) {
        throw new Error(`OpenRouter repair pass did not return JSON. Details: ${summarizeEmptyOpenRouterResponse(payload)}`);
      }

      return parseAndValidateRecipe(content);
    } catch (error) {
      lastError = error;
      console.log(`Repair model failed: ${model}: ${error.message}`);
    }
  }

  throw lastError || new Error("OpenRouter repair pass failed.");
};

const callOpenRouter = async (imageDataUrl, keywordGuidance) => {
  let lastError = null;

  for (const model of getRecipeModelOrder()) {
    try {
      const { content, reasoning, payload } = await requestOpenRouterRecipe({ model, imageDataUrl, keywordGuidance });
      const repairSource = content || reasoning;

      if (containsJsonObject(content)) {
        try {
          return parseAndValidateRecipe(content);
        } catch (error) {
          console.log(`OpenRouter JSON from ${model} failed validation: ${error.message}`);
          return await repairRecipeJson({
            sourceText: `${content}\n\nValidation error to fix: ${error.message}`,
            keywordGuidance,
          });
        }
      }

      if (repairSource) {
        console.log(`OpenRouter ${model} did not return final JSON. Running JSON repair pass...`);
        return await repairRecipeJson({ sourceText: repairSource, keywordGuidance });
      }

      lastError = new Error(`OpenRouter ${model} returned empty content. Details: ${summarizeEmptyOpenRouterResponse(payload || {})}`);
      console.log(lastError.message);
    } catch (error) {
      lastError = error;
      console.log(`Recipe model failed: ${model}: ${error.message}`);
    }
  }

  throw lastError || new Error("OpenRouter recipe generation failed.");
};

const parseRecipeJson = (content) => {
  const trimmed = String(content).trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not find JSON object in OpenRouter response:\n${content}`);
  }

  return JSON.parse(withoutFence.slice(start, end + 1));
};

const normalizeRecipe = (recipe, imageUrl) => {
  const normalized = {
    slug: slugify(recipe.slug || recipe.title),
    category: recipe.category,
    title: String(recipe.title || "").trim(),
    description: String(recipe.description || "").trim(),
    image: imageUrl,
    alt: String(recipe.alt || recipe.title || "Recipe image").trim(),
    prepTime: String(recipe.prepTime || "").trim(),
    cookTime: String(recipe.cookTime || "").trim(),
    servings: String(recipe.servings || "").trim(),
    difficulty: String(recipe.difficulty || "Easy").trim(),
    nutrition: recipe.nutrition || {},
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients.map(String) : [],
    instructions: Array.isArray(recipe.instructions) ? recipe.instructions.map(String) : [],
    related: Array.isArray(recipe.related) ? recipe.related.map(slugify).slice(0, 3) : [],
  };

  if (!normalized.slug) throw new Error("Recipe is missing a usable slug.");
  if (!normalized.title) throw new Error("Recipe is missing title.");
  if (!ALLOWED_CATEGORIES.includes(normalized.category)) {
    normalized.category = "Lunch";
  }
  if (!normalized.description) throw new Error("Recipe is missing description.");
  if (!normalized.prepTime || !normalized.cookTime || !normalized.servings) {
    throw new Error("Recipe is missing prepTime, cookTime, or servings.");
  }
  if (normalized.ingredients.length < 6) throw new Error("Recipe needs at least 6 ingredients.");
  if (normalized.instructions.length < 4) throw new Error("Recipe needs at least 4 instructions.");

  normalized.nutrition = {
    calories: String(normalized.nutrition.calories || "500").replace(/\s*calories?$/i, ""),
    protein: String(normalized.nutrition.protein || "20g"),
    carbs: String(normalized.nutrition.carbs || "45g"),
    fat: String(normalized.nutrition.fat || "22g"),
  };

  return normalized;
};

const parseAndValidateRecipe = (content) => normalizeRecipe(parseRecipeJson(content), "");

const toJsString = (value) => JSON.stringify(value);

const formatRecipeEntry = (recipe) => `    "${recipe.slug}": {
      category: ${toJsString(recipe.category)},
      title: ${toJsString(recipe.title)},
      description:
        ${toJsString(recipe.description)},
      image: ${toJsString(recipe.image)},
      alt: ${toJsString(recipe.alt)},
      prepTime: ${toJsString(recipe.prepTime)},
      cookTime: ${toJsString(recipe.cookTime)},
      servings: ${toJsString(recipe.servings)},
      difficulty: ${toJsString(recipe.difficulty)},
      nutrition: {
        calories: ${toJsString(recipe.nutrition.calories)},
        protein: ${toJsString(recipe.nutrition.protein)},
        carbs: ${toJsString(recipe.nutrition.carbs)},
        fat: ${toJsString(recipe.nutrition.fat)},
      },
      ingredients: [
${recipe.ingredients.map((ingredient) => `        ${toJsString(ingredient)},`).join("\n")}
      ],
      instructions: [
${recipe.instructions.map((instruction) => `        ${toJsString(instruction)},`).join("\n")}
      ],
      related: [${recipe.related.map(toJsString).join(", ")}],
    },
`;

const findCatalogBounds = (source) => {
  const declaration = "const recipeCatalog = ";
  const declarationIndex = source.indexOf(declaration);
  if (declarationIndex === -1) {
    throw new Error("Could not find recipeCatalog in main.js.");
  }

  const objectStart = source.indexOf("{", declarationIndex);
  let depth = 0;

  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return { objectStart, objectEnd: index };
    }
  }

  throw new Error("Could not find end of recipeCatalog in main.js.");
};

const getExistingSlugs = (source) => {
  const { objectStart, objectEnd } = findCatalogBounds(source);
  const catalogSource = source.slice(objectStart, objectEnd);
  return new Set([...catalogSource.matchAll(/"([^"]+)"\s*:/g)].map((match) => match[1]));
};

const makeUniqueSlug = (slug, existingSlugs) => {
  if (!existingSlugs.has(slug)) {
    return slug;
  }

  let index = 2;
  let candidate = `${slug}-${index}`;
  while (existingSlugs.has(candidate)) {
    index += 1;
    candidate = `${slug}-${index}`;
  }

  return candidate;
};

const insertRecipeIntoCatalog = (recipe) => {
  const source = fs.readFileSync(MAIN_JS_PATH, "utf8");
  const existingSlugs = getExistingSlugs(source);
  recipe.slug = makeUniqueSlug(recipe.slug, existingSlugs);
  const { objectEnd } = findCatalogBounds(source);
  const entry = formatRecipeEntry(recipe);
  const updated = `${source.slice(0, objectEnd)}${entry}${source.slice(objectEnd)}`;
  fs.writeFileSync(MAIN_JS_PATH, updated);
};

const main = async () => {
  loadEnvFile(ENV_PATH);
  requireEnv();

  const { imagePath, keywordGuidance } = parseCliArgs(process.argv.slice(2));
  if (!imagePath) {
    throw new Error('Usage: node scripts/generate-from-image.js "C:\\path\\to\\recipe-image.jpeg" [--keyword-guidance "high protein dinner"]');
  }

  const resolvedImagePath = path.resolve(imagePath);
  if (!fs.existsSync(resolvedImagePath)) {
    throw new Error(`Image file not found: ${resolvedImagePath}`);
  }

  const imageDataUrl = imagePathToDataUrl(resolvedImagePath);

  console.log("Requesting recipe from OpenRouter...");
  if (keywordGuidance) {
    console.log(`Using title/description guidance: ${keywordGuidance}`);
  }
  const recipe = await callOpenRouter(imageDataUrl, keywordGuidance);

  console.log("Uploading image to R2...");
  requireR2Env();
  const imageUrl = await uploadToR2(resolvedImagePath);
  recipe.image = imageUrl;
  console.log(`Uploaded image: ${imageUrl}`);

  console.log(`Generated recipe: ${recipe.title} (${recipe.slug})`);
  insertRecipeIntoCatalog(recipe);

  console.log("Regenerating static recipe pages...");
  execFileSync(process.execPath, [GENERATE_PAGES_SCRIPT], {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });

  console.log(`Done: recipes/${recipe.slug}.html`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
