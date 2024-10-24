import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { csvRequest } from "./login.js";
import { microstrategySessionCredentials } from "./getSessionCookies.js";
import crypto from "crypto";
import { getAllPartsInDigikeySearchV4 } from "./digiKeyAPI.js";

config();

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
}

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
      $addFields: {
        Series: {
          $regexFind: {
            input: "$Mfg Part Number",
            regex: /D1\D{3}/,
          },
        },
      },
    },
    {
      $addFields: {
        Series: "$Series.match",
      },
    },
    {
      $merge: {
        into: "sales_data",
      },
    },
  ];

  logExceptOnTest("aggregating data...");
  await salesCollection.aggregate(linkPartDataPipeline).toArray();

  await client.close();
  return salesJSON;
}

async function getCsvData() {
  let sessionObj;
  try {
    sessionObj = await getSessionCredentials();

    logExceptOnTest("Using session information...");

    const csvBuffer = await csvRequest(
      sessionObj.sessionCookies,
      sessionObj.authToken,
      "sales"
    );
    logExceptOnTest("Retrieved CSV data...");

    // const csv = Buffer.from(csvBuffer, "binary").toString("utf-8");
    return csvBuffer.toString("utf-16le");
  } catch (error) {
    logExceptOnTest(`Error getting CSVs: ${error.message} \n${error.stack}`);
    if (error.statusCode === 401 && retries < maxRetries) {
      retries++;
      logExceptOnTest("Session expired. Fetching new session credentials...");
      sessionObj = await getSessionCredentials();
      return getCsvData(); // Retry with new session credentials
    } else if (error.statusCode === 401 && retries >= maxRetries) {
      logExceptOnTest("Received request while authorizing!");
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
      logExceptOnTest(`\n\nRetrying... (${retries - 1} retries left)\n\n`);
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
  // logExceptOnTest(csv);
  let lines = csv.split(`\r\n`);
  // logExceptOnTest(lines);

  for (let i = 1; i < lines.length; i++) {
    // logExceptOnTest(i);
    let lineArr = lines[i].split(`","`);
    // logExceptOnTest(lineArr);
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
    logExceptOnTest(`Inserted ${result.upsertedCount} new document(s).`);
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

export function convertMongoDataToCSV(data) {
  let csvData = `Month, Invoiced Date, Customer Company, Customer City, Customer State/Prov, Customer Postal Code, Ship To Company, Ship To City, Ship To State/Prov, Ship To Postal Code, Ship To Country, DK Part Nbr, Mfg Part Number, Return Flag, Shipped Qty, Total Billable Orders, Series, Product Group`;
  data.forEach((salesLine, i) => {
    csvData += `\n"${salesLine["Month"]}","${salesLine["Invoiced Date"]}","${salesLine["Customer Company"]}","${salesLine["Customer City"]}","${salesLine["Customer State/Prov"]}","${salesLine["Customer Postal Code"]}","${salesLine["Ship To Company"]}","${salesLine["Ship To City"]}","${salesLine["Ship To State/Prov"]}","${salesLine["Ship To Postal Code"]}","${salesLine["Ship To Country"]}","${salesLine["DK Part Nbr"]}","${salesLine["Mfg Part Number"]}","${salesLine["Return Flag"]}","${salesLine["Shipped Qty"]}","${salesLine["Total Billable Orders"]}","${salesLine["Series"]}","${salesLine["ProductGroup"]}"`;
  });

  return csvData;
}

export async function syncMongoPartData() {
  const client = new MongoClient(process.env.part_parametric_connection_string);

  try {
    await client.connect();

    const db = client.db("part-parametrics");
    const part_collection = db.collection("part_parametrics");

    let rawParts = await getAllPartsInDigikeySearchV4();

    const partsWrite = rawParts.map((rawPart) => {
      let partFormat = convertPartFormat(rawPart);
      return {
        updateOne: {
          filter: {
            part_number: partFormat.part_number,
          },
          update: { $set: partFormat },
          upsert: true,
        },
      };
    });

    const result = await part_collection.bulkWrite(partsWrite);
    return logExceptOnTest(`Updated ${result.modifiedCount} new document(s).`);
  } catch (error) {
    console.error("An error occurred while syncing part data:", error);
  } finally {
    await client.close();
  }
}

export async function retrieveMongoPartData(partNumber) {
  partNumber = partNumber || null;
  const query = {};
  if (partNumber) {
    query["Mfg Part Number"] = { $regex: partNumber };
  }
  const client = new MongoClient(process.env.part_parametric_connection_string);
  await client.connect();

  const db = client.db("part-parametrics");
  const part_collection = db.collection("part_parametrics");
  let data = await part_collection.find(query).toArray();
  return data;
}

export function flattenPartData(partData) {
  let flattenedData = partData.map((document) => {
    // logExceptOnTest(document);
    return {
      product_description: document.product_description,
      detailed_description: document.detailed_description,
      part_number: document.part_number,
      product_url: document.product_url,
      datasheet_url: document.datasheet_url,
      photo_url: document.photo_url,
      video_url: document.video_url,
      status: document.status,
      resistance: document.resistance,
      resistance_tolerance: document.resistance_tolerance,
      power: document.power,
      composition: document.composition,
      features: document.features?.join(", "),
      temp_coefficient: document.temp_coefficient,
      operating_temperature: document.operating_temperature,
      digikey_case_size: document.digikey_case_size,
      case_size: document.case_size,
      ratings: document.ratings?.join(", "),
      dimensions: document.dimensions,
      height: document.height,
      terminations_number: document.terminations_number,
      fail_rate: document.fail_rate,
      category: document.category,
      sub_category: document.sub_category,
      series: document.series,
      reach_status: document.classifications?.reach_status,
      rohs_status: document.classifications?.rohs_status,
      moisture_sensitivity_level:
        document.classifications?.moisture_sensitivity_level,
      export_control_class_number:
        document.classifications?.export_control_class_number,
      htsus_code: document.classifications?.htsus_code,
      in_digikey: document.in_digikey,
      break_quantity: document.standard_reel_pricing?.BreakQuantity,
      unit_price: document.standard_reel_pricing?.UnitPrice,
      total_price: document.standard_reel_pricing?.TotalPrice,
    };
  });
  return flattenedData;
}

export function converPartDataToCSV(flattenedData) {
  const headers = [
    "product_description",
    "detailed_description",
    "part_number",
    "product_url",
    "datasheet_url",
    "photo_url",
    "video_url",
    "status",
    "resistance",
    "resistance_tolerance",
    "power",
    "composition",
    "features",
    "temp_coefficient",
    "operating_temperature",
    "digikey_case_size",
    "case_size",
    "ratings",
    "dimensions",
    "height",
    "terminations_number",
    "fail_rate",
    "category",
    "sub_category",
    "series",
    "reach_status",
    "rohs_status",
    "moisture_sensitivity_level",
    "export_control_class_number",
    "htsus_code",
    "in_digikey",
    "break_quantity",
    "unit_price",
    "total_price",
  ];
  const csvRows = [headers.join(",")];
  flattenedData.forEach((flattenedDocument) => {
    const values = headers.map((header) => {
      const value = flattenedDocument[header];
      return value !== undefined
        ? `"${String(value).replace(/"/g, '""')}"`
        : '""';
    });
    csvRows.push(values.join(","));
  });

  let csv = csvRows.join("\n");

  return csv;
}

function convertPartFormat(originalData) {
  return {
    product_description: originalData.Description.ProductDescription,
    detailed_description: originalData.Description.DetailedDescription,
    part_number: originalData.ManufacturerProductNumber,
    product_url: originalData.ProductUrl,
    datasheet_url: originalData.DatasheetUrl,
    photo_url: originalData.PhotoUrl,
    video_url: originalData.PrimaryVideoUrl || "",
    status: originalData.ProductStatus.Status,
    resistance:
      originalData.Parameters.find(
        (param) => param.ParameterText === "Resistance"
      )?.ValueText || "",
    resistance_tolerance:
      originalData.Parameters.find(
        (param) => param.ParameterText === "Tolerance"
      )?.ValueText || "",
    power:
      originalData.Parameters.find(
        (param) => param.ParameterText === "Power (Watts)"
      )?.ValueText || "",
    composition:
      originalData.Parameters.find(
        (param) => param.ParameterText === "Composition"
      )?.ValueText || "",
    features: originalData.Parameters.filter(
      (param) => param.ParameterText === "Features"
    ).map((param) => param.ValueText),
    temp_coefficient:
      originalData.Parameters.find(
        (param) => param.ParameterText === "Temperature Coefficient"
      )?.ValueText || "",
    operating_temperature:
      originalData.Parameters.find(
        (param) => param.ParameterText === "Operating Temperature"
      )?.ValueText || "",
    digikey_case_size:
      originalData.Parameters.find(
        (param) => param.ParameterText === "Package / Case"
      )?.ValueText || "",
    case_size:
      originalData.Parameters.find(
        (param) => param.ParameterText === "Supplier Device Package"
      )?.ValueText || "",
    ratings: originalData.Parameters.filter(
      (param) => param.ParameterText === "Ratings"
    ).map((param) => param.ValueText),
    dimensions:
      originalData.Parameters.find(
        (param) => param.ParameterText === "Size / Dimension"
      )?.ValueText || "",
    height:
      originalData.Parameters.find(
        (param) => param.ParameterText === "Height - Seated (Max)"
      )?.ValueText || "",
    terminations_number:
      parseInt(
        originalData.Parameters.find(
          (param) => param.ParameterText === "Number of Terminations"
        )?.ValueText
      ) || 0,
    fail_rate:
      originalData.Parameters.find(
        (param) => param.ParameterText === "Failure Rate"
      )?.ValueText || "",
    category: originalData.Category.Name,
    sub_category:
      originalData.Category.ChildCategories.length > 0
        ? originalData.Category.ChildCategories[0].Name
        : "",
    series: originalData.Series.Name,
    classifications: {
      reach_status: originalData.Classifications.ReachStatus,
      rohs_status: originalData.Classifications.RohsStatus,
      moisture_sensitivity_level:
        originalData.Classifications.MoistureSensitivityLevel,
      export_control_class_number:
        originalData.Classifications.ExportControlClassNumber,
      htsus_code: originalData.Classifications.HtsusCode,
    },
    standard_reel_pricing: originalData.ProductVariations.filter(
      (a) => a.PackageType.Name === "Tape & Reel (TR)"
    )[0].StandardPricing[0],
  };
}

// const regexPNPipeline = [
//   {
//     $match: {
//       Series: {
//         $exists: false,
//       },
//     },
//   },
//   {
//     $addFields: {
//       Series: {
//         $regexFind: {
//           input: "$Mfg Part Number",
//           regex: /D1\D+/,
//         },
//       },
//     },
//   },
//   {
//     $addFields: {
//       Series: "$Series.match",
//     },
//   },
//   {
//     $merge: {
//       into: "sales_data",
//       on: "_id",
//       whenMatched: "merge",
//       whenNotMatched: "discard",
//     },
//   },
// ];
