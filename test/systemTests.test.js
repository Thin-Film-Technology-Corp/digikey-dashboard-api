import request from "supertest";
import { expect } from "chai";
import { config } from "dotenv";
import { describe } from "mocha";
import {
  convertMongoDataToCSV,
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
    convertedSalesData = await convertMongoDataToCSV(salesData);
    expect(convertedSalesData).to.be.a("string");
    expect(convertedSalesData).to.include(
      `Month, Invoiced Date, Customer Company, Customer City, Customer State/Prov, Customer Postal Code, Ship To Company, Ship To City, Ship To State/Prov, Ship To Postal Code, Ship To Country, DK Part Nbr, Mfg Part Number, Return Flag, Shipped Qty, Total Billable Orders, Series, Product Group`
    );
  });
});

describe("Integration testing for part data workflow", async function () {});
