import request from "supertest";
import { expect } from "chai";
import { config } from "dotenv";
import { describe } from "mocha";
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
import { retrieveResistorPNs } from "../competitor_syncing/competitorSync.js";
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

describe("syncs competitor data", async function () {
  let accessToken;
  let partData;
  // get access token for digikey api
  it("Retrieves access token for DigiKey REST API", async function () {
    accessToken = await getAccessTokenForDigikeyAPI();
    expect(accessToken).to.be.a("string");
  });
  // get chip resistors from api
  it("Retrieves resistor data from part search V4", async function () {
    this.timeout(15000);
    partData = await retrieveResistorPNs(accessToken);
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

    expect(partData[0].product_description).to.be.a("string");
    expect(partData[0].detailed_description).to.be.a("string");
    expect(partData[0].part_number).to.be.a("string");
    expect(partData[0].product_url).to.be.a("string");
    expect(partData[0].datasheet_url).to.be.a("string");
    expect(partData[0].photo_url).to.be.a("string");
    expect(partData[0].video_url).to.be.a("string");
    expect(partData[0].status).to.be.a("string");
    expect(partData[0].resistance).to.be.a("string");
    expect(partData[0].resistance_tolerance).to.be.a("string");
    expect(partData[0].power).to.be.a("string");
    expect(partData[0].composition).to.be.a("string");
    expect(partData[0].features).to.be.an("array").that.is.not.empty;
    expect(partData[0].temp_coefficient).to.be.a("string");
    expect(partData[0].operating_temperature).to.be.a("string");
    expect(partData[0].digikey_case_size).to.be.a("string");
    expect(partData[0].case_size).to.be.a("string");
    expect(partData[0].ratings).to.be.an("array");
    expect(partData[0].dimensions).to.be.a("string");
    expect(partData[0].height).to.be.a("string");
    expect(partData[0].terminations_number).to.be.a("number");
    expect(partData[0].fail_rate).to.be.a("string");
    expect(partData[0].category).to.be.a("string");
    expect(partData[0].sub_category).to.be.a("string");
    expect(partData[0].series).to.be.a("string");

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
});
