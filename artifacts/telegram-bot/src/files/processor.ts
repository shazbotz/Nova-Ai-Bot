import fs from "fs";
import path from "path";
import axios from "axios";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
import mammoth from "mammoth";
import { logger } from "../utils/logger";

export interface FileProcessResult {
  text: string;
  fileName: string;
  fileType: string;
  size: number;
  pages?: number;
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export async function downloadTelegramFile(
  fileId: string,
  botToken: string
): Promise<{ buffer: Buffer; fileName: string }> {
  const fileInfoRes = await axios.get(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
  );
  const filePath: string = fileInfoRes.data.result.file_path;
  const fileName = path.basename(filePath);
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

  const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
  return { buffer: Buffer.from(response.data), fileName };
}

export async function processFile(
  buffer: Buffer,
  fileName: string
): Promise<FileProcessResult> {
  const ext = path.extname(fileName).toLowerCase();
  const size = buffer.length;

  try {
    if (ext === ".pdf") {
      const data = await pdfParse(buffer);
      return {
        text: data.text.slice(0, 100000),
        fileName,
        fileType: "PDF",
        size,
        pages: data.numpages,
      };
    }

    if (ext === ".docx" || ext === ".doc") {
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value.slice(0, 100000), fileName, fileType: "Word Document", size };
    }

    if ([".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".log"].includes(ext)) {
      const text = buffer.toString("utf-8");
      return { text: text.slice(0, 100000), fileName, fileType: "Text File", size };
    }

    if ([".js", ".ts", ".py", ".java", ".cpp", ".c", ".cs", ".go", ".rs", ".php", ".rb", ".swift", ".kt"].includes(ext)) {
      const text = buffer.toString("utf-8");
      return { text: text.slice(0, 100000), fileName, fileType: "Code File", size };
    }

    if ([".html", ".htm", ".css", ".scss"].includes(ext)) {
      const text = buffer.toString("utf-8");
      return { text: text.slice(0, 100000), fileName, fileType: "Web File", size };
    }

    // Try as plain text fallback
    try {
      const text = buffer.toString("utf-8");
      if (text && !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 100))) {
        return { text: text.slice(0, 100000), fileName, fileType: "Text", size };
      }
    } catch {
      // binary
    }

    throw new Error(`Unsupported file type: ${ext || "unknown"}`);
  } catch (err) {
    logger.error("File processing error", { fileName, error: err });
    throw err;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
