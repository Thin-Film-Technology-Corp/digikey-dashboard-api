import { validatePNs, remediatePNs } from "./partNumberRemediation.js";
import { structurePNs } from "./partNumberStructuring.js";
import pLimit from "p-limit";
import { config } from "dotenv";
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
