import request from "supertest";
import { expect } from "chai";
import app from "../index.js"; // Adjust the path to where your Express app is exported

describe("Express App End-to-End Tests", function () {
  // Increase the timeout for async operations
  this.timeout(15000);

  const authToken = process.env.AUTH_TOKEN;

  it("Returns a CSV file for /csv/sales with authorization", async () => {
    const res = await request(app)
      .get("/csv/sales")
      .set("Authorization", authToken);

    expect(res.status).to.equal(200);
    expect(res.headers["content-type"]).to.equal("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).to.match(
      /attachment; filename="digikey_sales_report.csv"/
    );
    expect(res.text).to.be.a("string");
  });

  it("Returns a CSV file for /csv/parts with authorization", async () => {
    const res = await request(app)
      .get("/csv/parts")
      .set("Authorization", authToken);

    expect(res.status).to.equal(200);
    expect(res.headers["content-type"]).to.equal("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).to.match(
      /attachment; filename="digikey_sales_report.csv"/
    );
    expect(res.text).to.be.a("string");
  });

  it("Returns a CSV file for /csv/inventory with authorization", async () => {
    const res = await request(app)
      .get("/csv/inventory")
      .set("Authorization", authToken);

    expect(res.status).to.equal(200);
    expect(res.headers["content-type"]).to.equal("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).to.match(
      /attachment; filename="digikey_inventory_report.csv"/
    );
    expect(res.text).to.be.a("string");
  });

  it("Returns 400 for an invalid document type", async () => {
    const res = await request(app)
      .get("/csv/invalidDocument")
      .set("Authorization", authToken);

    expect(res.status).to.equal(400);
  });

  it("Returns 401 when authorization header is missing", async () => {
    const res = await request(app).get("/csv/sales");

    expect(res.status).to.equal(401);
    expect(res.body).to.have.property(
      "message",
      "Authorization header is missing"
    );
  });

  it("Returns 403 for an invalid authorization token", async () => {
    const res = await request(app)
      .get("/csv/sales")
      .set("Authorization", "invalid-token");

    expect(res.status).to.equal(403);
    expect(res.body).to.have.property("message", "Invalid authorization token");
  });

  //   it("Syncs MongoDB data on /sync_mongo_data", async () => {
  //     this.timeout(25000);
  //     const res = await request(app)
  //       .patch("/sync_mongo_data")
  //       .set("Authorization", authToken);

  //     expect(res.status).to.equal(200);
  //   });

  //   it("Enforces rate limiting", async () => {
  //     await request(app).get("/csv/sales").set("Authorization", authToken);

  //     // Simulate many requests to trigger rate limiting
  //     for (let i = 0; i < 101; i++) {
  //       await request(app).get("/csv/sales").set("Authorization", authToken);
  //     }

  //     const rateLimitRes = await request(app)
  //       .get("/csv/sales")
  //       .set("Authorization", authToken);

  //     expect(rateLimitRes.status).to.equal(429);
  //     expect(rateLimitRes.body).to.have.property(
  //       "message",
  //       "Too many requests from this IP, please try again later."
  //     );
  //   });
});
