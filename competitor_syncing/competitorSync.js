import { config } from "dotenv";
import { MongoClient } from "mongodb";
import {
  getAccessTokenForDigikeyAPI,
  getAllPartsInDigikeySearchV4,
} from "../digiKeyAPI.js";
import { createHash } from "node:crypto";

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
}

export async function retrieveResistorPNs(accessToken, body = null) {
  if (!body) {
    body = {
      Keywords: "Resistor",
      Limit: 50,
      Offset: 121800,
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
  }
  const pns = await getAllPartsInDigikeySearchV4(accessToken, body);
  return pns.map(structurePNs);
}

function addHashAndDate(data, hash = false) {
  const date = new Date();
  data.day = date.getDate();
  data.month = date.getMonth() + 1;
  data.year = date.getFullYear();

  if (hash) {
    const hashInstance = createHash("MD5");
    hashInstance.update(JSON.stringify(data));
    data.hash = hashInstance.digest("hex");
  }

  return data;
}

function structurePNs(originalData) {
  const productVariations = originalData.ProductVariations || [];
  const parameters = originalData.Parameters || [];

  const getVariationData = (id) =>
    productVariations.find((v) => v.PackageType.Id === id) || {};

  const getParameterValue = (text) =>
    parameters.find((p) => p.ParameterText === text)?.ValueText || "";

  return {
    product_description: originalData.Description.ProductDescription,
    detailed_description: originalData.Description.DetailedDescription,
    part_number: originalData.ManufacturerProductNumber,
    product_url: originalData.ProductUrl,
    datasheet_url: originalData.DatasheetUrl,
    photo_url: originalData.PhotoUrl,
    video_url: originalData.PrimaryVideoUrl || "",
    status: originalData.ProductStatus.Status,
    resistance: getParameterValue("Resistance"),
    resistance_tolerance: getParameterValue("Tolerance"),
    power: getParameterValue("Power (Watts)"),
    composition: getParameterValue("Composition"),
    features: parameters
      .filter((p) => p.ParameterText === "Features")
      .map((p) => p.ValueText),
    temp_coefficient: getParameterValue("Temperature Coefficient"),
    operating_temperature: getParameterValue("Operating Temperature"),
    digikey_case_size: getParameterValue("Package / Case"),
    case_size: getParameterValue("Supplier Device Package"),
    ratings: parameters
      .filter((p) => p.ParameterText === "Ratings")
      .map((p) => p.ValueText),
    dimensions: getParameterValue("Size / Dimension"),
    height: getParameterValue("Height - Seated (Max)"),
    terminations_number:
      parseInt(getParameterValue("Number of Terminations")) || 0,
    fail_rate: getParameterValue("Failure Rate"),
    category: originalData.Category.Name,
    sub_category: originalData.Category.ChildCategories[0]?.Name || "",
    series: originalData.Series.Name,
    classifications: originalData.Classifications || {},
    pricing: [
      addHashAndDate(
        {
          tape_reel: getVariationData(1).StandardPricing || [],
          cut_tape: getVariationData(2).StandardPricing || [],
          digi_reel: getVariationData(3).StandardPricing || [],
        },
        true
      ),
    ],
    inventory: [
      addHashAndDate(
        {
          tape_reel: getVariationData(1).QuantityAvailableforPackageType || 0,
          cut_tape: getVariationData(2).QuantityAvailableforPackageType || 0,
          digi_reel: getVariationData(3).QuantityAvailableforPackageType || 0,
        },
        true
      ),
    ],
  };
}

function compareHashes(newData, oldData) {
  if (newData[0].hash !== oldData[0].hash) {
    oldData.push(newData[0]);
  }
  return oldData;
}

async function compareQueryToDatabase(queryResults, database) {
  const partNumbers = queryResults.map((pn) => pn.part_number);
  const existingParts = await database
    .find({ part_number: { $in: partNumbers } })
    .toArray();

  const bulkOp = [];
  const insertionList = [];
  const existingPartsMap = new Map(
    existingParts.map((p) => [p.part_number, p])
  );

  queryResults.forEach((pn) => {
    const oldPNData = existingPartsMap.get(pn.part_number);
    if (oldPNData) {
      const combinedPricing = compareHashes(pn.pricing, oldPNData.pricing);
      const combinedInventory = compareHashes(
        pn.inventory,
        oldPNData.inventory
      );
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

  return { bulkOp, insertionList };
}

async function syncCompetitors() {
  logExceptOnTest("getting access token for digikey...");
  const accessToken = await getAccessTokenForDigikeyAPI();

  logExceptOnTest("retrieving all Chip Resistors from Digikey...");
  const pns = await retrieveResistorPNs(accessToken);

  logExceptOnTest("connecting to Mongo instance...");
  const client = new MongoClient(
    process.env.competitor_database_connection_string
  );
  await client.connect();
  const db = client.db("CompetitorDBInstance");
  const dkChipResistor = db.collection("dk_chip_resistor");

  logExceptOnTest("comparing delta between query and Mongo...");
  const operations = await compareQueryToDatabase(pns, dkChipResistor);

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

syncCompetitors().then((data) => {
  // logExceptOnTest(data)
});

async function findDuplicatePartNumbers() {
  const client = new MongoClient(
    process.env.competitor_database_connection_string
  );
  await client.connect();
  const db = client.db("CompetitorDBInstance");
  const dkChipResistor = db.collection("dk_chip_resistor");

  const duplicates = await dkChipResistor
    .aggregate([
      { $group: { _id: "$part_number", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $project: { _id: 0, part_number: "$_id", count: 1 } },
    ])
    .toArray();

  await client.close();

  return duplicates;
}
