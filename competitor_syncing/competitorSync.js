import { config } from "dotenv";
import { MongoClient } from "mongodb";
import {
  getAccessTokenForDigikeyAPI,
  getAllPartsInDigikeySearchV4,
} from "../digiKeyAPI.js";
import { createHash } from "node:crypto";
import {
  isMainThread,
  Worker,
  parentPort,
  workerData,
} from "node:worker_threads";
import { readFileSync, writeFileSync } from "fs";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
}

// do fetch until you get response.ok
async function fetchWithRetries(url, options, retries = 3) {
  while (retries > 0) {
    let response = await fetch(url, options);
    if (response.ok) {
      return await response.json();
    }
    retries--;
  }
  throw new Error(`there was an error fetching after three retries`);
}

// return an array of the offsets that need to be redone
function validatePNs(markers, initialOffset, total, limit) {
  let redoArray = [];
  for (let i = initialOffset; i < total; i += limit) {
    if (!markers.includes(i)) {
      redoArray.push(i);
    }
  }
  return redoArray;
}

// use array of offsets to retrieve missing information
async function remediatePNs(redos, body, accessToken) {
  let retArr = [];
  let failCount = 0;
  // run fetch on each of the redos in the array, using the value as the offset
  for (let redo in redos) {
    try {
      body.Offset = redos[redo];
      let data = await fetchWithRetries(
        "https://api.digikey.com/products/v4/search/keyword",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-DIGIKEY-Client-Id": process.env.clientId,
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify(body),
        }
      );
      retArr.push(...data.Products);
    } catch (error) {
      failCount++;
      if (failCount > 4) {
        throw new Error(`5 failures occurred for part number remdiation`);
      }
      console.error(
        `There was a problem with the request for part number remidiation\n\ttotal failures: ${failCount}`
      );
    }
  }
  return retArr;
}

// return all of the chip resistor product data to the structure pn function
export async function retrieveResistorPNs(accessToken, body) {
  let total;
  let promiseArray = [];
  let markers = [];
  let redos = [];

  body = body || {
    Keywords: "Resistor",
    Limit: 50,
    Offset: 120200,
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

  const initialOffset = structuredClone(body.Offset);

  // send one fetch to get product count
  let response = await fetch(
    "https://api.digikey.com/products/v4/search/keyword",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-DIGIKEY-Client-Id": process.env.clientId,
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  if (response.ok) {
    let data = await response.json();
    total = data.ProductsCount;
  } else {
    console.log("There was an error retrieving the product count");
  }

  const numberOfBatches = total / body.Limit - body.Offset / body.Limit;

  // loop over batches per core num
  // create promises for each batch
  for (let i = 0; i < numberOfBatches; i++) {
    try {
      promiseArray.push({
        index: body.Offset,
        data: fetch("https://api.digikey.com/products/v4/search/keyword", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-DIGIKEY-Client-Id": process.env.clientId,
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify(body),
        }),
      });
      // markers array is added to after promise is added to array
      markers.push(body.Offset);
      body.Offset += body.Limit;
    } catch (error) {
      console.error(
        `There was an error pushing promise for index ${body.Offset}`
      );
      body.Offset += body.Limit;
    }
  }

  const pns = [];
  promiseArray = await Promise.all(
    promiseArray.map((r) =>
      r.data
        .then((res) => {
          if (!res.ok) {
            throw new Error(
              `promise for part numbering failed!\n${res.status}`
            );
          }
          return res.json();
        })
        .then((d) => {
          pns.push(...d.Products);
          return { ...d, index: r.index };
        })
        .catch((error) => {
          console.error("Error processing request:", error);
          // Return a default value or handle the error in a way that doesn't break the Promise.all
          // return { error: true, index: r.index, message: error.message };
        })
    )
  );
  // Validate that we got all of our information
  // Check if length matches number of batches
  if (pns.length !== Math.round(numberOfBatches * 50)) {
    logExceptOnTest(`pns require validation`);
    let validatedRedos = validatePNs(markers, initialOffset, total, body.Limit);
    redos.push(...validatedRedos);
    logExceptOnTest(`${redos.length} batches require another attempt`);
    let additionalPNs = await remediatePNs(redos, body, accessToken);
    pns.push(...additionalPNs);
    logExceptOnTest(`pushed ${additionalPNs.length} redone parts into pns`);
  }

  return pns.map(structurePNs);
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

// divides the database comparisons between the core count
// spawns worker threads
// Distributes the comparisons between the worker threads by adding the comparison data to the thread
export async function compareQueryToDatabase(
  queryResults,
  database,
  coreCount
) {
  let testFile =
    (await readFileSync("./temp/results.csv").toString()) ||
    '"core count","elapsed time","number of parts","parts / ms"';

  const startTime = Date.now();
  coreCount = coreCount || 1;

  // get all the part numbers from the queryresults and request all the parts from the database
  const partNumbers = queryResults.map((pn) => pn.part_number);
  const existingParts = await database
    .find({ part_number: { $in: partNumbers } })
    .toArray();

  const bulkOp = [];
  const insertionList = [];

  // create a Map of the parts with the key being the part number
  const existingPartsMap = new Map(
    existingParts.map((p) => [p.part_number, p])
  );

  const workerPNIncrement = Math.ceil(queryResults.length / coreCount);
  let workerPNIndex = 0;

  let promises = [];

  for (let i = 0; i < coreCount; i++) {
    let partSubset = queryResults.slice(
      workerPNIndex,
      workerPNIndex + workerPNIncrement
    );
    workerPNIndex += workerPNIncrement;

    if (partSubset.length > 0) {
      const workerPromise = new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
          workerData: {
            partNumbers: partSubset,
            existingPartsMap: Array.from(existingPartsMap.entries()),
          },
        });

        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });
      });

      promises.push(workerPromise);
    }
  }
  const results = await Promise.all(promises);

  results.forEach(
    ({ bulkOp: workerBulkOp, insertionList: workerInsertionList }) => {
      bulkOp.push(...workerBulkOp);
      insertionList.push(...workerInsertionList);
    }
  );
  const endTime = Date.now();
  const elapsedTime = endTime - startTime;
  logExceptOnTest(
    `time for comparison execution: ${elapsedTime} ms for ${
      partNumbers.length
    } parts\n${partNumbers.length / elapsedTime} parts / ms`
  );
  writeFileSync(
    "./temp/results.csv",
    (testFile += `\n${coreCount},${elapsedTime},${partNumbers.length},${
      partNumbers.length / elapsedTime
    }`)
  );

  return { bulkOp, insertionList };
}

// This is what a worker thread will execute to compare
function processPartNumbers(queryResults, existingPartsMap) {
  const bulkOp = [];
  const insertionList = [];
  queryResults.forEach((pn) => {
    const oldPNData = existingPartsMap.get(pn.part_number);
    if (oldPNData) {
      let combinedPricing = pn.pricing;
      let combinedInventory = pn.inventory;
      if (oldPNData.pricing) {
        combinedPricing = compareHashes(pn.pricing, oldPNData.pricing);
      }
      if (oldPNData.inventory) {
        combinedInventory = compareHashes(pn.inventory, oldPNData.inventory);
      }
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

// Abstraction that calls the functions in their order
// Connects to mongoDB and makes the additions
export async function syncCompetitors(numSyncs) {
  numSyncs = numSyncs || 1;
  for (let i = 0; i < numSyncs; i++) {
    logExceptOnTest("getting access token for digikey...");
    const accessToken = await getAccessTokenForDigikeyAPI();

    logExceptOnTest("retrieving all Chip Resistors from Digikey...");
    const pns = await retrieveResistorPNs(accessToken);

    console.log(pns.length);

    if (pns.length < 1) {
      console.log(
        `no PNs were returned from retrieve resistor pn function: ${pns}`
      );
    }

    logExceptOnTest("connecting to Mongo instance...");
    const client = new MongoClient(
      process.env.competitor_database_connection_string
    );
    await client.connect();
    const db = client.db("CompetitorDBInstance");
    const dkChipResistor = db.collection("dk_chip_resistor");

    logExceptOnTest("comparing delta between query and Mongo...");
    const operations = await compareQueryToDatabase(pns, dkChipResistor, 1);

    console.log(operations);

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
}

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

if (!isMainThread) {
  const { partNumbers, existingPartsMap } = workerData;
  const existingPartsMapObj = new Map(existingPartsMap);
  const result = processPartNumbers(partNumbers, existingPartsMapObj);
  parentPort.postMessage(result);
} else {
  // TODO: handle 429 codes (30 second timeout)
  syncCompetitors(1).then((data) => {
    // logExceptOnTest(data)
  });
}
