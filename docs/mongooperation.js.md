---
description: Exported functions for operating the Mongo Database
---

# mongoOperation.js

## MongoDB Operations Documentation

### Overview

This file contains functions for interacting with MongoDB, including synchronizing sales data, retrieving sales data, and converting MongoDB data to CSV format. It handles fetching data from an external source, processing it, and updating MongoDB collections.

### Dependencies

* `dotenv`: Loads environment variables from a .env file.
* `mongodb`: MongoDB driver for Node.js.
* `csvRequest`: Custom module for handling CSV requests.
* `microstrategySessionCredentials`: Custom module for fetching session credentials.
* `crypto`: Node.js module for cryptographic functionalities.

### Environment Variables

The application uses the following environment variables:

* `part_parametric_connection_string`: Connection string for MongoDB.
* `digikey_username`: Username for fetching session credentials.
* `digikey_password`: Password for fetching session credentials.

### Functions

#### syncMongoSalesData

Synchronizes MongoDB sales data with data fetched from an external source.

**Example**

```javascript
export async function syncMongoSalesData() {
  const client = new MongoClient(process.env.part_parametric_connection_string);

  await client.connect();

  const db = client.db("part-parametrics");
  const salesCollection = db.collection("sales_data");

  let csvData = await getCsvData();
  let salesJSON = turnCSVIntoJSON(csvData);

  let monthData = salesJSON.filter((salesRecord) => {
    return removeExtraMonthsAddHash(salesRecord);
  });

  await insertIfNotExists(client, "part-parametrics", "sales_data", monthData);

  let linkPartDataPipeline = [
    {
      $match: {
        part_details: {
          $exists: false,
        },
      },
    },
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

  console.log("aggregating data...");
  await salesCollection.aggregate(linkPartDataPipeline).toArray();

  await client.close();
  return salesJSON;
}
```

#### getCsvData

Fetches CSV data from an external source using session credentials.

**Example**

```javascript
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

    return csvBuffer.toString("utf-16le");
  } catch (error) {
    console.log(`Error getting CSVs: ${error.message} \n${error.stack}`);
    if (error.statusCode === 401 && retries < maxRetries) {
      retries++;
      console.log("Session expired. Fetching new session credentials...");
      sessionObj = await getSessionCredentials();
      return getCsvData();
    } else if (error.statusCode === 401 && retries >= maxRetries) {
      console.log("Received request while authorizing!");
      return;
    } else {
      return;
    }
  }
}
```

#### getSessionCredentials

Fetches session credentials with a retry mechanism.

**Parameters**

* `retries`: Number of retry attempts.

**Example**

```javascript
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
```

#### turnCSVIntoJSON

Converts CSV data into JSON format.

**Parameters**

* `csv`: CSV data as a string.

**Example**

```javascript
function turnCSVIntoJSON(csv) {
  const retArr = [];
  let lines = csv.split(`\r\n`);

  for (let i = 1; i < lines.length; i++) {
    let lineArr = lines[i].split(`","`);
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
```

#### removeExtraMonthsAddHash

Filters out non-current month items and adds a document hash to avoid duplicates.

**Parameters**

* `jsonData`: JSON data to be processed.

**Example**

```javascript
function removeExtraMonthsAddHash(jsonData) {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
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
```

#### insertIfNotExists

Inserts documents into a MongoDB collection if they do not already exist.

**Parameters**

* `client`: MongoDB client instance.
* `dbName`: Name of the database.
* `collectionName`: Name of the collection.
* `documents`: Array of documents to be inserted.

**Example**

```javascript
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
```

#### retrieveMongoSalesData

Retrieves sales data from MongoDB based on specified parameters.

**Parameters**

* `month`: Month of the sales data.
* `year`: Year of the sales data.
* `customer`: Customer name.
* `partNumber`: Part number.

**Example**

```javascript
export async function retrieveMongoSalesData(
  month,
  year,
  customer,
  partNumber
) {
  const client = new MongoClient(process.env.part_parametric_connection_string);

  await client.connect();

  const db = client.db("part-parametrics");
  const salesCollection = db.collection("sales_data");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
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
```

#### getProductGroup

Determines the product group based on part details.

**Parameters**

* `data`: Data containing part details.

**Example**

```javascript
function getProductGroup(data) {
  const csrPrefixes = [
    "D1WEL", "D1CPA", "D1CPC", "D1FCP",
    "D1MPA", "D1MPC", "D1WKL", "D

1WRL",
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
```

#### convertMongoDataToCSV

Converts MongoDB data to CSV format.

**Parameters**

* `data`: MongoDB data to be converted.

**Example**

```javascript
export async function convertMongoDataToCSV(data) {
  let csvData = `Month, Invoiced Date, Customer Company, Customer City, Customer State/Prov, Customer Postal Code, Ship To Company, Ship To City, Ship To State/Prov, Ship To Postal Code, Ship To Country, DK Part Nbr, Mfg Part Number, Return Flag, Shipped Qty, Total Billable Orders, Series, Product Group`;
  data.forEach((salesLine, i) => {
    csvData += `\n"${salesLine["Month"]}","${salesLine["Invoiced Date"]}","${salesLine["Customer Company"]}","${salesLine["Customer City"]}","${salesLine["Customer State/Prov"]}","${salesLine["Customer Postal Code"]}","${salesLine["Ship To Company"]}","${salesLine["Ship To City"]}","${salesLine["Ship To State/Prov"]}","${salesLine["Ship To Postal Code"]}","${salesLine["Ship To Country"]}","${salesLine["DK Part Nbr"]}","${salesLine["Mfg Part Number"]}","${salesLine["Return Flag"]}","${salesLine["Shipped Qty"]}","${salesLine["Total Billable Orders"]}","${salesLine["Series"]}","${salesLine["ProductGroup"]}"`;
  });

  return csvData;
}
```
