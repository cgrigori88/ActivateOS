import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAccountsCsv } from "../src/lib/ingest/csv";

test("parseAccountsCsv maps flexible headers and product lists", () => {
  const csv = [
    "Company Name,Website,Industry,Employees,Partner,Installed Products,Target Solution",
    'Acme Corp,acme.com,Manufacturing,"1,200",Reseller X,VMware vSphere; RHEL,Infrastructure Automation',
  ].join("\n");

  const { rows, errors } = parseAccountsCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyName, "Acme Corp");
  assert.equal(rows[0].domain, "acme.com");
  assert.equal(rows[0].employeeCount, 1200);
  assert.deepEqual(rows[0].existingProducts, ["VMware vSphere", "RHEL"]);
  assert.equal(rows[0].targetProduct, "Infrastructure Automation");
});

test("parseAccountsCsv reports rows missing a company name", () => {
  const csv = ["Company Name,Domain", "Acme,acme.com", ",nodomain.com"].join("\n");
  const { rows, errors } = parseAccountsCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 3);
});

test("parseAccountsCsv tolerates missing optional columns", () => {
  const csv = ["Company Name", "Acme"].join("\n");
  const { rows, errors } = parseAccountsCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows[0].employeeCount, null);
  assert.deepEqual(rows[0].existingProducts, []);
});
