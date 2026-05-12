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
const TMP_DIR = path.join(ROOT_DIR, ".recipe-generator-tmp");
const GENERATOR_SCRIPT = path.join(ROOT_DIR, "scripts", "generate-from-image.js");
const STATIC_GENERATOR_SCRIPT = path.join(ROOT_DIR, "scripts", "generate-recipe-pages.js");
const PORT = Number(process.env.PORT || 3100);
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_KEYWORD_GUIDANCE_CHARS = 1200;
const GENERATOR_TIMEOUT_MS = Number(process.env.GENERATOR_TIMEOUT_MS || 20 * 60 * 1000);
let generatorQueue = Promise.resolve();

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
        const result = await queueGenerator(tempPath, normalizeKeywordGuidance(upload.fields.keywordGuidance));
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

function runGenerator(imagePath, keywordGuidance) {
  return new Promise((resolve, reject) => {
    const args = [GENERATOR_SCRIPT, imagePath];
    if (keywordGuidance) {
      args.push("--keyword-guidance", keywordGuidance);
    }

    execFile(
      process.execPath,
      args,
      {
        cwd: ROOT_DIR,
        timeout: GENERATOR_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 4,
      },
      (error, stdout, stderr) => {
        const combinedOutput = `${stdout || ""}${stderr ? `\n${stderr}` : ""}`.trim();

        if (error) {
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
          output: combinedOutput,
        });
      }
    );
  });
}

function queueGenerator(imagePath, keywordGuidance) {
  const queuedRun = generatorQueue.then(
    () => runGenerator(imagePath, keywordGuidance),
    () => runGenerator(imagePath, keywordGuidance)
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
