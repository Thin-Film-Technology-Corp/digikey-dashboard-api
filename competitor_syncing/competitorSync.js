import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { getAccessTokenForDigikeyAPI } from "../digiKeyAPI.js";
import { createHash } from "node:crypto";
import {
  isMainThread,
  Worker,
  parentPort,
  workerData,
} from "node:worker_threads";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import pLimit from "p-limit";

// limits the max amount of concurrent connections being made
const limit = pLimit(15);

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
      return response.json();
    } else {
      // console.log(
      //   `There was an error fetching with retries: ${response.status}\n${response.statusText}`
      // );
      errorArray.push({
        type: "http response fail",
        code: response.status,
        message: response.statusText,
      });
    }
    retries--;
  }
  throw new Error(`there was an error fetching after three retries`);
}

// return an array of the offsets that need to be redone
function validatePNs(markers, initialOffset, total, limit) {
  let redoArray = [];
  for (let i = initialOffset; i < total; i += limit) {
    // TODO: test if this can just be a single truthy
    if (
      markers.get(i) === false ||
      markers.get(i) === undefined ||
      markers.get(i) === null
    ) {
      redoArray.push(i);
    }
  }
  return redoArray;
}

// remediates pns in a batch format, distinct from retrievepns function because it doesn't necesarily go sequentially (maybe we could change that about retrieve resistor pns to consolidate these and make it recursive)
async function bulkRemediation(arrOfPNs, body, accessToken, clientId) {
  let redos = [];
  let pns = [];
  let promiseArray = [];
  // iterate over the redos
  for (let pn in arrOfPNs) {
    let index = arrOfPNs[pn];
    body.Offset = index;
    // fetch all of them at their indexes
    // put them into an array
    promiseArray.push({
      index: body.Offset,
      data: limit(() =>
        fetch("https://api.digikey.com/products/v4/search/keyword", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-DIGIKEY-Client-Id": clientId,
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify(body),
        })
      ),
    });
  }
  // await promise.all them and validate the response.ok

  promiseArray = await Promise.all(
    promiseArray.map((r) =>
      r.data
        .then((res) => {
          if (!res.ok) {
            // add index of redo to redo array
            errorArray.push({
              type: "http response fail",
              code: res.status,
              message: res.statusText,
              index: r.index,
            });
            redos.push(r.index);
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
          errorArray.push({
            type: "general error",
            message: error,
          });
          // console.error("Error processing request:", error);
          // add index of redo to redo array
          redos.push(r.index);
        })
    )
  );
  // get new redo array

  return [redos, pns];
}

// use array of offsets to retrieve missing information
async function remediatePNs(
  redos,
  body,
  accessToken,
  burstLimit,
  burstReset,
  clientId,
  fixedBatches,
  errorArray
) {
  let retArr = [];
  let failCount = 0;
  let bursts = Math.ceil(redos.length / burstLimit);
  let index = 0;
  fixedBatches = fixedBatches || 0;

  clientId = clientId || process.env.clientId;

  for (let i = 0; i < bursts; i++) {
    logExceptOnTest(
      `Remediation #${i} waiting ${
        burstReset / 1000
      } seconds before attempting...`
    );
    await new Promise((resolve) => setTimeout(resolve, burstReset + 1000));
    index = i * burstLimit;
    let redoSlice = redos.slice(index, index + burstLimit);

    // TODO: Add in a redo here with batches instead of individual requests, try to get a majority of these knocked out before moving to the much slower fetch with retries
    logExceptOnTest(
      `Attempting bulk remediation of ${redoSlice.length} PN batches...`
    );

    // ? This was the last thing added 22Oct. I'm out of tokens and cannot test it, but I believe the retArr was being overwritten and thus the remediated PNs were being lost except for the final ones
    let remediatedPNs;

    // bulkRemediation will attempt to resolve the entire batch in bulk so that there is no need to redo each request individually
    [redoSlice, remediatedPNs] = await bulkRemediation(
      redoSlice,
      body,
      accessToken,
      clientId,
      errorArray
    );
    retArr.push(...remediatedPNs);

    logExceptOnTest(
      `Bulk remediation failed to address ${redoSlice.length} PNs. \nForcing individual remediation with retries... `
    );

    for (let redo in redoSlice) {
      try {
        body.Offset = redos[redo];
        logExceptOnTest(`redoing indexes ${body.Offset} - ${body.Offset + 50}`);
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
        fixedBatches += data.Products.length;
        logExceptOnTest(`${fixedBatches} / ${redos.length * 50} remediated`);
        retArr.push(...data.Products);
      } catch (error) {
        logExceptOnTest(`error remediating parts: ${error}`);
        failCount++;
        if (failCount > 4) {
          throw new Error(`5 failures occurred for part number remdiation`);
        }
        console.error(
          `There was a problem with the request for part number remidiation\n\ttotal failures: ${failCount} \n${error.message}`
        );
      }
    }
  }
  // Wait for burstreset
  // If the total redos is greater than the burst limit, divide it into parts

  // run fetch on each of the redos in the array, using the value as the offset
  return retArr;
}

// iterates over burst limit and modifies body.Offset to return promise array
async function retrieveBurstLimit(
  accessToken,
  body,
  burstLimit,
  markers,
  client_id
) {
  let containedBody = structuredClone(body);
  let promiseArray = [];
  client_id = client_id || process.env.clientId;

  markers = markers || new Map([]);
  for (let i = 0; i < burstLimit; i++) {
    try {
      // Clone inside the loop to create a new instance for each iteration (saving a snapshot)
      let currentBody = structuredClone(containedBody);
      promiseArray.push({
        index: currentBody.Offset,
        data: limit(() =>
          fetch("https://api.digikey.com/products/v4/search/keyword", {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "X-DIGIKEY-Client-Id": client_id,
              "Content-Type": "application/json",
            },
            method: "POST",
            body: JSON.stringify(currentBody),
          })
        ),
      });
      // markers array is added to after promise is added to array
      markers.set(currentBody.Offset, true);
      containedBody.Offset += containedBody.Limit;
    } catch (error) {
      console.error(
        `There was an error pushing promise for index ${containedBody.Offset}\n
        ${error}`
      );
      containedBody.Offset += containedBody.Limit;
    }
  }

  return [promiseArray, markers];
}

// return all of the chip resistor product data to the structure pn function
export async function retrieveResistorPNs(
  accessToken,
  body,
  burstReset,
  burstLimit,
  total,
  apiIndex,
  client_id,
  remediationToken,
  errorArray
) {
  let promiseArray = [];
  let markers = new Map();
  let redos = [];
  body = body || {
    Keywords: "Resistor",
    Limit: 50,
    Offset: 105200,
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
  let bodyClone = structuredClone(body);
  const initialOffset = structuredClone(body.Offset);

  // API index is just for debugging
  apiIndex = apiIndex || "null";
  // 240 requests within time frame

  burstLimit = burstLimit || 238;
  const partsPerAPI = total - bodyClone.Offset;
  // if parts per api is less than the burst limit * 50 set the burst limit to the parts per api / 50
  if (partsPerAPI < burstLimit * 50) {
    burstLimit = Math.ceil(partsPerAPI / 50);
  }

  // 15 second reset
  burstReset = burstReset || 15000;

  const totalBatches = total / bodyClone.Limit; // total = 31,000 and limit = 50 so 620
  const completedBatches = bodyClone.Offset / bodyClone.Limit; // Offset = 0 and Limit = 50 so 0
  const numberOfBatches = Math.ceil(totalBatches - completedBatches); // 620
  const numberOfBursts = Math.ceil(numberOfBatches / burstLimit); // 620 / 238 = 3 (2.6)
  logExceptOnTest(
    `number of batches: ${numberOfBatches}\nnumber of bursts: ${numberOfBursts}`
  );

  return await new Promise(async (resolve, reject) => {
    for (let i = 0; i < numberOfBursts; i++) {
      try {
        if (i > 0) {
          logExceptOnTest(`${burstReset / 1000} second timeout...`);
          await new Promise((resolve) =>
            setTimeout(resolve, burstReset + 1000)
          );
        }
        console.log(`Burst ${i} on API ${apiIndex}:`);
      } catch (error) {
        console.error(
          `Error waiting for burst reset (Burst ${i} on API ${apiIndex}): ${error}`
        );
      }

      try {
        let burstLimitData = await retrieveBurstLimit(
          accessToken,
          bodyClone,
          burstLimit,
          markers,
          client_id
        );

        promiseArray.push(...burstLimitData[0]);

        // ? Wouldnt this overwrite the markers array? The retrieve burst limit function should be the one modifying this
        // markers = burstLimitData[1];
      } catch (error) {
        console.error(
          `Error retriving burst limit on burst ${i} on API ${apiIndex}: ${error}`
        );
      }
    }

    const pns = [];
    try {
      logExceptOnTest(`resolving promise array...`);
      promiseArray = await Promise.all(
        promiseArray.map((r) =>
          r.data
            .then((res) => {
              if (!res.ok) {
                // set marker to false for revision
                markers.set(r.index, false);
                errorArray.push({
                  type: "http response fail",
                  code: res.status,
                  message: res.statusText,
                  index: r.index,
                });
                throw new Error(
                  `promise for part numbering failed!\n${res.status}`
                );
              } else {
                return res.json();
              }
            })
            .then((d) => {
              // logExceptOnTest("pushing product to pn...");
              pns.push(...d.Products);
              return { ...d, index: r.index };
            })
            .catch((error) => {
              // console.error("Error processing request:", error);
              errorArray.push({
                type: "general error",
                message: error,
              });
              // set marker to false for revision
              markers.set(r.index, false);
              // Return a default value or handle the error in a way that doesn't break the Promise.all
              // return { error: true, index: r.index, message: error.message };
            })
        )
      );
    } catch (error) {
      console.error(`Error resolving promises on burst limit data: ${error}`);
    }
    // Validate that we got all of our information
    // Check if length matches number of batches or if any marker is set to negative

    logExceptOnTest(
      `PNs length: ${pns.length}\nExpected length: ${
        total - initialOffset
      }\nDoes markers include false values: ${[...markers.values()].includes(
        false
      )}`
    );

    // Remediation
    if ([...markers.values()].includes(false)) {
      logExceptOnTest(`pns require validation`);
      let validatedRedos = validatePNs(
        markers,
        initialOffset,
        total,
        bodyClone.Limit
      );
      redos.push(...validatedRedos);

      let additionalPNs = [];
      try {
        logExceptOnTest(`${redos.length} batches require another attempt`);
        let fixedBatches = 0;
        additionalPNs = await remediatePNs(
          redos,
          bodyClone,
          remediationToken,
          burstLimit,
          burstReset,
          process.env.clientId,
          fixedBatches,
          errorArray
        );
      } catch (error) {
        console.error(error);
      }
      pns.push(...(await Promise.all(additionalPNs)));
      logExceptOnTest(`pushed ${additionalPNs.length} redone parts into pns`);
    }

    resolve(pns.map(structurePNs));
  });
}

async function returnTotalParts(accessToken, body) {
  let total;
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

  return total;
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
    productVariations.find((v) => v.PackageType?.Id === id) || {};

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
  newData.forEach((newItem) => {
    if (!oldData.some((oldItem) => oldItem.hash === newItem.hash)) {
      oldData.push(newItem);
    }
  });
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
    readFileSync("./temp/results.csv").toString() ||
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
    // console.log(
    //   `Here's where the old map has the part number ${pn.part_number}: ${oldPNData}`
    // );

    // the part number exists in the db if it gets past this
    if (oldPNData) {
      let combinedPricing;
      let combinedInventory;
      if (oldPNData.pricing) {
        combinedPricing = compareHashes(pn.pricing, oldPNData.pricing);
      }
      if (oldPNData.inventory) {
        combinedInventory = compareHashes(pn.inventory, oldPNData.inventory);
      }

      // If the comparison results in another addition to that pn, then update
      // Otherwise do nothing
      if (
        combinedInventory.length > oldPNData.inventory.length ||
        combinedPricing.length > oldPNData.pricing.length
      ) {
        bulkOp.push({
          updateOne: {
            filter: { part_number: pn.part_number },
            update: {
              $set: { pricing: combinedPricing, inventory: combinedInventory },
            },
          },
        });
      }
    } else {
      insertionList.push(pn);
    }
  });
  return { bulkOp, insertionList };
}

async function checkAPIAccess(clientId, accessToken) {
  let body = {
    Keywords: "Resistor",
    Limit: 1,
    Offset: 0,
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
  let response = await fetch(
    "https://api.digikey.com/products/v4/search/keyword",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-DIGIKEY-Client-Id": clientId,
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  if (response.ok) {
    // Return the number of parts we can still recieve
    return response.headers.get("X-RateLimit-Remaining") * 50;
  } else {
    return false;
  }
}

// Abstraction that calls the functions in their order
// Connects to mongoDB and makes the additions
export async function syncCompetitors() {
  let body = {
    Keywords: "Resistor",
    Limit: 50,
    Offset: 120000,
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
      Field: "ManufacturerProductNumber",
      SortOrder: "Ascending",
    },
  };

  // This accumulates all of our errors and writes them to a log file in ./temp
  let errorArray = [];

  // This access token for getting total and is used as a backup
  logExceptOnTest("getting access tokens for digikey...");
  // up to 5 APIs in use at once
  let credentialArray = [
    { id: process.env?.db_sync_01_id, secret: process.env?.db_sync_01_secret },
    { id: process.env?.db_sync_02_id, secret: process.env?.db_sync_02_secret },
    { id: process.env?.db_sync_03_id, secret: process.env?.db_sync_03_secret },
    { id: process.env?.db_sync_04_id, secret: process.env?.db_sync_04_secret },
    { id: process.env?.db_sync_05_id, secret: process.env?.db_sync_05_secret },
    // These are the testing APIs
    {
      id: process.env?.db_sync_01_backup_id,
      secret: process.env?.db_sync_01_backup_secret,
    },
    {
      id: process.env?.db_sync_02_backup_id,
      secret: process.env?.db_sync_02_backup_secret,
    },
    {
      id: process.env?.db_sync_03_backup_id,
      secret: process.env?.db_sync_03_backup_secret,
    },
    {
      id: process.env?.db_sync_04_backup_id,
      secret: process.env?.db_sync_04_backup_secret,
    },
    {
      id: process.env?.db_sync_05_backup_id,
      secret: process.env?.db_sync_05_backup_secret,
    },
  ];

  // Begin processing all the access tokens
  for (let credential in credentialArray) {
    let cred = credentialArray[credential];
    if (cred.id && cred.secret) {
      cred.accessToken = await getAccessTokenForDigikeyAPI(
        cred.id,
        cred.secret
      );
    }
    cred.isActive = await checkAPIAccess(cred.id, cred.accessToken);
  }

  // Filters operating APIs based on if they have an access token and if they show a 200 when requested
  const operatingAPIs = credentialArray.filter((a) => a.isActive);
  if (operatingAPIs.length === 0) {
    return null;
  }

  const accessToken = await getAccessTokenForDigikeyAPI();

  logExceptOnTest(`retrieving total amount of resistors...`);
  const total = await returnTotalParts(accessToken, body);

  // Raise body limit to max
  body.Limit = 50;

  logExceptOnTest(
    `${operatingAPIs.length} / ${credentialArray.length} APIs operating \n`
  );

  // Create a clone of the body.Offset since we need to modify it ot get correct indexes
  const initialOffset = structuredClone(body.Offset);
  // Divide the total amongst the operating APIs, subtracting the initial body.Offset ensures that if we start at index 80,000 - 120,000 we get 40,000 parts instead of 120,000
  let totalInBatches = Math.ceil((total - initialOffset) / body.Limit);
  let partsPerAPI =
    Math.ceil(totalInBatches / operatingAPIs.length) * body.Limit;

  logExceptOnTest(`parts per API: ${partsPerAPI} / ${initialOffset}`);

  let pns = [];
  let floatingPNs = 0;

  // order these operating APIs so the smalles isActive comes first (for the floating PNs)
  operatingAPIs.sort((a, b) => {
    return a.isActive - b.isActive;
  });

  for (let api in operatingAPIs) {
    try {
      let cred = operatingAPIs[api];
      let totalPartsHandled;
      // prevent api from modifying source body
      let apiBody = structuredClone(body);

      // if this api can't handle all requests given to it, add those to the floating PNs and give them to another
      if (cred.isActive < partsPerAPI) {
        floatingPNs += partsPerAPI - cred.isActive;
        totalPartsHandled = cred.isActive;
        // This API is able to accept all the requested parts, so we will check if it can take extras too
      } else {
        let extraParts = cred.isActive - partsPerAPI;
        // if we have more extra requests than pns which needs to be taken, give all the pns to this api
        // Sse the total parts per api with all additional floating parts
        if (extraParts >= floatingPNs) {
          totalPartsHandled = partsPerAPI + floatingPNs;
          // if there are more pns that needs to be taken than extra requests, take all that we can and subtract that number from the floating pns
          // Use all possible tokens remaining in the API for this operation
        } else {
          floatingPNs -= extraParts;
          totalPartsHandled = cred.isActive;
        }
      }
      logExceptOnTest(
        `API ${api} is taking indexes ${body.Offset} - ${
          body.Offset + totalPartsHandled
        }\n${totalPartsHandled} out of ${total - initialOffset} parts`
      );

      logExceptOnTest(`Parts remaining on API ${api}: ${cred.isActive}`);

      // create agent with connections set to the max amount of connections

      pns.push(
        retrieveResistorPNs(
          cred.accessToken,
          apiBody,
          60000,
          120,
          body.Offset + totalPartsHandled,
          api,
          cred.id,
          accessToken,
          errorArray
        )
      );

      // Explicitly modify the body offset so the indexes are correctly ordered
      body.Offset += totalPartsHandled;
    } catch (error) {
      console.error(`Error retrieving resistor PNs ${error}`);
      logExceptOnTest("writing error log to ./temp/retrieval_errors.json");
      writeFileSync("./temp/retrieval_errors.json", JSON.stringify(errorArray));
      return null;
    }
  }

  logExceptOnTest("retrieving all Chip Resistors from Digikey...");

  pns = (await Promise.all(pns)).flat();

  logExceptOnTest("writing error log to ./temp/retrieval_errors.json");
  writeFileSync("./temp/retrieval_errors.json", JSON.stringify(errorArray));

  // writeFileSync("./temp/checkOnParts.json", JSON.stringify(pns));

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
  const operations = await compareQueryToDatabase(pns, dkChipResistor, 4);

  if (operations.insertionList.length > 0) {
    await dkChipResistor.insertMany(operations.insertionList);
  }

  if (operations.bulkOp.length > 0) {
    await dkChipResistor.bulkWrite(operations.bulkOp);
  }

  logExceptOnTest(
    `completed:\n\t${operations.bulkOp.length} doc(s) updated\n\t${operations.insertionList.length} doc(s) created`
  );

  // TODO: move this to the pn stage so we aren''t sendinf redundant info
  logExceptOnTest(`Cleaning up...`);
  const duplicates = await findDuplicatePartNumbers(true, dkChipResistor);
  logExceptOnTest(
    `${duplicates.length} part number duplicates found and removed`
  );

  logExceptOnTest("closing client...");
  await client.close();
}

async function findDuplicatePartNumbers(isDeleteDuplicates, collection) {
  let client;
  if (!collection) {
    const client = new MongoClient(
      process.env.competitor_database_connection_string
    );
    await client.connect();
    const db = client.db("CompetitorDBInstance");
    collection = db.collection("dk_chip_resistor");
  }

  const duplicates = await collection
    .aggregate([
      { $group: { _id: "$part_number", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $project: { _id: 0, part_number: "$_id", count: 1 } },
    ])
    .toArray();

  if (isDeleteDuplicates) {
    const duplicatePartNumbers = duplicates.map((doc) => doc.part_number);
    await collection.deleteMany({
      part_number: { $in: duplicatePartNumbers },
    });
  }

  await client?.close();

  return duplicates;
}

// findDuplicatePartNumbers(false).then((data) => console.log(data));

if (!isMainThread) {
  const { partNumbers, existingPartsMap } = workerData;
  const existingPartsMapObj = new Map(existingPartsMap);
  const result = processPartNumbers(partNumbers, existingPartsMapObj);
  parentPort.postMessage(result);
} else {
  // TODO: handle 429 codes (30 second timeout)
  syncCompetitors().then((data) => {
    // logExceptOnTest(data)
  });
}
