/**
 * seedConfig.js
 *
 * 환경별 Chrome 프로필 폴더의 하위 폴더명을 profile_id로 사용해서
 * SQLite bot_config 테이블에 일괄 주입합니다.
 *
 * 사용법:
 *   node seedConfig.js
 */

const fs = require("fs");
const { join } = require("path");
const config = require("./config");
const { upsertBotConfig, getBotConfig } = require("./db");

//--------- 주입할 설정값 ---------
// .env.development 또는 .env.production 파일에서 읽어옵니다.
// 직접 덮어쓰고 싶을 때만 아래 값을 변경하세요.

const NAVIGATE            = config.botNavigate;
const WISHLIST_URL        = config.wishlistUrl;
const SMARTSTORE_URL      = config.smartstoreUrl;
const ALERT_THRESHOLD_PCT = config.alertThresholdPct;

const PROFILE_DIR = config.chromeProfileDir;

function listProfileIds() {
  if (!fs.existsSync(PROFILE_DIR)) {
    throw new Error(`Chrome 프로필 폴더를 찾을 수 없습니다: ${PROFILE_DIR}`);
  }

  return fs
    .readdirSync(PROFILE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name !== "default")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
}

//---------------------------------

const profileIds = listProfileIds();
console.log(`[seedConfig] profile count: ${profileIds.length}`);

for (const profileId of profileIds) {
  upsertBotConfig({
    profileId,
    navigate:           NAVIGATE,
    wishlistUrl:        WISHLIST_URL,
    smartstoreUrl:      SMARTSTORE_URL,
    alertThresholdPct:  ALERT_THRESHOLD_PCT,
  });

  const saved = getBotConfig(profileId);
  console.log(
    `[seedConfig] saved: ${saved.profile_id} | navigate=${saved.navigate} | wishlist=${saved.wishlist_url} | smartstore=${saved.smartstore_url} | threshold=${saved.alert_threshold_pct}%`,
  );
}

console.log(`[seedConfig] done: ${profileIds.length} rows seeded`);
