import { validatePNs, remediatePNs } from "./partNumberRemediation.js";
import { structurePNs } from "./partNumberStructuring.js";
import pLimit from "p-limit";
import { config } from "dotenv";
import { getAccessTokenForDigikeyAPI } from "../digiKeyAPI.js";
config();

// limits the max amount of concurrent connections being made
const limit = pLimit(15);

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
}

// return all of the chip resistor product data to the structure pn function with paths for remdiation
export async function retrieveResistorPNs(
  accessToken,
  body,
  burstReset,
  burstLimit,
  total,
  apiIndex,
  client_id,
  remediationToken,
  errorArray,
  pnCollection
) {
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
  burstReset = burstReset || 15000;
  burstLimit = burstLimit || 238;
  apiIndex = apiIndex || "null";
  total = total || body.Offset + 250;
  client_id = client_id || process.env.clientId;
  remediationToken = remediationToken || getAccessTokenForDigikeyAPI();
  errorArray = errorArray || [];
  let bodyClone = structuredClone(body);
  const initialOffset = structuredClone(body.Offset);

  // API index is just for debugging
  // 240 requests within time frame

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

  const pns = [];
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < numberOfBursts; i++) {
      try {
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
        // start a timer
        const start = Date.now();

        // resolve the promises with marker mapping etc.
        await resolvePNPromiseArray(
          burstLimitData[0],
          markers,
          pns,
          errorArray
        );
        // push them all to mongo, once resolved
        const bulkCommand = pns.map(structurePNs);
        logExceptOnTest(`API ${apiIndex} writing to mongo...`);
        const mongoResults = await pnCollection.bulkWrite(bulkCommand);

        // if timer elapsed time <= burst reset then wait the difference out
        const end = Date.now();
        const timeSpent = end - start;
        logExceptOnTest(
          `time spent retrieving data ${timeSpent / 1000} (${timeSpent}ms) \n${
            mongoResults.insertedCount
          } inserted & ${mongoResults.modifiedCount} modified`
        );

        // if the time spent was less than the burst reset, and there is still another burst to do
        if (timeSpent <= burstReset + 1000 && i + 1 < numberOfBursts) {
          const waitingTime = burstReset + 1000 - timeSpent;
          logExceptOnTest(`${waitingTime / 1000} second timeout...`);
          await new Promise((resolve) => setTimeout(resolve, waitingTime));
        }
        // set body offset and move on
        bodyClone.Offset += burstLimit * bodyClone.Limit;
      } catch (error) {
        console.error(
          `Error retriving burst limit on burst ${i} on API ${apiIndex}: ${error}`
        );
      }
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
    }
    logExceptOnTest(
      `API ${apiIndex} has ${redos.length} indexes that need to be redone`
    );
    resolve(redos);
  });
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

async function resolvePNPromiseArray(promiseArray, markers, pns, errorArray) {
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
}
