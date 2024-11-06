import { createHash } from "node:crypto";
import { config } from "dotenv";
config();

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
}

function mongoUpsert(data) {
  return {
    updateOne: {
      filter: { part_number: data.part_number },
      update: [
        // First stage: Set fields as usual
        {
          $set: {
            product_description: data.product_description,
            detailed_description: data.detailed_description,
            part_number: data.part_number,
            product_url: data.product_url,
            datasheet_url: data.datasheet_url,
            photo_url: data.photo_url,
            video_url: data.video_url,
            status: data.status,
            resistance: data.resistance,
            resistance_tolerance: data.resistance_tolerance,
            power: data.power,
            composition: data.composition,
            features: data.features,
            temp_coefficient: data.temp_coefficient,
            operating_temperature: data.operating_temperature,
            digikey_case_size: data.digikey_case_size,
            case_size: data.case_size,
            ratings: data.ratings,
            dimensions: data.dimensions,
            height: data.height,
            terminations_number: data.terminations_number,
            fail_rate: data.fail_rate,
            category: data.category,
            sub_category: data.sub_category,
            series: data.series,
            classifications: data.classifications,
            manufacturer: data.manufacturer,
          },
        },
        // Second stage: Add filtered pricing that does not exist in the current array
        {
          $set: {
            pricing: {
              $concatArrays: [
                {
                  $ifNull: ["$pricing", []],
                },
                {
                  $filter: {
                    input: data.pricing,
                    as: "newPrice",
                    cond: {
                      $not: {
                        $in: [
                          "$$newPrice.hash",
                          { $ifNull: ["$pricing.hash", []] },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        // Third stage: Add filtered inventory that does not exist in the current array
        {
          $set: {
            inventory: {
              $concatArrays: [
                {
                  $ifNull: ["$inventory", []],
                },
                {
                  $filter: {
                    input: data.inventory,
                    as: "newInventory",
                    cond: {
                      $not: {
                        $in: [
                          "$$newInventory.hash",
                          { $ifNull: ["$inventory.hash", []] },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      ],
      upsert: true,
    },
  };
}

export function structurePNs(originalData) {
  const productVariations = originalData.ProductVariations || [];
  const parameters = originalData.Parameters || [];

  const getVariationData = (id) =>
    productVariations.find((v) => v.PackageType?.Id === id) || {};

  const getParameterValue = (text) =>
    parameters.find((p) => p.ParameterText === text)?.ValueText || "";

  return mongoUpsert({
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
    manufacturer: originalData.Manufacturer.Name,
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
  });
}

function addHashAndDate(data, hash = false) {
  const date = new Date();

  if (hash) {
    const hashInstance = createHash("MD5");
    hashInstance.update(JSON.stringify(data));
    data.hash = hashInstance.digest("hex");
    data.day = date.getDate();
    data.month = date.getMonth() + 1;
    data.year = date.getFullYear();
  }

  return data;
}
