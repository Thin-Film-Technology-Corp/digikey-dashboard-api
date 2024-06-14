---
description: >-
  The login.js file contains functions to handle session management and CSV data
  retrieval from DigiKey using Puppeteer.
---

# login.js

### Overview

This file contains the following main functionalities:

* Launching a Puppeteer browser to initiate a session with DigiKey.
* Extracting session credentials from the DigiKey website.
* Retrieving CSV data based on document type.
* Parsing cookies for session management.

### Code Breakdown

#### Import Statements

```javascript
import { launch } from "puppeteer";
import { config } from "dotenv";
config();
```

* `launch` from `puppeteer`: Used to launch a headless browser for web scraping.
* `config` from `dotenv`: Loads environment variables from a `.env` file.

#### getDigiKeyMicroStrategySession Function

```javascript
export async function getDigiKeyMicroStrategySession() {
  let browser;
  console.log("starting browser...");
  try {
    browser = await launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
      args: [
        "--disable-features=SameSiteByDefaultCookies",
        "--disable-features=CookiesWithoutSameSiteMustBeSecure",
        "--disable-site-isolation-trials",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });
    console.log("browser started");
  } catch (error) {
    console.error("Error launching browser:", error);
    throw new Error("Failed to launch browser");
  }

  let page;
  try {
    page = await browser.newPage();
  } catch (error) {
    console.error("Error opening new page:", error);
    await browser.close();
    throw new Error("Failed to open new page");
  }

  const responsePromise = new Promise((resolve, reject) => {
    page.on("response", async (response) => {
      try {
        const url = response.url();
        const headers = response.headers();
        if (
          url ===
            "https://digikey.cloud.microstrategy.com/MicroStrategyLibrarySRPortal/api/auth/delegate" &&
          headers["x-mstr-authtoken"]
        ) {
          let sessionCookies = getCredsFromSetHeaders(headers["set-cookie"]);
          let authToken = headers["x-mstr-authtoken"];
          let obj = { sessionCookies: sessionCookies, authToken: authToken };
          resolve(obj);
        }
      } catch (error) {
        console.error("Error in response event handler:", error);
        reject(error);
      }
    });
  });

  try {
    await page.goto("https://supplier.digikey.com/");
  } catch (error) {
    console.error("Error navigating to DigiKey:", error);
    await browser.close();
    throw new Error("Failed to navigate to DigiKey");
  }

  try {
    await page.type("#username", process.env.digikey_username);
  } catch (error) {
    console.error("Error typing username:", error);
    await browser.close();
    throw new Error("Failed to type username");
  }

  try {
    await page.type("#password", process.env.digikey_password);
  } catch (error) {
    console.error("Error typing password:", error);
    await browser.close();
    throw new Error("Failed to type password");
  }

  try {
    await page.click("#signOnButton");
  } catch (error) {
    console.error("Error clicking sign-on button:", error);
    await browser.close();
    throw new Error("Failed to click sign-on button");
  }

  try {
    await page.waitForNavigation({ waitUntil: "networkidle0" });
  } catch (error) {
    console.error("Error waiting for navigation:", error);
    await browser.close();
    throw new Error("Failed to wait for navigation");
  }

  try {
    await page.click('button.map-button[data-testid="Open-2"]');
  } catch (error) {
    console.error("Error clicking map button:", error);
    await browser.close();
    throw new Error("Failed to click map button");
  }

  try {
    await page.waitForResponse(
      (response) =>
        response.url() ===
        "https://digikey.cloud.microstrategy.com/MicroStrategyLibrarySRPortal/api/sessions"
    );
  } catch (error) {
    console.error("Error waiting for response:", error);
    await browser.close();
    throw new Error("Failed to wait for response");
  }

  let result;
  try {
    result = await responsePromise;
  } catch (error) {
    console.error("Error resolving response promise:", error);
    await browser.close();
    throw new Error("Failed to resolve response promise");
  }

  try {
    await browser.close();
  } catch (error) {
    console.error("Error closing browser:", error);
    throw new Error("Failed to close browser");
  }

  return result;
}
```

* `getDigiKeyMicroStrategySession()`: Launches a headless browser, logs in to the DigiKey supplier portal, and extracts session credentials.
  * Launches a headless browser with specified arguments.
  * Opens a new page and navigates to the DigiKey supplier portal.
  * Types in the username and password from environment variables.
  * Clicks the sign-on button and waits for navigation to complete.
  * Clicks a button to trigger a specific session response.
  * Waits for a response containing the session credentials and resolves them.
  * Closes the browser and returns the session credentials.

#### getCredsFromSetHeaders Function

```javascript
export function getCredsFromSetHeaders(cookie) {
  let mstrSessionCORSRegex = /mstrSessionCORS=(\w+);/gm;
  let JSESSIONIDRegex = /JSESSIONID=(\w+);/gm;
  let mstrSessionCORS = cookie.match(mstrSessionCORSRegex);
  let JSESSIONID = cookie.match(JSESSIONIDRegex);

  return `${mstrSessionCORS} ${JSESSIONID}`;
}
```

* `getCredsFromSetHeaders(cookie)`: Parses session cookies from response headers.
  * Uses regular expressions to extract `mstrSessionCORS` and `JSESSIONID` cookies.
  * Returns a concatenated string of the extracted cookies.

#### csvRequest Function

```javascript
export async function csvRequest(cookies, authToken, document) {
  let instanceURL;
  let instanceDataURL;

  if (document == "inventory") {
    instanceURL =
      "https://digikey.cloud.microstrategy.com/MicroStrategyLibrarySRPortal/api/documents/206EF18843BBEE37A42BDFB6522F908B/instances/";
    instanceDataURL = `/visualizations/W59DF347374C0424A8755FA262F82AA87/csv`;
  } else if (document == "sales") {
    instanceURL =
      "https://digikey.cloud.microstrategy.com/MicroStrategyLibrarySRPortal/api/documents/D3B8AC6A4623434AC54CE080D69088A5/instances/";
    instanceDataURL = "/visualizations/WE94053832E16401AA38932E4A34B67AD/csv";
  } else if (document == "fees") {
    instanceURL =
      "https://digikey.cloud.microstrategy.com/MicroStrategyLibrarySRPortal/api/documents/D3F9F015467D80E7F22E62A4E7BE46CD/instances/";
    instanceDataURL = "/visualizations/WAE3C08969CC64D58885A38E54E8F6FCB/csv";
  } else if (document == "billing") {
    instanceURL =
      "https://digikey.cloud.microstrategy.com/MicroStrategyLibrarySRPortal/api/documents/D7947E2742187FF15E09CFA2ED15C336/instances/";
    instanceDataURL = "/visualizations/W377C0B43D32145D7AB5D515D7776F7D1/csv";
  } else {
    return false;
  }

  let instance = await fetch(instanceURL, {
    headers: {
      "content-type": "application/json",
      "x-mstr-authtoken": authToken,
      "x-mstr-projectid": process.env.digikey_project_id,
      cookie: cookies,
    },
    body: '{"filters":[],"vizAppearances":[],"persistViewState":true,"resolveOnly":false}',
    method: "POST",
  });
  let instanceData = await instance.json();

  try {
    const response = await fetch(
      `${instanceURL}${instanceData.mid}${instanceDataURL}`,
      {
        method: "POST",
        headers: {
          "X-Mstr-Authtoken": `${authToken}`,
          "X-MSTR-ProjectID": process.env.digikey_project_id,
          Prefer: "respond-async",
          Cookie: cookies,
        },
      }
    );

    if (!response.ok) {
      if (response.status == 401) {
        let expiredSession = new Error("Session expired!");
        expiredSession.statusCode = 401;
        throw expiredSession;
      } else {
        throw new Error(
          `HTTP error! Status: ${response.status} \n ${await response.text()}`
        );
      }
    }

    const data = await response.arrayBuffer();
    let buffer = Buffer.from(data);

    return buffer;
  } catch (error) {
    throw error;
  }
}
```

* `csvRequest(cookies, authToken, document)`: Fetches CSV data from MicroStrategy based on document type.
  * Determines the appropriate `instanceURL` and `instanceDataURL` based on the document type.
  * Creates a report instance in MicroStrategy and retrieves its data.
  * Fetches the CSV data for the specified document.
  * Returns the CSV data as a buffer.

### Environment Variables

* `CHROME_PATH`: Path to the Chrome executable for Puppeteer.
* `digikey_username`: Username for DigiKey login.
* `digikey_password`: Password for DigiKey login.
* `digikey_project_id`: Project ID for DigiKey MicroStrategy API.

### External Dependencies

* **puppeteer**: Provides a high-level API to control Chrome or Chromium.
* **dotenv**: Loads environment variables from a `.env` file.

### Functions

* **getDigiKeyMicroStrategySession**: Launches a headless browser, logs in to the DigiKey supplier portal, and extracts session credentials.
* **getCredsFromSetHeaders**: Parses session cookies from response headers.
* **csvRequest**: Fetches CSV data from MicroStrategy based on document type.
