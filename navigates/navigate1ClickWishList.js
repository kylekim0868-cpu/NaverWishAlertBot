/**
 * navigate1OpenWishlist.js
 *
 * 네이버 스마트스토어의 특정 상품 페이지를 열고 로그인 상태를 확인한 뒤
 * 찜하기 버튼을 눌러 위시리스트에 추가합니다.
 * 위시리스트 URL은 bot_config.wishlist_url 을 우선 사용합니다.
 * (또는 bot_config.wishlist_url 을 우선 사용)
 */

const { sleep, scrollUntil, findInteractableLocator, getCommonConfig, createLogger, typeLikeHuman } = require("./utils");
const { getBotConfig } = require("../db");

//--------- 상수 ---------
const DEFAULT_WISHLIST_URL = "";
const LOGIN_CHECK_SELECTORS = [
  'a[href*="login"]',
  'a:has-text("로그인")',
  'button:has-text("로그인")',
];
const LOGIN_FORM_SELECTORS = {
  id: "#id",
  pw: "#pw",
  submit: 'button[type="submit"], button.btn_login, .btn_login',
};
const WISHLIST_BUTTON_SELECTORS = [
  'button:has-text("찜하기")',
  'button:has-text("찜해제")',
  'button:has-text("찜취소")',
  'a:has-text("찜하기")',
  'a:has-text("찜해제")',
  'a:has-text("찜취소")',
  'button[aria-label*="찜하기"]',
  'button[aria-label*="찜해제"]',
  'button[aria-label*="찜취소"]',
  'a[aria-label*="찜하기"]',
  'a[aria-label*="찜해제"]',
  'a[aria-label*="찜취소"]',
  '[title*="찜하기"]',
  '[title*="찜해제"]',
  '[title*="찜취소"]',
];

//---------

async function navigate1ClickWishList({ page, profileId }) {
  const logger = createLogger("navigate1");
  const cfg = getCommonConfig();

  //-- 위시리스트 URL 결정 --
  const botConfig = getBotConfig(profileId);
  const wishlistUrl = botConfig?.wishlist_url || DEFAULT_WISHLIST_URL;

  if (!wishlistUrl) {
    throw new Error("wishlist_url 설정이 비어 있습니다. .env 또는 bot_config를 확인하세요.");
  }

  //-- 1) 상품 링크 이동 --
  logger.log(`위시리스트 페이지 이동: ${wishlistUrl}`);
  await page.goto(wishlistUrl, { waitUntil: "domcontentloaded", timeout: cfg.navigationTimeoutMs });
  await page.waitForLoadState("networkidle", { timeout: cfg.navigationTimeoutMs }).catch(() => {
    logger.warn("네트워크 아이들 상태 대기 중 타임아웃 발생 — 페이지가 완전히 로드되지 않았을 수 있습니다.");
    throw new Error("페이지 로드 실패");
  });

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
      await loginLink.click().catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: cfg.navigationTimeoutMs }).catch(() => {});

      const idInput = page.locator(LOGIN_FORM_SELECTORS.id).first();
      const pwInput = page.locator(LOGIN_FORM_SELECTORS.pw).first();
      const submitButton = page.locator(LOGIN_FORM_SELECTORS.submit).first();

      await typeLikeHuman(idInput, loginId);
      await sleep(cfg.pageLoadWaitMs);
      await typeLikeHuman(pwInput, loginPassword);

      await submitButton.click({ timeout: cfg.navigationTimeoutMs });
      await page.waitForLoadState("networkidle", { timeout: cfg.navigationTimeoutMs }).catch(() => {});
    } else {
      logger.warn("NAVER_LOGIN_ID / NAVER_LOGIN_PASSWORD가 없어 수동 로그인을 기다립니다.");
      await loginLink.waitFor({ state: "hidden", timeout: cfg.navigationTimeoutMs }).catch(() => {
        throw new Error("로그인 상태를 확인하지 못했습니다. Chrome 프로필 로그인 상태 또는 네이버 로그인 정보를 확인하세요.");
      });
    }
  }
  //-- 2-2) 로그인이 되어 있는 경우 다음 스텝 진행 --


  //-- 3) 찜하기 버튼 찾을 때까지 자연스러운 스크롤 --
  const wishButtonVisible = await scrollUntil(
    page,
    async () => {
      const button = await findInteractableLocator(page, WISHLIST_BUTTON_SELECTORS, 700);
      return !!button;
    },
    { max: 18, delay: cfg.actionDelayMs, distance: 700 },
  );
  logger.log(wishButtonVisible ? "찜하기 버튼을 찾았습니다." : "찜하기 버튼을 찾지 못했습니다.");

  if (!wishButtonVisible) {
    throw new Error("찜하기 버튼을 찾지 못했습니다. 페이지 구조 또는 로그인 상태를 확인하세요.");
  }

  const wishButton = await findInteractableLocator(page, WISHLIST_BUTTON_SELECTORS, 3000);
  if (!wishButton) {
    throw new Error("찜하기 버튼이 보이지만 클릭 가능한 요소를 찾지 못했습니다.");
  }

  await wishButton.scrollIntoViewIfNeeded({ timeout: cfg.navigationTimeoutMs }).catch(() => {});

  //-- 4) 찜하기 활성화 여부 확인 --
  //--  4-1) 찜하기 비활성화일 경우 찜하기 버튼 클릭 --
  //--  4-2) 찜하기 활성화일 경우 로그 기록 --
  const buttonText = await wishButton.textContent().catch(() => "");
  const buttonAriaLabel = await wishButton.getAttribute("aria-label").catch(() => "") || "";
  const buttonTitle = await wishButton.getAttribute("title").catch(() => "") || "";
  const ariaPressed = await wishButton.getAttribute("aria-pressed").catch(() => null);
  const buttonSignature = [buttonText, buttonAriaLabel, buttonTitle].join(" ");

  const isAlreadyWished =
    (/찜해제|찜취소|해제/.test(buttonSignature) && !/찜하기/.test(buttonSignature)) ||
    (ariaPressed === "true" && /찜하기|찜해제|찜취소/.test(buttonSignature));

  if (isAlreadyWished) {
    logger.log("이미 찜한 상태입니다.");
  } else {
    logger.log("찜하기 버튼 클릭");
    await wishButton.click({ timeout: cfg.navigationTimeoutMs });
    await page.waitForLoadState("networkidle", { timeout: cfg.navigationTimeoutMs }).catch(() => {});
    await sleep(cfg.actionDelayMs);
  }

  //-- 5) 몇 초 딜레이 후 브라우저 종료
  await sleep(cfg.pageLoadWaitMs);

  logger.log("1단계 완료");

  return {
    loginRequired: isLoginRequired,
    wished: !isAlreadyWished,
  };

}

module.exports = navigate1ClickWishList;
