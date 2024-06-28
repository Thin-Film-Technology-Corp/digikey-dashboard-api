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
} from "./mongoOperation.js";

const app = express();

config();

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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
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
    console.log("Refreshing MongoDB data from sales API...");
    await syncMongoSalesData(); // refresh mongo data
    console.log("\ncompleted!");
  } catch (error) {
    console.error(
      `Error while completing scheduled refresh of Mongo data:: ${error} \n${error.stack}`
    );
  }
});
