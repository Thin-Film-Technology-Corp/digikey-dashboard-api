import express, { json } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "dotenv";
import { csvRequest } from "./login.js";
import { microstrategySessionCredentials } from "./getSessionCookies.js";

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

const getSessionCredentials = async () => {
  console.log("Fetching new session credentials...");
  sessionObj = await microstrategySessionCredentials(
    process.env.digikey_username,
    process.env.digikey_password
  );
  console.log(`\nsession obj: ${JSON.stringify(sessionObj)}\n `);
  return sessionObj;
};

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
      console.log(`Error getting CSVs: ${error} \n${error.stack}`);
      if (error.statusCode === 401 && retries < 2) {
        retries++;
        console.log("Session expired. Fetching new session credentials...");
        sessionObj = await getSessionCredentials();
        return getCsvData(); // Retry with new session credentials
      } else if (error.statusCode === 401 && retries < 2) {
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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
