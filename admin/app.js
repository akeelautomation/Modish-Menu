const panels = document.querySelectorAll("[data-panel]");
const navItems = document.querySelectorAll("[data-panel-target]");
const serverState = document.querySelector("#serverState");
const refreshAuditButton = document.querySelector("#refreshAuditButton");
const regenerateButton = document.querySelector("#regenerateButton");
const actionLog = document.querySelector("#actionLog");
const recipeSelect = document.querySelector("#recipeSelect");
const recipeEditorForm = document.querySelector("#recipeEditorForm");
const deleteRecipeButton = document.querySelector("#deleteRecipeButton");
const openRecipeButton = document.querySelector("#openRecipeButton");
const recipeEditorStatus = document.querySelector("#recipeEditorStatus");

const form = document.querySelector("#uploadForm");
const imageInput = document.querySelector("#imageInput");
const keywordGuidanceInput = document.querySelector("#keywordGuidance");
const dropzone = document.querySelector(".dropzone");
const previewWrap = document.querySelector("#previewWrap");
const statusEl = document.querySelector("#status");
const submitButton = document.querySelector("#submitButton");
const clearButton = document.querySelector("#clearButton");
const summary = document.querySelector("#summary");
const queueList = document.querySelector("#queueList");

const publisherIdInput = document.querySelector("#publisherId");
const adClientIdInput = document.querySelector("#adClientId");
const leaderboardSlotInput = document.querySelector("#leaderboardSlot");
const rectangleSlotInput = document.querySelector("#rectangleSlot");
const saveAdsenseSettingsButton = document.querySelector("#saveAdsenseSettings");
const copyAdsenseSnippetButton = document.querySelector("#copyAdsenseSnippet");
const copyAdsTxtButton = document.querySelector("#copyAdsTxt");
const adsenseSnippet = document.querySelector("#adsenseSnippet");

const PROCESS_DELAY_MS = 5000;
const FAILED_ITEM_RETRY_DELAY_MS = 30000;
const MAX_ITEM_ATTEMPTS = 2;
const KEYWORD_GUIDANCE_STORAGE_KEY = "modishMenu.keywordGuidance";
const ADSENSE_SETTINGS_KEY = "modishMenu.adsenseSettings";

let queuedFiles = [];
let previewUrls = [];
let isProcessing = false;
let editableRecipes = [];
let selectedRecipeSlug = "";

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const target = item.dataset.panelTarget;
    navItems.forEach((navItem) => navItem.classList.toggle("is-active", navItem === item));
    panels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === target));
  });
});

refreshAuditButton?.addEventListener("click", loadAudit);
regenerateButton?.addEventListener("click", regenerateStaticPages);
recipeSelect?.addEventListener("change", () => selectRecipe(recipeSelect.value));
recipeEditorForm?.addEventListener("submit", saveSelectedRecipe);
deleteRecipeButton?.addEventListener("click", deleteSelectedRecipe);

keywordGuidanceInput.value = localStorage.getItem(KEYWORD_GUIDANCE_STORAGE_KEY) || "";
keywordGuidanceInput.addEventListener("input", () => {
  localStorage.setItem(KEYWORD_GUIDANCE_STORAGE_KEY, keywordGuidanceInput.value);
});

const savedAdsenseSettings = JSON.parse(localStorage.getItem(ADSENSE_SETTINGS_KEY) || "{}");
publisherIdInput.value = savedAdsenseSettings.publisherId || "";
adClientIdInput.value = savedAdsenseSettings.adClientId || "";
leaderboardSlotInput.value = savedAdsenseSettings.leaderboardSlot || "";
rectangleSlotInput.value = savedAdsenseSettings.rectangleSlot || "";

[publisherIdInput, adClientIdInput, leaderboardSlotInput, rectangleSlotInput].forEach((input) => {
  input.addEventListener("input", renderAdsenseSnippet);
});

saveAdsenseSettingsButton.addEventListener("click", () => {
  localStorage.setItem(ADSENSE_SETTINGS_KEY, JSON.stringify(getAdsenseSettings()));
  saveAdsenseSettingsButton.textContent = "Saved";
  setTimeout(() => {
    saveAdsenseSettingsButton.textContent = "Save Locally";
  }, 900);
});

copyAdsenseSnippetButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(adsenseSnippet.textContent || "");
  flashButton(copyAdsenseSnippetButton, "Copied");
});

copyAdsTxtButton.addEventListener("click", async () => {
  const { publisherId } = getAdsenseSettings();
  const line = publisherId
    ? `google.com, ${publisherId}, DIRECT, f08c47fec0942fa0`
    : "Enter a real pub- publisher ID first.";
  await navigator.clipboard.writeText(line);
  flashButton(copyAdsTxtButton, "Copied");
});

imageInput.addEventListener("change", () => {
  setQueuedFiles(Array.from(imageInput.files || []));
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragging");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");

  const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
  setQueuedFiles(files);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!queuedFiles.length) {
    setStatus("Choose one or more images first.", "error");
    return;
  }

  isProcessing = true;
  const keywordGuidance = keywordGuidanceInput.value.trim();
  setLoading(true);
  summary.textContent = `Processing 0 of ${queuedFiles.length}. Each image runs one at a time.`;
  summary.classList.remove("empty");

  let completed = 0;
  let failed = 0;

  for (let index = 0; index < queuedFiles.length; index += 1) {
    const file = queuedFiles[index];
    const row = queueList.querySelector(`[data-index="${index}"]`);

    updateQueueRow(row, {
      state: "loading",
      status: `Processing ${index + 1} of ${queuedFiles.length}...`,
    });
    setStatus(`Generating ${index + 1} of ${queuedFiles.length}: ${file.name}`, "loading");

    try {
      const result = await generateRecipeWithRetry(file, row, index, queuedFiles.length, keywordGuidance);
      completed += 1;
      updateQueueRow(row, {
        state: "success",
        status: "Done",
        result,
      });
    } catch (error) {
      failed += 1;
      updateQueueRow(row, {
        state: "error",
        status: "Failed",
        error: error.message || "Recipe generation failed.",
      });
    }

    summary.textContent = `Completed ${completed} of ${queuedFiles.length}. Failed ${failed}.`;

    if (index < queuedFiles.length - 1) {
      setStatus("Moving to the next image. Backend pacing only slows down after provider errors.", "loading");
      await sleep(PROCESS_DELAY_MS);
    }
  }

  isProcessing = false;
  setLoading(false);
  setStatus(`Batch finished. ${completed} done, ${failed} failed.`, failed ? "error" : "success");
  loadAudit();
});

clearButton.addEventListener("click", () => {
  if (isProcessing) {
    setStatus("Batch is running. Wait for it to finish before clearing.", "error");
    return;
  }

  imageInput.value = "";
  queuedFiles = [];
  renderQueue();
  summary.textContent = "Generated recipe pages, R2 image URLs, and run logs will appear here.";
  summary.classList.add("empty");
  setStatus("", "");
});

renderAdsenseSnippet();
loadAudit();
loadRecipes();

async function loadAudit() {
  refreshAuditButton.disabled = true;
  serverState.textContent = "Checking";

  try {
    const response = await fetch("/api/admin-summary");
    const audit = await response.json();
    if (!response.ok) {
      throw new Error(audit.error || "Unable to load admin summary.");
    }
    renderAudit(audit);
    serverState.textContent = "Online";
  } catch (error) {
    serverState.textContent = "Offline";
    renderError(error.message || "Unable to load admin summary.");
  } finally {
    refreshAuditButton.disabled = false;
  }
}

function renderAudit(audit) {
  setText("#recipeCount", audit.recipes.total);
  setText("#generatedPageCount", `${audit.recipes.generatedPages} static recipe pages`);
  setText("#categoryCount", audit.recipes.categories.length);
  setText("#policyScore", `${audit.policyPages.filter((page) => page.exists).length}/${audit.policyPages.length}`);
  setText("#adSlotCount", audit.ads.totalSlots);

  renderReadiness(audit.readiness);
  renderCategoryBars(audit.recipes.categories);
  renderRecentRecipes(audit.recipes.recent);
  renderSeoAssets(audit.seoAssets);
  renderSchemaSummary(audit.schema);
  renderEnvironmentList(audit.environment);
}

async function loadRecipes(preferredSlug = selectedRecipeSlug) {
  if (!recipeSelect) return;

  recipeSelect.disabled = true;
  recipeSelect.innerHTML = `<option value="">Loading recipes...</option>`;

  try {
    const response = await fetch("/api/recipes");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to load recipes.");
    }

    editableRecipes = data.recipes || [];
    recipeSelect.textContent = "";

    if (!editableRecipes.length) {
      recipeSelect.innerHTML = `<option value="">No recipes found</option>`;
      recipeEditorForm.hidden = true;
      return;
    }

    editableRecipes.forEach((recipe) => {
      const option = document.createElement("option");
      option.value = recipe.slug;
      option.textContent = `${recipe.title} (${recipe.slug})`;
      recipeSelect.appendChild(option);
    });

    const nextSlug = editableRecipes.some((recipe) => recipe.slug === preferredSlug)
      ? preferredSlug
      : editableRecipes[0].slug;
    recipeSelect.value = nextSlug;
    selectRecipe(nextSlug);
  } catch (error) {
    recipeSelect.innerHTML = `<option value="">Recipe loading failed</option>`;
    setRecipeEditorStatus(error.message || "Unable to load recipes.", "error");
  } finally {
    recipeSelect.disabled = false;
  }
}

function selectRecipe(slug) {
  const recipe = editableRecipes.find((item) => item.slug === slug);
  selectedRecipeSlug = slug;

  if (!recipe) {
    recipeEditorForm.hidden = true;
    return;
  }

  recipeEditorForm.hidden = false;
  setValue("#editTitle", recipe.title);
  setValue("#editCategory", recipe.category);
  setValue("#editPrepTime", recipe.prepTime);
  setValue("#editCookTime", recipe.cookTime);
  setValue("#editServings", recipe.servings);
  setValue("#editDifficulty", recipe.difficulty);
  setValue("#editDescription", recipe.description);
  setValue("#editImage", recipe.image);
  setValue("#editAlt", recipe.alt);
  setValue("#editCalories", recipe.nutrition?.calories);
  setValue("#editProtein", recipe.nutrition?.protein);
  setValue("#editCarbs", recipe.nutrition?.carbs);
  setValue("#editFat", recipe.nutrition?.fat);
  setValue("#editIngredients", (recipe.ingredients || []).join("\n"));
  setValue("#editInstructions", (recipe.instructions || []).join("\n"));
  setValue("#editRelated", (recipe.related || []).join("\n"));
  openRecipeButton.href = `/site/recipes/${recipe.slug}.html`;
  setRecipeEditorStatus("", "");
}

async function saveSelectedRecipe(event) {
  event.preventDefault();

  if (!selectedRecipeSlug) return;

  setRecipeEditorLoading(true);
  setRecipeEditorStatus("Saving recipe and regenerating static pages...", "loading");

  try {
    const response = await fetch(`/api/recipes/${encodeURIComponent(selectedRecipeSlug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readRecipeEditorForm()),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Recipe save failed.");
    }

    setRecipeEditorStatus("Recipe saved. Static pages regenerated.", "success");
    await loadAudit();
    await loadRecipes(selectedRecipeSlug);
  } catch (error) {
    setRecipeEditorStatus(error.message || "Recipe save failed.", "error");
  } finally {
    setRecipeEditorLoading(false);
  }
}

async function deleteSelectedRecipe() {
  if (!selectedRecipeSlug) return;

  const recipe = editableRecipes.find((item) => item.slug === selectedRecipeSlug);
  const confirmed = window.confirm(`Delete "${recipe?.title || selectedRecipeSlug}"? This removes it from the catalog and regenerates the site.`);
  if (!confirmed) return;

  setRecipeEditorLoading(true);
  setRecipeEditorStatus("Deleting recipe and regenerating static pages...", "loading");

  try {
    const response = await fetch(`/api/recipes/${encodeURIComponent(selectedRecipeSlug)}`, {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Recipe delete failed.");
    }

    setRecipeEditorStatus("Recipe deleted. Static pages regenerated.", "success");
    selectedRecipeSlug = "";
    await loadAudit();
    await loadRecipes();
  } catch (error) {
    setRecipeEditorStatus(error.message || "Recipe delete failed.", "error");
  } finally {
    setRecipeEditorLoading(false);
  }
}

function readRecipeEditorForm() {
  return {
    title: getValue("#editTitle"),
    category: getValue("#editCategory"),
    prepTime: getValue("#editPrepTime"),
    cookTime: getValue("#editCookTime"),
    servings: getValue("#editServings"),
    difficulty: getValue("#editDifficulty"),
    description: getValue("#editDescription"),
    image: getValue("#editImage"),
    alt: getValue("#editAlt"),
    nutrition: {
      calories: getValue("#editCalories"),
      protein: getValue("#editProtein"),
      carbs: getValue("#editCarbs"),
      fat: getValue("#editFat"),
    },
    ingredients: getLines("#editIngredients"),
    instructions: getLines("#editInstructions"),
    related: getLines("#editRelated"),
  };
}

function renderReadiness(items) {
  const list = document.querySelector("#readinessList");
  const badge = document.querySelector("#readinessBadge");
  list.textContent = "";

  items.forEach((item) => list.appendChild(createCheckItem(item)));

  const failures = items.filter((item) => item.state === "fail").length;
  const warnings = items.filter((item) => item.state === "warn").length;
  badge.className = `badge ${failures ? "warn" : "good"}`;
  badge.textContent = failures ? `${failures} blockers` : warnings ? `${warnings} warnings` : "Ready for review";
}

function renderCategoryBars(categories) {
  const list = document.querySelector("#categoryBars");
  list.textContent = "";
  const max = Math.max(...categories.map((category) => category.count), 1);

  categories.forEach((category) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-top">
        <span>${escapeHtml(category.name)}</span>
        <span>${category.count}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width: ${(category.count / max) * 100}%"></div></div>
    `;
    list.appendChild(row);
  });
}

function renderRecentRecipes(recipes) {
  const list = document.querySelector("#recentRecipes");
  list.textContent = "";

  if (!recipes.length) {
    list.appendChild(createTextItem("No generated recipe files found.", "Run the generator to create static pages."));
    return;
  }

  recipes.forEach((recipe) => {
    const item = document.createElement("a");
    item.className = "file-item";
    item.href = `/site/${recipe.path}`;
    item.target = "_blank";
    item.rel = "noreferrer";
    item.innerHTML = `<strong>${escapeHtml(recipe.title || recipe.path)}</strong><small>${escapeHtml(recipe.path)} - ${escapeHtml(recipe.modified)}</small>`;
    list.appendChild(item);
  });
}

function renderSeoAssets(items) {
  const list = document.querySelector("#seoAssets");
  list.textContent = "";
  items.forEach((item) => list.appendChild(createCheckItem(item)));
}

function renderSchemaSummary(schema) {
  const list = document.querySelector("#schemaSummary");
  list.textContent = "";
  [
    { title: "Recipe JSON-LD pages", detail: `${schema.recipeJsonLdPages} of ${schema.generatedRecipePages} generated pages include recipe schema.` },
    { title: "Canonical pages", detail: `${schema.canonicalPages} of ${schema.generatedRecipePages} generated pages include canonical links.` },
    { title: "Open Graph pages", detail: `${schema.openGraphPages} of ${schema.generatedRecipePages} generated pages include share metadata.` },
  ].forEach((row) => {
    const item = document.createElement("div");
    item.className = "schema-row";
    item.innerHTML = `<strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.detail)}</small>`;
    list.appendChild(item);
  });
}

function renderEnvironmentList(items) {
  const list = document.querySelector("#environmentList");
  list.textContent = "";
  items.forEach((item) => list.appendChild(createCheckItem(item)));
}

function createCheckItem(item) {
  const element = document.createElement("div");
  element.className = "check-item";
  element.dataset.state = item.state;
  element.innerHTML = `<strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small>`;
  return element;
}

function createTextItem(title, detail) {
  const element = document.createElement("div");
  element.className = "file-item";
  element.innerHTML = `<strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small>`;
  return element;
}

function renderError(message) {
  const list = document.querySelector("#readinessList");
  list.textContent = "";
  list.appendChild(createCheckItem({ state: "fail", title: "Audit failed", detail: message }));
}

async function regenerateStaticPages() {
  regenerateButton.disabled = true;
  actionLog.hidden = false;
  actionLog.textContent = "Regenerating recipe pages, recipe directory, and homepage cards...";

  try {
    const response = await fetch("/api/regenerate-site", { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Regeneration failed.");
    }
    actionLog.textContent = data.output || "Static pages regenerated.";
    await loadAudit();
  } catch (error) {
    actionLog.textContent = error.message || "Regeneration failed.";
  } finally {
    regenerateButton.disabled = false;
  }
}

function renderQueue() {
  revokePreviewUrls();
  queueList.textContent = "";

  if (!queuedFiles.length) {
    previewWrap.hidden = true;
    queueList.hidden = true;
    return;
  }

  previewWrap.hidden = false;
  queueList.hidden = false;

  queuedFiles.forEach((file, index) => {
    const previewUrl = URL.createObjectURL(file);
    previewUrls.push(previewUrl);

    const preview = document.createElement("div");
    const previewImage = document.createElement("img");
    const previewName = document.createElement("span");
    previewImage.src = previewUrl;
    previewImage.alt = file.name;
    previewName.textContent = file.name;
    preview.append(previewImage, previewName);
    previewWrap.appendChild(preview);

    queueList.appendChild(createQueueRow({ file, index, previewUrl }));
  });

  summary.textContent = `${queuedFiles.length} image${queuedFiles.length === 1 ? "" : "s"} queued.`;
  summary.classList.remove("empty");
}

function setQueuedFiles(files) {
  if (isProcessing) {
    setStatus("Batch is running. Wait for it to finish before changing the queue.", "error");
    return;
  }

  queuedFiles = files;
  renderQueue();
}

function createQueueRow({ file, index, previewUrl }) {
  const row = document.createElement("article");
  row.className = "queue-row";
  row.dataset.index = String(index);
  row.dataset.state = "queued";

  row.innerHTML = `
    <img class="queue-thumb" src="${previewUrl}" alt="">
    <div class="queue-main">
      <div class="queue-topline">
        <h3>${escapeHtml(file.name)}</h3>
        <span class="queue-state">Queued</span>
      </div>
      <p class="queue-meta">${formatBytes(file.size)}</p>
      <div class="queue-links" hidden></div>
      <pre class="queue-log" hidden></pre>
    </div>
  `;

  return row;
}

async function generateRecipe(file, keywordGuidance) {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("keywordGuidance", keywordGuidance);

  const response = await fetch("/api/generate-recipe", {
    method: "POST",
    body: formData,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Recipe generation failed.");
  }

  return data;
}

async function generateRecipeWithRetry(file, row, index, total, keywordGuidance) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ITEM_ATTEMPTS; attempt += 1) {
    try {
      updateQueueRow(row, {
        state: "loading",
        status: `Processing ${index + 1} of ${total} - attempt ${attempt}/${MAX_ITEM_ATTEMPTS}`,
      });
      return await generateRecipe(file, keywordGuidance);
    } catch (error) {
      lastError = error;

      if (attempt < MAX_ITEM_ATTEMPTS) {
        updateQueueRow(row, {
          state: "loading",
          status: `Retrying in ${Math.round(FAILED_ITEM_RETRY_DELAY_MS / 1000)}s`,
        });
        await sleep(FAILED_ITEM_RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

function updateQueueRow(row, { state, status, result, error }) {
  if (!row) return;

  row.dataset.state = state;
  row.querySelector(".queue-state").textContent = status;

  const links = row.querySelector(".queue-links");
  const log = row.querySelector(".queue-log");

  if (result) {
    links.hidden = false;
    links.innerHTML = `
      <a href="${escapeHtml(toSitePreviewUrl(result.pageUrl) || "#")}" target="_blank" rel="noreferrer">${escapeHtml(
        result.title || result.pagePath || "Recipe page"
      )}</a>
      <a href="/site/" target="_blank" rel="noreferrer">Homepage</a>
      <a href="${escapeHtml(result.uploadedImageUrl || "#")}" target="_blank" rel="noreferrer">R2 image</a>
      <button class="copy copy-row-log" type="button">Copy Log</button>
    `;
    log.hidden = false;
    log.textContent = result.output || "";
    links.querySelector(".copy-row-log").addEventListener("click", async (event) => {
      await navigator.clipboard.writeText(log.textContent || "");
      flashButton(event.currentTarget, "Copied");
    });
  }

  if (error) {
    log.hidden = false;
    log.textContent = error;
  }
}

function renderAdsenseSnippet() {
  const { adClientId, leaderboardSlot, rectangleSlot } = getAdsenseSettings();
  const client = adClientId || "ca-pub-0000000000000000";
  const leaderboard = leaderboardSlot || "LEADERBOARD_SLOT_ID";
  const rectangle = rectangleSlot || "RECTANGLE_SLOT_ID";

  adsenseSnippet.textContent = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>

<!-- Leaderboard -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="${client}"
     data-ad-slot="${leaderboard}"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>

<!-- In-content rectangle -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="${client}"
     data-ad-slot="${rectangle}"
     data-ad-format="rectangle"
     data-full-width-responsive="true"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`;
}

function getAdsenseSettings() {
  return {
    publisherId: publisherIdInput.value.trim(),
    adClientId: adClientIdInput.value.trim(),
    leaderboardSlot: leaderboardSlotInput.value.trim(),
    rectangleSlot: rectangleSlotInput.value.trim(),
  };
}

function setStatus(message, state) {
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}

function setRecipeEditorStatus(message, state) {
  recipeEditorStatus.textContent = message;
  recipeEditorStatus.dataset.state = state;
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  clearButton.disabled = isLoading;
  keywordGuidanceInput.disabled = isLoading;
  submitButton.textContent = isLoading ? "Batch Running..." : "Start Batch";
}

function setRecipeEditorLoading(isLoading) {
  recipeSelect.disabled = isLoading;
  recipeEditorForm.querySelectorAll("input, textarea, button").forEach((element) => {
    element.disabled = isLoading;
  });
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = String(value);
  }
}

function setValue(selector, value) {
  const element = document.querySelector(selector);
  if (element) {
    element.value = value || "";
  }
}

function getValue(selector) {
  return document.querySelector(selector)?.value.trim() || "";
}

function getLines(selector) {
  return getValue(selector)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSitePreviewUrl(value) {
  if (!value) {
    return "";
  }

  return `/site/${String(value).replace(/^\/+/, "")}`;
}

function revokePreviewUrls() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  previewWrap.textContent = "";
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function flashButton(button, text) {
  const original = button.textContent;
  button.textContent = text;
  setTimeout(() => {
    button.textContent = original;
  }, 900);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
