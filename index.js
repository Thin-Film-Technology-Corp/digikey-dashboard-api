import express, { json } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "dotenv";
import { schedule } from "node-cron";
import { csvRequest } from "./login.js";
import { microstrategySessionCredentials } from "./getSessionCookies.js";
import {
  syncMongoSalesData,
  retrieveMongoSalesData,
  convertMongoDataToCSV,
  syncMongoPartData,
  converPartDataToCSV,
  retrieveMongoPartData,
  flattenPartData,
} from "./mongoOperation.js";
import { handleCompetitorRefresh } from "./competitor_syncing/competitorSync.js";

const app = express();

config();

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
}

app.use(json());
app.use(helmet());

const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS || 60000, // 1 minute default
  max: process.env.RATE_LIMIT_MAX || 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});

app.use(limiter);

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

// In-memory storage for session credentials
let sessionObj = null;

const getSessionCredentials = async (retries = 3) => {
  try {
    if (retries <= 0) {
      throw new Error("Exceeded maximum retries to fetch session credentials.");
    }

    logExceptOnTest("Fetching new session credentials...");
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
      logExceptOnTest(`Retrying... (${retries - 1} retries left)`);
      return await getSessionCredentials(retries - 1);
    } else {
      throw new Error(
        "Failed to fetch session credentials after multiple retries."
      );
    }
  }
};

app.get("/csv/sales", authorize, async (req, res) => {
  let csvData;
  try {
    logExceptOnTest("getting sales data from mongo...");
    let salesData = await retrieveMongoSalesData();
    logExceptOnTest("converting sales data to csv...");
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
  logExceptOnTest("sending csv...");
  res.status(200).send(csvData).end();
});

// send all mongo parts
app.get("/csv/parts", authorize, async (req, res) => {
  const partData = await retrieveMongoPartData();
  const flattenedData = flattenPartData(partData);
  const csv = converPartDataToCSV(flattenedData);

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="digikey_sales_report.csv"`
  );
  return res.status(200).send(csv);
});

app.get("/csv/:document", authorize, async (req, res) => {
  const paths = ["inventory", "fees", "billing"];

  if (!paths.includes(req.params.document)) {
    logExceptOnTest(`Document not described ${req.params.document}`);
    res.status(400).end("Bad request");
    return;
  }

  let retries = 0;
  const maxRetries = 2;

  const getCsvData = async () => {
    try {
      logExceptOnTest("Retrieving session information...");
      if (!sessionObj) {
        sessionObj = await getSessionCredentials();
      }
      logExceptOnTest("Using session information...");

      const csvBuffer = await csvRequest(
        sessionObj.sessionCookies,
        sessionObj.authToken,
        req.params.document
      );
      logExceptOnTest("Retrieved CSV data...");

      const csv = csvBuffer.toString("utf-8");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="digikey_${req.params.document}_report.csv"`
      );
      logExceptOnTest("Sending CSV data...");
      res.status(200).send(csv).end();
    } catch (error) {
      logExceptOnTest(`Error getting CSVs: ${error.message} \n${error.stack}`);
      if (error.statusCode === 401 && retries < maxRetries) {
        retries++;
        logExceptOnTest("Session expired. Fetching new session credentials...");
        sessionObj = await getSessionCredentials();
        return getCsvData(); // Retry with new session credentials
      } else if (error.statusCode === 401 && retries >= maxRetries) {
        logExceptOnTest("Received request while authorizing!");
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

app.patch("/sync_mongo_data", authorize, async (req, res) => {
  try {
    logExceptOnTest("Refreshing MongoDB data from sales API...");
    await syncMongoSalesData(); // refresh mongo data
    logExceptOnTest("\ncompleted!\n\nRefreshing MongoDB data from part API...");
    await syncMongoPartData();
    logExceptOnTest("completed!");
    return res.status(200).end();
  } catch (error) {
    console.error(
      `Error while completing manual refresh of Mongo data:: ${error} \n${error.stack}`
    );
    return res.status(500).end("Error syncing data!");
  }
});

app.patch("/sync_comp_db/chip_resistor", authorize, async (req, res) => {
  try {
    await syncCompetitors();
    return res.status(200).end();
  } catch (error) {
    console.log(error);
    return res.status(500).end();
  }
});

app.patch("/test/sync_competitor_db", authorize, async (req, res) => {
  try {
    await handleCompetitorRefresh(122000);
    res.status(200).end();
  } catch (error) {
    console.error(`error occurred on /test/sync_competitor_db: ${error}`);
    res.status(500).end(`Error occurred!`);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logExceptOnTest(`Server is listening on port ${port}`);
});

// Cron job format explanation
// The following lines are used to explain the node-cron scheduling format
// ┌────────────── second (optional)
// │ ┌──────────── minute
// │ │ ┌────────── hour
// │ │ │ ┌──────── day of month
// │ │ │ │ ┌────── month
// │ │ │ │ │ ┌──── day of week
// │ │ │ │ │ │
// │ │ │ │ │ │
// * * * * * *

schedule("0 11 * * *", async () => {
  // Schedule a task every day at 6 AM
  try {
    logExceptOnTest("Refreshing MongoDB data from sales API...");
    await syncMongoSalesData(); // refresh mongo data
    logExceptOnTest("\ncompleted!\n\nRefreshing MongoDB data from part API...");
    await syncMongoPartData();
    logExceptOnTest("completed!");
  } catch (error) {
    console.error(
      `Error while completing scheduled refresh of Mongo data:: ${error} \n${error.stack}`
    );
  }
  try {
    await handleCompetitorRefresh(0);
  } catch (error) {
    console.error(`competitor refresh failed: ${error}\n${error.stack}`);
  }
});

export default app;
