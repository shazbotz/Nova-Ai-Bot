import fs from "fs";
import path from "path";
import axios from "axios";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require("adm-zip") as new (input: Buffer) => {
  getEntries(): Array<{ entryName: string; isDirectory: boolean; getData(): Buffer }>;
};
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

  if (!fileInfoRes.data?.ok || !fileInfoRes.data.result?.file_path) {
    // Telegram's standard cloud Bot API refuses to serve files over 20MB
    // (returns e.g. "Bad Request: file is too big") — surface that clearly
    // instead of crashing on `undefined.file_path` below.
    const description = fileInfoRes.data?.description || "Telegram couldn't provide this file (it may be too large — 20MB max).";
    throw new Error(description);
  }

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

    if (ext === ".zip") {
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();
      const TEXT_EXTS = new Set([
        ".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".log",
        ".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".cpp", ".c", ".cs",
        ".go", ".rs", ".php", ".rb", ".swift", ".kt", ".html", ".htm",
        ".css", ".scss", ".toml", ".ini", ".env",
      ]);
      let allText = "";
      let processedCount = 0;
      let skippedCount = 0;
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const entryExt = path.extname(entry.entryName).toLowerCase();
        if (!TEXT_EXTS.has(entryExt)) { skippedCount++; continue; }
        try {
          const content = entry.getData().toString("utf-8");
          if (content.trim()) {
            allText += `\n\n--- ${entry.entryName} ---\n${content.slice(0, 12000)}`;
            processedCount++;
          }
        } catch { skippedCount++; }
        if (allText.length > 90000) break;
      }
      if (!allText.trim()) {
        throw new Error("ZIP contains no readable text or code files (only binary/image files found).");
      }
      const header =
        `ZIP archive: ${entries.length} total entries, ` +
        `${processedCount} text files read, ${skippedCount} binary files skipped.\n`;
      return {
        text: (header + allText).slice(0, 100000),
        fileName,
        fileType: "ZIP Archive",
        size,
      };
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
