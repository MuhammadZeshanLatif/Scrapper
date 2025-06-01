const express = require("express");
const puppeteer = require("puppeteer");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = 3000;

app.use(cors({
  origin: 'http://127.0.0.1:5500',
  methods: ['GET', 'POST'],
}));

app.use(express.static(path.join(__dirname, "public")));

let lastHeight = 0;
let scrapedData = new Set();

app.get("/search", async (req, res) => {
  const username = req.query.username || "";
  if (!username) {
    return res.status(400).send("Please provide a username in the query string.");
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    console.log("🌐 Launching Puppeteer...");
    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ["--start-maximized"],
    });

    const page = await browser.newPage();
    console.log("🌐 Opening anonyig.com...");
    await page.goto("https://anonyig.com/en/", { waitUntil: "networkidle2" });

    console.log("⏳ Waiting for search input field...");
    await page.waitForSelector(".search.search-form__input", { timeout: 5000 });

    console.log(`🖊 Typing username: ${username}`);
    await page.type(".search.search-form__input", username);

    console.log("🔍 Clicking search button...");
    await page.click(".search-form__button");

    console.log("⏳ Waiting for the output component...");
    await page.waitForSelector(".user-info", { timeout: 10000 }).catch(() => {});

    // Perform scrolling
    let scrollsRemaining = 10;
    while (scrollsRemaining > 0) {
      console.log(`🔄 Scrolling down - ${7 - scrollsRemaining} of 6...`);
      await page.evaluate((scrollPos) => {
        window.scrollTo(0, scrollPos);
      }, lastHeight);

      lastHeight += 500;
      await new Promise(resolve => setTimeout(resolve, 3000));
      scrollsRemaining -= 1;
    }

    // Check existence of required selectors
    const hasUserInfo = await page.$('.user-info') !== null;
    const hasProfileMedia = await page.$('.profile-media-list') !== null;

    let userInfoData = [];
    let profileMediaData = [];

    if (!hasUserInfo && !hasProfileMedia) {
      console.log("⚠️ Neither .user-info nor .profile-media-list found. Checking for error message...");
      const errorMessageData = await page.$$eval('.error-message__text', (elements) =>
        elements.map(el => el.textContent.trim())
      );

      if (errorMessageData.length > 0) {
        console.log("❌ Error message found.");
        res.write(`data: ${JSON.stringify({ message: "Error message found", error: errorMessageData })}\n\n`);
      } else {
        console.log("❌ No recognizable content found.");
        res.write(`data: ${JSON.stringify({ message: "No recognizable content found on the page." })}\n\n`);
      }

      res.end();
      await browser.close();
      return;
    }

    if (hasUserInfo) {
      userInfoData = await page.$$eval('.user-info', (elements) =>
        elements.map(el => el.outerHTML)
      );
    }

    if (hasProfileMedia) {
      profileMediaData = await page.$$eval('.profile-media-list', (elements) =>
        elements.map(el => el.outerHTML)
      );
    }

    const newUserInfo = userInfoData.filter(data => !scrapedData.has(data));
    const newProfileMedia = profileMediaData.filter(data => !scrapedData.has(data));

    if (newUserInfo.length > 0 || newProfileMedia.length > 0) {
      res.write(`data: ${JSON.stringify({
        message: "New data chunk received",
        data: [...newUserInfo, ...newProfileMedia]
      })}\n\n`);
      console.log("✅ Sending new data chunk to client...");
      [...newUserInfo, ...newProfileMedia].forEach(data => scrapedData.add(data));
    } else {
      console.log("⚠️ No new data to send.");
    }

    res.write(`data: ${JSON.stringify({ message: "✅ Crawling complete." })}\n\n`);
    res.end();
    await browser.close();
  } catch (err) {
    console.error("❌ Error:", err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
