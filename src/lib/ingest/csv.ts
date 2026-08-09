import { parse } from "csv-parse/sync";
import { z } from "zod";

/**
 * Account CSV ingestion (PROJECT_BRIEF §8, Day 2). Headers are matched
 * case/format-insensitively so customer exports don't need reshaping.
 */

export const accountRowSchema = z.object({
  companyName: z.string().min(1),
  domain: z.string().optional().default(""),
  industry: z.string().optional().default(""),
  employeeCount: z.number().int().positive().nullable(),
  partner: z.string().optional().default(""),
  existingProducts: z.array(z.string()),
  targetProduct: z.string().optional().default(""),
});

export type AccountRow = z.infer<typeof accountRowSchema>;

const HEADER_MAP: Record<string, keyof AccountRow | "employeeCountRaw"> = {
  companyname: "companyName",
  company: "companyName",
  accountname: "companyName",
  domain: "domain",
  website: "domain",
  industry: "industry",
  employeecount: "employeeCountRaw",
  employees: "employeeCountRaw",
  partner: "partner",
  existingproducts: "existingProducts",
  installedproducts: "existingProducts",
  targetproduct: "targetProduct",
  targetsolution: "targetProduct",
};

function canonicalHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z]/g, "");
}

export interface ParseResult {
  rows: AccountRow[];
  errors: { line: number; message: string }[];
}

export function parseAccountsCsv(content: string): ParseResult {
  const records: Record<string, string>[] = parse(content, {
    columns: (headers: string[]) =>
      headers.map((h) => HEADER_MAP[canonicalHeader(h)] ?? canonicalHeader(h)),
    skip_empty_lines: true,
    trim: true,
  });

  const rows: AccountRow[] = [];
  const errors: ParseResult["errors"] = [];

  records.forEach((record, i) => {
    const employeeRaw = record["employeeCountRaw"]?.replace(/[,\s]/g, "") ?? "";
    const employeeCount = /^\d+$/.test(employeeRaw) ? Number(employeeRaw) : null;
    const existing = (record["existingProducts"] ?? "")
      .split(/[;|]/)
      .map((p) => p.trim())
      .filter(Boolean);

    const parsed = accountRowSchema.safeParse({
      companyName: record["companyName"] ?? "",
      domain: record["domain"] ?? "",
      industry: record["industry"] ?? "",
      employeeCount,
      partner: record["partner"] ?? "",
      existingProducts: existing,
      targetProduct: record["targetProduct"] ?? "",
    });

    if (parsed.success) rows.push(parsed.data);
    else errors.push({ line: i + 2, message: parsed.error.issues[0]?.message ?? "invalid row" });
  });

  return { rows, errors };
}
