/**
 * navigate3CheckPriceChange.js
 *
 * DB에 저장된 위시리스트 아이템 각각의 현재 가격/재고를 확인하고
 * price_history에 기록합니다.
 * 변동이 있는 아이템은 context.changedItems 에 담습니다.
 */

const { sleep, getCommonConfig, createLogger } = require("./utils");
const { getWishItems, insertPriceHistory, getLastPrice, getBotConfig } = require("../db");

//---------
const PRICE_SELECTOR = [
  "strong[class*='price']",
  "em[class*='price']",
  "span[class*='price']",
  ".product_price strong",
  "#P_PRICE",
].join(", ");

const SOLDOUT_TEXTS = ["품절", "일시품절", "판매중단"];
//---------

async function navigate3CheckPriceChange({ page, profileId, context }) {
  const logger = createLogger("navigate3");
  const cfg = getCommonConfig();
  const botConfig = getBotConfig(profileId);
  const thresholdPct = botConfig?.alert_threshold_pct ?? 0;

  const items = getWishItems(profileId);
  logger.log(`가격 체크 대상: ${items.length}개`);

  const changedItems = [];

  for (const item of items) {
    const { item_id: itemId, item_name: itemName, item_url: itemUrl } = item;

    if (!itemUrl) {
      logger.debug(`[${itemId}] URL 없음, 스킵`);
      continue;
    }

    try {
      logger.debug(`[${itemId}] 페이지 이동: ${itemUrl}`);
      await page.goto(itemUrl, { waitUntil: "domcontentloaded", timeout: cfg.navigationTimeoutMs });
      await sleep(cfg.pageLoadWaitMs);

      //-- 품절 여부 확인 --
      const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
      const isSoldOut = SOLDOUT_TEXTS.some((t) => bodyText.includes(t));

      //-- 가격 파싱 --
      let currentPrice = null;

      if (!isSoldOut) {
        const priceEl = page.locator(PRICE_SELECTOR).first();
        const priceVisible = await priceEl.isVisible({ timeout: 3000 }).catch(() => false);

        if (priceVisible) {
          const raw = (await priceEl.textContent().catch(() => "")) || "";
          // 숫자만 추출 (예: "1,234원" → 1234)
          const parsed = parseInt(raw.replace(/[^0-9]/g, ""), 10);
          if (!isNaN(parsed)) currentPrice = parsed;
        }
      }

      //-- 이전 가격과 비교 --
      const last = getLastPrice(profileId, itemId);
      const lastPrice = last?.price ?? null;
      const lastAvailable = last ? Boolean(last.is_available) : true;
      const isAvailable = !isSoldOut;

      insertPriceHistory({ profileId, itemId, price: currentPrice, isAvailable });

      //-- 변동 감지 --
      const priceChanged =
        lastPrice !== null &&
        currentPrice !== null &&
        lastPrice !== currentPrice;

      const priceDrop =
        priceChanged &&
        currentPrice < lastPrice &&
        (thresholdPct === 0 || (lastPrice - currentPrice) / lastPrice * 100 >= thresholdPct);

      const restocked = !lastAvailable && isAvailable;
      const soldOut   = lastAvailable && !isAvailable;

      if (priceDrop || restocked || soldOut || (last === null && currentPrice !== null)) {
        changedItems.push({
          itemId,
          itemName,
          itemUrl,
          alertType: soldOut ? "sold_out" : restocked ? "restocked" : "price_drop",
          oldPrice: lastPrice,
          newPrice: currentPrice,
          isAvailable,
        });
        logger.log(`변동 감지 [${itemId}] ${itemName} | ${lastPrice} → ${currentPrice} | available=${isAvailable}`);
      } else {
        logger.debug(`변동 없음 [${itemId}]`);
      }

    } catch (err) {
      logger.warn(`[${itemId}] 체크 오류: ${err.message}`);
    }

    await sleep(cfg.actionDelayMs);
  }

  logger.log(`가격 체크 완료 | 변동: ${changedItems.length}개`);

  if (context) {
    context.changedItems   = changedItems;
    context.itemsChecked   = items.length;
  }

  return changedItems;
}

module.exports = navigate3CheckPriceChange;
