const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getEnvNumber(name, fallback, min) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (min !== undefined && parsed < min) return min;
  return parsed;
}

function getCommonConfig() {
  return {
    searchInputTimeoutMs:  getEnvNumber("BOT_SEARCH_INPUT_TIMEOUT_MS",  10000, 500),
    navigationTimeoutMs:   getEnvNumber("BOT_NAV_TIMEOUT_MS",           30000, 1000),
    pageLoadWaitMs:        getEnvNumber("BOT_PAGE_LOAD_WAIT_MS",          300, 200),
    actionDelayMs:         getEnvNumber("BOT_ACTION_DELAY_MS",            120, 100),
  };
}

async function typeLikeHuman(locator, text, cfg = {}) {
  await locator.click();
  await locator.fill("");
  const min = cfg.typeDelayMin ?? 90;
  const max = cfg.typeDelayMax ?? 180;
  for (const ch of text) {
    const delay = min + Math.floor(Math.random() * (max - min + 1));
    await locator.type(ch, { delay });
  }
}

async function scrollDown(page, amount = 850) {
  const variance = amount * 0.3;
  const randomAmount = amount + (Math.random() - 0.5) * 2 * variance;
  if (Math.random() < 0.1) {
    await page.mouse.wheel(0, -Math.random() * 100);
    await sleep(200);
  }
  await page.mouse.wheel(0, randomAmount);
}

async function scrollUntil(page, checkFn, opts = {}) {
  const max = opts.max ?? 100;
  let distance = opts.distance ?? 850;
  const delay = opts.delay ?? 700;
  const stallLimit = opts.stallLimit ?? 5;
  const minDelta = opts.minDelta ?? 20;
  let stallCount = 0;

  const getScrollMetrics = () =>
    page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement || document.body;
      return { y: window.scrollY, height: el.scrollHeight, viewport: window.innerHeight };
    });

  let prev = await getScrollMetrics();

  for (let i = 0; i < max; i++) {
    if (await checkFn()) return true;
    await scrollDown(page, distance);
    await sleep(delay);
    const curr = await getScrollMetrics();
    if (Math.abs(curr.y - prev.y) < minDelta) {
      stallCount++;
      if (stallCount >= stallLimit) break;
    } else {
      stallCount = 0;
    }
    prev = curr;
  }
  return false;
}

async function isTextVisible(page, text, opts = {}) {
  try {
    const loc = page.getByText(text, { exact: opts.exact ?? false });
    return await loc.first().isVisible({ timeout: opts.timeout ?? 3000 });
  } catch {
    return false;
  }
}

async function findFirstVisibleLocator(page, selectors, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 500 })) return loc;
      } catch { /* continue */ }
    }
    await sleep(300);
  }
  return null;
}

async function isLocatorInteractable(locator, page) {
  const visible = await locator.isVisible({ timeout: 400 }).catch(() => false);
  if (!visible) return false;

  const box = await locator.boundingBox().catch(() => null);
  if (!box) return false;

  const viewport = page.viewportSize() || { width: 0, height: 0 };
  if (!viewport.width || !viewport.height) return false;

  const inViewport =
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width > 0 &&
    box.y + box.height > 0 &&
    box.x < viewport.width &&
    box.y < viewport.height;

  if (!inViewport) return false;

  const handle = await locator.elementHandle().catch(() => null);
  if (!handle) return false;

  return handle.evaluate((el) => {
    const style = window.getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (style.opacity === "0") return false;
    if (style.pointerEvents === "none") return false;
    if (el.disabled) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);

    return topElement === el || el.contains(topElement);
  }).catch(() => false);
}

async function findInteractableLocator(page, selectors, timeoutMs = 5000, options = {}) {
  const deadline = Date.now() + timeoutMs;
  const requiredTextPattern = options.requiredTextPattern || /찜하기|찜해제|찜취소/;
  const excludedTextPattern = options.excludedTextPattern || /찜목록|찜한\s*상품|찜한\s*목록/;
  const excludedAncestorPattern = options.excludedAncestorPattern || /header|gnb|global|utility|menu|nav|top/;

  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const candidates = page.locator(sel);
        const count = await candidates.count().catch(() => 0);

        for (let index = 0; index < count; index++) {
          const candidate = candidates.nth(index);
          if (!(await isLocatorInteractable(candidate, page))) continue;

          const handle = await candidate.elementHandle().catch(() => null);
          if (!handle) continue;

          const matched = await handle.evaluate(
            (el, rules) => {
              const pieces = [el.textContent, el.getAttribute("aria-label"), el.getAttribute("title")]
                .filter(Boolean)
                .map((value) => String(value).replace(/\s+/g, " ").trim());

              const signature = pieces.join(" ");
              if (!rules.requiredTextPattern.test(signature)) return false;
              if (rules.excludedTextPattern.test(signature)) return false;

              let node = el;
              for (let depth = 0; depth < 5 && node; depth += 1, node = node.parentElement) {
                const tagName = (node.tagName || "").toLowerCase();
                const id = (node.id || "").toLowerCase();
                const className = String(node.className || "").toLowerCase();

                if (tagName === "header" || tagName === "nav" || tagName === "aside") return false;
                if (rules.excludedAncestorPattern.test(id) || rules.excludedAncestorPattern.test(className)) {
                  return false;
                }
              }

              return true;
            },
            {
              requiredTextPattern,
              excludedTextPattern,
              excludedAncestorPattern,
            },
          ).catch(() => false);

          if (matched) return candidate;
        }
      } catch {
        // continue
      }
    }

    await sleep(300);
  }

  return null;
}

async function isLocatorInViewport(locator, page, padding = 8) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return false;

  const viewport = page.viewportSize() || { width: 0, height: 0 };
  if (!viewport.width || !viewport.height) return false;

  const boxRight = box.x + box.width;
  const boxBottom = box.y + box.height;

  return (
    box.width > 0 &&
    box.height > 0 &&
    boxRight > padding &&
    boxBottom > padding &&
    box.x < viewport.width - padding &&
    box.y < viewport.height - padding
  );
}

async function findVisibleLocator(page, selectors, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const candidates = page.locator(sel);
        const count = await candidates.count().catch(() => 0);

        for (let index = 0; index < count; index++) {
          const candidate = candidates.nth(index);
          if (await isLocatorInViewport(candidate, page)) return candidate;
        }
      } catch { /* continue */ }
    }
    await sleep(300);
  }
  return null;
}

function createLogger(tag) {
  const prefix = `[${tag}]`;
  return {
    log:   (...a) => console.log(prefix, ...a),
    warn:  (...a) => console.warn(prefix, ...a),
    error: (...a) => console.error(prefix, ...a),
    debug: (...a) => {
      if (process.env.BOT_DEBUG === "1") console.log(`${prefix}[DEBUG]`, ...a);
    },
  };
}

module.exports = {
  sleep,
  getEnvNumber,
  getCommonConfig,
  typeLikeHuman,
  scrollDown,
  scrollUntil,
  isTextVisible,
  findFirstVisibleLocator,
  isLocatorInViewport,
  isLocatorInteractable,
  findInteractableLocator,
  findVisibleLocator,
  createLogger,
};
