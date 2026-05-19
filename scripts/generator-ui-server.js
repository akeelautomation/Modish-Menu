const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const { execFile } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env.local");
loadEnvFile(ENV_PATH);
const ADMIN_DIR = path.join(ROOT_DIR, "admin");
const MAIN_JS_PATH = path.join(ROOT_DIR, "main.js");
const KITCHEN_PICKS_PATH = path.join(ROOT_DIR, "kitchen-picks.html");
const KITCHEN_PICKS_DATA_PATH = path.join(ROOT_DIR, "data", "kitchen-picks.json");
const TMP_DIR = path.join(ROOT_DIR, ".recipe-generator-tmp");
const GENERATOR_SCRIPT = path.join(ROOT_DIR, "scripts", "generate-from-image.js");
const STATIC_GENERATOR_SCRIPT = path.join(ROOT_DIR, "scripts", "generate-recipe-pages.js");
const PORT = Number(process.env.PORT || 3100);
const SITE_URL = String(process.env.SITE_URL || "https://modish-menu.pages.dev").replace(/\/+$/, "");
const OPENROUTER_API_URL = process.env.OPENROUTER_API_BASE_URL || "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash-lite";
const OPENROUTER_REFERER = process.env.OPENROUTER_HTTP_REFERER || SITE_URL;
const OPENROUTER_TITLE = "Modish Menu Product Publisher";
const PINTEREST_DOMAIN_VERIFY = process.env.PINTEREST_DOMAIN_VERIFY || "9c6037d438a25ef0f7bd7f38b3ce4d23";
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_KEYWORD_GUIDANCE_CHARS = 1200;
const DEFAULT_GENERATOR_TIMEOUT_MS = 45 * 60 * 1000;
const GENERATOR_TIMEOUT_MS = readPositiveIntegerEnv("GENERATOR_TIMEOUT_MS", DEFAULT_GENERATOR_TIMEOUT_MS);
let generatorQueue = Promise.resolve();

const KITCHEN_PICK_SECTIONS = [
  { id: "weeknight", title: "Weeknight Foundations" },
  { id: "baking", title: "Baking Bench" },
  { id: "hosting", title: "Table & Serve" },
  { id: "coffee", title: "Coffee & Breakfast" },
  { id: "pantry", title: "Pantry Order" },
];

const AFFILIATE_REVIEW_FIELDS = [
  { key: "whoItsBestFor", label: "Who It's Best For", type: "text" },
  { key: "whoShouldSkipIt", label: "Who Should Skip It", type: "text" },
  { key: "whereItWorksBest", label: "Where It Works Best", type: "text" },
  { key: "pros", label: "Pros", type: "list" },
  { key: "cons", label: "Cons", type: "list" },
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

fs.mkdirSync(TMP_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/admin")) {
      sendFile(res, path.join(ADMIN_DIR, "index.html"));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname.startsWith("/admin/")) {
      const requestedPath = path.normalize(decodeURIComponent(requestUrl.pathname.replace(/^\/admin\//, "")));
      const filePath = path.join(ADMIN_DIR, requestedPath);

      if (!filePath.startsWith(ADMIN_DIR)) {
        sendJson(res, 403, { error: "Forbidden." });
        return;
      }

      sendFile(res, filePath);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname.startsWith("/site")) {
      sendSiteFile(res, requestUrl.pathname);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/admin-summary") {
      sendJson(res, 200, buildAdminSummary());
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/regenerate-site") {
      const result = await runStaticGenerator();
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/recipes") {
      sendJson(res, 200, buildRecipeEditorList());
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/kitchen-picks") {
      sendJson(res, 200, buildKitchenPicksEditorList());
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/affiliate-publisher/sections") {
      sendJson(res, 200, { sections: getAffiliatePublisherSections() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/affiliate-publisher/analyze") {
      const payload = await readJsonBody(req);
      const analysis = await analyzeAffiliatePublisherInput(payload);
      sendJson(res, 200, { analysis });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/affiliate-publisher/publish") {
      const payload = await readJsonBody(req);
      const analysis = canReuseAffiliateAnalysis(payload, payload.analysis)
        ? payload.analysis
        : await analyzeAffiliatePublisherInput(payload);
      const result = publishAffiliatePick(analysis);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/kitchen-picks") {
      const payload = await readJsonBody(req);
      const result = createKitchenPick(payload);
      sendJson(res, 200, result);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/kitchen-picks/")) {
      const id = decodeURIComponent(requestUrl.pathname.replace(/^\/api\/kitchen-picks\//, ""));

      if (req.method === "PUT") {
        const payload = await readJsonBody(req);
        const result = updateKitchenPick(id, payload);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "DELETE") {
        const result = deleteKitchenPick(id);
        sendJson(res, 200, result);
        return;
      }
    }

    if (requestUrl.pathname.startsWith("/api/recipes/")) {
      const slug = decodeURIComponent(requestUrl.pathname.replace(/^\/api\/recipes\//, ""));

      if (req.method === "PUT") {
        const payload = await readJsonBody(req);
        const result = await updateRecipe(slug, payload);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "DELETE") {
        const result = await deleteRecipe(slug);
        sendJson(res, 200, result);
        return;
      }
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/generate-recipe") {
      const upload = await readMultipartUpload(req);
      const tempPath = path.join(TMP_DIR, `${Date.now()}-${sanitizeFilename(upload.filename)}`);
      fs.writeFileSync(tempPath, upload.buffer);

      try {
        const result = await queueGenerator(tempPath, normalizeKeywordGuidance(upload.fields.keywordGuidance), res);
        sendJson(res, 200, result);
      } finally {
        fs.rmSync(tempPath, { force: true });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Modish Menu recipe generator running at http://localhost:${PORT}/admin`);
});

function loadEnvFile(filePath) {
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
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(res, 404, { error: "File not found." });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendSiteFile(res, pathname) {
  const relativePath = decodeURIComponent(pathname.replace(/^\/site\/?/, "")) || "index.html";
  const normalizedPath = path.normalize(relativePath);
  const filePath = path.join(ROOT_DIR, normalizedPath);

  if (!filePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  sendFile(res, filePath);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error("Image is too large. Use a file under 12 MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const body = await readRequestBody(req);
  if (!body.length) {
    return {};
  }

  try {
    return JSON.parse(body.toString("utf8"));
  } catch (_error) {
    throw new Error("Expected valid JSON request body.");
  }
}

async function readMultipartUpload(req) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

  if (!boundaryMatch) {
    throw new Error("Expected multipart form upload.");
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const body = await readRequestBody(req);
  const parts = splitMultipart(body, boundary);
  const fields = {};
  let image = null;

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const rawHeaders = part.slice(0, headerEnd).toString("utf8");
    const content = trimMultipartContent(part.slice(headerEnd + 4));
    const disposition = rawHeaders.match(/content-disposition:[^\r\n]+/i)?.[0] || "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
    const partContentType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";

    if (name === "image" && filename) {
      if (!partContentType.startsWith("image/")) {
        throw new Error("Please upload an image file.");
      }

      image = {
        filename,
        contentType: partContentType,
        buffer: content,
      };
      continue;
    }

    if (name && !filename) {
      fields[name] = content.toString("utf8").trim();
    }
  }

  if (!image) {
    throw new Error("No image field found in upload.");
  }

  return {
    ...image,
    fields,
  };
}

function splitMultipart(body, boundary) {
  const parts = [];
  let cursor = body.indexOf(boundary);

  while (cursor !== -1) {
    const partStart = cursor + boundary.length;
    const next = body.indexOf(boundary, partStart);
    if (next === -1) break;

    const part = body.slice(partStart, next);
    if (!part.includes(Buffer.from("Content-Disposition"))) {
      cursor = next;
      continue;
    }

    parts.push(trimMultipartContent(part));
    cursor = next;
  }

  return parts;
}

function trimMultipartContent(buffer) {
  let start = 0;
  let end = buffer.length;

  if (buffer.slice(0, 2).toString() === "\r\n") start = 2;
  if (buffer.slice(end - 2).toString() === "\r\n") end -= 2;
  if (buffer.slice(end - 2).toString() === "--") end -= 2;

  return buffer.slice(start, end);
}

function normalizeKeywordGuidance(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_KEYWORD_GUIDANCE_CHARS);
}

function runGenerator(imagePath, keywordGuidance, res) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const startedAt = Date.now();
    const args = [GENERATOR_SCRIPT, imagePath];
    if (keywordGuidance) {
      args.push("--keyword-guidance", keywordGuidance);
    }

    const child = execFile(
      process.execPath,
      args,
      {
        cwd: ROOT_DIR,
        timeout: GENERATOR_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 4,
      },
      (error, stdout, stderr) => {
        settled = true;
        const combinedOutput = `${stdout || ""}${stderr ? `\n${stderr}` : ""}`.trim();
        const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

        if (error) {
          if (error.killed && error.signal === "SIGTERM") {
            reject(
              new Error(
                [
                  `Recipe generation timed out after ${Math.round(GENERATOR_TIMEOUT_MS / 60000)} minutes.`,
                  "The provider was still cooling down, retrying, or regenerating pages.",
                  "This item can be retried, or increase GENERATOR_TIMEOUT_MS in .env.local for larger batches.",
                  combinedOutput,
                ]
                  .filter(Boolean)
                  .join("\n")
              )
            );
            return;
          }

          reject(new Error(combinedOutput || error.message));
          return;
        }

        const pageMatch = combinedOutput.match(/Done:\s+(recipes\/[^\s]+\.html)/);
        const uploadMatch = combinedOutput.match(/Uploaded image:\s+(https?:\/\/[^\s]+)/);
        const recipeMatch = combinedOutput.match(/Generated recipe:\s+(.+?)\s+\(([^)]+)\)/);

        resolve({
          ok: true,
          title: recipeMatch?.[1] || "",
          slug: recipeMatch?.[2] || "",
          pagePath: pageMatch?.[1] || "",
          pageUrl: pageMatch ? `/${pageMatch[1].replace(/\\/g, "/")}` : "",
          uploadedImageUrl: uploadMatch?.[1] || "",
          output: `${combinedOutput}\nElapsed: ${elapsedSeconds}s`,
        });
      }
    );

    res.on("close", () => {
      if (!settled) {
        child.kill();
        reject(new Error("Generation stopped by user."));
      }
    });
  });
}

function queueGenerator(imagePath, keywordGuidance, res) {
  const queuedRun = generatorQueue.then(
    () => runGenerator(imagePath, keywordGuidance, res),
    () => runGenerator(imagePath, keywordGuidance, res)
  );

  generatorQueue = queuedRun.catch(() => {});
  return queuedRun;
}

function runStaticGenerator() {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [STATIC_GENERATOR_SCRIPT],
      {
        cwd: ROOT_DIR,
        timeout: GENERATOR_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 4,
      },
      (error, stdout, stderr) => {
        const output = `${stdout || ""}${stderr ? `\n${stderr}` : ""}`.trim();
        if (error) {
          reject(new Error(output || error.message));
          return;
        }

        resolve({ ok: true, output });
      }
    );
  });
}

function buildAdminSummary() {
  const catalog = extractRecipeCatalog();
  const recipeFiles = listRecipeFiles();
  const categoryCounts = countCategories(catalog);
  const policyPages = [
    { label: "About", path: "about.html" },
    { label: "Contact", path: "contact.html" },
    { label: "Privacy Policy", path: "privacy-policy.html" },
    { label: "Terms", path: "terms.html" },
  ].map((page) => ({
    ...page,
    exists: fs.existsSync(path.join(ROOT_DIR, page.path)),
  }));
  const seoAssets = [
    { title: "robots.txt", path: "robots.txt", required: true },
    { title: "sitemap.xml", path: "sitemap.xml", required: true },
    { title: "ads.txt", path: "ads.txt", required: false },
  ].map((asset) => {
    const exists = fs.existsSync(path.join(ROOT_DIR, asset.path));
    return {
      state: exists ? "pass" : asset.required ? "fail" : "warn",
      title: asset.title,
      detail: exists
        ? `${asset.path} is present.`
        : asset.required
          ? `${asset.path} is missing and should be deployed.`
          : `${asset.path} should be added after AdSense gives you the real publisher ID.`,
    };
  });
  const schema = collectSchemaStats(recipeFiles);
  const ads = collectAdStats();
  const kitchenPicks = collectKitchenPicksStats();
  const environment = [
    envCheck("OPENROUTER_API_KEY", "AI recipe generation API key"),
    envCheck("R2_BUCKET_NAME", "Cloudflare R2 bucket"),
    envCheck("R2_ENDPOINT", "Cloudflare R2 S3 endpoint"),
    envCheck("R2_ACCESS_KEY_ID", "Cloudflare R2 access key"),
    envCheck("R2_SECRET_ACCESS_KEY", "Cloudflare R2 secret key"),
    envCheck("R2_PUBLIC_BASE_URL", "Public recipe image base URL"),
    envCheck("SITE_URL", "Canonical production URL"),
    envCheck("ADSENSE_PUBLISHER_ID", "AdSense publisher ID for ads.txt"),
    envCheck("ADSENSE_AD_CLIENT", "AdSense client ID for ad tags"),
  ];

  const readiness = [
    {
      state: Object.keys(catalog).length >= 30 ? "pass" : "warn",
      title: "Substantial recipe library",
      detail: `${Object.keys(catalog).length} recipes are in the catalog. More original, useful content improves review quality.`,
    },
    {
      state: policyPages.every((page) => page.exists) ? "pass" : "fail",
      title: "Trust and policy pages",
      detail: `${policyPages.filter((page) => page.exists).length}/${policyPages.length} required trust pages exist.`,
    },
    {
      state: seoAssets.filter((asset) => asset.state === "fail").length ? "fail" : "pass",
      title: "Crawler assets",
      detail: "robots.txt and sitemap.xml help Google discover public content.",
    },
    {
      state: schema.recipeJsonLdPages === recipeFiles.length && recipeFiles.length ? "pass" : "warn",
      title: "Recipe structured data",
      detail: `${schema.recipeJsonLdPages}/${recipeFiles.length} recipe pages include JSON-LD schema.`,
    },
    {
      state: ads.hasDevPlaceholders ? "warn" : "pass",
      title: "Ad placement presentation",
      detail: ads.hasDevPlaceholders
        ? "Development ad placeholder labels are still visible in CSS."
        : "Ad containers use neutral labeling and avoid misleading callouts.",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    recipes: {
      total: Object.keys(catalog).length,
      generatedPages: recipeFiles.length,
      categories: categoryCounts,
      recent: recipeFiles.slice(0, 8),
    },
    policyPages,
    seoAssets,
    ads,
    schema,
    kitchenPicks,
    environment,
    readiness,
  };
}

function buildRecipeEditorList() {
  const catalog = extractRecipeCatalog();
  return {
    recipes: Object.entries(catalog)
      .map(([slug, recipe]) => ({
        slug,
        ...recipe,
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

function buildKitchenPicksEditorList() {
  return readKitchenPicksData();
}

function getAffiliatePublisherSections() {
  return KITCHEN_PICK_SECTIONS.map((section) => ({
    id: section.id,
    label: section.title,
    pageFile: "kitchen-picks.html",
    sectionUrl: `kitchen-picks.html#${section.id}`,
  }));
}

async function analyzeAffiliatePublisherInput(input) {
  const imageUrls = normalizeAffiliateImageUrls(input.imageUrls?.length ? input.imageUrls : input.imageUrl);
  const affiliateUrl = cleanText(input.affiliateUrl, "");

  if (!affiliateUrl || !imageUrls.length) {
    throw new Error("Product link and at least one image URL are required.");
  }

  assertSafeExternalUrl(affiliateUrl, "Product link", false);
  imageUrls.forEach((imageUrl) => assertSafeExternalUrl(imageUrl, "Image URL", false));

  const sections = getAffiliatePublisherSections();
  const sectionId = sections.some((section) => section.id === input.sectionId) ? input.sectionId : sections[0].id;
  const sectionLabel = sections.find((section) => section.id === sectionId)?.label || "Kitchen Picks";
  const resolvedProductUrl = await resolveProductUrl(affiliateUrl);
  const amazonData = await readAmazonProductData(resolvedProductUrl);
  const shortTitle = cleanText(input.shortTitle, amazonData.title || "Kitchen Pick");
  const price = normalizePublisherPrice(input.price || amazonData.price);
  if (!price) {
    throw new Error("Pinterest Product Rich Pins require a price. Enter the current product price in the Pinterest price field, then preview again.");
  }

  const availability = normalizePinterestAvailability(input.availability || amazonData.availability);
  const generatedReview = await generatePublisherReviewContent({
    shortTitle,
    brand: amazonData.brand,
    fullTitle: amazonData.fullTitle || shortTitle,
    bullets: amazonData.bullets,
    price,
    sectionLabel,
  });
  const cardCopy = cleanText(input.cardCopy, generatedReview.cardCopy);
  const pageSummary = cleanText(input.pageSummary, generatedReview.pageSummary);
  const review = {
    ...generatedReview,
    cardCopy,
    pageSummary,
  };
  const pageSlug = slugify(shortTitle) || slugify(amazonData.asin) || `kitchen-pick-${Date.now()}`;
  const pageFile = `pick-${pageSlug}.html`;

  return {
    affiliateUrl,
    imageUrl: imageUrls[0],
    imageUrls,
    sectionId,
    sectionLabel,
    sectionPageFile: "kitchen-picks.html",
    sectionUrl: `kitchen-picks.html#${sectionId}`,
    asin: amazonData.asin,
    brand: amazonData.brand,
    fullTitle: amazonData.fullTitle || shortTitle,
    shortTitle,
    cardCopy,
    pageSummary,
    review,
    price,
    currency: "USD",
    priceLabel: "Check Latest Price on Amazon",
    availability,
    availabilityLabel: pinterestAvailabilityLabel(availability),
    pageFile,
    productUrl: toPublicProductUrl(pageFile),
    metaDescription: truncateText(`${shortTitle}. ${cardCopy}`, 158),
    ogTitle: `${shortTitle} | Modish Menu`,
    ogDescription: pageSummary,
    twitterDescription: pageSummary,
    altText: cleanText(input.altText, `${shortTitle} product photo`),
  };
}

function canReuseAffiliateAnalysis(input, analysis) {
  if (!analysis || typeof analysis !== "object" || !analysis.review || !normalizePublisherPrice(analysis.price)) {
    return false;
  }

  const inputImageUrls = normalizeAffiliateImageUrls(input.imageUrls?.length ? input.imageUrls : input.imageUrl);
  const analysisImageUrls = normalizeAffiliateImageUrls(analysis.imageUrls?.length ? analysis.imageUrls : analysis.imageUrl);

  return (
    cleanText(input.affiliateUrl, "") === cleanText(analysis.affiliateUrl, "") &&
    JSON.stringify(inputImageUrls) === JSON.stringify(analysisImageUrls) &&
    optionalValueMatches(input.sectionId, analysis.sectionId) &&
    optionalValueMatches(input.price, analysis.price) &&
    optionalValueMatches(input.availability, analysis.availability) &&
    optionalValueMatches(input.shortTitle, analysis.shortTitle) &&
    optionalValueMatches(input.cardCopy, analysis.cardCopy) &&
    optionalValueMatches(input.pageSummary, analysis.pageSummary) &&
    optionalValueMatches(input.altText, analysis.altText)
  );
}

function publishAffiliatePick(analysis) {
  const pageFile = findExistingAffiliatePickFile(analysis);
  const finalAnalysis = {
    ...analysis,
    pageFile,
    productUrl: toPublicProductUrl(pageFile),
  };

  fs.writeFileSync(path.join(ROOT_DIR, pageFile), renderAffiliateProductPage(finalAnalysis), "utf8");

  const data = readKitchenPicksData();
  const existingIndex = data.picks.findIndex(
    (pick) => pick.linkUrl === finalAnalysis.affiliateUrl || pick.title === finalAnalysis.shortTitle
  );
  const pick = {
    id: slugify(finalAnalysis.shortTitle) || path.basename(pageFile, ".html").replace(/^pick-/, ""),
    section: finalAnalysis.sectionId,
    label: finalAnalysis.sectionLabel.replace(/\s+Foundations|\s+Bench|\s+Order/gi, "") || "Kitchen",
    title: finalAnalysis.shortTitle,
    description: finalAnalysis.cardCopy,
    imageUrl: finalAnalysis.imageUrl,
    imageAlt: finalAnalysis.altText,
    linkUrl: finalAnalysis.affiliateUrl,
    pageFile,
    productUrl: finalAnalysis.productUrl,
    buttonText: finalAnalysis.priceLabel,
  };

  if (existingIndex >= 0) {
    data.picks[existingIndex] = { ...data.picks[existingIndex], ...pick };
  } else {
    data.picks.unshift(pick);
  }

  writeKitchenPicksData(data);
  regenerateKitchenPicksPage(data);

  return {
    ok: true,
    pageFile,
    pagePath: path.join(ROOT_DIR, pageFile),
    kitchenPicksPath: KITCHEN_PICKS_PATH,
    analysis: finalAnalysis,
  };
}

async function readAmazonProductData(affiliateUrl) {
  const fallback = {
    asin: extractAsinFromUrl(affiliateUrl),
    brand: "",
    title: titleFromUrl(affiliateUrl),
    fullTitle: titleFromUrl(affiliateUrl),
    bullets: [],
    price: "",
    availability: "InStock",
  };

  const asin = fallback.asin;
  if (!asin) {
    return fallback;
  }

  try {
    const canonicalUrl = new URL(`/dp/${asin}`, new URL(affiliateUrl).origin).toString();
    const response = await fetch(canonicalUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return fallback;
    }

    const html = await response.text();
    const fullTitle = extractHtmlField(html, /<span id="productTitle"[^>]*>([\s\S]*?)<\/span>/i);
    const brand = extractHtmlField(html, /<a id="bylineInfo"[^>]*>([\s\S]*?)<\/a>/i)
      .replace(/^Visit the\s+/i, "")
      .replace(/\s+Store$/i, "");

    return {
      asin,
      brand,
      title: fullTitle || fallback.title,
      fullTitle: fullTitle || fallback.fullTitle,
      bullets: extractAmazonBullets(html),
      price: extractAmazonPrice(html),
      availability: extractAmazonAvailability(html),
    };
  } catch (_error) {
    return fallback;
  }
}

async function resolveProductUrl(productUrl) {
  try {
    const response = await fetch(productUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    const location = response.headers.get("location") || response.url || productUrl;
    return new URL(location, productUrl).toString();
  } catch (_error) {
    return productUrl;
  }
}

async function generatePublisherReviewContent({ shortTitle, brand, fullTitle, bullets, price, sectionLabel }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing. Add it to .env.local, then restart the admin server.");
  }

  const fallbackDetail = bullets.find((bullet) => bullet.length > 20) || `${shortTitle} for ${sectionLabel}.`;
  const fallbackReview = buildPublisherReviewFallback({ shortTitle, sectionLabel, fallbackDetail });
  const promptPayload = {
    shortTitle,
    brand,
    fullTitle,
    section: sectionLabel,
    price: price ? `$${price}` : "Not available",
    productFeatures: bullets,
  };

  const systemPrompt =
    "You write product recommendation copy for a food and recipe website. Rewrite product information into grounded buying guidance for home cooks. Do not copy product listing wording. Do not mention Amazon. Do not invent exact dimensions, materials, accessories, or performance claims that are not supported by the provided details. If information is limited, be honest and tell the reader to check the listing details. Return valid JSON only.";

  const userPrompt = [
    "Create structured product notes using this schema:",
    "{",
    '  "cardCopy": "1-2 concise sentences for a product card, 100-165 characters if possible",',
    '  "pageSummary": "1 sentence product page subtitle, kitchen-use focused, 170 characters or less",',
    '  "whoItsBestFor": "1-2 sentences",',
    '  "whoShouldSkipIt": "1-2 sentences",',
    '  "whereItWorksBest": "1-2 sentences",',
    '  "pros": ["3 concise items"],',
    '  "cons": ["1-2 concise items"]',
    "}",
    "Rules:",
    "- Keep the tone practical, specific, and honest.",
    "- Rephrase ideas instead of echoing supplied features.",
    "- Pros and cons must be concise plain-text list items.",
    "- Keep pros to exactly 3 items and cons to 1-2 items.",
    "- Keep every field compact. Avoid long paragraphs.",
    "",
    JSON.stringify(promptPayload, null, 2),
  ].join("\n");

  const models = [OPENROUTER_MODEL]
    .concat(String(process.env.OPENROUTER_FALLBACK_MODELS || "").split(","))
    .map((model) => model.trim())
    .filter(Boolean);
  let lastError = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(OPENROUTER_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": OPENROUTER_REFERER,
            "X-Title": OPENROUTER_TITLE,
          },
          body: JSON.stringify({
            model,
            temperature: attempt === 0 ? 0.2 : 0.1,
            max_completion_tokens: attempt === 0 ? 1200 : 1500,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            ...(attempt === 0 ? { response_format: { type: "json_object" } } : {}),
          }),
        });

        if (!response.ok) {
          throw new Error(await readOpenRouterError(response));
        }

        const payload = await response.json();
        const messageText = extractOpenRouterMessageText(payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text);
        return normalizePublisherReview(parsePublisherReviewResponse(messageText));
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (process.env.OPENROUTER_STRICT_REVIEW_JSON === "1") {
    throw new Error(`AI review generation failed: ${lastError?.message || "unexpected OpenRouter response"}`);
  }

  return fallbackReview;
}

function renderAffiliateProductPage(data) {
  const price = normalizePublisherPrice(data.price);
  if (!price) {
    throw new Error("Cannot render a Pinterest product page without a price.");
  }

  const currency = cleanText(data.currency, "USD").toUpperCase();
  const availability = normalizePinterestAvailability(data.availability);
  const pinterestAvailability = pinterestAvailabilityLabel(availability);
  const imageUrl = (data.imageUrls || [data.imageUrl]).filter(Boolean)[0] || data.imageUrl;
  const imageSize = inferProductImageSize(imageUrl);
  const retailerItemId = cleanText(data.asin, path.basename(data.pageFile || "", ".html"));
  const productBrand = cleanText(data.brand, inferProductBrand(data.shortTitle || data.fullTitle));
  const productBrandMeta = productBrand ? `    <meta property="product:brand" content="${escapeHtml(productBrand)}" />\n` : "";
  const productJson = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: data.fullTitle,
    url: data.productUrl,
    image: data.imageUrls,
    description: data.metaDescription,
    sku: data.asin || data.pageFile,
    brand: productBrand ? { "@type": "Brand", name: productBrand } : undefined,
    offers: {
      "@type": "Offer",
      url: data.affiliateUrl,
      itemCondition: "https://schema.org/NewCondition",
      availability: `https://schema.org/${availability}`,
      priceCurrency: currency,
      price,
    },
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,follow" />
    <meta name="color-scheme" content="light" />
    <meta name="p:domain_verify" content="${escapeHtml(PINTEREST_DOMAIN_VERIFY)}" />
    <meta name="description" content="${escapeHtml(data.metaDescription)}" />
    <meta property="og:type" content="product" />
    <meta property="og:site_name" content="MODISH MENU" />
    <meta property="og:url" content="${escapeHtml(data.productUrl)}" />
    <meta property="og:title" content="${escapeHtml(data.ogTitle)}" />
    <meta property="og:description" content="${escapeHtml(data.ogDescription)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:alt" content="${escapeHtml(data.altText)}" />
    <meta property="og:image:width" content="${imageSize.width}" />
    <meta property="og:image:height" content="${imageSize.height}" />
    <meta property="product:retailer_item_id" content="${escapeHtml(retailerItemId)}" />
${productBrandMeta}    <meta property="product:condition" content="new" />
    <meta property="product:availability" content="${escapeHtml(pinterestAvailability)}" />
    <meta property="product:price:amount" content="${escapeHtml(price)}" />
    <meta property="product:price:currency" content="${escapeHtml(currency)}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(data.ogTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(data.twitterDescription)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <script type="application/ld+json">${JSON.stringify(productJson, null, 8).replace(/<\/script/gi, "<\\/script")}</script>
    <title>MODISH MENU | ${escapeHtml(data.shortTitle)}</title>
    <link rel="stylesheet" href="style.css?v=20260519-product-images" />
  </head>
  <body class="product-page">
    <div class="page-shell">
      <header class="site-header">
        <div class="container nav-wrap">
          <a class="brand" href="index.html">Modish Menu</a>
          <nav class="site-nav" aria-label="Primary">
            <a class="nav-link" href="index.html">Home</a>
            <a class="nav-link" href="recipes.html">Recipes</a>
            <a class="nav-link is-current" href="kitchen-picks.html">Kitchen Picks</a>
          </nav>
        </div>
      </header>
      <main>
        <section class="picks-hero">
          <div class="container">
            <div class="picks-hero-grid">
              <div class="picks-hero-copy">
                <span class="eyebrow">Kitchen Pick</span>
                <h1 class="section-heading">${escapeHtml(data.shortTitle)}</h1>
                <p class="section-copy">${escapeHtml(data.pageSummary)}</p>
                <div class="picks-disclosure">
                  <span>Note</span>
                  Some outbound shopping links may earn Modish Menu a commission at no extra cost to you.
                </div>
                <a class="button button-dark" href="${escapeHtml(data.affiliateUrl)}" target="_blank" rel="noopener noreferrer nofollow sponsored">${escapeHtml(data.priceLabel)}</a>
              </div>
              <img
                class="picks-hero-image"
                src="${escapeHtml(data.imageUrl)}"
                alt="${escapeHtml(data.altText)}"
                loading="eager"
                decoding="async"
                referrerpolicy="no-referrer"
                data-gallery-main
                onerror="this.src='https://placehold.co/600x400?text=Product+Image+Coming+Soon'"
              />
            </div>
          </div>
        </section>
        <section class="pick-zone">
          <div class="container">
            <div class="pick-grid pick-grid-compact">
${renderAffiliateReviewMarkup(data.review)}
            </div>
            <p class="section-copy">Pricing and availability can change. Check the product page for the latest details before buying.</p>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>
`;
}

function renderAffiliateReviewMarkup(review) {
  return AFFILIATE_REVIEW_FIELDS.map((field) => {
    const value = review[field.key];
    const body = field.type === "list"
      ? `<ul>${(value || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p>${escapeHtml(value || "")}</p>`;
    return `              <article class="product-pick-card">
                <div class="product-pick-body">
                  <span class="tag">Product Notes</span>
                  <h3>${escapeHtml(field.label)}</h3>
                  ${body}
                </div>
              </article>`;
  }).join("\n");
}

function findExistingAffiliatePickFile(analysis) {
  const candidates = fs
    .readdirSync(ROOT_DIR)
    .filter((file) => /^pick-.*\.html$/i.test(file));

  for (const file of candidates) {
    const html = fs.readFileSync(path.join(ROOT_DIR, file), "utf8");
    if ((analysis.asin && html.includes(analysis.asin)) || html.includes(analysis.affiliateUrl) || file === analysis.pageFile) {
      return file;
    }
  }

  return analysis.pageFile;
}

function normalizeAffiliateImageUrls(input) {
  const values = Array.isArray(input) ? input : [input];
  const cleaned = [];

  values.forEach((value) => {
    String(value || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((url) => {
        if (!cleaned.includes(url)) {
          cleaned.push(url);
        }
      });
  });

  return cleaned;
}

function optionalValueMatches(inputValue, analysisValue) {
  const normalized = String(inputValue || "").trim();
  return !normalized || normalized === String(analysisValue || "").trim();
}

function extractAsinFromUrl(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const dpIndex = parts.findIndex((part) => part.toLowerCase() === "dp");
    const productIndex = parts.findIndex((part) => part.toLowerCase() === "product");
    return cleanText(dpIndex >= 0 ? parts[dpIndex + 1] : productIndex >= 0 ? parts[productIndex + 1] : "", "").toUpperCase();
  } catch (_error) {
    return "";
  }
}

function titleFromUrl(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const titlePart = parts.find((part) => !["dp", "gp", "product"].includes(part.toLowerCase()) && !/^[A-Z0-9]{10}$/i.test(part));
    return titlePart
      ? titlePart.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
      : "Kitchen Pick";
  } catch (_error) {
    return "Kitchen Pick";
  }
}

function extractHtmlField(html, pattern) {
  const match = html.match(pattern);
  return cleanText(match?.[1] || "", "");
}

function extractAmazonBullets(html) {
  const section = html.match(/<div id="feature-bullets"[\s\S]*?<ul[\s\S]*?<\/ul>/i)?.[0] || "";
  return Array.from(section.matchAll(/<li[^>]*>\s*<span class="a-list-item">([\s\S]*?)<\/span>\s*<\/li>/gi))
    .map((match) => cleanText(match[1], ""))
    .filter((item) => item.length > 20)
    .slice(0, 4);
}

function extractAmazonPrice(html) {
  const patterns = [
    /<span class="a-offscreen">\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
    /"displayPrice"\s*:\s*"\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)"/i,
    /"priceAmount"\s*:\s*"?([0-9][0-9,]*(?:\.[0-9]{1,2})?)"?/i,
  ];

  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1]?.replace(/,/g, "");
    if (value) {
      return Number(value).toFixed(2);
    }
  }

  return "";
}

function extractAmazonAvailability(html) {
  const availabilityBlock =
    html.match(/<div[^>]+id="availability"[\s\S]*?<\/div>/i)?.[0] ||
    html.match(/<span[^>]+class="[^"]*\ba-size-medium\b[^"]*"[^>]*>\s*([^<]*(?:currently unavailable|out of stock)[^<]*)<\/span>/i)?.[0] ||
    "";

  return /currently unavailable|out of stock/i.test(availabilityBlock) ? "OutOfStock" : "InStock";
}

function normalizePublisherPrice(value) {
  const normalized = String(value || "").replace(/[$,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return "";
  }

  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price.toFixed(2) : "";
}

function normalizePinterestAvailability(value) {
  const normalized = String(value || "").replace(/\s+/g, "").toLowerCase();
  const map = {
    instock: "InStock",
    available: "InStock",
    onlineonly: "OnlineOnly",
    outofstock: "OutOfStock",
    unavailable: "OutOfStock",
    preorder: "PreOrder",
    discontinued: "Discontinued",
  };

  return map[normalized] || "InStock";
}

function pinterestAvailabilityLabel(value) {
  const map = {
    InStock: "instock",
    OnlineOnly: "instock",
    OutOfStock: "out of stock",
    PreOrder: "preorder",
    Discontinued: "discontinued",
  };

  return map[normalizePinterestAvailability(value)] || "instock";
}

function inferProductImageSize(imageUrl) {
  const token = String(imageUrl || "").match(/_AC_S(?:L|X|Y)(\d+)_|_S(?:L|X|Y)(\d+)_/i);
  const size = Number(token?.[1] || token?.[2] || 1500);
  const normalized = Number.isFinite(size) && size > 0 ? size : 1500;

  return {
    width: normalized,
    height: normalized,
  };
}

function inferProductBrand(title) {
  return cleanText(String(title || "").split(/[,|:-]/)[0], "")
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
}

async function readOpenRouterError(response) {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || parsed?.message || raw;
  } catch (_error) {
    return raw || `OpenRouter returned ${response.status}`;
  }
}

function extractOpenRouterMessageText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        if (typeof part?.output_text === "string") return part.output_text;
        return "";
      })
      .join("\n")
      .trim();
  }

  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    if (typeof content.output_text === "string") return content.output_text;
    return JSON.stringify(content);
  }

  return "";
}

function buildPublisherReviewFallback({ shortTitle, sectionLabel, fallbackDetail }) {
  return {
    cardCopy: truncateText(fallbackDetail, 165),
    pageSummary: `${shortTitle} is selected for cooks comparing practical kitchen pieces for everyday use.`,
    whoItsBestFor: `${shortTitle} is best for readers browsing ${sectionLabel.toLowerCase()} who want a practical kitchen upgrade.`,
    whoShouldSkipIt: "Skip it if you need exact sizing, material, or compatibility details that are not visible from the product listing.",
    whereItWorksBest: `${shortTitle} fits best in a home kitchen where the item has a clear role in prep, storage, serving, or everyday cooking.`,
    pros: [
      truncateText(fallbackDetail, 120),
      "Useful for comparing before buying.",
      "Fits naturally into the Kitchen Picks page.",
    ],
    cons: ["Price, availability, and listing details can change."],
  };
}

function parsePublisherReviewResponse(text) {
  const source = String(text || "").trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() || source;
  const start = fenced.indexOf("{");

  if (start < 0) {
    throw new Error("The AI response did not contain JSON.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < fenced.length; index += 1) {
    const char = fenced[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(fenced.slice(start, index + 1));
      }
    }
  }

  throw new Error("The AI response contained incomplete JSON.");
}

function normalizePublisherReview(rawReview) {
  const review = {
    cardCopy: truncateText(cleanText(rawReview?.cardCopy, ""), 165),
    pageSummary: truncateText(cleanText(rawReview?.pageSummary, ""), 170),
    whoItsBestFor: cleanText(rawReview?.whoItsBestFor, ""),
    whoShouldSkipIt: cleanText(rawReview?.whoShouldSkipIt, ""),
    whereItWorksBest: cleanText(rawReview?.whereItWorksBest, ""),
    pros: cleanGeneratedList(rawReview?.pros, 3, 3),
    cons: cleanGeneratedList(rawReview?.cons, 1, 2),
  };

  const missing = AFFILIATE_REVIEW_FIELDS.filter((field) => {
    const value = review[field.key];
    return field.type === "list" ? !value.length : !value;
  }).map((field) => field.label);

  if (!review.cardCopy) missing.push("cardCopy");
  if (!review.pageSummary) missing.push("pageSummary");

  if (missing.length) {
    throw new Error(`The AI response was missing: ${missing.join(", ")}.`);
  }

  return review;
}

function cleanGeneratedList(values, minimum, maximum) {
  const source = Array.isArray(values)
    ? values
    : String(values || "")
        .split(/\r?\n|[;\u2022]/)
        .map((item) => item.trim());
  const cleaned = [];

  source.forEach((item) => {
    const normalized = cleanText(String(item || "").replace(/^[\-*\d.)\s]+/, ""), "");
    if (normalized && !cleaned.includes(normalized) && cleaned.length < maximum) {
      cleaned.push(normalized);
    }
  });

  if (cleaned.length < minimum) {
    throw new Error(`Expected at least ${minimum} list items from the AI response.`);
  }

  return cleaned;
}

function truncateText(value, maxLength) {
  const text = cleanText(value, "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}...`;
}

function toPublicUrl(fileName) {
  const normalized = String(fileName || "").replace(/^\/+/, "");
  return `${SITE_URL}/${normalized}`;
}

function toPublicProductUrl(fileName) {
  const normalized = String(fileName || "").replace(/^\/+/, "").replace(/\.html$/i, "");
  return `${SITE_URL}/${normalized}`;
}

function createKitchenPick(payload) {
  const data = readKitchenPicksData();
  const pick = normalizeKitchenPickPayload(payload);
  const baseId = slugify(pick.title) || "kitchen-pick";
  let id = baseId;
  let suffix = 2;

  while (data.picks.some((item) => item.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  pick.id = id;
  data.picks.push(pick);
  writeKitchenPicksData(data);
  regenerateKitchenPicksPage(data);

  return {
    ok: true,
    pick,
    kitchenPicks: data,
  };
}

function updateKitchenPick(id, payload) {
  assertSafeKitchenPickId(id);
  const data = readKitchenPicksData();
  const index = data.picks.findIndex((pick) => pick.id === id);

  if (index === -1) {
    throw new Error(`Kitchen pick not found: ${id}`);
  }

  data.picks[index] = normalizeKitchenPickPayload(payload, data.picks[index]);
  data.picks[index].id = id;
  writeKitchenPicksData(data);
  regenerateKitchenPicksPage(data);

  return {
    ok: true,
    pick: data.picks[index],
    kitchenPicks: data,
  };
}

function deleteKitchenPick(id) {
  assertSafeKitchenPickId(id);
  const data = readKitchenPicksData();
  const nextPicks = data.picks.filter((pick) => pick.id !== id);

  if (nextPicks.length === data.picks.length) {
    throw new Error(`Kitchen pick not found: ${id}`);
  }

  data.picks = nextPicks;
  writeKitchenPicksData(data);
  regenerateKitchenPicksPage(data);

  return {
    ok: true,
    id,
    kitchenPicks: data,
  };
}

function readKitchenPicksData() {
  let data = { sections: KITCHEN_PICK_SECTIONS, picks: [] };

  if (fs.existsSync(KITCHEN_PICKS_DATA_PATH)) {
    data = JSON.parse(fs.readFileSync(KITCHEN_PICKS_DATA_PATH, "utf8"));
  }

  const sectionIds = new Set(KITCHEN_PICK_SECTIONS.map((section) => section.id));
  const picks = Array.isArray(data.picks)
    ? data.picks.map((pick) => normalizeKitchenPickPayload(pick, pick)).filter((pick) => sectionIds.has(pick.section))
    : [];

  return {
    sections: KITCHEN_PICK_SECTIONS,
    picks,
  };
}

function writeKitchenPicksData(data) {
  fs.mkdirSync(path.dirname(KITCHEN_PICKS_DATA_PATH), { recursive: true });
  fs.writeFileSync(
    KITCHEN_PICKS_DATA_PATH,
    `${JSON.stringify({ sections: KITCHEN_PICK_SECTIONS, picks: data.picks }, null, 2)}\n`
  );
}

function normalizeKitchenPickPayload(payload, existingPick = {}) {
  const sectionIds = new Set(KITCHEN_PICK_SECTIONS.map((section) => section.id));
  const section = sectionIds.has(payload.section) ? payload.section : existingPick.section || KITCHEN_PICK_SECTIONS[0].id;
  const title = cleanText(payload.title, existingPick.title || "Untitled Pick");
  const label = cleanText(payload.label, existingPick.label || "Kitchen");
  const description = cleanText(payload.description, existingPick.description || "A useful pick for the home kitchen.");
  const imageUrl = cleanText(payload.imageUrl, existingPick.imageUrl || "");
  const imageAlt = cleanText(payload.imageAlt, existingPick.imageAlt || title);
  const linkUrl = cleanText(payload.linkUrl, existingPick.linkUrl || "");
  const inferredPageFile = inferKitchenPickPageFile(existingPick.id || payload.id || slugify(title));
  const pageFile = cleanText(payload.pageFile, existingPick.pageFile || inferredPageFile);
  const productUrl = cleanText(payload.productUrl, existingPick.productUrl || (pageFile ? toPublicProductUrl(pageFile) : ""));
  const buttonText = cleanText(payload.buttonText, existingPick.buttonText || "See Options");
  const id = existingPick.id || cleanText(payload.id, "");

  assertSafeExternalUrl(imageUrl, "Image URL", true);
  assertSafeExternalUrl(linkUrl, "Shopping link", false);
  if (productUrl) {
    assertSafeExternalUrl(productUrl, "Product URL", false);
  }

  return {
    id,
    section,
    label,
    title,
    description,
    imageUrl,
    imageAlt,
    linkUrl,
    pageFile,
    productUrl,
    buttonText,
  };
}

function inferKitchenPickPageFile(id) {
  const safeId = String(id || "").trim();
  if (!safeId) {
    return "";
  }

  const pageFile = `pick-${safeId}.html`;
  return fs.existsSync(path.join(ROOT_DIR, pageFile)) ? pageFile : "";
}

function regenerateKitchenPicksPage(data = readKitchenPicksData()) {
  if (!fs.existsSync(KITCHEN_PICKS_PATH)) {
    throw new Error("kitchen-picks.html is missing.");
  }

  let html = fs.readFileSync(KITCHEN_PICKS_PATH, "utf8");

  KITCHEN_PICK_SECTIONS.forEach((section) => {
    const picks = data.picks.filter((pick) => pick.section === section.id);
    html = replacePickGrid(html, section.id, picks.map(renderKitchenPickCard).join("\n"));
  });

  html = updateKitchenPicksJsonLd(html, data.picks);
  fs.writeFileSync(KITCHEN_PICKS_PATH, html);
}

function replacePickGrid(html, sectionId, cardsHtml) {
  const sectionStart = html.indexOf(`<section class="pick-zone" id="${sectionId}">`);
  if (sectionStart === -1) {
    throw new Error(`Could not find Kitchen Picks section: ${sectionId}`);
  }

  const gridStart = html.indexOf('<div class="pick-grid', sectionStart);
  if (gridStart === -1) {
    throw new Error(`Could not find product grid for section: ${sectionId}`);
  }

  const gridOpenEnd = html.indexOf(">", gridStart) + 1;
  const gridClose = findMatchingClosingDiv(html, gridStart);
  const replacement = cardsHtml ? `\n${cardsHtml}\n            ` : "\n            ";

  return `${html.slice(0, gridOpenEnd)}${replacement}${html.slice(gridClose.start)}`;
}

function findMatchingClosingDiv(html, divStart) {
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = divStart;
  let depth = 0;
  let match;

  while ((match = tagPattern.exec(html))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return {
          start: match.index,
          end: tagPattern.lastIndex,
        };
      }
      continue;
    }

    depth += 1;
  }

  throw new Error("Could not find the end of a Kitchen Picks product grid.");
}

function renderKitchenPickCard(pick) {
  const detailsLink = pick.pageFile
    ? `<a class="button button-secondary" href="${escapeHtml(pick.pageFile)}">Details</a>`
    : "";

  return `              <article class="product-pick-card">
                <img
                  src="${escapeHtml(pick.imageUrl)}"
                  alt="${escapeHtml(pick.imageAlt)}"
                />
                <div class="product-pick-body">
                  <span class="tag">${escapeHtml(pick.label)}</span>
                  <h3>${escapeHtml(pick.title)}</h3>
                  <p>${escapeHtml(pick.description)}</p>
                  ${detailsLink}
                  <a
                    class="button button-secondary"
                    href="${escapeHtml(pick.linkUrl)}"
                    target="_blank"
                    rel="noopener noreferrer nofollow sponsored"
                  >${escapeHtml(pick.buttonText)}</a>
                </div>
              </article>`;
}

function updateKitchenPicksJsonLd(html, picks) {
  const itemListElement = picks.map((pick, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: pick.title,
    url: pick.productUrl || pick.linkUrl,
  }));
  const json = JSON.stringify(itemListElement, null, 10).replace(/\n/g, "\n        ");

  return html.replace(/"itemListElement":\s*\[[\s\S]*?\]\s*(?=\n\s*})/, `"itemListElement": ${json}`);
}

function assertSafeKitchenPickId(id) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("Invalid Kitchen Picks item ID.");
  }
}

function assertSafeExternalUrl(value, label, allowRelative) {
  if (allowRelative && value.startsWith("/")) {
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must use http or https.`);
  }
}

async function updateRecipe(slug, payload) {
  assertSafeSlug(slug);
  const source = fs.readFileSync(MAIN_JS_PATH, "utf8");
  const catalog = extractRecipeCatalogFromSource(source);

  if (!catalog[slug]) {
    throw new Error(`Recipe not found: ${slug}`);
  }

  catalog[slug] = normalizeRecipePayload(payload, catalog[slug]);
  writeCatalogToMainJs(source, catalog);
  const generation = await runStaticGenerator();

  return {
    ok: true,
    slug,
    recipe: catalog[slug],
    output: generation.output,
  };
}

async function deleteRecipe(slug) {
  assertSafeSlug(slug);
  const source = fs.readFileSync(MAIN_JS_PATH, "utf8");
  const catalog = extractRecipeCatalogFromSource(source);

  if (!catalog[slug]) {
    throw new Error(`Recipe not found: ${slug}`);
  }

  delete catalog[slug];
  Object.values(catalog).forEach((recipe) => {
    recipe.related = Array.isArray(recipe.related) ? recipe.related.filter((relatedSlug) => relatedSlug !== slug) : [];
  });

  writeCatalogToMainJs(source, catalog);
  fs.rmSync(path.join(ROOT_DIR, "recipes", `${slug}.html`), { force: true });
  const generation = await runStaticGenerator();

  return {
    ok: true,
    slug,
    output: generation.output,
  };
}

function extractRecipeCatalog() {
  const source = fs.readFileSync(MAIN_JS_PATH, "utf8");
  return extractRecipeCatalogFromSource(source);
}

function extractRecipeCatalogFromSource(source) {
  const declaration = "const recipeCatalog = ";
  const declarationIndex = source.indexOf(declaration);

  if (declarationIndex === -1) {
    return {};
  }

  const objectStart = source.indexOf("{", declarationIndex);
  let depth = 0;

  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;

    if (depth === 0) {
      const objectLiteral = source.slice(objectStart, index + 1);
      return vm.runInNewContext(`(${objectLiteral})`);
    }
  }

  return {};
}

function findCatalogBounds(source) {
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
}

function writeCatalogToMainJs(source, catalog) {
  const { objectStart, objectEnd } = findCatalogBounds(source);
  const catalogSource = JSON.stringify(catalog, null, 4);
  const updated = `${source.slice(0, objectStart)}${catalogSource}${source.slice(objectEnd + 1)}`;
  fs.writeFileSync(MAIN_JS_PATH, updated);
}

function normalizeRecipePayload(payload, existingRecipe) {
  const recipe = {
    ...existingRecipe,
    ...payload,
    nutrition: {
      ...existingRecipe.nutrition,
      ...(payload.nutrition || {}),
    },
  };

  recipe.category = cleanText(recipe.category, existingRecipe.category);
  recipe.title = cleanText(recipe.title, existingRecipe.title);
  recipe.description = cleanText(recipe.description, existingRecipe.description);
  recipe.image = cleanText(recipe.image, existingRecipe.image);
  recipe.alt = cleanText(recipe.alt, existingRecipe.alt || recipe.title);
  recipe.prepTime = cleanText(recipe.prepTime, existingRecipe.prepTime || "15 min");
  recipe.cookTime = cleanText(recipe.cookTime, existingRecipe.cookTime || "30 min");
  recipe.servings = cleanText(recipe.servings, existingRecipe.servings || "4");
  recipe.difficulty = cleanText(recipe.difficulty, existingRecipe.difficulty || "Easy");
  recipe.ingredients = cleanList(recipe.ingredients, existingRecipe.ingredients);
  recipe.instructions = cleanList(recipe.instructions, existingRecipe.instructions);
  recipe.related = cleanList(recipe.related, existingRecipe.related).slice(0, 6);
  recipe.nutrition = {
    calories: cleanText(recipe.nutrition?.calories, existingRecipe.nutrition?.calories || "500"),
    protein: cleanText(recipe.nutrition?.protein, existingRecipe.nutrition?.protein || "20g"),
    carbs: cleanText(recipe.nutrition?.carbs, existingRecipe.nutrition?.carbs || "45g"),
    fat: cleanText(recipe.nutrition?.fat, existingRecipe.nutrition?.fat || "20g"),
  };

  return recipe;
}

function cleanText(value, fallback) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized || fallback || "";
}

function cleanList(value, fallback) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  const cleaned = source.map((item) => String(item || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return cleaned.length ? cleaned : Array.isArray(fallback) ? fallback : [];
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function assertSafeSlug(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Invalid recipe slug.");
  }
}

function countCategories(catalog) {
  const counts = new Map();
  Object.values(catalog).forEach((recipe) => {
    const category = recipe.category || "Uncategorized";
    counts.set(category, (counts.get(category) || 0) + 1);
  });

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function listRecipeFiles() {
  const recipesDir = path.join(ROOT_DIR, "recipes");
  if (!fs.existsSync(recipesDir)) {
    return [];
  }

  return fs
    .readdirSync(recipesDir)
    .filter((file) => file.endsWith(".html"))
    .map((file) => {
      const filePath = path.join(recipesDir, file);
      const html = fs.readFileSync(filePath, "utf8");
      const stat = fs.statSync(filePath);
      return {
        path: `recipes/${file}`,
        title: html.match(/<title>(.*?)<\/title>/i)?.[1]?.replace(/\s+\|\s+Modish Menu$/, "") || file,
        modified: stat.mtime.toISOString().slice(0, 10),
        mtime: stat.mtimeMs,
        html,
      };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ html, mtime, ...recipe }) => recipe);
}

function collectSchemaStats(recipeFiles) {
  const detailedFiles = recipeFiles.map((recipe) => {
    const html = fs.readFileSync(path.join(ROOT_DIR, recipe.path), "utf8");
    return html;
  });

  return {
    generatedRecipePages: recipeFiles.length,
    recipeJsonLdPages: detailedFiles.filter((html) => /"@type":\s*"Recipe"/.test(html)).length,
    canonicalPages: detailedFiles.filter((html) => /<link\s+rel="canonical"/i.test(html)).length,
    openGraphPages: detailedFiles.filter((html) => /property="og:title"/i.test(html)).length,
  };
}

function collectAdStats() {
  const publicPages = ["index.html", "categories.html", "about.html", "recipe.html"].filter((file) =>
    fs.existsSync(path.join(ROOT_DIR, file))
  );
  const totalSlots = publicPages.reduce((sum, file) => {
    const html = fs.readFileSync(path.join(ROOT_DIR, file), "utf8");
    return sum + (html.match(/class="[^"]*\bad-slot\b/g) || []).length;
  }, 0);
  const css = fs.existsSync(path.join(ROOT_DIR, "style.css"))
    ? fs.readFileSync(path.join(ROOT_DIR, "style.css"), "utf8")
    : "";

  return {
    totalSlots,
    hasDevPlaceholders: /Ad Placeholder|Remove \.ad-slot dev styles/i.test(css),
  };
}

function collectKitchenPicksStats() {
  const pagePath = path.join(ROOT_DIR, "kitchen-picks.html");
  const homepagePath = path.join(ROOT_DIR, "index.html");
  const sitemapPath = path.join(ROOT_DIR, "sitemap.xml");
  const pageHtml = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, "utf8") : "";
  const homepageHtml = fs.existsSync(homepagePath) ? fs.readFileSync(homepagePath, "utf8") : "";
  const sitemapXml = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, "utf8") : "";
  const productCards = (pageHtml.match(/class="[^"]*\bproduct-pick-card\b/g) || []).length;
  const outboundLinks = (pageHtml.match(/class="button button-secondary"[\s\S]*?target="_blank"/g) || []).length;
  const sponsoredLinks = (pageHtml.match(/class="button button-secondary"[\s\S]*?rel="[^"]*\bsponsored\b[^"]*"/g) || []).length;
  const hasDisclosure = /commission at no extra cost to you/i.test(pageHtml);
  const hasHomepageEntry = /class="[^"]*\bhome-pick-card\b/.test(homepageHtml);
  const hasSitemapEntry = /kitchen-picks\.html/.test(sitemapXml);

  return {
    exists: Boolean(pageHtml),
    productCards,
    outboundLinks,
    sponsoredLinks,
    checks: [
      {
        state: pageHtml ? "pass" : "fail",
        title: "Kitchen Picks page",
        detail: pageHtml ? "kitchen-picks.html exists." : "kitchen-picks.html is missing.",
      },
      {
        state: productCards >= 6 ? "pass" : productCards ? "warn" : "fail",
        title: "Pick card inventory",
        detail: `${productCards} product-style cards are currently published.`,
      },
      {
        state: hasDisclosure ? "pass" : "warn",
        title: "Commission disclosure",
        detail: hasDisclosure
          ? "The page includes reader-facing commission language."
          : "Add a discreet commission note near the top of the page.",
      },
      {
        state: outboundLinks === sponsoredLinks ? "pass" : "warn",
        title: "Sponsored link attributes",
        detail: `${sponsoredLinks}/${outboundLinks} outbound shopping links include sponsored rel attributes.`,
      },
      {
        state: hasHomepageEntry ? "pass" : "warn",
        title: "Homepage entry",
        detail: hasHomepageEntry ? "Homepage Kitchen Picks cards are present." : "Add a homepage entry section.",
      },
      {
        state: hasSitemapEntry ? "pass" : "warn",
        title: "Sitemap entry",
        detail: hasSitemapEntry ? "kitchen-picks.html is listed in sitemap.xml." : "Add kitchen-picks.html to sitemap.xml.",
      },
    ],
  };
}

function envCheck(name, title) {
  const exists = Boolean(process.env[name]);
  return {
    state: exists ? "pass" : "warn",
    title,
    detail: exists ? `${name} is configured.` : `${name} is not set in .env.local.`,
  };
}

function sanitizeFilename(value) {
  const parsed = path.parse(value);
  const name = parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const ext = parsed.ext.toLowerCase() || ".jpg";
  return `${name || "recipe-image"}${ext}`;
}

function readPositiveIntegerEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
