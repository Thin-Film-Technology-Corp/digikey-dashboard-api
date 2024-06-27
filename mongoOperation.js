import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { csvRequest } from "./login.js";
import { microstrategySessionCredentials } from "./getSessionCookies.js";
import crypto from "crypto";

config();

export async function syncMongoSalesData() {
  // connect to mongo collection
  const client = new MongoClient(process.env.part_parametric_connection_string);

  await client.connect();

  const db = client.db("part-parametrics");
  const salesCollection = db.collection("sales_data");

  //   retrieve csv of sales data from DK
  let csvData = await getCsvData();

  let salesJSON = turnCSVIntoJSON(csvData);

  // parse out all non-current month items, add document hash so we dont duplicate
  let monthData = salesJSON.filter((salesRecord) => {
    return removeExtraMonthsAddHash(salesRecord);
  });

  await insertIfNotExists(client, "part-parametrics", "sales_data", monthData);

  // link part data from part_parametrics collection to the order
  let linkPartDataPipeline = [
    {
      $lookup: {
        from: "part_parametrics",
        localField: "Mfg Part Number",
        foreignField: "part_number",
        as: "part_details",
      },
    },
    {
      $unwind: {
        path: "$part_details",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $merge: {
        into: "sales_data",
      },
    },
  ];

  salesCollection.aggregate(linkPartDataPipeline);

  await client.close();
  return salesJSON;
}

async function getCsvData() {
  let sessionObj;
  try {
    sessionObj = await getSessionCredentials();

    console.log("Using session information...");

    const csvBuffer = await csvRequest(
      sessionObj.sessionCookies,
      sessionObj.authToken,
      "sales"
    );
    console.log("Retrieved CSV data...");

    // const csv = Buffer.from(csvBuffer, "binary").toString("utf-8");
    return csvBuffer.toString("utf-16le");
  } catch (error) {
    console.log(`Error getting CSVs: ${error.message} \n${error.stack}`);
    if (error.statusCode === 401 && retries < maxRetries) {
      retries++;
      console.log("Session expired. Fetching new session credentials...");
      sessionObj = await getSessionCredentials();
      return getCsvData(); // Retry with new session credentials
    } else if (error.statusCode === 401 && retries >= maxRetries) {
      console.log("Received request while authorizing!");
      return;
    } else {
      return;
    }
  }
}

async function getSessionCredentials(retries) {
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
      console.log(`\n\nRetrying... (${retries - 1} retries left)\n\n`);
      return await getSessionCredentials(retries - 1);
    } else {
      throw new Error(
        "Failed to fetch session credentials after multiple retries."
      );
    }
  }
}

function turnCSVIntoJSON(csv) {
  const retArr = [];
  // console.log(csv);
  let lines = csv.split(`\r\n`);
  // console.log(lines);

  for (let i = 1; i < lines.length; i++) {
    // console.log(i);
    let lineArr = lines[i].split(`","`);
    // console.log(lineArr);
    let retObj = {};
    lines[0].split(`,`).forEach((elem) => {
      elem = elem.replace(/['"\uFEFF]*/gm, "");
      retObj[`${elem}`] = null;
    });
    let keys = Object.keys(retObj);
    for (let j = 0; j < lineArr.length; j++) {
      let item = `${lineArr[j]}`;
      item = item.replace(/['"]*/gm, "");
      retObj[keys[j]] = item;
    }
    retArr.push(retObj);
  }
  return retArr;
}

function removeExtraMonthsAddHash(jsonData) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const currentDate = new Date();
  const currentMonth = months[currentDate.getMonth()];
  const currentYear = currentDate.getFullYear();
  const month = jsonData.Month?.split(" ")[0];
  const year = parseInt(jsonData.Month.split(" ")[1]);

  if (currentMonth === month && currentYear === year) {
    jsonData.document_hash = crypto
      .createHash("md5")
      .update(JSON.stringify(jsonData))
      .digest("hex");
    return jsonData;
  }
}

async function insertIfNotExists(client, dbName, collectionName, documents) {
  const db = client.db(dbName);
  const col = db.collection(collectionName);

  const bulkOps = documents.map((doc) => ({
    updateOne: {
      filter: { document_hash: doc.document_hash },
      update: { $setOnInsert: doc },
      upsert: true,
    },
  }));

  try {
    const result = await col.bulkWrite(bulkOps);
    console.log(`Inserted ${result.upsertedCount} new document(s).`);
  } catch (err) {
    console.error(`Failed to insert documents: ${err}`);
  }
}

export async function retrieveMongoSalesData(
  month,
  year,
  customer,
  partNumber
) {
  // process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
  const client = new MongoClient(process.env.part_parametric_connection_string);

  await client.connect();

  const db = client.db("part-parametrics");
  const salesCollection = db.collection("sales_data");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  month = months[month - 1] || null;
  year = year || null;
  customer = customer?.toUpperCase() || null;
  partNumber = partNumber?.toUpperCase() || null;
  let dateRegex = "";

  if (month) {
    dateRegex += month;
  }
  if (year) {
    dateRegex += ` ${year}`;
  }

  let query = {};
  if (dateRegex) {
    query.Month = { $regex: dateRegex };
  }
  if (customer) {
    query["Customer Company"] = { $regex: customer };
  }
  if (partNumber) {
    query["Mfg Part Number"] = { $regex: partNumber };
  }

  let results = await salesCollection.find(query).toArray((err) => {
    if (err) {
      throw err;
    }
  });

  results = results.map((result) => {
    result.ProductGroup = getProductGroup(result);
    return result;
  });

  await client.close();

  return results;
}

function getProductGroup(data) {
  const csrPrefixes = [
    "D1WEL",
    "D1CPA",
    "D1CPC",
    "D1FCP",
    "D1MPA",
    "D1MPC",
    "D1WKL",
    "D1WRL",
  ];
  const thickFilmPrefixes = ["D1LP", "D1TFA"];
  const cssPrefixes = ["D1CSA"];
  let partNumber = data["Mfg Part Number"];

  if (data.part_details.resistance_tolerance.toUpperCase() === "JUMPER") {
    return "JUMPER";
  }

  if (cssPrefixes.some((prefix) => partNumber.startsWith(prefix))) return "CSS";

  if (csrPrefixes.some((prefix) => partNumber.startsWith(prefix))) return "CSR";

  if (thickFilmPrefixes.some((prefix) => partNumber.startsWith(prefix)))
    return "Thick Film";

  return 0;
}

export async function convertMongoDataToCSV(data) {
  let csvData = `Month, Invoiced Date, Customer Company, Customer City, Customer State/Prov, Customer Postal Code, Ship To Company, Ship To City, Ship To State/Prov, Ship To Postal Code, Ship To Country, DK Part Nbr, Mfg Part Number, Return Flag, Shipped Qty, Total Billable Orders, Series, Product Group`;
  data.forEach((salesLine) => {
    csvData += `\n"${salesLine["Month"]}","${salesLine["Invoiced Date"]}","${salesLine["Customer Company"]}","${salesLine["Customer City"]}","${salesLine["Customer State/Prov"]}","${salesLine["Customer Postal Code"]}","${salesLine["Ship To Company"]}","${salesLine["Ship To City"]}","${salesLine["Ship To State/Prov"]}","${salesLine["Ship To Postal Code"]}","${salesLine["Ship To Country"]}","${salesLine["DK Part Nbr"]}","${salesLine["Mfg Part Number"]}","${salesLine["Return Flag"]}","${salesLine["Shipped Qty"]}","${salesLine["Total Billable Orders"]}","${salesLine["Series"]}","${salesLine["ProductGroup"]}"`;
  });

  return csvData;
}
