const express = require("express");
const { config } = require("dotenv");
const { getDigiKeyMicroStrategySession, csvRequest } = require("./login");

const app = express();
app.use(express.json());

app.get("/*", (req, res, next) => {
  // ! Security
  // ! Throttling
  next();
});

app.get("/csv/:document", async (req, res) => {
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

app.listen(3000, () => {
  console.log("server is running!");
});
