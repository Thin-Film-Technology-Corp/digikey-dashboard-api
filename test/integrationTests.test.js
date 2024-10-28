import { expect } from "chai";
import { config } from "dotenv";
import { describe } from "mocha";
import { MongoClient } from "mongodb";
import {
  converPartDataToCSV,
  convertMongoDataToCSV,
  flattenPartData,
  retrieveMongoPartData,
  retrieveMongoSalesData,
} from "../mongoOperation.js";
import {
  getDigiKeyCookies,
  getMicroStrategySession,
  getTokenForMicroStrategy,
} from "../getSessionCookies.js";
import { csvRequest } from "../login.js";
import { getAccessTokenForDigikeyAPI } from "../digiKeyAPI.js";
import { retrieveResistorPNs } from "../competitor_syncing/partNumberRetrieval.js";
import {
  compareQueryToDatabase,
  distributeWorkers,
  processPartNumbers,
  retrieveAllCompetitorDataFromMongo,
} from "../competitor_syncing/partNumberComparison.js";
import { readFileSync, writeFileSync } from "fs";
config();

describe("Integration testing for sales data workflow", async function () {
  let salesData;
  let convertedSalesData;
  it("Retrieves mongo sales data and combines with product group", async function () {
    this.timeout(15000);
    salesData = await retrieveMongoSalesData(1, 2024);
    expect(salesData).to.be.an("array");
    expect(salesData[0]).to.have.all.keys([
      "_id",
      "Month",
      "Invoiced Date",
      "Customer Company",
      "Customer City",
      "Customer State/Prov",
      "Customer Postal Code",
      "Ship To Company",
      "Ship To City",
      "Ship To State/Prov",
      "Ship To Postal Code",
      "Ship To Country",
      "DK Part Nbr",
      "Mfg Part Number",
      "Return Flag",
      "Shipped Qty",
      "Total Billable Orders",
      "Series",
      "document_hash",
      "part_details",
      "ProductGroup",
    ]);
  });
  it("Converts retrieved data to csv", async function () {
    convertedSalesData = convertMongoDataToCSV(salesData);
    expect(convertedSalesData).to.be.a("string");
    expect(convertedSalesData).to.include(
      `Month, Invoiced Date, Customer Company, Customer City, Customer State/Prov, Customer Postal Code, Ship To Company, Ship To City, Ship To State/Prov, Ship To Postal Code, Ship To Country, DK Part Nbr, Mfg Part Number, Return Flag, Shipped Qty, Total Billable Orders, Series, Product Group`
    );
  });
});

describe("Integration testing for part data workflow", async function () {
  let partData;
  let flattenedPartData;
  let csv;
  it("Retrieves part data from Mongo", async function () {
    this.timeout(15000);
    partData = await retrieveMongoPartData();
    expect(partData).to.be.an("array");
    expect(partData[0]).to.be.an("object");
    expect(partData[0]).to.have.all.keys([
      "_id",
      "product_description",
      "detailed_description",
      "part_number",
      "product_url",
      "datasheet_url",
      "photo_url",
      "video_url",
      "status",
      "resistance",
      "resistance_tolerance",
      "power",
      "composition",
      "features",
      "temp_coefficient",
      "operating_temperature",
      "digikey_case_size",
      "case_size",
      "ratings",
      "dimensions",
      "height",
      "terminations_number",
      "fail_rate",
      "category",
      "sub_category",
      "series",
      "classifications",
      "in_digikey",
      "standard_reel_pricing",
    ]);
  });
  it("Flattens retireved part data", function () {
    flattenedPartData = flattenPartData(partData);
    expect(flattenedPartData).to.be.an("array");
    expect(flattenedPartData[0]).to.be.an("object");
    expect(flattenedPartData[0]).to.have.all.keys([
      "product_description",
      "detailed_description",
      "part_number",
      "product_url",
      "datasheet_url",
      "photo_url",
      "video_url",
      "status",
      "resistance",
      "resistance_tolerance",
      "power",
      "composition",
      "features",
      "temp_coefficient",
      "operating_temperature",
      "digikey_case_size",
      "case_size",
      "ratings",
      "dimensions",
      "height",
      "terminations_number",
      "fail_rate",
      "category",
      "sub_category",
      "series",
      "reach_status",
      "rohs_status",
      "moisture_sensitivity_level",
      "export_control_class_number",
      "htsus_code",
      "in_digikey",
      "break_quantity",
      "unit_price",
      "total_price",
    ]);
  });
  it("Convertes flattened part data to csv", async function () {
    csv = converPartDataToCSV(flattenedPartData);
    expect(csv).to.be.a("string");
    expect(csv).to.include(
      "product_description,detailed_description,part_number,product_url,datasheet_url,photo_url,video_url,status,resistance,resistance_tolerance,power,composition,features,temp_coefficient,operating_temperature,digikey_case_size,case_size,ratings,dimensions,height,terminations_number,fail_rate,category,sub_category,series,reach_status,rohs_status,moisture_sensitivity_level,export_control_class_number,htsus_code,in_digikey,break_quantity,unit_price,total_price"
    );
  });
});

describe("Integration testing for dashboard document data workflow", async function () {
  // get micro strategy session credentials
  let cookies;
  let token;
  let sessionObj;
  it("Retrieves DigiKey session cookies", async function () {
    this.timeout(15000);
    cookies = await getDigiKeyCookies(
      process.env.digikey_username,
      process.env.digikey_password
    );
    expect(cookies).to.be.an("object");
    expect(cookies).to.have.all.keys([
      "apiCookies",
      "supplierCookies",
      "authorizationCookies",
    ]);
    expect(cookies.apiCookies[0]).to.be.a("string");
    expect(cookies.supplierCookies[0]).to.be.a("string");
    expect(cookies.authorizationCookies[0]).to.be.a("string");
  });
  // get token for microstrategy
  it("Uses DigiKey cookies to retrieve MicroStrategy token", async function () {
    this.timeout(15000);
    token = await getTokenForMicroStrategy(
      cookies.supplierCookies,
      cookies.authorizationCookies,
      process.env.digikey_username,
      process.env.digikey_password
    );
    expect(token).to.be.a("string");
    expect(token.length).to.be.greaterThan(10);
  });
  // getMicroStrategySession
  it("Exchanges DigiKey token for Microstrategy session", async function () {
    this.timeout(15000);
    sessionObj = await getMicroStrategySession(token);
    // console.log(sessionObj);
    expect(sessionObj).to.be.an("object");
    expect(sessionObj).to.have.all.keys(["cookies", "authToken"]);
    expect(sessionObj.cookies).to.be.a("string");
    expect(sessionObj.authToken).to.be.a("string");
    expect(sessionObj.cookies).to.include("mstrSessionCORS=");
    expect(sessionObj.cookies).to.include("mstrSession=");
    expect(sessionObj.cookies).to.include("JSESSIONID=");
    expect(sessionObj.cookies).to.include("iSession=");
    expect(sessionObj.cookies).to.include("MSTRDEVICEID=");
  });
  it("Requests inventory csv data", async function () {
    this.timeout(15000);
    const csvBuffer = await csvRequest(
      sessionObj.cookies,
      sessionObj.authToken,
      "inventory"
    );
    const csv = csvBuffer.toString("utf-16le");
    // console.log(csv);
    expect(csv).to.be.a("string");
    expect(csv).to.include(
      `"Mfg Part Number","Report Part Number","Min Order Qty","Order Mult","Qty Available","Qty on Order","Back Ordered","Ship Rsv","Current Cost","Last Order Date","Inventory Turns","Qty to Order"`
    );
  });
  it("Requests sales csv data", async function () {
    this.timeout(15000);
    const csvBuffer = await csvRequest(
      sessionObj.cookies,
      sessionObj.authToken,
      "sales"
    );
    const csv = csvBuffer.toString("utf-16le");
    expect(csv).to.be.a("string");
    expect(csv).to.include(
      `"Month","Invoiced Date","Customer Company","Customer City","Customer State/Prov","Customer Postal Code","Ship To Company","Ship To City","Ship To State/Prov","Ship To Postal Code","Ship To Country","DK Part Nbr","Mfg Part Number","Return Flag","Shipped Qty","Total Billable Orders"`
    );
  });
  it("Requests fees csv data", async function () {
    this.timeout(15000);
    const csvBuffer = await csvRequest(
      sessionObj.cookies,
      sessionObj.authToken,
      "fees"
    );
    const csv = csvBuffer.toString("utf-16le");
    expect(csv).to.be.a("string");
    expect(csv).to.include(
      `"Year","Month","Storage Fees","Return Fees","SKU Addtions Fees","Fee Total"`
    );
  });
  it("Requests billing csv data", async function () {
    this.timeout(15000);
    const csvBuffer = await csvRequest(
      sessionObj.cookies,
      sessionObj.authToken,
      "billing"
    );
    const csv = csvBuffer.toString("utf-16le");
    expect(csv).to.be.a("string");
    expect(csv).to.include(
      `"Vendor ID","Transaction Date","Vendor Invoice Nbr","Memo ID","Reference Note","Transaction Amount","Currency","Pending Invoice Amount","Pending Fees Amount","Pending Misc Amt"`
    );
  });
});

describe("Integration testing for syncing competitor data", async function () {
  let accessToken;
  let partData;
  let client;
  let db;
  let dkChipResistor;
  // get access token for digikey api
  it("Retrieves access token for DigiKey REST API", async function () {
    accessToken = await getAccessTokenForDigikeyAPI();
    expect(accessToken).to.be.a("string");
  });
  // get chip resistors from api
  it("Retrieves resistor data from part search V4", async function () {
    this.timeout(15000);
    partData = await retrieveResistorPNs(accessToken, {
      Keywords: "Resistor",
      Limit: 50,
      Offset: 121950,
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
    });
    expect(partData).to.be.an("array");
    expect(partData[0]).to.have.all.keys(
      "product_description",
      "detailed_description",
      "part_number",
      "product_url",
      "datasheet_url",
      "photo_url",
      "video_url",
      "status",
      "resistance",
      "resistance_tolerance",
      "power",
      "composition",
      "features",
      "temp_coefficient",
      "operating_temperature",
      "digikey_case_size",
      "case_size",
      "ratings",
      "dimensions",
      "height",
      "terminations_number",
      "fail_rate",
      "category",
      "sub_category",
      "series",
      "classifications",
      "pricing",
      "inventory"
    );

    expect(partData[0].classifications)
      .to.be.an("object")
      .that.includes.all.keys(
        "ReachStatus",
        "RohsStatus",
        "MoistureSensitivityLevel",
        "ExportControlClassNumber",
        "HtsusCode"
      );

    expect(partData[0].pricing).to.be.an("array").that.is.not.empty;
    expect(partData[0].inventory).to.be.an("array").that.is.not.empty;
  });
  // Connect to MongoDB
  it("Connects to MongoDB", async function () {
    client = new MongoClient(process.env.competitor_database_connection_string);
    await client.connect();
    db = client.db("CompetitorDBInstance");
    dkChipResistor = db.collection("dk_chip_resistor");
    expect(db).to.not.be.null;
  });
});

describe("Integration testing for comparing competitor database", async function () {
  let client;
  let dbCollection;
  let partNumbers;
  let existingPartsMap;
  let testComparisonFile = JSON.parse(
    readFileSync("./temp/most_recent_pns.json")
  );

  it("connects to mongo database", async function () {
    this.timeout(3000);
    client = new MongoClient(process.env.competitor_database_connection_string);
    await client.connect();
    const db = client.db("CompetitorDBInstance");
    dbCollection = db.collection("dk_chip_resistor");
    expect(dbCollection).to.not.be.null;
  });
  it("retrieves all data from the mongo database", async function () {
    this.timeout(20000);
    [partNumbers, existingPartsMap] = await retrieveAllCompetitorDataFromMongo(
      dbCollection,
      testComparisonFile
    );
    expect(partNumbers).to.be.an("array");
    expect(existingPartsMap).to.be.an("map");
  });
  it("worker thread functions correctly assess when to insert, modify, or ignore pricing / inventory changes", async function () {
    // simulate 3 mongo entries
    let mongoSimulation = new Map([
      // [
      //   "RM02F24R3CT",
      //   {
      //     _id: "671922168c26820d731d38f6",
      //     product_description: "RES SMD 24.3 OHM 1% 1/20W 0201",
      //     detailed_description:
      //       "24.3 Ohms ±1% 0.05W, 1/20W Chip Resistor 0201 (0603 Metric) Thick Film",
      //     part_number: "RM02F24R3CT",
      //     product_url:
      //       "https://www.digikey.com/en/products/detail/cal-chip-electronics-inc/RM02F24R3CT/13567642",
      //     datasheet_url:
      //       "https://calchip.com/wp-content/uploads/2023/05/rm_series.pdf",
      //     photo_url:
      //       "https://mm.digikey.com/Volume0/opasdata/d220001/medias/images/4029/MFG_RM_series.jpg",
      //     video_url: "",
      //     status: "Active",
      //     resistance: "24.3 Ohms",
      //     resistance_tolerance: "±1%",
      //     power: "0.05W, 1/20W",
      //     composition: "Thick Film",
      //     features: ["-"],
      //     temp_coefficient: "±200ppm/°C",
      //     operating_temperature: "-55°C ~ 125°C",
      //     digikey_case_size: "0201 (0603 Metric)",
      //     case_size: "0201",
      //     ratings: ["-"],
      //     dimensions: '0.024" L x 0.012" W (0.60mm x 0.30mm)',
      //     height: '0.010" (0.26mm)',
      //     terminations_number: 2,
      //     fail_rate: "",
      //     category: "Resistors",
      //     sub_category: "Chip Resistor - Surface Mount",
      //     series: "RM",
      //     classifications: {
      //       ReachStatus: "REACH Unaffected",
      //       RohsStatus: "ROHS3 Compliant",
      //       MoistureSensitivityLevel: "1  (Unlimited)",
      //       ExportControlClassNumber: "EAR99",
      //       HtsusCode: "8533.21.0030",
      //     },
      //     pricing: [
      //       {
      //         tape_reel: [
      //           {
      //             BreakQuantity: 5000,
      //             UnitPrice: 0.06101,
      //             TotalPrice: 305.05,
      //           },
      //           {
      //             BreakQuantity: 10000,
      //             UnitPrice: 0.05664,
      //             TotalPrice: 566.4,
      //           },
      //           {
      //             BreakQuantity: 15000,
      //             UnitPrice: 0.05447,
      //             TotalPrice: 817.05,
      //           },
      //           {
      //             BreakQuantity: 25000,
      //             UnitPrice: 0.05207,
      //             TotalPrice: 1301.75,
      //           },
      //           {
      //             BreakQuantity: 35000,
      //             UnitPrice: 0.05068,
      //             TotalPrice: 1773.8,
      //           },
      //           {
      //             BreakQuantity: 50000,
      //             UnitPrice: 0.04934,
      //             TotalPrice: 2467,
      //           },
      //           {
      //             BreakQuantity: 125000,
      //             UnitPrice: 0.04649,
      //             TotalPrice: 5811.25,
      //           },
      //         ],
      //         cut_tape: [
      //           { BreakQuantity: 1, UnitPrice: 0.36, TotalPrice: 0.36 },
      //           { BreakQuantity: 10, UnitPrice: 0.19, TotalPrice: 1.9 },
      //           { BreakQuantity: 50, UnitPrice: 0.1304, TotalPrice: 6.52 },
      //           { BreakQuantity: 100, UnitPrice: 0.1128, TotalPrice: 11.28 },
      //           { BreakQuantity: 500, UnitPrice: 0.08406, TotalPrice: 42.03 },
      //           { BreakQuantity: 1000, UnitPrice: 0.07539, TotalPrice: 75.39 },
      //         ],
      //         digi_reel: [],
      //         hash: "0c50d5bd5951589cbc34f7d02dd5c707",
      //         day: 28,
      //         month: 10,
      //         year: 2024,
      //       },
      //     ],
      //     inventory: [
      //       {
      //         tape_reel: 0,
      //         cut_tape: 4900,
      //         digi_reel: 0,
      //         hash: "4886247817506f34c70bc9aad0f50c0e",
      //         day: 28,
      //         month: 10,
      //         year: 2024,
      //       },
      //     ],
      //   },
      // ],
      [
        "AddEntry",
        {
          _id: "671922168c26820d731d3891",
          product_description: "RES SMD 53.6K OHM 1% 1/20W 0201",
          detailed_description:
            "53.6 kOhms ±1% 0.05W, 1/20W Chip Resistor 0201 (0603 Metric) Thick Film",
          part_number: "AddEntry",
          product_url:
            "https://www.digikey.com/en/products/detail/cal-chip-electronics-inc/RM02F5362CT/13567384",
          datasheet_url:
            "https://calchip.com/wp-content/uploads/2023/05/rm_series.pdf",
          photo_url:
            "https://mm.digikey.com/Volume0/opasdata/d220001/medias/images/4029/MFG_RM_series.jpg",
          video_url: "",
          status: "Active",
          resistance: "53.6 kOhms",
          resistance_tolerance: "±1%",
          power: "0.05W, 1/20W",
          composition: "Thick Film",
          features: ["-"],
          temp_coefficient: "±200ppm/°C",
          operating_temperature: "-55°C ~ 125°C",
          digikey_case_size: "0201 (0603 Metric)",
          case_size: "0201",
          ratings: ["-"],
          dimensions: '0.024" L x 0.012" W (0.60mm x 0.30mm)',
          height: '0.010" (0.26mm)',
          terminations_number: 2,
          fail_rate: "",
          category: "Resistors",
          sub_category: "Chip Resistor - Surface Mount",
          series: "RM",
          classifications: {
            ReachStatus: "REACH Unaffected",
            RohsStatus: "ROHS3 Compliant",
            MoistureSensitivityLevel: "1  (Unlimited)",
            ExportControlClassNumber: "EAR99",
            HtsusCode: "8533.21.0030",
          },
          pricing: [
            {
              tape_reel: [
                {
                  BreakQuantity: 5000,
                  UnitPrice: 0.06101,
                  TotalPrice: 305.05,
                },
                {
                  BreakQuantity: 10000,
                  UnitPrice: 0.05664,
                  TotalPrice: 566.4,
                },
                {
                  BreakQuantity: 15000,
                  UnitPrice: 0.05447,
                  TotalPrice: 817.05,
                },
                {
                  BreakQuantity: 25000,
                  UnitPrice: 0.05207,
                  TotalPrice: 1301.75,
                },
                {
                  BreakQuantity: 35000,
                  UnitPrice: 0.05068,
                  TotalPrice: 1773.8,
                },
                {
                  BreakQuantity: 50000,
                  UnitPrice: 0.04934,
                  TotalPrice: 2467,
                },
                {
                  BreakQuantity: 125000,
                  UnitPrice: 0.04649,
                  TotalPrice: 5811.25,
                },
              ],
              cut_tape: [
                { BreakQuantity: 1, UnitPrice: 0.36, TotalPrice: 0.36 },
                { BreakQuantity: 10, UnitPrice: 0.19, TotalPrice: 1.9 },
                { BreakQuantity: 50, UnitPrice: 0.1304, TotalPrice: 6.52 },
                { BreakQuantity: 100, UnitPrice: 0.1128, TotalPrice: 11.28 },
                { BreakQuantity: 500, UnitPrice: 0.08406, TotalPrice: 42.03 },
                { BreakQuantity: 1000, UnitPrice: 0.07539, TotalPrice: 75.39 },
              ],
              digi_reel: [],
              hash: "0c50d5bd5951589cbc34f7d02dd5c707",
              day: 28,
              month: 10,
              year: 2024,
            },
          ],
          inventory: [
            {
              tape_reel: 0,
              cut_tape: 4900,
              digi_reel: 0,
              hash: "4886247817506f34c70bc9aad0f50c0e",
              day: 28,
              month: 10,
              year: 2024,
            },
          ],
        },
      ],
      [
        "IdenticalPart",
        {
          _id: "671922168c26820d731d3896",
          product_description: "RES SMD 604 OHM 1% 1/20W 0201",
          detailed_description:
            "604 Ohms ±1% 0.05W, 1/20W Chip Resistor 0201 (0603 Metric) Thick Film",
          part_number: "IdenticalPart",
          product_url:
            "https://www.digikey.com/en/products/detail/cal-chip-electronics-inc/RM02F6040CT/13567763",
          datasheet_url:
            "https://calchip.com/wp-content/uploads/2023/05/rm_series.pdf",
          photo_url:
            "https://mm.digikey.com/Volume0/opasdata/d220001/medias/images/4029/MFG_RM_series.jpg",
          video_url: "",
          status: "Active",
          resistance: "604 Ohms",
          resistance_tolerance: "±1%",
          power: "0.05W, 1/20W",
          composition: "Thick Film",
          features: ["-"],
          temp_coefficient: "±200ppm/°C",
          operating_temperature: "-55°C ~ 125°C",
          digikey_case_size: "0201 (0603 Metric)",
          case_size: "0201",
          ratings: ["-"],
          dimensions: '0.024" L x 0.012" W (0.60mm x 0.30mm)',
          height: '0.010" (0.26mm)',
          terminations_number: 2,
          fail_rate: "",
          category: "Resistors",
          sub_category: "Chip Resistor - Surface Mount",
          series: "RM",
          classifications: {
            ReachStatus: "REACH Unaffected",
            RohsStatus: "ROHS3 Compliant",
            MoistureSensitivityLevel: "1  (Unlimited)",
            ExportControlClassNumber: "EAR99",
            HtsusCode: "8533.21.0030",
          },
          pricing: [
            {
              tape_reel: [
                {
                  BreakQuantity: 5000,
                  UnitPrice: 0.06101,
                  TotalPrice: 305.05,
                },
                {
                  BreakQuantity: 10000,
                  UnitPrice: 0.05664,
                  TotalPrice: 566.4,
                },
                {
                  BreakQuantity: 15000,
                  UnitPrice: 0.05447,
                  TotalPrice: 817.05,
                },
                {
                  BreakQuantity: 25000,
                  UnitPrice: 0.05207,
                  TotalPrice: 1301.75,
                },
                {
                  BreakQuantity: 35000,
                  UnitPrice: 0.05068,
                  TotalPrice: 1773.8,
                },
                {
                  BreakQuantity: 50000,
                  UnitPrice: 0.04934,
                  TotalPrice: 2467,
                },
                {
                  BreakQuantity: 125000,
                  UnitPrice: 0.04649,
                  TotalPrice: 5811.25,
                },
              ],
              cut_tape: [
                { BreakQuantity: 1, UnitPrice: 0.36, TotalPrice: 0.36 },
                { BreakQuantity: 10, UnitPrice: 0.19, TotalPrice: 1.9 },
                { BreakQuantity: 50, UnitPrice: 0.1304, TotalPrice: 6.52 },
                { BreakQuantity: 100, UnitPrice: 0.1128, TotalPrice: 11.28 },
                { BreakQuantity: 500, UnitPrice: 0.08406, TotalPrice: 42.03 },
                { BreakQuantity: 1000, UnitPrice: 0.07539, TotalPrice: 75.39 },
              ],
              digi_reel: [],
              hash: "0c50d5bd5951589cbc34f7d02dd5c707",
              day: 28,
              month: 10,
              year: 2024,
            },
          ],
          inventory: [
            {
              tape_reel: 0,
              cut_tape: 4900,
              digi_reel: 0,
              hash: "4886247817506f34c70bc9aad0f50c0e",
              day: 28,
              month: 10,
              year: 2024,
            },
          ],
        },
      ],
    ]);
    let querySimulation = [
      // should ignore this one since it's identical
      {
        _id: "671922168c26820d731d3896",
        product_description: "RES SMD 604 OHM 1% 1/20W 0201",
        detailed_description:
          "604 Ohms ±1% 0.05W, 1/20W Chip Resistor 0201 (0603 Metric) Thick Film",
        part_number: "IdenticalPart",
        product_url:
          "https://www.digikey.com/en/products/detail/cal-chip-electronics-inc/RM02F6040CT/13567763",
        datasheet_url:
          "https://calchip.com/wp-content/uploads/2023/05/rm_series.pdf",
        photo_url:
          "https://mm.digikey.com/Volume0/opasdata/d220001/medias/images/4029/MFG_RM_series.jpg",
        video_url: "",
        status: "Active",
        resistance: "604 Ohms",
        resistance_tolerance: "±1%",
        power: "0.05W, 1/20W",
        composition: "Thick Film",
        features: ["-"],
        temp_coefficient: "±200ppm/°C",
        operating_temperature: "-55°C ~ 125°C",
        digikey_case_size: "0201 (0603 Metric)",
        case_size: "0201",
        ratings: ["-"],
        dimensions: '0.024" L x 0.012" W (0.60mm x 0.30mm)',
        height: '0.010" (0.26mm)',
        terminations_number: 2,
        fail_rate: "",
        category: "Resistors",
        sub_category: "Chip Resistor - Surface Mount",
        series: "RM",
        classifications: {
          ReachStatus: "REACH Unaffected",
          RohsStatus: "ROHS3 Compliant",
          MoistureSensitivityLevel: "1  (Unlimited)",
          ExportControlClassNumber: "EAR99",
          HtsusCode: "8533.21.0030",
        },
        pricing: [
          {
            tape_reel: [
              {
                BreakQuantity: 5000,
                UnitPrice: 0.06101,
                TotalPrice: 305.05,
              },
              {
                BreakQuantity: 10000,
                UnitPrice: 0.05664,
                TotalPrice: 566.4,
              },
              {
                BreakQuantity: 15000,
                UnitPrice: 0.05447,
                TotalPrice: 817.05,
              },
              {
                BreakQuantity: 25000,
                UnitPrice: 0.05207,
                TotalPrice: 1301.75,
              },
              {
                BreakQuantity: 35000,
                UnitPrice: 0.05068,
                TotalPrice: 1773.8,
              },
              {
                BreakQuantity: 50000,
                UnitPrice: 0.04934,
                TotalPrice: 2467,
              },
              {
                BreakQuantity: 125000,
                UnitPrice: 0.04649,
                TotalPrice: 5811.25,
              },
            ],
            cut_tape: [
              { BreakQuantity: 1, UnitPrice: 0.36, TotalPrice: 0.36 },
              { BreakQuantity: 10, UnitPrice: 0.19, TotalPrice: 1.9 },
              { BreakQuantity: 50, UnitPrice: 0.1304, TotalPrice: 6.52 },
              { BreakQuantity: 100, UnitPrice: 0.1128, TotalPrice: 11.28 },
              { BreakQuantity: 500, UnitPrice: 0.08406, TotalPrice: 42.03 },
              { BreakQuantity: 1000, UnitPrice: 0.07539, TotalPrice: 75.39 },
            ],
            digi_reel: [],
            hash: "0c50d5bd5951589cbc34f7d02dd5c707",
            day: 28,
            month: 10,
            year: 2024,
          },
        ],
        inventory: [
          {
            tape_reel: 0,
            cut_tape: 4900,
            digi_reel: 0,
            hash: "4886247817506f34c70bc9aad0f50c0e",
            day: 28,
            month: 10,
            year: 2024,
          },
        ],
      },
      // should add an entry to both inventory and pricing since they've changed
      {
        _id: "671922168c26820d731d3891",
        product_description: "RES SMD 53.6K OHM 1% 1/20W 0201",
        detailed_description:
          "53.6 kOhms ±1% 0.05W, 1/20W Chip Resistor 0201 (0603 Metric) Thick Film",
        part_number: "AddEntry",
        product_url:
          "https://www.digikey.com/en/products/detail/cal-chip-electronics-inc/RM02F5362CT/13567384",
        datasheet_url:
          "https://calchip.com/wp-content/uploads/2023/05/rm_series.pdf",
        photo_url:
          "https://mm.digikey.com/Volume0/opasdata/d220001/medias/images/4029/MFG_RM_series.jpg",
        video_url: "",
        status: "Active",
        resistance: "53.6 kOhms",
        resistance_tolerance: "±1%",
        power: "0.05W, 1/20W",
        composition: "Thick Film",
        features: ["-"],
        temp_coefficient: "±200ppm/°C",
        operating_temperature: "-55°C ~ 125°C",
        digikey_case_size: "0201 (0603 Metric)",
        case_size: "0201",
        ratings: ["-"],
        dimensions: '0.024" L x 0.012" W (0.60mm x 0.30mm)',
        height: '0.010" (0.26mm)',
        terminations_number: 2,
        fail_rate: "",
        category: "Resistors",
        sub_category: "Chip Resistor - Surface Mount",
        series: "RM",
        classifications: {
          ReachStatus: "REACH Unaffected",
          RohsStatus: "ROHS3 Compliant",
          MoistureSensitivityLevel: "1  (Unlimited)",
          ExportControlClassNumber: "EAR99",
          HtsusCode: "8533.21.0030",
        },
        pricing: [
          {
            tape_reel: [
              {
                BreakQuantity: 5000,
                // modifications are here
                UnitPrice: 0.061,
                // modifications are here
                TotalPrice: 305.0,
              },
              {
                BreakQuantity: 10000,
                UnitPrice: 0.05664,
                TotalPrice: 566.4,
              },
              {
                BreakQuantity: 15000,
                UnitPrice: 0.05447,
                TotalPrice: 817.05,
              },
              {
                BreakQuantity: 25000,
                UnitPrice: 0.05207,
                TotalPrice: 1301.75,
              },
              {
                BreakQuantity: 35000,
                UnitPrice: 0.05068,
                TotalPrice: 1773.8,
              },
              {
                BreakQuantity: 50000,
                UnitPrice: 0.04934,
                TotalPrice: 2467,
              },
              {
                BreakQuantity: 125000,
                UnitPrice: 0.04649,
                TotalPrice: 5811.25,
              },
            ],
            cut_tape: [
              { BreakQuantity: 1, UnitPrice: 0.36, TotalPrice: 0.36 },
              { BreakQuantity: 10, UnitPrice: 0.19, TotalPrice: 1.9 },
              { BreakQuantity: 50, UnitPrice: 0.1304, TotalPrice: 6.52 },
              { BreakQuantity: 100, UnitPrice: 0.1128, TotalPrice: 11.28 },
              { BreakQuantity: 500, UnitPrice: 0.08406, TotalPrice: 42.03 },
              { BreakQuantity: 1000, UnitPrice: 0.07539, TotalPrice: 75.39 },
            ],
            digi_reel: [],
            // modifications are here
            hash: "0c50d5bd5951589cbc34f7d02dd5c707TEST",
            day: 29,
            month: 10,
            year: 2024,
          },
        ],
        inventory: [
          {
            tape_reel: 0,
            // modifications are here
            cut_tape: 4501,
            digi_reel: 0,
            // modifications are here
            hash: "4886247817506f34c70bc9aad0f50c0eTEST",
            day: 29,
            month: 10,
            year: 2024,
          },
        ],
      },
      // should add this one since it doesnt exist in the map
      {
        _id: "671922168c26820d731d38f6",
        product_description: "RES SMD 24.3 OHM 1% 1/20W 0201",
        detailed_description:
          "24.3 Ohms ±1% 0.05W, 1/20W Chip Resistor 0201 (0603 Metric) Thick Film",
        part_number: "Addition",
        product_url:
          "https://www.digikey.com/en/products/detail/cal-chip-electronics-inc/RM02F24R3CT/13567642",
        datasheet_url:
          "https://calchip.com/wp-content/uploads/2023/05/rm_series.pdf",
        photo_url:
          "https://mm.digikey.com/Volume0/opasdata/d220001/medias/images/4029/MFG_RM_series.jpg",
        video_url: "",
        status: "Active",
        resistance: "24.3 Ohms",
        resistance_tolerance: "±1%",
        power: "0.05W, 1/20W",
        composition: "Thick Film",
        features: ["-"],
        temp_coefficient: "±200ppm/°C",
        operating_temperature: "-55°C ~ 125°C",
        digikey_case_size: "0201 (0603 Metric)",
        case_size: "0201",
        ratings: ["-"],
        dimensions: '0.024" L x 0.012" W (0.60mm x 0.30mm)',
        height: '0.010" (0.26mm)',
        terminations_number: 2,
        fail_rate: "",
        category: "Resistors",
        sub_category: "Chip Resistor - Surface Mount",
        series: "RM",
        classifications: {
          ReachStatus: "REACH Unaffected",
          RohsStatus: "ROHS3 Compliant",
          MoistureSensitivityLevel: "1  (Unlimited)",
          ExportControlClassNumber: "EAR99",
          HtsusCode: "8533.21.0030",
        },
        pricing: [
          {
            tape_reel: [
              {
                BreakQuantity: 5000,
                UnitPrice: 0.06101,
                TotalPrice: 305.05,
              },
              {
                BreakQuantity: 10000,
                UnitPrice: 0.05664,
                TotalPrice: 566.4,
              },
              {
                BreakQuantity: 15000,
                UnitPrice: 0.05447,
                TotalPrice: 817.05,
              },
              {
                BreakQuantity: 25000,
                UnitPrice: 0.05207,
                TotalPrice: 1301.75,
              },
              {
                BreakQuantity: 35000,
                UnitPrice: 0.05068,
                TotalPrice: 1773.8,
              },
              {
                BreakQuantity: 50000,
                UnitPrice: 0.04934,
                TotalPrice: 2467,
              },
              {
                BreakQuantity: 125000,
                UnitPrice: 0.04649,
                TotalPrice: 5811.25,
              },
            ],
            cut_tape: [
              { BreakQuantity: 1, UnitPrice: 0.36, TotalPrice: 0.36 },
              { BreakQuantity: 10, UnitPrice: 0.19, TotalPrice: 1.9 },
              { BreakQuantity: 50, UnitPrice: 0.1304, TotalPrice: 6.52 },
              { BreakQuantity: 100, UnitPrice: 0.1128, TotalPrice: 11.28 },
              { BreakQuantity: 500, UnitPrice: 0.08406, TotalPrice: 42.03 },
              { BreakQuantity: 1000, UnitPrice: 0.07539, TotalPrice: 75.39 },
            ],
            digi_reel: [],
            hash: "0c50d5bd5951589cbc34f7d02dd5c707",
            day: 28,
            month: 10,
            year: 2024,
          },
        ],
        inventory: [
          {
            tape_reel: 0,
            cut_tape: 4900,
            digi_reel: 0,
            hash: "4886247817506f34c70bc9aad0f50c0e",
            day: 28,
            month: 10,
            year: 2024,
          },
        ],
      },
    ];
    // simulate 3 query results
    let results = processPartNumbers(querySimulation, mongoSimulation);

    // ensure bulkOp has 1 entry
    expect(results.bulkOp.length).to.equal(1);
    // ensure insertionList has 1 entry
    expect(results.insertionList.length).to.equal(1);
  });
  it("distributes comparison functions to worker threads and returns results", async function () {
    this.timeout(0);
    let coreCount = 4;
    const results = distributeWorkers(
      testComparisonFile,
      coreCount,
      existingPartsMap
    );
    expect(results).to.be.an("array");
    let workerOutputs = await Promise.all(results);
    expect(workerOutputs.length).to.equal(coreCount);
    workerOutputs.forEach((comparisonResults) => {
      expect(comparisonResults).to.have.keys(["bulkOp", "insertionList"]);
    });
    writeFileSync("./temp/test_operation.json", JSON.stringify(workerOutputs));
  });

  if (client) {
    client.close();
  }
});
