/**
 * navigate2CheckAlerts.js
 *
 * 위시리스트 페이지를 스캔하여 아이템 목록을 수집하고 DB에 저장합니다.
 * 수집 데이터: itemId, itemName, itemUrl
 */

const { sleep, scrollUntil, findInteractableLocator, getCommonConfig, createLogger, typeLikeHuman } = require("./utils");
const { upsertWishItem, getBotConfig } = require("../db");

//---------
const WISHLIST_ITEM_SELECTOR = 'li[data-nclick*="wish"]';
const LOGIN_CHECK_SELECTORS = [
  'a[href*="login"]',
  'a:has-text("로그인")',
  'button:has-text("로그인")',
];
const LOGIN_FORM_SELECTORS = {
  id: "#id",
  pw: "#pw",
  submit: 'button[type="submit"], button.btn_login, .btn_login',
  button: 'div[id="keep"]',
};
const ALERT_BUTTON_SELECTORS = [
  'button:has-text("알림받기")',
  'button:has-text("알림받는중")',
  'a:has-text("알림받기")',
  'a:has-text("알림받는중")',
  'button[aria-label*="알림받기"]',
  'button[aria-label*="알림받는중"]',
  'a[aria-label*="알림받기"]',
  'a[aria-label*="알림받는중"]',
  '[title*="알림받기"]',
  '[title*="알림받는중"]',
];

//---------

async function navigate2CheckAlerts({ page, profileId, context }) {
  const logger = createLogger("navigate2");
  const cfg = getCommonConfig();

  logger.log("알림받기 버튼 활성화 시작");

  //-- 1) 네이버 스마트스토어 회사 통합페이지 이동 --
  const botConfig = getBotConfig(profileId);
  const smartstoreUrl = botConfig?.smartstore_url;
  if (!smartstoreUrl) {
    throw new Error("smartstore_url 설정이 비어 있습니다. .env 또는 bot_config를 확인하세요.");
  }

  logger.log(`스마트스토어 페이지 이동: ${smartstoreUrl}`);
  await page.goto(smartstoreUrl, { waitUntil: "domcontentloaded", timeout: cfg.navigationTimeoutMs });
  await sleep(cfg.pageLoadWaitMs);

  //-- 2) 로그인 여부 확인 --
  //-- 2-1) 비로그인일 경우 로그인 시도 --
  const loginLink = page.locator(LOGIN_CHECK_SELECTORS.join(", ")).first();
  const loginVisible = await loginLink.isVisible({ timeout: 1200 }).catch(() => false);
  const isLoginRequired = loginVisible;

  if (isLoginRequired) {
    logger.warn("로그인이 필요합니다. 로그인 후 다음 단계로 진행합니다.");

    const loginId = process.env.NAVER_LOGIN_ID || process.env.NAVER_ID || "";
    const loginPassword = process.env.NAVER_LOGIN_PASSWORD || process.env.NAVER_PASSWORD || "";

    if (loginId && loginPassword) {
      // await loginLink.click().catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: cfg.navigationTimeoutMs }).catch(() => {});

      const idInput = page.locator(LOGIN_FORM_SELECTORS.id).first();
      const pwInput = page.locator(LOGIN_FORM_SELECTORS.pw).first();
      const submitButton = page.locator(LOGIN_FORM_SELECTORS.submit).first();
      const keepLoginButton = page.locator(LOGIN_FORM_SELECTORS.button).first();
      

      await typeLikeHuman(idInput, loginId);
      await sleep(cfg.pageLoadWaitMs);
      await typeLikeHuman(pwInput, loginPassword);
      await keepLoginButton.click( { timeout: cfg.navigationTimeoutMs }).catch(() => {});
      await sleep(cfg.actionDelayMs);
      await submitButton.click({ timeout: cfg.navigationTimeoutMs });
      await sleep(cfg.pageLoadWaitMs);
    } else {
      logger.warn("NAVER_LOGIN_ID / NAVER_LOGIN_PASSWORD가 없어 수동 로그인을 기다립니다.");
      await loginLink.waitFor({ state: "hidden", timeout: cfg.navigationTimeoutMs }).catch(() => {
        throw new Error("로그인 상태를 확인하지 못했습니다. Chrome 프로필 로그인 상태 또는 네이버 로그인 정보를 확인하세요.");
      });
    }
  }
  //-- 2-2) 로그인이 되어 있는 경우 다음 스텝 진행 --

  //-- 3) 알림받기 버튼 찾을 때까지 자연스러운 스크롤 --
  const alertButton = await findInteractableLocator(
    page,
    ALERT_BUTTON_SELECTORS,
    cfg.navigationTimeoutMs,
    {
      requiredTextPattern: /알림받기|알림받는중|알림해제|알림취소/,
      excludedTextPattern: /알림목록|알림설정/,
    },
  );

  if (!alertButton) {
    throw new Error("알림받기 버튼을 찾지 못했습니다. 페이지 상태 또는 셀렉터를 확인하세요.");
  }

  const buttonText = await alertButton.textContent().catch(() => "");
  const buttonAriaLabel = await alertButton.getAttribute("aria-label").catch(() => "") || "";
  const buttonTitle = await alertButton.getAttribute("title").catch(() => "") || "";
  const ariaPressed = await alertButton.getAttribute("aria-pressed").catch(() => null);
  const buttonSignature = [buttonText, buttonAriaLabel, buttonTitle].join(" ");
  const isAlreadyAlerted =
     (/알림해제|알림취소|해제/.test(buttonSignature) && !/알림받기/.test(buttonSignature)) ||
     (ariaPressed === "true" && /알림받기|알림해제|알림취소/.test(buttonSignature));
  
    if (isAlreadyAlerted) {
      logger.log("이미 알림받기 상태입니다.");
    } else {
      logger.log("알림받기 버튼 클릭");
      await alertButton.click({ timeout: cfg.navigationTimeoutMs });
      await sleep(cfg.actionDelayMs);
    }
    // //-- 4) 알림받기 활성화 여부 확인 --
    // //--  4-1) 알림받기 비활성화일 경우 알림받기 버튼 클릭 --
    // //--  4-2) 알림받기 활성화일 경우 로그 기록 --
    
  
   
  
    //-- 5) 몇 초 딜레이 후 브라우저 종료
    await sleep(cfg.pageLoadWaitMs);
  
    logger.log("1단계 완료");
  
    return {
      loginRequired: isLoginRequired,
      alerted: !isAlreadyAlerted,
    };
}

module.exports = navigate2CheckAlerts;
