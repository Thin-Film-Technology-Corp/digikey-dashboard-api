import { config } from "dotenv";
import { MongoClient } from "mongodb";
import {
  getAccessTokenForDigikeyAPI,
  getAllPartsInDigikeySearchV4,
} from "../digiKeyAPI.js";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
}

export async function retrieveResistorPNs(accessToken, body) {
  body = body || {
    Keywords: "Resistor",
    Limit: 50,
    Offset: 121850,
    FilterOptionsRequest: {
      ManufacturerFilter: [],
      MinimumQuantityAvailable: 1,
      ParameterFilterRequest: {
        CategoryFilter: { Id: "52", Value: "Chip Resistor - Surface Mount" },
      },
      StatusFilter: [{ Id: 0, Value: "Active" }],
    },
    ExcludeMarketPlaceProducts: false,
    SortOptions: {
      Field: "None",
      SortOrder: "Ascending",
    },
  };
  const pns = await getAllPartsInDigikeySearchV4(accessToken, body);
  //   structure the new data into the correct format
  let newDB = [];
  pns.forEach((pn) => {
    newDB.push(structurePNs(pn));
  });

  return newDB;
}

function addHashAndDate(data, hash) {
  hash = hash || false;
  const date = new Date();
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  if (hash) {
    const hash = createHash("MD5");
    hash.update(JSON.stringify(data));
    data.hash = hash.digest("hex");
  }
  data.day = day;
  data.month = month;
  data.year = year;

  return data;
}

function structurePNs(originalData) {
  const productVariations = originalData.ProductVariations;
  const parameters = originalData.Parameters;

  let pricingData = {
    tape_reel:
      productVariations.find((v) => v.PackageType.Id === 1)?.StandardPricing ||
      [],
    cut_tape:
      productVariations.find((v) => v.PackageType.Id === 2)?.StandardPricing ||
      [],
    digi_reel:
      productVariations.find((v) => v.PackageType.Id === 3)?.StandardPricing ||
      [],
  };

  let inventoryData = {
    tape_reel:
      productVariations.find((v) => v.PackageType.Id === 1)
        ?.QuantityAvailableforPackageType || 0,
    cut_tape:
      productVariations.find((v) => v.PackageType.Id === 2)
        ?.QuantityAvailableforPackageType || 0,
    digi_reel:
      productVariations.find((v) => v.PackageType.Id === 3)
        ?.QuantityAvailableforPackageType || 0,
  };

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
      parameters.find((p) => p.ParameterText === "Resistance")?.ValueText || "",
    resistance_tolerance:
      parameters.find((p) => p.ParameterText === "Tolerance")?.ValueText || "",
    power:
      parameters.find((p) => p.ParameterText === "Power (Watts)")?.ValueText ||
      "",
    composition:
      parameters.find((p) => p.ParameterText === "Composition")?.ValueText ||
      "",
    features: parameters
      .filter((p) => p.ParameterText === "Features")
      .map((p) => p.ValueText),
    temp_coefficient:
      parameters.find((p) => p.ParameterText === "Temperature Coefficient")
        ?.ValueText || "",
    operating_temperature:
      parameters.find((p) => p.ParameterText === "Operating Temperature")
        ?.ValueText || "",
    digikey_case_size:
      parameters.find((p) => p.ParameterText === "Package / Case")?.ValueText ||
      "",
    case_size:
      parameters.find((p) => p.ParameterText === "Supplier Device Package")
        ?.ValueText || "",
    ratings: parameters
      .filter((p) => p.ParameterText === "Ratings")
      .map((p) => p.ValueText),
    dimensions:
      parameters.find((p) => p.ParameterText === "Size / Dimension")
        ?.ValueText || "",
    height:
      parameters.find((p) => p.ParameterText === "Height - Seated (Max)")
        ?.ValueText || "",
    terminations_number:
      parseInt(
        parameters.find((p) => p.ParameterText === "Number of Terminations")
          ?.ValueText
      ) || 0,
    fail_rate:
      parameters.find((p) => p.ParameterText === "Failure Rate")?.ValueText ||
      "",
    category: originalData.Category.Name,
    sub_category: originalData.Category.ChildCategories[0]?.Name || "",
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
    pricing: [addHashAndDate(pricingData, true)],
    inventory: [addHashAndDate(inventoryData, true)],
  };
}

function compareHashes(newData, oldData) {
  const newHash = newData[0].hash;
  const oldHash = oldData[0].hash;
  if (newHash !== oldHash) {
    oldData.push(newData[0]);
  }

  return oldData;
}

async function compareQueryToDatabase(queryResults, database) {
  // Get all the part numbers at once (batching)
  const partNumbers = queryResults.map((pn) => pn.part_number);
  const existingParts = await database
    .find({ part_number: { $in: partNumbers } })
    .toArray();

  let bulkOp = [];
  let insertionList = [];

  const existingPartsMap = new Map(
    existingParts.map((p) => [p.part_number, p])
  );

  queryResults.forEach((pn) => {
    const oldPNData = existingPartsMap.get(pn.part_number);

    if (oldPNData) {
      let combinedPricing = compareHashes(pn.pricing, oldPNData.pricing);
      let combinedInventory = compareHashes(pn.inventory, oldPNData.inventory);

      bulkOp.push({
        updateOne: {
          filter: { part_number: pn.part_number },
          update: {
            $set: { pricing: combinedPricing, inventory: combinedInventory },
          },
        },
      });
    } else {
      insertionList.push(pn);
    }
  });

  return { bulkOp: bulkOp, insertionList: insertionList };
}

async function syncCompetitors() {
  logExceptOnTest("getting access token for digikey...");
  const accessToken = await getAccessTokenForDigikeyAPI();

  logExceptOnTest("retrieving all Chip Resistors from Digikey...");
  let pns = await retrieveResistorPNs(accessToken);

  //   TODO: replace with mongo instance
  logExceptOnTest("connecting to Mongo instance...");
  // let testDB = await JSON.parse(readFileSync("./temp/testDB.json").toString());
  const client = new MongoClient(
    process.env.competitor_database_connection_string
  );
  await client.connect();
  const db = client.db("CompetitorDBInstance");
  const dkChipResistor = db.collection("dk_chip_resistor");

  logExceptOnTest("comparing delta between query and Mongo...");
  let operations = await compareQueryToDatabase(pns, dkChipResistor);

  // console.log(operations.bulkOp);

  if (operations.insertionList.length > 0) {
    await dkChipResistor.insertMany(operations.insertionList);
  }

  if (operations.bulkOp.length > 0) {
    await dkChipResistor.bulkWrite(operations.bulkOp);
  }

  logExceptOnTest(
    `completed:\n\t${operations.bulkOp.length} doc(s) updated\n\t${operations.insertionList.length} doc(s) created`
  );

  logExceptOnTest("closing client...");
  await client.close();
}

// syncCompetitors().then((data) => {
//   // logExceptOnTest(data)
// });

async function findDuplicatePartNumbers() {
  const client = new MongoClient(
    process.env.competitor_database_connection_string
  );
  await client.connect();
  const db = client.db("CompetitorDBInstance");
  const dkChipResistor = db.collection("dk_chip_resistor");

  const duplicates = await dkChipResistor
    .aggregate([
      {
        $group: {
          _id: "$part_number",
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          part_number: "$_id",
          count: 1,
        },
      },
    ])
    .toArray();

  await client.close();

  return duplicates;
}
