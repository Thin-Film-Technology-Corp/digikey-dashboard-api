import { install } from "@puppeteer/browsers";

const installPuppeteer = async () => {
  await install({
    browser: "chrome",
    buildId: "latest",
  });
  console.log("Puppeteer installation complete");
};

installPuppeteer().catch(console.error);
