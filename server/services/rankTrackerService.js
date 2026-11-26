
import { chromium } from "playwright-core";
import Browserbase from "@browserbasehq/sdk";

// Initialize Browserbase only when rank tracking is requested.
function getBrowserbase() {
  const apiKey = process.env.BROWSERBASE_API_KEY;

  if (!apiKey) {
    throw new Error("BROWSERBASE_API_KEY is missing in server .env");
  }

  return new Browserbase({ apiKey });
}

// Normalize domain names.
function normalizeDomain(domain) {
  return domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase();
}

// Check exact domain or subdomain match.
function isMatchingDomain(resultDomain, targetDomain) {
  return (
    resultDomain === targetDomain ||
    resultDomain.endsWith(`.${targetDomain}`)
  );
}

// Search Google and return target domain ranking.
export async function rankTracker(keyword, targetDomain) {
  let browser;

  try {
    if (!keyword || !targetDomain) {
      throw new Error("Keyword and target domain are required");
    }

    const bb = getBrowserbase();

    const cleanTarget = normalizeDomain(targetDomain);

    const session = await bb.sessions.create({
      browserSettings: {
        blockAds: true,
      },
    });

    browser = await chromium.connectOverCDP(session.connectUrl);

    const context = browser.contexts()[0];

    if (!context) {
      throw new Error("Browser context not available");
    }

    const page = context.pages()[0] || await context.newPage();

    page.setDefaultNavigationTimeout(45000);

    await page.goto("https://www.google.com", {
      waitUntil: "domcontentloaded",
    });

    // Handle Google consent if available.
    try {
      const consentButton = page.locator(
        'button[id="L2AGLb"], form[action*="consent"] button'
      ).first();

      if (await consentButton.count()) {
        await consentButton.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
      }
    } catch {
      // Consent button is optional.
    }

    const allResults = [];
    let found = null;

    for (let gPage = 1; gPage <= 5 && !found; gPage++) {
      const searchUrl =
        `https://www.google.com/search?q=${encodeURIComponent(keyword)}` +
        `&start=${(gPage - 1) * 10}&num=10&hl=en&gl=us`;

      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
      });

      let pageResults = [];

      for (let retry = 0; retry < 3; retry++) {
        try {
          await page.waitForSelector("h3", {
            timeout: 10000,
          });

          await page.waitForTimeout(1000);

          pageResults = await page.evaluate(() => {
            return Array.from(document.querySelectorAll("h3"))
              .map((h3) => {
                const anchor = h3.closest("a");

                if (!anchor || !anchor.href.startsWith("http")) {
                  return null;
                }

                const url = new URL(anchor.href);

                if (
                  url.hostname.includes("google.") ||
                  url.hostname.includes("youtube.com")
                ) {
                  return null;
                }

                const container =
                  anchor.closest("div.MjjYud") ||
                  anchor.parentElement;

                return {
                  url: anchor.href,
                  domain: url.hostname
                    .replace(/^www\./i, "")
                    .toLowerCase(),
                  title: h3.innerText.trim(),
                  snippet: (
                    container?.innerText || ""
                  ).trim().substring(0, 300),
                };
              })
              .filter(Boolean);
          });

          if (pageResults.length > 0) break;

        } catch (error) {
          if (retry === 2) {
            console.error("Google result extraction failed:", error.message);
            break;
          }

          await page.reload({
            waitUntil: "domcontentloaded",
          });
        }
      }

      if (!pageResults.length) break;

      for (const result of pageResults) {
        const position = allResults.length + 1;

        const resultData = {
          ...result,
          position,
        };

        allResults.push(resultData);

        if (isMatchingDomain(result.domain, cleanTarget)) {
          found = {
            ...resultData,
            page: gPage,
          };

          break;
        }
      }

      if (!found) {
        await page.waitForTimeout(1500);
      }
    }

    const competitors = allResults
      .filter(
        (result) => !isMatchingDomain(result.domain, cleanTarget)
      )
      .slice(0, 10);

    return {
      success: true,
      data: {
        keyword,
        targetDomain,
        position: found?.position ?? null,
        page: found?.page ?? null,
        title: found?.title ?? null,
        snippet: found?.snippet ?? null,
        competitors,
        totalResultsScanned: allResults.length,
      },
    };

  } catch (error) {
    console.error("Error in rankTracker:", error);

    return {
      success: false,
      error: error.message || "An error occurred while tracking rank",
    };

  } finally {
    if (browser) {
      await browser.close().catch((error) => {
        console.error("Browser cleanup failed:", error.message);
      });
    }
  }
}
