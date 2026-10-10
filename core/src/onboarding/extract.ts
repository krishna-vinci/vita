import { extname } from "node:path";
import mammoth from "mammoth";
import { pdfText } from "../render/textcheck.js";

export const RESUME_UPLOAD_LIMIT = 5 * 1024 * 1024;
export const RESUME_TEXT_LIMIT = 200_000;

export class OnboardingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}

export async function extractResumeText(input: { filename: string; bytes: Uint8Array }): Promise<string> {
  if (input.bytes.byteLength > RESUME_UPLOAD_LIMIT)
    throw new OnboardingError("upload-too-large", "Resume exceeds 5 MB");
  const extension = extname(input.filename).toLowerCase();
  if (![".pdf", ".docx", ".txt", ".md"].includes(extension))
    throw new OnboardingError("unsupported-format", "Upload a PDF, DOCX, TXT or Markdown resume");
  let text: string;
  try {
    const buffer = Buffer.from(input.bytes);
    if (extension === ".pdf") text = (await pdfText(buffer)).text;
    else if (extension === ".docx") text = (await mammoth.extractRawText({ buffer })).value;
    else text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (cause) {
    throw new OnboardingError(
      "extraction-failed",
      `Could not extract resume text: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!text.trim())
    throw new OnboardingError("empty-document", "No text found. Upload a text resume or answer the guided interview.");
  if (text.length > RESUME_TEXT_LIMIT)
    throw new OnboardingError("text-too-large", "Extracted resume text exceeds 200,000 characters");
  return text;
}
