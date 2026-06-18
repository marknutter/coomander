/**
 * Document parsing utilities for chat file attachments.
 * Converts office documents to text for LLM consumption.
 */

import mammoth from "mammoth";
import * as XLSX from "xlsx";
import officeParser from "officeparser";

export async function parseDocx(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

export async function parseXlsx(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`[Sheet: ${sheetName}]\n${csv}`);
  }
  return parts.join("\n\n");
}

export async function parsePptx(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  const text = await officeParser.parseOffice(buffer, { outputErrorToConsole: false });
  return (text as unknown as string).trim();
}
