import { config } from "dotenv";
config();

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
  console.log(body.Offset);

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

    if (body.Offset <= total) {
      body.Offset = body.Offset += 50;
      data.Products.forEach((product) => {
        allData.push(product);
      });
      return getAllPartsInDigikeySearchV4(accessToken, body, allData);
    } else {
      return allData;
    }
  } else {
    console.log(
      `error ${response.status} ${
        response.statusText
      } \n${await response.text()}`
    );
  }
}

export async function getAccessTokenForDigikeyAPI() {
  const authCodeURL = `https://api.digikey.com/v1/oauth2/token`;
  let formData = encodeURI(
    `client_id=${process.env.clientId}&client_secret=${process.env.clientSecret}&grant_type=client_credentials`
  );
  let response = await fetch(authCodeURL, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    method: "POST",
    body: formData,
  });
  if (response.ok) {
    let data = await response.json();
    // console.log(data);
    return data.access_token;
  } else {
    console.log(
      `${response.status}\n ${response.statusText}\n ${await response.text()}`
    );
  }
}
