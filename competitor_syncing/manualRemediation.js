import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import { compareQueryToDatabase } from "./partNumberComparison.js";

config();

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
}

// Abstraction that calls the functions in their order
// Connects to mongoDB and makes the additions
async function syncCompetitorsNoFetch(pns) {
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

  writeFileSync("./temp/most_recent_pns.json", JSON.stringify(pns));
  writeFileSync(
    "./temp/most_recent_operation.json",
    JSON.stringify(operations)
  );

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

// syncCompetitorsNoFetch(
//   JSON.parse(readFileSync("./temp/checkOnParts.json"))
// ).then((results) => {
//   console.log("complete");
// });
