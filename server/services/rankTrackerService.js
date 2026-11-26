import { chromium } from "playwright-core";
import Browserbase from "@browserbasehq/sdk";

function getBrowserbase() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    throw new Error("BROWSERBASE_API_KEY is missing in server .env");
  }
  return new Browserbase({ apiKey });
}

function normalizeDomain(domain) {
  return domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase();
}

function isMatchingDomain(resultDomain, targetDomain) {
  return (
    resultDomain === targetDomain ||
    resultDomain.endsWith(`.${targetDomain}`)
  );
}

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

    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultNavigationTimeout(45000);

    await page.goto("https://www.google.com/?hl=en&gl=us", {
      waitUntil: "domcontentloaded",
    });

    // Dismiss consent banner if shown
    try {
      const consentButton = page
        .locator('button[id="L2AGLb"], form[action*="consent"] button')
        .first();
      if (await consentButton.count()) {
        await consentButton.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
      }
    } catch {
      // Optional consent banner
    }

    // Type keyword into Google's search box
    const searchBox = page
      .locator('textarea[name="q"], input[name="q"]')
      .first();
    await searchBox.waitFor({ timeout: 10000 });
    await searchBox.fill(keyword);
    await searchBox.press("Enter");

    const allResults = [];
    let found = null;

    for (let gPage = 1; gPage <= 5 && !found; gPage++) {
      if (gPage > 1) {
        const nextBtn = page.locator("a#pnnext").first();
        if (!(await nextBtn.count())) break;
        await nextBtn.click();
      }

      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(3000);

      const pageResults = await page.evaluate(() => {
        const isGoogleInternalHost = (host) => {
          const h = host.toLowerCase();
          return (
            h === "google.com" ||
            h.endsWith(".google.com") ||
            h.includes("gstatic.com") ||
            h.includes("googleapis.com") ||
            h.includes("googleusercontent.com")
          );
        };

        const extractUrlFromCard = (anchor, card) => {
          const rawHref = anchor?.getAttribute("href") || "";

          // 1. Direct or /url?q= link
          try {
            const parsed = new URL(rawHref, "https://www.google.com");
            if (
              parsed.hostname.includes("google.") &&
              parsed.pathname === "/url"
            ) {
              const target =
                parsed.searchParams.get("q") ||
                parsed.searchParams.get("url") ||
                "";
              if (target.startsWith("http")) return target;
            } else if (
              parsed.protocol.startsWith("http") &&
              !isGoogleInternalHost(parsed.hostname)
            ) {
              return parsed.href;
            }
          } catch {
            // Fall through to <cite> extraction
          }

          // 2. Fallback for /goto?url=... redirect links: read the visible <cite> URL in the card
          const citeEl = card?.querySelector("cite");
          const citeText = (citeEl?.textContent || "").trim();
          if (citeText) {
            const basePart = citeText.split(/[›\s]/)[0].trim();
            if (basePart && basePart.includes(".")) {
              const candidateUrl = /^https?:\/\//i.test(basePart)
                ? basePart
                : `https://${basePart}`;
              try {
                const u = new URL(candidateUrl);
                if (!isGoogleInternalHost(u.hostname)) {
                  return u.href;
                }
              } catch {
                // Invalid cite URL
              }
            }
          }

          return "";
        };

        const seenDomainsAndTitles = new Set();
        const results = [];
        const root =
          document.querySelector("#rso") ||
          document.querySelector("#search") ||
          document.body;

        const headings = Array.from(root.querySelectorAll("h3"));

        for (const h3 of headings) {
          // Skip hidden headings or headings inside AI Overview
          if (h3.offsetParent === null) continue;
          if (h3.closest('[data-attrid="SGE"], [jsname="N760b"]')) continue;

          const title = (h3.textContent || "").trim();
          if (!title || title.length < 2) continue;

          const card =
            h3.closest("div.MjjYud") ||
            h3.closest("div.g") ||
            h3.closest("[data-hveid]") ||
            h3.parentElement?.parentElement?.parentElement;

          const anchor =
            h3.closest("a[href]") ||
            card?.querySelector('a[href^="/goto"], a[href^="/url"], a[href^="http"]');

          const resolvedUrl = extractUrlFromCard(anchor, card);
          if (!resolvedUrl) continue;

          let parsedUrl;
          try {
            parsedUrl = new URL(resolvedUrl);
          } catch {
            continue;
          }

          const domain = parsedUrl.hostname
            .replace(/^www\./i, "")
            .toLowerCase();
          if (!domain || isGoogleInternalHost(domain)) continue;

          const dedupeKey = `${domain}::${title}`;
          if (seenDomainsAndTitles.has(dedupeKey)) continue;
          seenDomainsAndTitles.add(dedupeKey);

          const rawText = (card?.innerText || "").trim();
          const snippet =
            rawText
              .split("\n")
              .find(
                (line) =>
                  line.trim().length > 35 &&
                  !line.includes(title.substring(0, 20)) &&
                  !line.includes("›")
              )
              ?.trim()
              .substring(0, 300) || "";

          results.push({
            url: resolvedUrl,
            domain,
            title,
            snippet,
          });
        }

        return results;
      });

      console.log(
        `Keyword "${keyword}" | Page ${gPage}: extracted ${pageResults.length} results`
      );

      if (!pageResults.length) break;

      for (const result of pageResults) {
        const position = allResults.length + 1;
        const resultData = { ...result, position };
        allResults.push(resultData);

        if (isMatchingDomain(result.domain, cleanTarget)) {
          found = { ...resultData, page: gPage };
          break;
        }
      }

      if (!found) {
        await page.waitForTimeout(1500);
      }
    }

    const competitors = allResults
      .filter((result) => !isMatchingDomain(result.domain, cleanTarget))
      .slice(0, 10);

    return {
      success: true,
      data: {
        keyword,
        targetDomain,
        position: found?.position ?? null,
        page: found?.page ?? null,
        title: found?.title ?? "",
        snippet: found?.snippet ?? "",
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