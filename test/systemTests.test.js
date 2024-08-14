import request from "supertest";
import { expect } from "chai";
import { config } from "dotenv";
import { describe } from "mocha";
import {
  convertMongoDataToCSV,
  flattenPartData,
  retrieveMongoPartData,
  retrieveMongoSalesData,
} from "../mongoOperation.js";
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
  it("Convertes flattened part data to csv", async function () {});
});

describe("Integration testing for inventory data workflow", async function () {
  // get session credentials
  // make csv request
});
