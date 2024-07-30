import { config } from "dotenv";
import { MongoClient } from "mongodb";
import {
  getAccessTokenForDigikeyAPI,
  getAllPartsInDigikeySearchV4,
} from "../digiKeyAPI.js";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

async function retrieveResistorPNs(accessToken) {
  const body = {
    Keywords: "Resistor",
    Limit: 50,
    Offset: 121500,
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
  let unparsedPricingData = {
    tape_reel:
      originalData.ProductVariations.find(
        (variation) => variation.PackageType.Id === 1
      )?.StandardPricing || [],
    cut_tape:
      originalData.ProductVariations.find(
        (variation) => variation.PackageType.Id === 2
      )?.StandardPricing || [],
    digi_reel:
      originalData.ProductVariations.find(
        (variation) => variation.PackageType.Id === 3
      )?.StandardPricing || [],
  };
  let unparsedQuantityData = {
    tape_reel:
      originalData.ProductVariations.find(
        (variation) => variation.PackageType.Id === 1
      )?.QuantityAvailableforPackageType || 0,
    cut_tape:
      originalData.ProductVariations.find(
        (variation) => variation.PackageType.Id === 2
      )?.QuantityAvailableforPackageType || 0,
    digi_reel:
      originalData.ProductVariations.find(
        (variation) => variation.PackageType.Id === 3
      )?.QuantityAvailableforPackageType || 0,
  };
  let pricingData = [addHashAndDate(unparsedPricingData, true)];
  let inventoryData = [addHashAndDate(unparsedQuantityData, true)];

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
    pricing: pricingData,
    inventory: inventoryData,
  };
}

function compareHashes(newData, oldData) {
  const newHash = newData[0].hash;
  const oldHash = oldData[oldData.length - 1].hash;
  if (newHash !== oldHash) {
    oldData.push(newData[0]);
  }

  return oldData;
}

function compareQueryToDatabase(queryResults, database) {
  queryResults.forEach((pn) => {
    // TODO: replace with mongo find function
    let oldPNData = database.find((x) => x.part_number === pn.part_number);

    if (oldPNData) {
      // TODO: add this to an array and then run a bulk operation in Mongo
      oldPNData.pricing = compareHashes(pn.pricing, oldPNData.pricing);
      oldPNData.inventory = compareHashes(pn.inventory, oldPNData.inventory);
    } else {
      database.push(pn);
    }
  });

  return database;
}

async function syncCompetitors() {
  console.log("getting access token for digikey...");
  const accessToken = await getAccessTokenForDigikeyAPI();

  console.log("retrieving all Chip Resistors from Digikey...");
  let pns = await retrieveResistorPNs(accessToken);

  //   TODO: replace with mongo instance
  console.log("connecting to Mongo instance...");
  let testDB = await JSON.parse(readFileSync("./temp/testDB.json").toString());

  console.log("comparing delta between query and Mongo...");
  let bulkOperation = compareQueryToDatabase(pns, testDB);

  // TODO: run bulk upsert operation
  console.log(`completed:\n${0} doc(s) updated \n${0} doc(s) created`);
}

syncCompetitors().then((data) => {
  //   console.log(data);
});
