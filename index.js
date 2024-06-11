const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { config } = require("dotenv");
const { getDigiKeyMicroStrategySession, csvRequest } = require("./login");

const app = express();

app.use(express.json());

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

  const token = authHeader.split(" ")[1];
  if (token !== process.env.AUTH_TOKEN) {
    return res.status(403).json({ message: "Invalid authorization token" });
  }

  next();
};

app.get("/csv/:document", authorize, async (req, res) => {
  let sessionObj;
  const paths = ["inventory", "sales", "fees", "billing"];

  if (!paths.includes(req.params.document)) {
    console.log(`document not described ${req.params.document}`);
    res.status(400).end("bad request");
  }

  try {
    sessionObj = await getDigiKeyMicroStrategySession();
    console.log("retrieved session information...");
  } catch (error) {
    console.log(`error getting session object: ${error} \n${error.stack}`);
    res.status(500).end("internal error!");
  }

  try {
    let csvBuffer = await csvRequest(
      sessionObj.sessionCookies,
      sessionObj.authToken,
      req.params.document
    );
    console.log("retrieved csv data...");
    let csv = csvBuffer.toString("utf-8");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="./digikey_${req.params.document}_report.csv"`
    );
    console.log("sending csv data...");
    res.status(200).send(csv).end();
    return;
  } catch (error) {
    console.log(`error getting csvs: ${error} \n${error.stack}`);
    res.status(500).end("internal error!");
  }
});

app.listen();
