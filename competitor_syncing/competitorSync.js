import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { getAccessTokenForDigikeyAPI } from "../digiKeyAPI.js";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { retrieveResistorPNs } from "./partNumberRetrieval.js";
import { remediatePNs } from "./partNumberRemediation.js";
import { structurePNs } from "./partNumberStructuring.js";
import {
  findAndHandlePAIDuplicates,
  findDuplicatePartNumbers,
} from "./mongoCleaningFunctions.js";

config();

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
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
async function syncCompetitors(offset) {
  if (offset !== 0) {
    offset = offset || 122000;
  }
  let body = {
    Keywords: "Resistor",
    Limit: 50,
    Offset: offset,
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

  logExceptOnTest("connecting to Mongo instance...");
  const client = new MongoClient(
    process.env.competitor_database_connection_string
  );
  await client.connect();
  const db = client.db("CompetitorDBInstance");
  const dkChipResistor = db.collection("dk_chip_resistor");
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

      // resolves with the redos required
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
          errorArray,
          dkChipResistor
        )
      );

      // Explicitly modify the body offset so the indexes are correctly ordered
      body.Offset += totalPartsHandled;
    } catch (error) {
      console.error(`Error retrieving resistor PNs ${error} \n ${error.stack}`);
      logExceptOnTest("writing error log to ./temp/retrieval_errors.json");
      writeFileSync("./temp/retrieval_errors.json", JSON.stringify(errorArray));
      return null;
    }
  }

  logExceptOnTest("all requests sent. awaiting resolution...");
  await Promise.all(pns);

  logExceptOnTest(`All APIs require ${pns.length} to be redone`);
  const redoneParts = await remediatePNs(
    pns,
    body,
    await accessToken,
    120,
    60000,
    process.env.clientId,
    null,
    errorArray
  );

  try {
    const redoBulkCommand = redoneParts.map(structurePNs);
    logExceptOnTest(`pushing redone parts into mongo...`);
    const mongoResults = await dkChipResistor.bulkWrite(redoBulkCommand);
    logExceptOnTest(
      `${mongoResults.insertedCount} inserted & ${mongoResults.modifiedCount} modified`
    );
  } catch (error) {
    console.log(`There was an error redoing parts: ${error}`);
  }

  // TODO: move this to the pn stage so we aren''t sendinf redundant info
  logExceptOnTest(`Cleaning up...`);
  try {
    const duplicates = await findDuplicatePartNumbers(true, dkChipResistor);
    const paiDuplicates = await findAndHandlePAIDuplicates(
      true,
      dkChipResistor
    );
    logExceptOnTest(
      `${duplicates.length} part number duplicates found and removed\n ${paiDuplicates.length} part and inventory data duplicates removed`
    );
  } catch (error) {
    console.log(`there was an error cleaning up the database: ${error}`);
  }

  logExceptOnTest("closing client...");
  await client.close();
}

export async function handleCompetitorRefresh(offset) {
  // Create temp directory if it doesnt exist
  const tempDir = path.join(".", "temp");
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }
  await syncCompetitors(offset);
}
