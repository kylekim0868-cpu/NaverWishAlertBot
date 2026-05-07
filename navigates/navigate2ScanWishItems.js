/**
 * navigate2CheckAlerts.js
 *
 * 스마트스토어 메인 페이지에서 "알림받기" 상태를 확인하고,
 * 필요하면 팝업 확인까지 거쳐 "알림받는중" 상태로 전환합니다.
 */

const { sleep, findInteractableLocator, getCommonConfig, createLogger, typeLikeHuman } = require("./utils");
const { getBotConfig } = require("../db");

//---------
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
const ALERT_CONFIRM_POPUP_CLOSE_SELECTORS = [
  '[role="dialog"] button:has-text("닫기")',
  '[aria-modal="true"] button:has-text("닫기")',
  'dialog button:has-text("닫기")',
  '[class*="Modal"] button:has-text("닫기")',
  '[class*="modal"] button:has-text("닫기")',
  '[class*="Popup"] button:has-text("닫기")',
  '[class*="popup"] button:has-text("닫기")',
  'button:has-text("닫기")',
];
const ALERT_CONFIRM_POPUP_TEXT_PATTERNS = [
  /알림을 받으시겠어요/,
  /프로모션 정보를 빠르게 확인할 수 있습니다/,
];
const ALERT_SUCCESS_POPUP_TEXT_PATTERNS = [
  /알림을 설정했습니다/,
  /알림 받는 스토어 목록/,
  /관심스토어/,
];
const MODAL_CONTAINER_SELECTORS = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  'dialog',
  '[class*="Modal"]',
  '[class*="modal"]',
  '[class*="Popup"]',
  '[class*="popup"]',
];
const SMARTSTORE_CONFIRM_POPUP_SELECTORS = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  'dialog',
  'div[class*="layer"]',
  'div[class*="modal"]',
  'div[class*="popup"]',
  'div[class*="Modal"]',
  'div[class*="Popup"]',
];
const POPUP_CONTAINER_SELECTORS = [
  ...MODAL_CONTAINER_SELECTORS,
  'section',
  'article',
  'div',
];

function getButtonSignatureFromParts(text, ariaLabel, title) {
  return [text, ariaLabel, title].filter(Boolean).join(" ");
}

function isAlertedSignature(signature, ariaPressed) {
  return (
    (/알림받는중|알림취소|해제/.test(signature) && !/알림받기/.test(signature)) ||
    (ariaPressed === "true" && /알림받는중|알림해제|알림취소/.test(signature))
  );
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function summarizeDialogMessage(message) {
  const normalized = normalizeText(message);
  if (!normalized) return "대화상자 메시지를 읽지 못했습니다.";

  if (!/<!DOCTYPE html>|<html/i.test(normalized)) {
    return normalized.slice(0, 200);
  }

  const titleMatch = message.match(/<title>([\s\S]*?)<\/title>/i);
  const title = normalizeText(titleMatch?.[1]);
  const headlineMatch = message.match(/class="title_error"[^>]*>([\s\S]*?)<\/[^>]+>/i);
  const headline = normalizeText(headlineMatch?.[1]);
  const textMatches = Array.from(message.matchAll(/class="text(?: gap)?"[^>]*>([\s\S]*?)<\/[^>]+>/gi));
  const detail = normalizeText(textMatches.map((match) => match[1]).join(" "));

  return [title, headline, detail].filter(Boolean).join(" | ").slice(0, 300) || normalized.slice(0, 200);
}

function isSystemErrorDialogMessage(message) {
  return /시스템오류|에러페이지|module_error|title_error/i.test(message || "");
}

async function readAlertButtonState(locator) {
  const buttonText = await locator.textContent().catch(() => "");
  const buttonAriaLabel = await locator.getAttribute("aria-label").catch(() => "") || "";
  const buttonTitle = await locator.getAttribute("title").catch(() => "") || "";
  const ariaPressed = await locator.getAttribute("aria-pressed").catch(() => null);
  const buttonSignature = getButtonSignatureFromParts(buttonText, buttonAriaLabel, buttonTitle);

  return {
    buttonSignature,
    ariaPressed,
    isAlreadyAlerted: isAlertedSignature(buttonSignature, ariaPressed),
  };
}

async function runWithDialogHandler(page, logger, action) {
  let dialogAccepted = false;
  let dialogError = null;
  let dialogMessage = null;

  const handleDialog = async (dialog) => {
    dialogAccepted = true;
    dialogMessage = dialog.message();
    logger.log(`브라우저 대화상자 감지: ${dialog.type()} - ${summarizeDialogMessage(dialogMessage)}`);

    try {
      await dialog.accept();
    } catch (error) {
      dialogError = error;
      logger.warn(`브라우저 대화상자 수락 실패: ${error?.message || error}`);
    }
  };

  page.on("dialog", handleDialog);

  try {
    await action();
  } finally {
    page.off("dialog", handleDialog);
  }

  return { dialogAccepted, dialogError, dialogMessage };
}

async function clickAlertMainButton(page, locator, cfg, logger) {
  const dialogResult = await runWithDialogHandler(page, logger, async () => {
    await locator.click({ timeout: cfg.navigationTimeoutMs });
    await sleep(cfg.actionDelayMs);
  });

  return dialogResult;
}

async function findModalByText(page, textPatterns, timeoutMs, options = {}) {
  const match = options.match || "any";
  const requireButtonName = options.requireButtonName || null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const containers = page.locator(POPUP_CONTAINER_SELECTORS.join(", "));
    const count = await containers.count().catch(() => 0);
    let bestCandidate = null;
    let bestArea = Number.POSITIVE_INFINITY;

    for (let index = 0; index < count; index += 1) {
      const container = containers.nth(index);
      const isVisible = await container.isVisible().catch(() => false);
      if (!isVisible) continue;

      const signature = await container.textContent().catch(() => "");
      if (!signature) continue;

      const normalized = normalizeText(signature);
      const matches = match === "all"
        ? textPatterns.every((pattern) => pattern.test(normalized))
        : textPatterns.some((pattern) => pattern.test(normalized));
      if (!matches) continue;

      const box = await container.boundingBox().catch(() => null);
      if (!box || box.width <= 0 || box.height <= 0) continue;

      if (requireButtonName) {
        const hasButton = await container.getByRole("button", { name: requireButtonName, exact: true }).first()
          .isVisible({ timeout: 200 })
          .catch(() => false);
        if (!hasButton) continue;
      }

      const area = box.width * box.height;
      if (area < bestArea) {
        bestArea = area;
        bestCandidate = container;
      }
    }

    if (bestCandidate) return bestCandidate;

    await sleep(50);
  }

  return null;
}

async function findModalByButton(page, buttonName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const containers = page.locator(POPUP_CONTAINER_SELECTORS.join(", "));
    const count = await containers.count().catch(() => 0);

    for (let index = 0; index < count; index += 1) {
      const container = containers.nth(index);
      const isVisible = await container.isVisible().catch(() => false);
      if (!isVisible) continue;

      const actionButton = container.getByRole("button", { name: buttonName, exact: true }).first();
      const buttonVisible = await actionButton.isVisible({ timeout: 120 }).catch(() => false);
      if (buttonVisible) {
        return container;
      }
    }

    await sleep(50);
  }

  return null;
}

async function clickLocatorLikeHuman(page, locator, cfg) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});

  const box = await locator.boundingBox().catch(() => null);
  if (!box) {
    await locator.click({ timeout: cfg.navigationTimeoutMs });
    return;
  }

  const targetX = box.x + (box.width / 2) + ((Math.random() - 0.5) * Math.min(8, box.width * 0.1));
  const targetY = box.y + (box.height / 2) + ((Math.random() - 0.5) * Math.min(8, box.height * 0.1));

  await page.mouse.move(targetX, targetY, { steps: 10 });
  await page.mouse.down();
  await page.mouse.up();
}

async function clickLocatorNaturally(page, locator, cfg, logger, logLabel) {
  logger.log(`${logLabel} 클릭`);
  const dialogResult = await runWithDialogHandler(page, logger, async () => {
    try {
      await locator.click({ timeout: cfg.navigationTimeoutMs });
    } catch {
      await clickLocatorLikeHuman(page, locator, cfg);
    }
  });

  if (dialogResult.dialogError) {
    throw dialogResult.dialogError;
  }

  return dialogResult;
}

async function readAlertStateSummary(page, alertButton) {
  const currentButtonState = await readAlertButtonState(alertButton).catch(() => null);
  if (currentButtonState?.isAlreadyAlerted) {
    return currentButtonState;
  }

  const alertedButton = page.getByRole("button", { name: "알림받는중", exact: true }).first();
  const alertedVisible = await alertedButton.isVisible({ timeout: 40 }).catch(() => false);
  if (alertedVisible) {
    const text = normalizeText(await alertedButton.textContent().catch(() => "알림받는중"));
    return { buttonSignature: text || "알림받는중", ariaPressed: null, isAlreadyAlerted: true };
  }

  return { buttonSignature: null, ariaPressed: null, isAlreadyAlerted: false };
}

async function waitForAlertStateChange(page, alertButton, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const currentState = await readAlertStateSummary(page, alertButton);
    if (currentState.isAlreadyAlerted) {
      return currentState;
    }

    await sleep(30);
  }

  return { buttonSignature: null, ariaPressed: null, isAlreadyAlerted: false };
}

async function waitForSuccessPopup(page, cfg, logger) {
  const popup = await findModalByText(
    page,
    ALERT_SUCCESS_POPUP_TEXT_PATTERNS,
    Math.max(150, cfg.actionDelayMs * 2),
    { match: "any" },
  );

  if (popup) {
    logger.log("알림 설정 완료 팝업 확인");
  }

  return popup;
}

async function closeSuccessPopup(page, successPopup, cfg, logger) {
  const closeButton = (successPopup
    ? successPopup.getByRole("button", { name: "닫기", exact: true }).first()
    : page.getByRole("button", { name: "닫기", exact: true }).first());

  const visible = await closeButton.isVisible({ timeout: 5 }).catch(() => false);
  if (!visible) return;

  logger.log("알림 설정 완료 팝업 닫기 버튼 클릭");
  await closeButton.click({ timeout: 60 }).catch(() => {});
  return true;
}

async function findConfirmPopup(page, cfg) {
  const popupCandidate = page.locator(SMARTSTORE_CONFIRM_POPUP_SELECTORS.join(", "))
    .filter({ has: page.getByRole("button", { name: "알림받기", exact: true }) })
    .last();

  const isVisible = await popupCandidate.isVisible({ timeout: 80 }).catch(() => false);
  if (isVisible) {
    return popupCandidate;
  }

  const textCandidate = await findModalByText(
    page,
    ALERT_CONFIRM_POPUP_TEXT_PATTERNS,
    80,
    { match: "any", requireButtonName: "알림받기" },
  );
  if (textCandidate) {
    return textCandidate;
  }

  return null;
}

async function clickAlertPopupConfirm(page, alertButton, cfg, logger) {
  const popup = await findConfirmPopup(page, cfg);
  if (!popup) {
    logger.warn("첫 번째 알림 확인 팝업을 찾지 못했습니다.");
    return { confirmedClick: false, dialogMessage: null, finalState: null };
  }

  logger.log("첫 번째 알림 확인 팝업 감지 완료");

  const confirmButton = popup.getByRole("button", { name: "알림받기", exact: true }).first();
  const visible = await confirmButton.isVisible({ timeout: 20 }).catch(() => false);
  if (!visible) {
    logger.warn("팝업 내 알림받기 버튼을 찾지 못했습니다.");
    return { confirmedClick: false, dialogMessage: null, finalState: null };
  }

  const dialogResult = await clickLocatorNaturally(page, confirmButton, cfg, logger, "팝업 알림받기 버튼");
  if (dialogResult.dialogAccepted) {
    logger.log("팝업 클릭 이후 브라우저 대화상자를 수락했습니다.");
  }

  await closeSuccessPopup(page, null, cfg, logger);
  const finalState = await waitForAlertStateChange(page, alertButton, 700);

  return {
    confirmedClick: true,
    dialogMessage: dialogResult.dialogMessage || null,
    finalState,
  };
}

async function hasNaverLoginSession(page) {
  const cookies = await page.context().cookies().catch(() => []);
  return cookies.some((cookie) => /(^|\.)naver\.com$/i.test(cookie.domain || "") && /NID_AUT|NID_SES/i.test(cookie.name || ""));
}

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
  await sleep(100);

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
      await sleep(100);
      await typeLikeHuman(pwInput, loginPassword);
      await keepLoginButton.click( { timeout: cfg.navigationTimeoutMs }).catch(() => {});
      await sleep(100);
      await submitButton.click({ timeout: cfg.navigationTimeoutMs });
      await sleep(100);
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

  const { buttonSignature, ariaPressed, isAlreadyAlerted } = await readAlertButtonState(alertButton);
  let finalState = { buttonSignature, ariaPressed, isAlreadyAlerted };

  if (isAlreadyAlerted) {
    logger.log("이미 알림받기 상태입니다.");
  } else {
    logger.log("알림받기 버튼 클릭");

    const clickResult = await clickAlertMainButton(page, alertButton, cfg, logger);

    if (clickResult.dialogError) {
      throw clickResult.dialogError;
    }

    if (clickResult.dialogAccepted) {
      logger.log("브라우저 확인 대화상자를 수락했습니다.");
    }

    const popupResult = await clickAlertPopupConfirm(page, alertButton, cfg, logger);
    if (!popupResult.confirmedClick) {
      throw new Error("알림받기 확인 버튼을 찾지 못했습니다.");
    }

    if (popupResult.dialogMessage && isSystemErrorDialogMessage(popupResult.dialogMessage)) {
      const hasSession = await hasNaverLoginSession(page);
      const sessionHint = hasSession ? "로그인 세션은 보이지만 네이버 측 시스템 오류 응답이 발생했습니다." : "로그인 세션 쿠키가 없어 인증 문제일 가능성이 큽니다.";
      throw new Error(`팝업 알림받기 클릭 후 오류 대화상자 발생: ${summarizeDialogMessage(popupResult.dialogMessage)} / ${sessionHint}`);
    }

    if (popupResult.finalState?.isAlreadyAlerted) {
      finalState = popupResult.finalState;
      logger.log("확인 클릭 직후 상태 기준으로 알림 설정 완료를 확인했습니다.");
    } else if (popupResult.finalState) {
      finalState = popupResult.finalState;
    }

    // if (!finalState?.isAlreadyAlerted) {
    //   finalState = await waitForAlertStateChange(page, alertButton, 1500);
    // }

    if (!finalState?.isAlreadyAlerted) {
      throw new Error("알림은 클릭했지만 상태가 알림받는중으로 변경되지 않았습니다.");
    }

    logger.log(`알림 상태 변경 확인: ${finalState.buttonSignature || buttonSignature}`);
  }

    //-- 4) 알림받기 활성화 여부 확인 --
    //--  4-1) 알림받기 비활성화일 경우 알림받기 버튼 클릭 --
    //--  4-2) 알림받기 활성화일 경우 로그 기록 --

    //-- 5) 몇 초 딜레이 후 브라우저 종료
    logger.log("알림받기 작업 완료");
  
  return {
    loginRequired: isLoginRequired,
    alerted: finalState?.isAlreadyAlerted ?? false,
  };
}

module.exports = navigate2CheckAlerts;
