import express, { json } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "dotenv";
import { schedule } from "node-cron";
import {
  retrieveMongoSalesData,
  convertMongoDataToCSV,
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

app.get("/csv/sales", authorize, async (req, res) => {
  let csvData;
  try {
    logExceptOnTest("getting sales data from mongo...");
    let salesData = await retrieveMongoSalesData();
    logExceptOnTest("converting sales data to csv...");
    csvData = convertMongoDataToCSV(salesData);
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

app.patch("/test/sync_competitor_db", authorize, async (req, res) => {
  try {
    await handleCompetitorRefresh(122000);
    res.status(200).end();
  } catch (error) {
    console.error(`error occurred on /test/sync_competitor_db: ${error}`);
    res.status(500).end(`Error occurred!`);
  }
});

app.patch("/sync_competitor_db", authorize, async (req, res) => {
  try {
    let results = handleCompetitorRefresh(0);
    res.status(202).send();
    await results;
  } catch (error) {
    console.error(`competitor refresh failed: ${error}\n${error.stack}`);
    res.status(500).end();
  }
});

app.get("/health_check", authorize, (req, res) => {
  res.status(200).send().end();
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
  try {
    await handleCompetitorRefresh(0);
  } catch (error) {
    console.error(`competitor refresh failed: ${error}\n${error.stack}`);
  }
});

export default app;
