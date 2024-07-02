---
description: >-
  The index.js file sets up an Express server with various middleware and route
  handlers to serve CSV files based on specific requests.
---

# index.js (Express router)

## API Documentation

### Overview

This file initializes an Express application, configures middleware for security and rate limiting, defines authorization logic, and sets up routes to handle CSV file requests and synchronize MongoDB data. The main functionalities include:

* Configuring middleware
* Handling authorization
* Fetching and caching session credentials
* Serving CSV files based on document type

### Dependencies

* `express`: A minimal and flexible Node.js web application framework.
* `helmet`: Helps secure Express apps by setting various HTTP headers.
* `express-rate-limit`: Basic IP rate-limiting middleware for Express.
* `dotenv`: Loads environment variables from a .env file.
* `csvRequest`: Custom module for handling CSV requests.
* `microstrategySessionCredentials`: Custom module for fetching session credentials.
* `node-cron`: Module for scheduling tasks in Node.js.
* `mongoOperation`: Custom module for MongoDB operations.

### Environment Variables

The application uses the following environment variables:

* `PORT`: Port number on which the server will listen.
* `RATE_LIMIT_WINDOW_MS`: Time window in milliseconds for rate limiting (default: 60000 ms).
* `RATE_LIMIT_MAX`: Maximum number of requests per IP per window (default: 100).
* `AUTH_TOKEN`: Token used for authorizing API requests.
* `digikey_username`: Username for fetching session credentials.
* `digikey_password`: Password for fetching session credentials.

### Middleware

#### Helmet

Helmet helps secure the application by setting various HTTP headers.

```javascript
app.use(helmet());
```

#### JSON Parsing

Express JSON middleware is used to parse incoming JSON requests.

```javascript
app.use(express.json());
```

#### Rate Limiting

Rate limiting middleware to limit repeated requests to public APIs.

```javascript
const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS || 60000, // 1 minute default
  max: process.env.RATE_LIMIT_MAX || 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});

app.use(limiter);
```

#### Authorization

Custom middleware to check for the presence and validity of the Authorization header.

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

### Routes

#### GET /csv/:document

Fetches CSV data for the specified document. The available document types are inventory, fees, and billing.

**Request**

* URL Parameters:
  * `document`: Type of document to fetch (e.g., inventory, fees, billing).

**Response**

* Success (200): Returns CSV data for the requested document.
* Client Error (400): If the requested document type is invalid.
* Unauthorized (401): If the authorization header is missing.
* Forbidden (403): If the authorization token is invalid.
* Server Error (500): If there is an internal server error.

**Example**

```javascript
app.get("/csv/:document", authorize, async (req, res) => {
  const paths = ["inventory", "fees", "billing"];

  if (!paths.includes(req.params.document)) {
    console.log(`Document not described ${req.params.document}`);
    res.status(400).end("Bad request");
    return;
  }

  let retries = 0;
  const maxRetries = 2;

  const getCsvData = async () => {
    try {
      console.log("Retrieving session information...");
      if (!sessionObj) {
        sessionObj = await getSessionCredentials();
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
      console.log(`Error getting CSVs: ${error.message} \n${error.stack}`);
      if (error.statusCode === 401 && retries < maxRetries) {
        retries++;
        console.log("Session expired. Fetching new session credentials...");
        sessionObj = await getSessionCredentials();
        return getCsvData(); // Retry with new session credentials
      } else if (error.statusCode === 401 && retries >= maxRetries) {
        console.log("Received request while authorizing!");
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

#### GET /csv/sales

Fetches CSV data for sales documents from MongoDB.

**Example**

```javascript
app.get("/csv/sales", authorize, async (req, res) => {
  let csvData;
  try {
    console.log("getting sales data from mongo...");
    let salesData = await retrieveMongoSalesData();
    console.log("converting sales data to csv...");
    csvData = await convertMongoDataToCSV(salesData);
  } catch (error) {
    console.error(
      `error getting csv for sales from mongo: ${error} \n ${error.stack}`
    );
    return res.status(500).end();
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="digikey_sales_report.csv"`
  );
  console.log("sending csv...");
  res.status(200).send(csvData).end();
});
```

#### PATCH /sync\_mongo\_data

Synchronizes MongoDB data with the sales API.

**Example**

```javascript
app.patch("/sync_mongo_data", authorize, async (req, res) => {
  try {
    console.log("Refreshing MongoDB data from sales API...");
    await syncMongoSalesData(); // refresh mongo data
    console.log("\ncompleted!");
    return res.status(200).end();
  } catch (error) {
    console.error(
      `Error while completing manual refresh of Mongo data:: ${error} \n${error.stack}`
    );
    return res.status(500).end("Error syncing data!");
  }
});
```

### Helper Functions

#### getSessionCredentials

Fetches session credentials with a retry mechanism.

**Parameters**

* `retries`: Number of retry attempts (default: 3).

**Example**

```javascript
const getSessionCredentials = async (retries = 3) => {
  try {
    if (retries <= 0) {
      throw new Error("Exceeded maximum retries to fetch session credentials.");
    }

    console.log("Fetching new session credentials...");
    const sessionObj = await microstrategySessionCredentials(
      process.env.digikey_username,
      process.env.digikey_password
    );

    if (!sessionObj) {
      throw new Error("Failed to fetch session credentials.");
    }

    return sessionObj;
  } catch (error) {
    console.error(`Error in getSessionCredentials: ${error.message}`);
    if (retries > 1) {
      console.log(`Retrying... (${retries - 1} retries left)`);
      return await getSessionCredentials(retries - 1);
    } else {
      throw new Error(
        "Failed to fetch session credentials after multiple retries."
      );
    }
  }
};
```

### Server Initialization

The server listens on the port specified in the environment variable `PORT` or defaults to 3000.

```javascript
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
```

### Cron Job

Schedules a task to refresh MongoDB data from the sales API every day at 11 AM ZULU.

```javascript
schedule("0 11 * * *", async () => {
  try {
    console.log("Refreshing MongoDB data from sales API...");
    await syncMongoSalesData(); // refresh mongo data
    console.log("\ncompleted!");
  } catch (error) {
    console.error(
      `Error while completing scheduled refresh of Mongo data:: ${error} \n${error.stack}`
    );
  }
});
```
