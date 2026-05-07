const navigate1ClickWishList       = require("./navigates/navigate1ClickWishList");
const navigate2ScanWishItems     = require("./navigates/navigate2ScanWishItems");
const navigate3CheckPriceChange  = require("./navigates/navigate3CheckPriceChange");
const navigate4Alert             = require("./navigates/navigate4Alert");

const NAVIGATE_MAP = {
  1: navigate1ClickWishList,
  2: navigate2ScanWishItems,
  3: navigate3CheckPriceChange,
  4: navigate4Alert,
};

//---------------------------------------------------------------------------------------
// main orchestrator
//---------------------------------------------------------------------------------------
module.exports = async function runMain({ page, profileId }) {
  const mode = (process.env.BOT_NAVIGATE || "all").toLowerCase();
  const context = { page, profileId, navigateMode: mode };

  let success = false;
  let note = null;

  try {
    if (mode === "all") {
      for (const step of ["1", "2"]) {
        await NAVIGATE_MAP[step]({ page, profileId, context });
      }
    } else {
      const selected = NAVIGATE_MAP[mode];
      if (!selected) {
        note = `Unknown BOT_NAVIGATE=${mode}. Use 1,2,3,4 or all.`;
        console.log(`[main] ${note}`);
        return { success: false, note, context };
      }
      await selected({ page, profileId, context });
    }
    success = true;
  } catch (err) {
    note = err.message || String(err);
    console.error(`[main] 실행 중 오류: ${note}`);
  }

  return { success, note, context };
};
