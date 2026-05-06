/**
 * navigate4Alert.js
 *
 * context.changedItems 를 기반으로 알림을 발생시킵니다.
 * - 콘솔 출력 (항상)
 * - DB alert_log 기록 (항상)
 * - 추후 외부 알림 (카카오톡, Slack 등) 확장 가능
 */

const { createLogger } = require("./utils");
const { insertAlertLog } = require("../db");

//---------
const ALERT_TYPE_LABEL = {
  price_drop: "가격 인하",
  restocked:  "재입고",
  sold_out:   "품절",
  new_item:   "신규 등록",
};
//---------

async function navigate4Alert({ profileId, context }) {
  const logger = createLogger("navigate4");

  const changedItems = context?.changedItems ?? [];

  if (changedItems.length === 0) {
    logger.log("알림 대상 없음");
    return { alertsFired: 0 };
  }

  logger.log(`알림 발생: ${changedItems.length}건`);

  for (const item of changedItems) {
    const { itemId, itemName, alertType, oldPrice, newPrice, isAvailable } = item;

    const label = ALERT_TYPE_LABEL[alertType] || alertType;
    const priceInfo =
      oldPrice !== null && newPrice !== null
        ? ` | ${oldPrice.toLocaleString()}원 → ${newPrice.toLocaleString()}원`
        : newPrice !== null
        ? ` | 현재가: ${newPrice.toLocaleString()}원`
        : "";
    const note = `available=${isAvailable}`;

    //-- 콘솔 알림 --
    logger.log(`[${label}] ${itemName ?? itemId}${priceInfo}`);

    //-- DB 기록 --
    insertAlertLog({
      profileId,
      itemId,
      itemName,
      alertType,
      oldPrice,
      newPrice,
      note,
    });
  }

  if (context) context.alertsFired = changedItems.length;

  return { alertsFired: changedItems.length };
}

module.exports = navigate4Alert;
