import { MongoClient } from "mongodb";
import { config } from "dotenv";
config();

async function findPAIDuplicates(collection, field) {
  try {
    return await collection
      .aggregate([
        { $unwind: `$${field}` },
        {
          $group: {
            _id: {
              part_number: "$part_number",
              day: `$${field}.day`,
              month: `$${field}.month`,
              year: `$${field}.year`,
            },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
        {
          $project: {
            _id: 0,
            part_number: "$_id.part_number",
            day: "$_id.day",
            month: "$_id.month",
            year: "$_id.year",
            count: 1,
          },
        },
      ])
      .toArray();
  } catch (error) {
    console.error(`Error finding duplicates in ${field}:`, error);
    return [];
  }
}

async function removePAIDuplicates(collection, duplicates, field) {
  for (const duplicate of duplicates) {
    const { part_number, day, month, year } = duplicate;

    try {
      const doc = await collection.findOne({ part_number });
      if (doc && doc[field]) {
        const seenDates = new Set();
        const filteredArray = doc[field].filter((item) => {
          const dateKey = `${item.day}-${item.month}-${item.year}`;
          if (!seenDates.has(dateKey)) {
            seenDates.add(dateKey);
            return true; // Keep the first instance
          }
          return false; // Exclude duplicates
        });

        await collection.updateOne(
          { part_number },
          { $set: { [field]: filteredArray } }
        );
      }
    } catch (error) {
      console.error(
        `Error processing duplicates in ${field} for part ${part_number}:`,
        error
      );
    }
  }
}

export async function findAndHandlePAIDuplicates(
  isDeleteDuplicates,
  collection
) {
  let client;

  try {
    if (!collection) {
      try {
        client = new MongoClient(
          process.env.competitor_database_connection_string
        );
        await client.connect();
        const db = client.db("CompetitorDBInstance");
        collection = db.collection("play_dk_chip_resistor");
      } catch (error) {
        console.error("Error connecting to the database:", error);
        throw error; // Rethrow to ensure caller knows connection failed
      }
    }

    // Find duplicates in inventory and pricing arrays
    const inventoryDuplicates = await findPAIDuplicates(
      collection,
      "inventory"
    );
    const pricingDuplicates = await findPAIDuplicates(collection, "pricing");

    if (isDeleteDuplicates) {
      await removePAIDuplicates(collection, inventoryDuplicates, "inventory");
      await removePAIDuplicates(collection, pricingDuplicates, "pricing");
    }

    return [...inventoryDuplicates, ...pricingDuplicates];
  } catch (error) {
    console.error("Error in findAndHandleDuplicates:", error);
    throw error; // Allow caller to handle the error
  } finally {
    if (client) {
      await client.close();
    }
  }
}

export async function findDuplicatePartNumbers(isDeleteDuplicates, collection) {
  let client;
  if (!collection) {
    const client = new MongoClient(
      process.env.competitor_database_connection_string
    );
    await client.connect();
    const db = client.db("CompetitorDBInstance");
    collection = db.collection("play_dk_chip_resistor");
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
