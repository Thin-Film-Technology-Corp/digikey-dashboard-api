import { config } from "dotenv";
import pLimit from "p-limit";
config();

const limit = pLimit(15);

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
}

// return an array of the offsets that need to be redone
export function validatePNs(markers, initialOffset, total, limit) {
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

// use array of offsets to retrieve missing information
export async function remediatePNs(
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
          },
          undefined,
          errorArray
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

// remediates pns in a batch format, distinct from retrievepns function because it doesn't necesarily go sequentially (maybe we could change that about retrieve resistor pns to consolidate these and make it recursive)
async function bulkRemediation(
  arrOfPNs,
  body,
  accessToken,
  clientId,
  errorArray
) {
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
  // remove duplactes from array
  let redosNoDupes = [...new Set(redos)];

  return [redosNoDupes, pns];
}

// do fetch until you get response.ok
async function fetchWithRetries(url, options, retries = 3, errorArray) {
  try {
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
      logExceptOnTest(
        `The following status was returned by a retry with redos fetch: ${response.status} ${response.statusText}`
      );
    }
  } catch (error) {
    logExceptOnTest(`there was an error fetching with retries" ${error}`);
  }
  throw new Error(`there was an error fetching after three retries`);
}
