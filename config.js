/**
 * config.js
 *
 * 중앙 설정 모듈 — NODE_ENV에 따라 .env.development 또는 .env.production을 로드하고
 * 애플리케이션 전체에서 사용할 설정값을 단일 객체로 내보냅니다.
 *
 * 사용법:
 *   const config = require('./config');
 *   console.log(config.isProd, config.headless, config.dbPath);
 */

const path = require("path");
const { homedir } = require("os");

const env = process.env.NODE_ENV || "development";

// NODE_ENV에 맞는 .env 파일 로드 (.env.development 또는 .env.production)
require("dotenv").config({ path: path.join(__dirname, `.env.${env}`) });

const defaultChromeProfileDir =
  env === "development"
    ? path.join(homedir(), "Chrome-Profile-Dev")
    : path.join(homedir(), "Chrome-Profile");

module.exports = {
  /** 현재 실행 환경 ("development" | "production") */
  env,

  /** 운영 환경 여부 */
  isProd: env === "production",

  /** 브라우저를 화면 없이 실행할지 여부 — dev: false(눈으로 확인), prod: true(서버 실행) */
  headless: process.env.HEADLESS === "true",

  /** Chrome 프로필이 저장된 폴더 — dev/prod 기본 경로를 자동 분리합니다 */
  chromeProfileDir: process.env.CHROME_PROFILE_DIR || defaultChromeProfileDir,

  /**
   * SQLite DB 파일 경로
   * .env에서 상대 경로(예: ./data/wish_alert_dev.db)로 지정하면
   * 프로젝트 루트 기준 절대 경로로 변환됩니다.
   */
  dbPath: path.resolve(
    __dirname,
    process.env.DB_PATH || "./data/wish_alert.db",
  ),

  /** 기본 위시리스트 URL */
  wishlistUrl:
    process.env.WISHLIST_URL || "https://shopping.naver.com/my/wishes",

  /** 스마트스토어 URL */
  smartstoreUrl:
    process.env.SMARTSTORE_URL || "",

  /** 기본 알림 임계값(%) — 0이면 1원이라도 내려도 알림 */
  alertThresholdPct: Number(process.env.ALERT_THRESHOLD_PCT ?? 0),

  /** 기본 실행 단계 — "all" | "1" | "2" | "3" | "4" */
  botNavigate: process.env.BOT_NAVIGATE || "all",
};
