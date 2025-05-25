const chromium = require("chrome-aws-lambda");
const puppeteer = require("puppeteer-core");

let lastHeight = 0;
let scrapedData = new Set();

module.exports = async (req, res) => {
  const { username } = req.query;
  const HEADLESS = process.env.HEADLESS === "true";

  if (!username) {
    return res.status(400).send("Please provide a username in the query string.");
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto("https://anonyig.com/en/", { waitUntil: "networkidle2" });

    await page.waitForSelector(".search.search-form__input", { timeout: 5000 });
    await page.type(".search.search-form__input", username);
    await page.click(".search-form__button");
    await page.waitForSelector(".user-info", { timeout: 10000 }).catch(() => {});

    let scrollsRemaining = 10;
    while (scrollsRemaining > 0) {
      await page.evaluate((scrollPos) => {
        window.scrollTo(0, scrollPos);
      }, lastHeight);

      lastHeight += 500;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      scrollsRemaining -= 1;
    }

    const hasUserInfo = (await page.$(".user-info")) !== null;
    const hasProfileMedia = (await page.$(".profile-media-list")) !== null;

    let userInfoData = [];
    let profileMediaData = [];

    if (!hasUserInfo && !hasProfileMedia) {
      const errorMessageData = await page.$$eval(".error-message__text", (elements) =>
        elements.map((el) => el.textContent.trim())
      );

      if (errorMessageData.length > 0) {
        res.write(`data: ${JSON.stringify({ message: "Error", error: errorMessageData })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ message: "No content found" })}\n\n`);
      }

      res.end();
      await browser.close();
      return;
    }

    if (hasUserInfo) {
      userInfoData = await page.$$eval(".user-info", (elements) =>
        elements.map((el) => el.outerHTML)
      );
    }

    if (hasProfileMedia) {
      profileMediaData = await page.$$eval(".profile-media-list", (elements) =>
        elements.map((el) => el.outerHTML)
      );
    }

    const newUserInfo = userInfoData.filter((data) => !scrapedData.has(data));
    const newProfileMedia = profileMediaData.filter((data) => !scrapedData.has(data));

    if (newUserInfo.length > 0 || newProfileMedia.length > 0) {
      res.write(
        `data: ${JSON.stringify({
          message: "New data chunk",
          data: [...newUserInfo, ...newProfileMedia],
        })}\n\n`
      );
      [...newUserInfo, ...newProfileMedia].forEach((data) => scrapedData.add(data));
    }

    res.write(`data: ${JSON.stringify({ message: "✅ Crawling complete." })}\n\n`);
    res.end();
    await browser.close();
  } catch (err) {
    console.error("❌ Error:", err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
};
