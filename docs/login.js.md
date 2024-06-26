---
description: >-
  The login.js file contains functions to handle session management and CSV data
  retrieval from DigiKey using Puppeteer.
---

# login.js

### Dependencies

* **dotenv**: A zero-dependency module that loads environment variables from a `.env` file into `process.env`.

### Configuration

The configuration is set up using `dotenv` to load environment variables.

```javascript
import { config } from "dotenv";
config();
```

### Functions

#### `getCredsFromSetHeaders`

Extracts session credentials from a cookie string.

**Parameters**

* `cookie` (string): The cookie string containing session information.

**Returns**

* `string`: A string containing extracted session credentials.

**Example**

```javascript
export function getCredsFromSetHeaders(cookie) {
  let mstrSessionCORSRegex = /mstrSessionCORS=(\w+);/gm;
  let JSESSIONIDRegex = /JSESSIONID=(\w+);/gm;
  let mstrSessionCORS = cookie.match(mstrSessionCORSRegex);
  let JSESSIONID = cookie.match(JSESSIONIDRegex);

  return `${mstrSessionCORS} ${JSESSIONID}`;
}
```

#### `csvRequest`

Makes a request to the MicroStrategy API to create and fetch CSV data for the specified document type.

**Parameters**

* `cookies` (string): The session cookies used for authentication.
* `authToken` (string): The authorization token.
* `document` (string): The type of document to fetch (e.g., `inventory`, `sales`, `fees`, `billing`).

**Returns**

* `Buffer`: A buffer containing the CSV data.
* `false`: If the document type is invalid.

**Example**

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

### Usage

1. **Loading Environment Variables**: Ensure that you have a `.env` file with the required environment variables such as `digikey_project_id`.
2. **Extracting Credentials**: Use the `getCredsFromSetHeaders` function to extract session credentials from the cookie string.
3. **Making CSV Requests**: Use the `csvRequest` function to fetch CSV data for the desired document type. This function handles the creation and retrieval of the report from the MicroStrategy API.

#### Example

```javascript
import { getCredsFromSetHeaders, csvRequest } from './path/to/module';

const cookies = "mstrSessionCORS=abcd1234; JSESSIONID=efgh5678;";
const authToken = "your_auth_token";
const documentType = "inventory";

const sessionCreds = getCredsFromSetHeaders(cookies);
csvRequest(sessionCreds, authToken, documentType)
  .then((csvData) => {
    // Handle the CSV data
    console.log("CSV Data:", csvData.toString('utf-8'));
  })
  .catch((error) => {
    // Handle errors
    console.error("Error fetching CSV data:", error);
  });
```

This documentation provides a comprehensive overview of the modules, their functions, and how to use them within your API. For any further queries, refer to the source code or contact the development team.
