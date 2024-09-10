import { config } from "dotenv";
config();

function logExceptOnTest(string) {
  if (process.env.NODE_ENV !== "test") {
    console.log(string);
  }
}

export async function getAllPartsInDigikeySearchV4(accessToken, body, allData) {
  allData = allData || [];
  body = body || {
    Keywords: "Resistor",
    Limit: 50,
    Offset: 0,
    FilterOptionsRequest: {
      ManufacturerFilter: [{ Id: "4463" }],
      MinimumQuantityAvailable: 0,
      ParameterFilterRequest: {
        CategoryFilter: { Id: "52", Value: "Chip Resistor - Surface Mount" },
        StatusFilter: [{ Id: "0" }],
        ParameterFilters: [],
      },
    },
    ProductStatus: "Active",
    ExcludeMarketPlaceProducts: false,
    SortOptions: {
      Field: "None",
      SortOrder: "Ascending",
    },
  };
  accessToken = accessToken || (await getAccessTokenForDigikeyAPI());
  logExceptOnTest(body.Offset);

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
    let total = data.ProductsCount;
    let bodyOffsetCopy = body.Offset;
    batchSize = batchSize || total - body.Offset;

    console.log(
      `batch size: ${batchSize}\noffset + batchsize: ${body.Offset + batchSize}`
    );

    if (bodyOffsetCopy <= body.Offset + batchSize) {
      bodyOffsetCopy = bodyOffsetCopy += body.Limit;
      data.Products.forEach((product) => {
        allData.push(product);
      });
      return getAllPartsInDigikeySearchV4(
        accessToken,
        body,
        allData,
        batchSize
      );
    } else {
      return allData;
    }
  } else {
    logExceptOnTest(
      `error ${response.status} ${
        response.statusText
      } \n${await response.text()}`
    );
    return allData;
  }
}

export async function getAccessTokenForDigikeyAPI(clientId, clientSecret) {
  clientId = clientId || process.env.clientId;
  clientSecret = clientSecret || process.env.clientSecret;
  const authCodeURL = `https://api.digikey.com/v1/oauth2/token`;
  let formData = encodeURI(
    `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`
  );
  let response = await fetch(authCodeURL, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    method: "POST",
    body: formData,
  });
  if (response.ok) {
    let data = await response.json();
    // logExceptOnTest(data);
    return data.access_token;
  } else {
    logExceptOnTest(
      `${response.status}\n ${response.statusText}\n ${await response.text()}`
    );
  }
}
