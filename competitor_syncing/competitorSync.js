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
    Offset: 127600,
    FilterOptionsRequest: {
      ManufacturerFilter: [],
      MinimumQuantityAvailable: 1,
      ParameterFilterRequest: {
        CategoryFilter: { Id: "52", Value: "Chip Resistor - Surface Mount" },
        StatusFilter: [{ Id: 0, Value: "Active" }],
      },
    },
    ProductStatus: "Active",
    ExcludeMarketPlaceProducts: false,
    SortOptions: {
      Field: "None",
      SortOrder: "Ascending",
    },
  };
  const pns = await getAllPartsInDigikeySearchV4(accessToken, body);
  return pns;
}

function modifyPricingData(pricingData) {
  const date = new Date();
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  const hash = createHash("MD5");
  hash.update(JSON.stringify(pricingData));

  pricingData.hash = hash.digest("hex");
  pricingData.day = day;
  pricingData.month = month;
  pricingData.year = year;
  return pricingData;
}

function modifyInventoryData(quantity) {
  const date = new Date();
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const retObj = {
    day: day,
    month: month,
    year: year,
    inventory: quantity,
  };
  const hash = createHash("MD5");
  hash.update(JSON.stringify(retObj));
  retObj.hash = hash.digest("hex");

  return retObj;
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
  let pricingData = modifyPricingData(unparsedPricingData);
  let inventoryData = modifyInventoryData(originalData.QuantityAvailable);

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

async function syncCompetitors() {
  //   const accessToken = await getAccessTokenForDigikeyAPI();
  //   let pns = await retrieveResistorPNs(accessToken);
  let pns = await JSON.parse(
    readFileSync("./temp/originalPNS.json").toString()
  );
  //   console.log(pns);
  //   console.log(structurePNs(pns[2]));
  let structuredPN = structurePNs(pns[56]);
  console.log(structuredPN);
}

syncCompetitors().then((data) => {
  console.log(data);
});
