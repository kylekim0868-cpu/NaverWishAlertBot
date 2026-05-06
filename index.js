const config = require("./config");
const fs = require("fs");
const { chromium } = require("playwright-core");
const { join } = require("path");
const { homedir } = require("os");
const runMain = require("./main");
const { createLogger } = require("./navigates/utils");
const { insertRun, getBotConfig, markAccountBlocked, isAccountBlocked } = require("./db");

//---------------------------------------------------------------------------------------
// Chrome 실행 경로 탐색
//---------------------------------------------------------------------------------------
function getChromiumPath() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(homedir(), "AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const executablePath = getChromiumPath();

//---------------------------------------------------------------------------------------
// 로그인된 Chrome 프로필 런처
//---------------------------------------------------------------------------------------
async function launchLoggedInChrome(profileId) {
  const profilePath = join(config.chromeProfileDir, profileId);

  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath,
    headless: config.headless,
    args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-background-timer-throttling",
          "--disable-popup-blocking",
          "--disable-features=TranslateUI,IsolateOrigins,site-per-process",
          "--disable-site-isolation-trials",
          "--disable-web-security",
          "--no-first-run",
          "--disable-session-crashed-bubble",
          "--no-default-browser-check",
          "--disable-infobars",
          "--hide-crash-restore-bubble",
          "--disable-blink-features=AutomationControlled"
    ],
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/",
  });

  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

//---------------------------------------------------------------------------------------
// startup
//---------------------------------------------------------------------------------------
(async () => {
  const logger = createLogger("index");

  if (!executablePath) {
    logger.error("Chrome executable을 찾을 수 없습니다.");
    logger.error("Google Chrome을 설치하거나 getChromiumPath()를 환경에 맞게 수정하세요.");
    process.exit(1);
  }

  //---------------------------------------------------------------------------------------
  // 프로필 목록 결정
  // NAVER_ID 지정 시 해당 계정만, 미지정 시 Chrome-Profile 폴더 전체 순차 실행
  //---------------------------------------------------------------------------------------
  let profiles = [];
  if (process.env.NAVER_ID) {
    profiles = [process.env.NAVER_ID];
  } else {
    const profileDir = config.chromeProfileDir;
    try {
      profiles = fs
        .readdirSync(profileDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== "default")
        .map((d) => d.name);
    } catch {
      logger.error(`Chrome 프로필 폴더를 읽을 수 없습니다: ${profileDir}`);
      process.exit(1);
    }
    if (profiles.length === 0) {
      logger.error("실행 가능한 프로필이 없습니다. Chrome 프로필 폴더를 확인하세요.");
      process.exit(1);
    }
  }

  logger.log(`실행할 프로필 ${profiles.length}개: ${profiles.join(", ")}`);

  //---------------------------------------------------------------------------------------
  // 프로필별 순차 실행
  //---------------------------------------------------------------------------------------
  for (const profileId of profiles) {
    logger.log(`\n▶  [${profileId}] 봇 시작`);

    if (isAccountBlocked(profileId)) {
      logger.warn(`[${profileId}] 이전에 차단된 계정 — 건너뜁니다.`);
      continue;
    }

    //-- DB에서 봇 설정 로드 --
    const dbConfig = getBotConfig(profileId);
    if (dbConfig) {
      if (dbConfig.navigate)     process.env.BOT_NAVIGATE     = dbConfig.navigate;
      if (dbConfig.wishlist_url) process.env.BOT_WISHLIST_URL = dbConfig.wishlist_url;
      if (dbConfig.smartstore_url) process.env.BOT_SMARTSTORE_URL = dbConfig.smartstore_url;
      logger.log(
        `DB 설정 로드 — navigate=${dbConfig.navigate ?? "-"}, wishlist_url=${dbConfig.wishlist_url ?? "-"}, smartstore_url=${dbConfig.smartstore_url ?? "-"}, threshold=${dbConfig.alert_threshold_pct ?? 0}%`,
      );
    }

    //-- Chrome 실행 --
    let context, page;
    try {
      ({ context, page } = await launchLoggedInChrome(profileId));
      logger.log(`Chrome 시작 완료 — profile: ${profileId}`);
    } catch (err) {
      logger.error(`Chrome 실행 실패: ${err.message}`);
      continue;
    }

    //-- 봇 실행 --
    const result = await runMain({ page, profileId });

    //-- 실행 이력 저장 --
    insertRun({
      profileId,
      navigateMode:  process.env.BOT_NAVIGATE || "all",
      itemsChecked:  result?.context?.itemsChecked ?? 0,
      alertsFired:   result?.context?.alertsFired  ?? 0,
      success:       result?.success ?? false,
      note:          result?.note || null,
    });

    logger.log(
      `이력 저장 — ${profileId} | success=${result?.success} | items=${result?.context?.itemsChecked ?? 0} | alerts=${result?.context?.alertsFired ?? 0}`,
    );

    await context.close();
    logger.log(`✅ [${profileId}] 봇 완료`);
  }

  logger.log("모든 프로필 실행 완료");
})();
