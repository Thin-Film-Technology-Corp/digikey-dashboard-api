---
description: >-
  The index.js file sets up an Express server with various middleware and route
  handlers to serve CSV files based on specific requests.
---

# index.js (Express router)

### Overview

This file initializes an Express application, configures middleware for security and rate limiting, defines authorization logic, and sets up a route to handle CSV file requests. The main functionalities include:

* Configuring middleware
* Handling authorization
* Fetching and caching session credentials
* Serving CSV files based on document type

### Code Breakdown

#### Import Statements

```javascript
import express, { json } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "dotenv";
import { getDigiKeyMicroStrategySession, csvRequest } from "./login.js";
```

* `express` and `json`: Used to create an Express application and parse JSON payloads.
* `helmet`: Helps secure the app by setting various HTTP headers.
* `rateLimit`: Middleware to limit repeated requests to public APIs.
* `config`: Loads environment variables from a `.env` file.
* `getDigiKeyMicroStrategySession`, `csvRequest`: Functions imported from `login.js` to handle session management and CSV data retrieval.

#### Initialize Express App

```javascript
const app = express();
config();
```

* `app`: The Express application instance.
* `config()`: Loads environment variables.

#### Middleware Configuration

```javascript
app.use(json());
app.use(helmet());
```

* `app.use(json())`: Parses incoming requests with JSON payloads.
* `app.use(helmet())`: Sets various HTTP headers for security.

#### Rate Limiting

```javascript
const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS || 60000, // 1 minute default
  max: process.env.RATE_LIMIT_MAX || 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);
```

* `limiter`: Configures rate limiting to prevent abuse.
  * `windowMs`: Time window in milliseconds for rate limiting.
  * `max`: Maximum number of requests per window per IP.
  * `message`: Message returned when the rate limit is exceeded.

#### Authorization Middleware

```javascript
const authorize = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({ message: "Authorization header is missing" });
  }
  if (authHeader !== process.env.AUTH_TOKEN) {
    return res.status(403).json({ message: "Invalid authorization token" });
  }

  next();
};
```

* `authorize`: Middleware to check for an authorization header and validate its value against a predefined token.

#### Session Management

```javascript
let sessionObj = null;
let isAuthorizing = false;

const getSessionCredentials = async () => {
  isAuthorizing = true;
  console.log("Fetching new session credentials...");
  sessionObj = await getDigiKeyMicroStrategySession();
  isAuthorizing = false;
  return sessionObj;
};
```

* `sessionObj`: Stores session credentials.
* `isAuthorizing`: Tracks whether a session is currently being fetched.
* `getSessionCredentials()`: Fetches new session credentials and updates `sessionObj`.

#### CSV Route Handler

```javascript
app.get("/csv/:document", authorize, async (req, res) => {
  const paths = ["inventory", "sales", "fees", "billing"];

  if (!paths.includes(req.params.document)) {
    console.log(`Document not described ${req.params.document}`);
    res.status(400).end("Bad request");
    return;
  }

  let retries = 0;
  const getCsvData = async () => {
    try {
      console.log("Retrieving session information...");
      if (!sessionObj && !isAuthorizing) {
        sessionObj = await getSessionCredentials();
      } else if (!sessionObj && isAuthorizing) {
        console.log(`Recieved request while authorizing!`);
        return res
          .status(503)
          .end("Please wait for authorization before attempting again");
      }
      console.log("Using session information...");

      const csvBuffer = await csvRequest(
        sessionObj.sessionCookies,
        sessionObj.authToken,
        req.params.document
      );
      console.log("Retrieved CSV data...");

      const csv = csvBuffer.toString("utf-8");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="digikey_${req.params.document}_report.csv"`
      );
      console.log("Sending CSV data...");
      res.status(200).send(csv).end();
    } catch (error) {
      console.log(`Error getting CSVs: ${error} \n${error.stack}`);
      if (error.statusCode === 401 && retries < 2 && !isAuthorizing) {
        retries++;
        console.log("Session expired. Fetching new session credentials...");
        sessionObj = await getSessionCredentials();
        return getCsvData(); // Retry with new session credentials
      } else if (error.statusCode === 401 && retries < 2 && isAuthorizing) {
        console.log(`Recieved request while authorizing!`);
        return res
          .status(503)
          .end("Please wait for authorization before attempting again");
      } else {
        res.status(500).end("Internal error!");
      }
    }
  };

  getCsvData();
});
```

* `app.get("/csv/:document", authorize, async (req, res) => { ... })`: Handles GET requests to fetch CSV files.
  * `authorize`: Middleware to ensure the request is authorized.
  * `paths`: Array of valid document types.
  * `getCsvData()`: Fetches CSV data and handles retries if the session expires.

#### Server Initialization

```javascript
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
```

* `port`: The port on which the server listens.
* `app.listen(port, () => { ... })`: Starts the server and logs the listening port.

### Environment Variables

* `RATE_LIMIT_WINDOW_MS`: Time window for rate limiting (in milliseconds).
* `RATE_LIMIT_MAX`: Maximum number of requests per IP per time window.
* `AUTH_TOKEN`: Authorization token for securing routes.
* `PORT`: Port on which the server runs.

### External Dependencies

* **express**: Fast, unopinionated, minimalist web framework for Node.js.
* **helmet**: Helps secure Express apps by setting various HTTP headers.
* **express-rate-limit**: Basic rate-limiting middleware for Express.
* **dotenv**: Loads environment variables from a `.env` file into `process.env`.

### Functions

* [**getDigiKeyMicroStrategySession**](login.js.md#getdigikeymicrostrategysession-function): Fetches session credentials.
* [**csvRequest**](login.js.md#csvrequest-function): Fetches CSV data based on session credentials and document type.
