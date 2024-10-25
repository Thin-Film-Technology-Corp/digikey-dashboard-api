import { config } from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "fs";
import {
  isMainThread,
  Worker,
  parentPort,
  workerData,
} from "node:worker_threads";
config();

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
}

// divides the database comparisons between the core count
// spawns worker threads
// Distributes the comparisons between the worker threads by adding the comparison data to the thread
export async function compareQueryToDatabase(
  queryResults,
  database,
  coreCount
) {
  let testFile;
  if (existsSync("./temp/results.csv")) {
    testFile = readFileSync("./temp/results.csv").toString();
  } else {
    testFile = '"core count","elapsed time","number of parts","parts / ms"';
  }

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

function compareHashes(newData, oldData) {
  newData.forEach((newItem) => {
    if (!oldData.some((oldItem) => oldItem.hash === newItem.hash)) {
      oldData.push(newItem);
    }
  });
  return oldData;
}

if (!isMainThread) {
  const { partNumbers, existingPartsMap } = workerData;
  const existingPartsMapObj = new Map(existingPartsMap);
  const result = processPartNumbers(partNumbers, existingPartsMapObj);
  parentPort.postMessage(result);
}
