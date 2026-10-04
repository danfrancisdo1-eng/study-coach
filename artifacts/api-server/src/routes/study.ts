import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq } from "drizzle-orm";
import { createInflateRaw } from "node:zlib";
import { Worker } from "node:worker_threads";
import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { db, studySessionsTable, studyStatesTable } from "@workspace/db";
import {
  CheckInStudySessionBody,
  CreateStudySessionBody,
  FlagStudyQuestionBody,
  GenerateStudyQuizBody,
  ImportStudyStateBody,
  PutStudyStateBody,
  SaveStudyAnswerBody,
  SendStudyMessageBody,
} from "@workspace/api-zod";
import { complete } from "../ai";
import * as imageOcrPrompt from "../prompts/image-ocr.v1";
import * as tutorPrompt from "../prompts/tutor.v2";
import * as sessionQuizPrompt from "../prompts/session-quiz.v1";
import { readPublicPage } from "../lib/public-page";
import { reviewedLectureMaterials } from "../lib/lecture-materials";

const router: IRouter = Router();
const MAX_STATE_BYTES = 900_000;
const SOURCE_CHUNK_LENGTH = 1_200;
const SOURCE_CHAR_LIMIT = 14_000;
const MAX_SESSION_MESSAGES = 80;
const MAX_EXTRACTED_TEXT_CHARS = 100_000;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_ARCHIVE_XML_BYTES = 10_000_000;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 40_000_000;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_DOCX_SECTIONS = 100;
const MAX_DOCX_PARAGRAPHS = 50_000;
const MAX_DOCX_TEXT_RUNS = 100_000;
const MAX_PPTX_SLIDES = 500;
const MAX_PPTX_PARAGRAPHS = 50_000;
const MAX_PPTX_TEXT_RUNS = 100_000;
const MAX_PPTX_RELATIONSHIPS = 2_000;
const MAX_PDF_PAGES = 500;
const MAX_PDF_TEXT_ITEMS = 50_000;
const MATERIAL_PROCESSING_BUDGET_MS = 10_000;
const QUESTION_QUALITY_NOTICE = "Automated AI checks do not guarantee factual correctness. You can report an invalid or ambiguous question before grading.";

type MaterialFormat = "txt" | "md" | "pdf" | "docx" | "pptx";
type MaterialCoverage = "entire_file" | "selectable_text_only" | "document_body_text" | "slide_text_only";

const FORMAT_BY_EXTENSION: Record<string, MaterialFormat> = {
  ".txt": "txt",
  ".md": "md",
  ".markdown": "md",
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
};
const FORMAT_BY_MIME: Record<string, MaterialFormat> = {
  "text/plain": "txt",
  "text/markdown": "md",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

class MaterialReadError extends Error {}

function sanitizedFilename(value: string): string {
  const filename = value.replace(/\\/g, "/").split("/").pop() ?? "";
  return filename.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
}

function materialFormat(filename: string, contentType: string | undefined): MaterialFormat | null {
  const extensionFormat = FORMAT_BY_EXTENSION[filename.slice(filename.lastIndexOf(".")).toLowerCase()];
  const mime = contentType?.split(";")[0]?.trim().toLowerCase();
  const mimeFormat = mime && mime !== "application/octet-stream" ? FORMAT_BY_MIME[mime] : undefined;
  if (mime && mime !== "application/octet-stream" && !mimeFormat) return null;
  if (mimeFormat && extensionFormat && mimeFormat !== extensionFormat) return null;
  return mimeFormat ?? extensionFormat ?? null;
}

function enforceTextLimit(text: string): string {
  if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new MaterialReadError("Extracted text exceeds the 100,000 character limit; no text was returned.");
  }
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new MaterialReadError("No readable text was found in this file.");
  if (normalized.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new MaterialReadError("Extracted text exceeds the 100,000 character limit; no text was returned.");
  }
  return normalized;
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const numeric = code[1]?.toLowerCase() === "x"
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(numeric) && numeric >= 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : entity;
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" } as Record<string, string>)[code.toLowerCase()] ?? entity;
  });
}

function inflateZipEntryWithinLimits(
  buffer: Buffer,
  compressedOffset: number,
  compressedSize: number,
  expectedUncompressedSize: number,
  method: number,
  remainingCapacity: number,
  deadline: number,
): Promise<number> {
  if (method === 0) {
    if (compressedSize !== expectedUncompressedSize) {
      throw new MaterialReadError("An archive entry has inconsistent stored-size metadata.");
    }
    if (compressedSize > remainingCapacity) {
      throw new MaterialReadError("The archive expands beyond the 40 MB cumulative processing limit.");
    }
    return Promise.resolve(compressedSize);
  }
  if (method !== 8) {
    throw new MaterialReadError("The archive uses a compression method that is not supported for safe extraction.");
  }
  if (expectedUncompressedSize > remainingCapacity) {
    throw new MaterialReadError("The archive expands beyond the 40 MB cumulative processing limit.");
  }
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) {
    throw new MaterialReadError("Material extraction exceeded the 10-second processing limit; no text was returned.");
  }

  return new Promise<number>((resolve, reject) => {
    const inflater = createInflateRaw({ chunkSize: 64 * 1024 });
    let uncompressedSize = 0;
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(uncompressedSize);
    };
    const timer = setTimeout(() => {
      const error = new MaterialReadError("Material extraction exceeded the 10-second processing limit; no text was returned.");
      inflater.destroy();
      settle(error);
    }, remainingMs);
    inflater.on("data", (chunk: Buffer) => {
      uncompressedSize += chunk.length;
      if (uncompressedSize > expectedUncompressedSize) {
        const error = new MaterialReadError("An archive entry expands beyond its declared size and was rejected.");
        inflater.destroy();
        settle(error);
      } else if (uncompressedSize > remainingCapacity) {
        const error = new MaterialReadError("The archive expands beyond the 40 MB cumulative processing limit.");
        inflater.destroy();
        settle(error);
      }
    });
    inflater.on("error", () => {
      settle(new MaterialReadError("An archive entry could not be decompressed safely."));
    });
    inflater.on("end", () => {
      if (uncompressedSize !== expectedUncompressedSize) {
        settle(new MaterialReadError("An archive entry has inconsistent uncompressed-size metadata."));
      } else {
        settle();
      }
    });
    inflater.end(buffer.subarray(compressedOffset, compressedOffset + compressedSize));
  });
}

async function preflightArchiveWithinLimits(buffer: Buffer, deadline: number): Promise<void> {
  const minimumEocdSize = 22;
  const maxCommentLength = 65_535;
  const searchStart = Math.max(0, buffer.length - minimumEocdSize - maxCommentLength);
  let eocdOffset = -1;
  for (let offset = buffer.length - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 &&
      offset + minimumEocdSize + buffer.readUInt16LE(offset + 20) === buffer.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new MaterialReadError("This archive has no valid ZIP directory and cannot be read.");
  }
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const directoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const directorySize = buffer.readUInt32LE(eocdOffset + 12);
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new MaterialReadError("Multi-disk ZIP archives are not supported.");
  }
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new MaterialReadError("ZIP64 archives exceed the supported archive processing limits.");
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new MaterialReadError(`The archive contains more than the ${MAX_ARCHIVE_ENTRIES}-entry processing limit.`);
  }
  const directoryEnd = directoryOffset + directorySize;
  if (!Number.isSafeInteger(directoryEnd) || directoryOffset < 0 || directoryEnd > eocdOffset) {
    throw new MaterialReadError("This archive has invalid ZIP directory bounds.");
  }

  let offset = directoryOffset;
  let scannedEntries = 0;
  let totalUncompressedBytes = 0;
  while (offset < directoryEnd) {
    assertWithinDeadline(deadline);
    if (offset + 46 > directoryEnd || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new MaterialReadError("This archive has a malformed ZIP directory.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + filenameLength + extraLength + commentLength;
    if (!Number.isSafeInteger(entryEnd) || entryEnd > directoryEnd) {
      throw new MaterialReadError("This archive has invalid ZIP entry bounds.");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new MaterialReadError("ZIP64 entries exceed the supported archive processing limits.");
    }
    if ((flags & 0x41) !== 0) {
      throw new MaterialReadError("Encrypted ZIP entries are not supported.");
    }
    if (totalUncompressedBytes + uncompressedSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new MaterialReadError("The archive expands beyond the 40 MB cumulative processing limit.");
    }
    if (localHeaderOffset + 30 > directoryOffset || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new MaterialReadError("This archive has an invalid ZIP local-file header.");
    }
    const localFlags = buffer.readUInt16LE(localHeaderOffset + 6);
    const localMethod = buffer.readUInt16LE(localHeaderOffset + 8);
    const localFilenameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (localFlags !== flags || localMethod !== method || dataOffset > directoryOffset || dataEnd > directoryOffset ||
      !buffer.subarray(offset + 46, offset + 46 + filenameLength)
        .equals(buffer.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localFilenameLength))) {
      throw new MaterialReadError("This archive has inconsistent ZIP entry headers.");
    }
    const actualUncompressedSize = await inflateZipEntryWithinLimits(
      buffer,
      dataOffset,
      compressedSize,
      uncompressedSize,
      method,
      MAX_ARCHIVE_UNCOMPRESSED_BYTES - totalUncompressedBytes,
      deadline,
    );
    totalUncompressedBytes += actualUncompressedSize;
    scannedEntries += 1;
    offset = entryEnd;
  }
  if (offset !== directoryEnd || scannedEntries !== entryCount) {
    throw new MaterialReadError("This archive has inconsistent ZIP directory metadata.");
  }
}

function assertArchiveXmlWithinLimit(zip: JSZip, filenames: string[]): void {
  const tooLarge = filenames.some((filename) => {
    const entry = zip.files[filename] as (JSZip.JSZipObject & {
      _data?: { uncompressedSize?: number };
    }) | undefined;
    return !entry || (entry._data?.uncompressedSize ?? Number.POSITIVE_INFINITY) > MAX_ARCHIVE_XML_BYTES;
  });
  if (tooLarge) {
    throw new MaterialReadError("The document contains an XML section larger than the 10 MB processing limit.");
  }
}

function assertArchiveWithinLimits(zip: JSZip): void {
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new MaterialReadError(`The archive contains more than the ${MAX_ARCHIVE_ENTRIES} file-entry processing limit.`);
  }
  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    const metadata = entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } };
    const size = metadata._data?.uncompressedSize;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw new MaterialReadError("The archive has invalid or unreadable file-size metadata.");
    }
    totalUncompressedBytes += size;
    if (totalUncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new MaterialReadError("The archive expands beyond the 40 MB cumulative processing limit.");
    }
  }
}

function assertWithinDeadline(deadline: number): void {
  if (performance.now() >= deadline) {
    throw new MaterialReadError("Material extraction exceeded the 10-second processing limit; no text was returned.");
  }
}

async function withinDeadline<T>(
  startOperation: () => Promise<T>,
  deadline: number,
  onTimeout?: () => void,
): Promise<T> {
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) {
    onTimeout?.();
    throw new MaterialReadError("Material extraction exceeded the 10-second processing limit; no text was returned.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = startOperation();
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new MaterialReadError("Material extraction exceeded the 10-second processing limit; no text was returned."));
        }, Math.max(0, deadline - performance.now()));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractDocxTextInWorker(buffer: Buffer, deadline: number): Promise<string> {
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) {
    return Promise.reject(new MaterialReadError("Material extraction exceeded the 10-second processing limit; no text was returned."));
  }
  const bytes = new Uint8Array(buffer.length);
  bytes.set(buffer);
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL("./workers/mammoth-extract-worker.mjs", import.meta.url), {
      workerData: { bytes },
      transferList: [bytes.buffer],
      resourceLimits: {
        maxOldGenerationSizeMb: 96,
        maxYoungGenerationSizeMb: 24,
        stackSizeMb: 4,
      },
    });
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: MaterialReadError, text?: string): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(text ?? "");
    };
    timer = setTimeout(() => {
      finish(new MaterialReadError("Material extraction exceeded the 10-second processing limit; no text was returned."));
    }, remainingMs);
    worker.once("message", (message: unknown) => {
      if (typeof message === "object" && message !== null && "text" in message && typeof message.text === "string") {
        finish(undefined, message.text);
      } else {
        finish(new MaterialReadError("This DOCX file could not be read. No text was returned."));
      }
    });
    worker.once("error", () => {
      finish(new MaterialReadError("This DOCX file could not be read. No text was returned."));
    });
    worker.once("exit", (code) => {
      if (!settled) {
        finish(new MaterialReadError(code === 0
          ? "DOCX extraction ended without returning text."
          : "DOCX extraction exceeded its processing resources."));
      }
    });
  });
}

function assertXmlElementCount(
  xml: string,
  pattern: RegExp,
  maxCount: number,
  description: string,
  deadline: number,
): number {
  let count = 0;
  while (pattern.exec(xml)) {
    count += 1;
    if (count > maxCount) {
      throw new MaterialReadError(`${description} exceeds the ${maxCount}-item processing limit; no text was returned.`);
    }
    if ((count & 0x3ff) === 0) assertWithinDeadline(deadline);
  }
  return count;
}

function pptxSlidePath(target: string): string | null {
  const parts = (target.startsWith("/") ? target.slice(1) : `ppt/${target}`).split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  const path = normalized.join("/");
  return /^ppt\/slides\/slide\d+\.xml$/.test(path) ? path : null;
}

async function extractMaterial(buffer: Buffer, format: MaterialFormat): Promise<{
  text: string;
  coverage: MaterialCoverage;
}> {
  const deadline = performance.now() + MATERIAL_PROCESSING_BUDGET_MS;
  switch (format) {
    case "txt":
    case "md": {
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        throw new MaterialReadError("Text files must contain valid UTF-8 text.");
      }
      assertWithinDeadline(deadline);
      return { text: enforceTextLimit(text), coverage: "entire_file" };
    }
    case "pdf": {
      let loadingTask: ReturnType<typeof getDocument> | undefined;
      let pdf;
      try {
        pdf = await withinDeadline(() => {
          loadingTask = getDocument({
            data: new Uint8Array(buffer),
            useWorkerFetch: false,
          });
          return loadingTask.promise;
        }, deadline, () => {
          void loadingTask?.destroy().catch(() => undefined);
        });
      } catch (error) {
        if (error instanceof MaterialReadError) throw error;
        throw new MaterialReadError("This PDF could not be read. It may be damaged, encrypted, or contain no supported text.");
      }
      try {
        if (pdf.numPages > MAX_PDF_PAGES) {
          throw new MaterialReadError(`PDF exceeds the ${MAX_PDF_PAGES}-page processing limit; no text was returned.`);
        }
        const pages: string[] = [];
        let charCount = 0;
        let itemCount = 0;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          assertWithinDeadline(deadline);
          const page = await withinDeadline(() => pdf.getPage(pageNumber), deadline, () => {
            void pdf.destroy().catch(() => undefined);
          });
          const content = await withinDeadline(() => page.getTextContent(), deadline, () => {
            void pdf.destroy().catch(() => undefined);
          });
          itemCount += content.items.length;
          if (itemCount > MAX_PDF_TEXT_ITEMS) {
            throw new MaterialReadError(`PDF exceeds the ${MAX_PDF_TEXT_ITEMS}-text-item processing limit; no text was returned.`);
          }
          const pageText = content.items
            .filter((item): item is typeof item & { str: string } => "str" in item)
            .map((item) => item.str)
            .join(" ");
          charCount += pageText.length;
          if (charCount > MAX_EXTRACTED_TEXT_CHARS) {
            throw new MaterialReadError("Extracted text exceeds the 100,000 character limit; no text was returned.");
          }
          if (pageText.trim()) pages.push(pageText);
        }
        return { text: enforceTextLimit(pages.join("\n\n")), coverage: "selectable_text_only" };
      } finally {
        await pdf.destroy();
      }
    }
    case "docx": {
      try {
        await preflightArchiveWithinLimits(buffer, deadline);
        const zip = await withinDeadline(() => JSZip.loadAsync(buffer), deadline);
        assertArchiveWithinLimits(zip);
        assertArchiveXmlWithinLimit(zip, ["word/document.xml"]);
        const documentXml = await withinDeadline(() => zip.file("word/document.xml")!.async("string"), deadline);
        assertXmlElementCount(documentXml, /<w:sectPr\b/g, MAX_DOCX_SECTIONS, "DOCX sections", deadline);
        assertXmlElementCount(documentXml, /<w:p\b/g, MAX_DOCX_PARAGRAPHS, "DOCX paragraphs", deadline);
        assertXmlElementCount(documentXml, /<w:t\b/g, MAX_DOCX_TEXT_RUNS, "DOCX text runs", deadline);
        assertWithinDeadline(deadline);
        const text = await extractDocxTextInWorker(buffer, deadline);
        return { text: enforceTextLimit(text), coverage: "document_body_text" };
      } catch (error) {
        if (error instanceof MaterialReadError) throw error;
        throw new MaterialReadError("This DOCX file could not be read. Please check that it is a valid, unencrypted document.");
      }
    }
    case "pptx": {
      let zip: JSZip;
      try {
        await preflightArchiveWithinLimits(buffer, deadline);
        zip = await withinDeadline(() => JSZip.loadAsync(buffer), deadline);
      } catch (error) {
        if (error instanceof MaterialReadError) throw error;
        throw new MaterialReadError("This PPTX file could not be read. Please check that it is a valid presentation.");
      }
      assertArchiveWithinLimits(zip);
      const presentationEntry = zip.file("ppt/presentation.xml");
      const relationshipsEntry = zip.file("ppt/_rels/presentation.xml.rels");
      if (!presentationEntry || !relationshipsEntry) {
        throw new MaterialReadError("This PPTX file does not contain a readable presentation.");
      }
      assertArchiveXmlWithinLimit(zip, ["ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]);
      const presentationXml = await withinDeadline(() => presentationEntry.async("string"), deadline);
      const relationshipsXml = await withinDeadline(() => relationshipsEntry.async("string"), deadline);
      const slideRelationshipIds: string[] = [];
      const slideIdPattern = /<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/?>/g;
      let slideIdMatch: RegExpExecArray | null;
      while ((slideIdMatch = slideIdPattern.exec(presentationXml)) !== null) {
        assertWithinDeadline(deadline);
        if (slideRelationshipIds.length >= MAX_PPTX_SLIDES) {
          throw new MaterialReadError(`PPTX exceeds the ${MAX_PPTX_SLIDES}-slide processing limit; no text was returned.`);
        }
        slideRelationshipIds.push(slideIdMatch[1]!);
      }
      const requestedRelationshipIds = new Set(slideRelationshipIds);
      const targetsById = new Map<string, string>();
      const relationshipPattern = /<Relationship\b[^>]*\/?>/g;
      let relationshipCount = 0;
      let relationshipMatch: RegExpExecArray | null;
      while ((relationshipMatch = relationshipPattern.exec(relationshipsXml)) !== null) {
        relationshipCount += 1;
        if (relationshipCount > MAX_PPTX_RELATIONSHIPS) {
          throw new MaterialReadError(`PPTX exceeds the ${MAX_PPTX_RELATIONSHIPS}-relationship processing limit; no text was returned.`);
        }
        if ((relationshipCount & 0x3f) === 0) assertWithinDeadline(deadline);
        const relationship = relationshipMatch[0];
        const id = relationship.match(/\bId="([^"]+)"/)?.[1];
        if (!id || !requestedRelationshipIds.has(id)) continue;
        const target = relationship.match(/\bTarget="([^"]+)"/)?.[1];
        if (target) targetsById.set(id, decodeXml(target));
      }
      const slideNames = slideRelationshipIds.map((relationshipId) => {
        const target = targetsById.get(relationshipId);
        return target ? pptxSlidePath(target) : null;
      });
      if (!slideNames.length || slideNames.some((name) => !name || !zip.file(name))) {
        throw new MaterialReadError("This PPTX presentation has missing or unreadable slides.");
      }
      if (slideNames.length > MAX_PPTX_SLIDES) {
        throw new MaterialReadError(`PPTX exceeds the ${MAX_PPTX_SLIDES}-slide processing limit; no text was returned.`);
      }
      const orderedSlideNames = slideNames as string[];
      assertArchiveXmlWithinLimit(zip, orderedSlideNames);
      const slideTexts: string[] = [];
      let charCount = 0;
      let paragraphCount = 0;
      let textRunCount = 0;
      try {
        for (const name of orderedSlideNames) {
          assertWithinDeadline(deadline);
          const xml = await withinDeadline(() => zip.file(name)!.async("string"), deadline);
          const paragraphs: string[] = [];
          const paragraphPattern = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g;
          let paragraphMatch: RegExpExecArray | null;
          while ((paragraphMatch = paragraphPattern.exec(xml)) !== null) {
            paragraphCount += 1;
            if (paragraphCount > MAX_PPTX_PARAGRAPHS) {
              throw new MaterialReadError(`PPTX exceeds the ${MAX_PPTX_PARAGRAPHS}-paragraph processing limit; no text was returned.`);
            }
            if ((paragraphCount & 0x3f) === 0) assertWithinDeadline(deadline);
            const textRunPattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
            const paragraphParts: string[] = [];
            let textRunMatch: RegExpExecArray | null;
            while ((textRunMatch = textRunPattern.exec(paragraphMatch[1]!)) !== null) {
              textRunCount += 1;
              if (textRunCount > MAX_PPTX_TEXT_RUNS) {
                throw new MaterialReadError(`PPTX exceeds the ${MAX_PPTX_TEXT_RUNS}-text-run processing limit; no text was returned.`);
              }
              if ((textRunCount & 0x3ff) === 0) assertWithinDeadline(deadline);
              paragraphParts.push(decodeXml(textRunMatch[1]!));
            }
            const paragraphText = paragraphParts.join("");
            if (paragraphText.trim()) paragraphs.push(paragraphText);
          }
          assertWithinDeadline(deadline);
          const slideText = paragraphs.join("\n");
          charCount += slideText.length;
          if (charCount > MAX_EXTRACTED_TEXT_CHARS) {
            throw new MaterialReadError("Extracted text exceeds the 100,000 character limit; no text was returned.");
          }
          if (slideText) slideTexts.push(slideText);
        }
      } catch (error) {
        if (error instanceof MaterialReadError) throw error;
        throw new MaterialReadError("The PPTX slide text could not be read.");
      }
      return { text: enforceTextLimit(slideTexts.join("\n\n")), coverage: "slide_text_only" };
    }
  }
}

type JsonObject = Record<string, unknown>;
type SourceStatus = {
  usedSourceMaterial: boolean;
  selectedChunks: number;
  availableChunks: number;
  truncated: boolean;
  coverage: "complete" | "selected" | "none";
  sources: Array<{ label: string; kind: "source" | "supplemental" | "inferred" }>;
};
type PublicOption = { id: string; text: string };
type StudyQuestionFlagKind = "invalid" | "ambiguous";
type StoredQuestionFlag = {
  kind: StudyQuestionFlagKind;
  reason?: string;
  reportedAt: string;
};
type StoredQuestion = {
  id: string;
  prompt: string;
  concept: string;
  options: PublicOption[];
  correctOptionId: string;
  explanation: string;
  answers: Array<{ optionId: string; assisted: boolean }>;
  invalid?: boolean;
  flag?: StoredQuestionFlag;
  feedback?: {
    selectedOptionId: string | null;
    selectedOptionText: string | null;
    correctOptionId: string;
    correctOptionText: string;
    explanation: string;
    concept: string;
    assisted: boolean;
  };
};
type Quiz = {
  mode: "diagnostic" | "targeted";
  expectedCount: number;
  questions: StoredQuestion[];
  sourceStatus: SourceStatus;
  invalidItemCount: number;
  grade: Record<string, unknown> | null;
};
type Session = {
  id: string;
  courseId: string;
  topic: string;
  minutes: number;
  createdAt: string;
  status: "active" | "completed";
  checkIn: { skipped: boolean; recordedAt: string } | null;
  messages: Array<Record<string, unknown>>;
  quiz: Quiz | null;
  attempts: Quiz[];
  scores: { diagnostic: Record<string, unknown> | null; targeted: Record<string, unknown> | null };
  reviewSchedule: Array<Record<string, unknown>>;
  reportText: string | null;
  _version?: number;
};

declare global {
  namespace Express {
    interface Request {
      studyOwnerId?: string;
    }
  }
}

export function requireStudyAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.studyOwnerId) {
    next();
    return;
  }
  const auth = getAuth(req);
  const claimUserId = auth?.sessionClaims?.userId;
  const userId = typeof claimUserId === "string" ? claimUserId : auth?.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.studyOwnerId = userId;
  next();
}

router.use("/study", requireStudyAuth);

const activeMaterialReads = new Set<string>();
router.post("/study/materials/website", async (req, res): Promise<void> => {
  const userId = owner(req);
  if (activeMaterialReads.has(userId)) { res.status(429).json({ error: "Another material is being read. Please wait and retry." }); return; }
  if (typeof req.body?.url !== "string") { res.status(400).json({ error: "Provide a public website link." }); return; }
  activeMaterialReads.add(userId);
  try {
    const result = await readPublicPage(req.body.url.trim());
    res.json({ ...result, format: "website", status: "complete", coverage: "public_page_text", characterCount: result.text.length,
      coverageNote: `Read one public page (${result.finalUrl}). Navigation and scripts were removed. No crawling, login access, JavaScript rendering, images, linked pages or paywall bypass. Review for missing content before saving.` });
  } catch {
    res.status(422).json({ error: "This public page could not be read: it may be inaccessible, require login/JavaScript, use an unsupported format, exceed limits, or point to a private/reserved network. Nothing was saved. Check the link and retry." });
  } finally { activeMaterialReads.delete(userId); }
});

router.post("/study/materials/extract", async (req, res): Promise<void> => {
  const rawFilename = req.header("X-Filename");
  if (!rawFilename) {
    res.status(400).json({ error: "Provide the required X-Filename header." });
    return;
  }
  const filename = sanitizedFilename(rawFilename);
  if (!filename) {
    res.status(400).json({ error: "X-Filename must contain a valid filename." });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    res.status(415).json({ error: "Upload the file as a supported binary media type." });
    return;
  }
  if (req.body.length === 0) {
    res.status(400).json({ error: "The uploaded file is empty." });
    return;
  }
  if (req.body.length > MAX_UPLOAD_BYTES) {
    res.status(413).json({ error: "Uploaded material exceeds the 12 MB limit." });
    return;
  }
  const imageMime = req.body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
    : req.body[0] === 255 && req.body[1] === 216 && req.body[2] === 255 ? "image/jpeg"
    : req.body.subarray(0, 4).toString() === "RIFF" && req.body.subarray(8, 12).toString() === "WEBP" ? "image/webp"
    : null;
  if (imageMime) {
    const userId = owner(req);
    const stateRows = await db.select().from(studyStatesTable).where(eq(studyStatesTable.ownerId, userId)).limit(1);
    if (stateRows[0]?.state?.aiConsent !== true) { res.status(403).json({ error: "Accept the AI-processing notice before sending photos for text extraction." }); return; }
    if (activeMaterialReads.has(userId)) { res.status(429).json({ error: "Another material is being read. Please wait and retry." }); return; }
    activeMaterialReads.add(userId);
    try {
      const result = await complete("image_ocr", {
        system: imageOcrPrompt.systemPrompt(),
        messages: [{ role: "user", image: { mimeType: imageMime, base64: req.body.toString("base64") } }],
        timeoutMs: 60000,
        maxRetries: 0,
      });
      if (!result.finished) throw new Error("Incomplete extraction");
      const text = enforceTextLimit(JSON.parse(result.text ?? "{}").text ?? "");
      if (text.replace(/\[unreadable\]/gi, "").trim().length < 3) throw new Error("No meaningful readable text");
      res.json({ filename, format: "image", text, status: "complete", coverage: "visible_image_text", characterCount: text.length,
        coverageNote: "AI-transcribed visible text from one image; handwriting, small/blurry text, diagrams and cropped content may be missed or misread. [unreadable] marks uncertainty. Review and correct before saving; nothing is saved automatically." });
    } catch (error) {
      req.log.error({ error: aiErrorMessage(error) }, "Photo text extraction failed");
      res.status(422).json({ error: "Readable image text could not be extracted completely. Try a sharper or smaller PNG, JPEG or WebP image. Nothing was saved." });
    } finally { activeMaterialReads.delete(userId); }
    return;
  }
  const format = materialFormat(filename, req.header("Content-Type"));
  if (!format) {
    res.status(415).json({ error: "Unsupported or mismatched file type. Supported: TXT, Markdown, PDF, DOCX, PPTX, PNG, JPEG and WebP. HEIC, GIF and scanned PDFs are not supported; select a compatible photo or a page screenshot." });
    return;
  }
  try {
    const { text, coverage } = await extractMaterial(req.body, format);
    res.json({
      filename,
      format,
      text,
      status: "complete",
      coverage,
      characterCount: text.length,
      coverageNote: coverage === "entire_file"
        ? "All UTF-8 text was read; line endings were normalized and boundary whitespace was trimmed."
        : coverage === "selectable_text_only"
          ? "Only the PDF's selectable text layer is included; scanned or image-only text is not processed."
          : coverage === "document_body_text"
            ? "DOCX body paragraphs and tables are included; embedded images and non-body document sections may be omitted."
            : "Slide text shapes are included in presentation order; image text, charts, and speaker notes are not extracted.",
    });
  } catch (error) {
    if (error instanceof MaterialReadError) {
      res.status(422).json({ error: error.message });
      return;
    }
    res.status(422).json({ error: "This file is unreadable or damaged; no text was returned." });
  }
});

// Error text only (provider error type and message); never request content or keys.
function aiErrorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error";
}

function owner(req: Request): string {
  if (!req.studyOwnerId) throw new Error("Missing authenticated account");
  return req.studyOwnerId;
}

function jsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateState(value: unknown): string | null {
  if (!jsonObject(value) || typeof value.aiConsent !== "boolean") {
    return "Study state must be an object with an explicit boolean aiConsent field.";
  }
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > MAX_STATE_BYTES) return "Study state is too large.";
  if (Array.isArray(value.deadlines)) {
    for (const deadline of value.deadlines) {
      if (!jsonObject(deadline) || deadline.date == null) continue;
      if (typeof deadline.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(deadline.date)) {
        return "Dates must be confirmed calendar dates in YYYY-MM-DD format.";
      }
      const [year, month, day] = deadline.date.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return "Dates must be valid calendar dates.";
      }
      if (deadline.confirmed !== true) return "A deadline date must be explicitly confirmed before it is saved.";
    }
  }
  return null;
}

function safeSession(session: Session): Record<string, unknown> {
  const publicQuiz = (value: Quiz): Record<string, unknown> => ({
    mode: value.mode,
    expectedCount: value.expectedCount,
    invalidItemCount: value.invalidItemCount + value.questions.filter((question) => question.invalid || question.flag).length,
    qualityNotice: QUESTION_QUALITY_NOTICE,
    sourceStatus: value.sourceStatus,
    questions: value.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      concept: question.concept,
      options: question.options,
      flag: question.flag
        ? { ...question.flag, reason: question.flag.reason ?? null }
        : null,
      answer: question.answers.at(-1) ?? null,
      ...(value.grade ? { feedback: question.feedback ?? null } : {}),
    })),
    grade: value.grade,
  });
  const { _version, attempts = [], quiz: currentQuiz, ...publicSession } = session;
  return {
    ...publicSession,
    quiz: currentQuiz ? publicQuiz(currentQuiz) : null,
    attempts: attempts.map(publicQuiz),
  };
}

async function getSession(id: string, ownerId: string): Promise<Session | null> {
  const rows = await db.select().from(studySessionsTable)
    .where(and(eq(studySessionsTable.id, id), eq(studySessionsTable.ownerId, ownerId))).limit(1);
  const row = rows[0];
  if (!row) return null;
  const session = row.session as Session;
  return { ...session, attempts: Array.isArray(session.attempts) ? session.attempts : [], _version: row.version };
}

async function saveSession(session: Session, ownerId: string): Promise<boolean> {
  const expectedVersion = session._version ?? 1;
  const { _version, ...storedSession } = session;
  const updated = await db.update(studySessionsTable)
    .set({
      session: storedSession as unknown as Record<string, unknown>,
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(and(
      eq(studySessionsTable.id, session.id),
      eq(studySessionsTable.ownerId, ownerId),
      eq(studySessionsTable.version, expectedVersion),
    ))
    .returning({ version: studySessionsTable.version });
  if (!updated[0]) return false;
  session._version = updated[0].version;
  return true;
}

async function requireSession(req: Request, res: Response): Promise<Session | null> {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(400).json({ error: "Invalid session id." });
    return null;
  }
  const session = await getSession(id, owner(req));
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return null;
  }
  return session;
}

function parseBody<T extends JsonObject>(body: unknown, required: Record<string, (value: unknown) => boolean>): body is T {
  if (!jsonObject(body)) return false;
  return Object.entries(required).every(([key, validate]) => validate(body[key]));
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

router.get("/study/state", async (req, res): Promise<void> => {
  const rows = await db.select().from(studyStatesTable).where(eq(studyStatesTable.ownerId, owner(req))).limit(1);
  const row = rows[0];
  res.json({ state: row?.state ?? null, version: row?.version ?? 0 });
});

router.put("/study/state", async (req, res): Promise<void> => {
  const body = req.body as JsonObject;
  const parsed = PutStudyStateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide valid study state and a non-negative integer version." });
    return;
  }
  const invalid = validateState(body.state);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const ownerId = owner(req);
  const version = body.version as number;
  if (version === 0) {
    const id = randomUUID();
    const inserted = await db.insert(studyStatesTable)
      .values({ id, ownerId, state: body.state as JsonObject, version: 1 })
      .onConflictDoNothing({ target: studyStatesTable.ownerId }).returning();
    if (inserted[0]) {
      res.json({ state: inserted[0].state, version: inserted[0].version });
      return;
    }
  } else {
    const updated = await db.update(studyStatesTable)
      .set({ state: body.state as JsonObject, version: version + 1, updatedAt: new Date() })
      .where(and(eq(studyStatesTable.ownerId, ownerId), eq(studyStatesTable.version, version)))
      .returning();
    if (updated[0]) {
      res.json({ state: updated[0].state, version: updated[0].version });
      return;
    }
  }
  const current = await db.select({ version: studyStatesTable.version }).from(studyStatesTable)
    .where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  res.status(409).json({ error: "Study state version mismatch.", version: current[0]?.version ?? 0 });
});

router.post("/study/import", async (req, res): Promise<void> => {
  const parsed = ImportStudyStateBody.safeParse(req.body);
  if (!parsed.success || !jsonObject(req.body)) {
    res.status(400).json({ error: "Provide a study state object." });
    return;
  }
  const invalid = validateState(req.body.state);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const inserted = await db.insert(studyStatesTable)
    .values({ id: randomUUID(), ownerId: owner(req), state: req.body.state as JsonObject, version: 1 })
    .onConflictDoNothing({ target: studyStatesTable.ownerId }).returning();
  if (!inserted[0]) {
    res.status(409).json({ error: "Study state already exists; import is only allowed for an empty account." });
    return;
  }
  res.status(201).json({ state: inserted[0].state, version: inserted[0].version });
});

router.get("/study/sessions", async (req, res): Promise<void> => {
  const rows = await db.select().from(studySessionsTable)
    .where(eq(studySessionsTable.ownerId, owner(req))).orderBy(desc(studySessionsTable.createdAt));
  res.json({
    sessions: rows.map(({ session }) => {
      const value = session as unknown as Session;
      return {
        id: value.id, courseId: value.courseId, topic: value.topic, minutes: value.minutes,
        createdAt: value.createdAt, status: value.status,
        diagnosticScore: value.scores.diagnostic?.percent ?? null,
        targetedScore: value.scores.targeted?.percent ?? null,
      };
    }),
  });
});

router.post("/study/sessions", async (req, res): Promise<void> => {
  if (!CreateStudySessionBody.safeParse(req.body).success ||
    !parseBody(req.body, { courseId: (v) => boundedText(v, 200), topic: (v) => boundedText(v, 300), minutes: (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 360 })) {
    res.status(400).json({ error: "Provide courseId, topic and minutes (1-360)." });
    return;
  }
  const ownerId = owner(req);
  const state = await accountState(ownerId);
  const requestedCourseId = (req.body as JsonObject).courseId;
  const courses = Array.isArray(state?.courses) ? state.courses : [];
  if (!courses.some((course) => jsonObject(course) && course.id === requestedCourseId)) {
    res.status(400).json({ error: "courseId must belong to a course in the signed-in account's saved study state." });
    return;
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  const session: Session = {
    id, courseId: (req.body as JsonObject).courseId as string, topic: (req.body as JsonObject).topic as string,
    minutes: (req.body as JsonObject).minutes as number, createdAt: now, status: "active", checkIn: null,
    messages: [], quiz: null, attempts: [], scores: { diagnostic: null, targeted: null }, reviewSchedule: [], reportText: null,
    _version: 1,
  };
  const { _version, ...storedSession } = session;
  await db.insert(studySessionsTable).values({
    id, ownerId: owner(req), courseId: session.courseId, topic: session.topic,
    session: storedSession as unknown as JsonObject,
  });
  res.status(201).json(safeSession(session));
});

router.get("/study/sessions/:id", async (req, res): Promise<void> => {
  const session = await requireSession(req, res);
  if (session) res.json(safeSession(session));
});

router.post("/study/sessions/:id/check-in", async (req, res): Promise<void> => {
  if (!CheckInStudySessionBody.safeParse(req.body).success ||
    !parseBody(req.body, { skipped: (v) => typeof v === "boolean" })) {
    res.status(400).json({ error: "Provide skipped as a boolean." });
    return;
  }
  const session = await requireSession(req, res);
  if (!session) return;
  if (session.checkIn) {
    res.json(safeSession(session));
    return;
  }
  session.checkIn = { skipped: (req.body as JsonObject).skipped as boolean, recordedAt: new Date().toISOString() };
  if (!await saveSession(session, owner(req))) {
    const current = await getSession(session.id, owner(req));
    if (current?.checkIn) {
      res.json(safeSession(current));
      return;
    }
    res.status(409).json({ error: "Session changed on another device. Please retry." });
    return;
  }
  res.json(safeSession(session));
});

async function accountState(ownerId: string): Promise<JsonObject | null> {
  const rows = await db.select({ state: studyStatesTable.state }).from(studyStatesTable)
    .where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
  return (rows[0]?.state as JsonObject | undefined) ?? null;
}

async function persistSessionReviews(ownerId: string, session: Session): Promise<boolean> {
  const entries = session.reviewSchedule.filter((entry) =>
    entry.sessionId === session.id);
  if (!entries.length) return true;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = await db.select({ state: studyStatesTable.state, version: studyStatesTable.version })
      .from(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).limit(1);
    const row = rows[0];
    if (!row) return false;
    const latestState = row.state as JsonObject;
    const currentSchedule = Array.isArray(latestState.reviewSchedule) ? latestState.reviewSchedule : [];
    const existingKeys = new Set(currentSchedule
      .filter(jsonObject)
      .map((item) => item.reviewKey)
      .filter((key): key is string => typeof key === "string"));
    const additions = entries.filter((entry) =>
      typeof entry.reviewKey === "string" && !existingKeys.has(entry.reviewKey));
    if (!additions.length) return true;
    const updated = await db.update(studyStatesTable).set({
      state: { ...latestState, reviewSchedule: [...currentSchedule, ...additions] },
      version: row.version + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(studyStatesTable.ownerId, ownerId),
      eq(studyStatesTable.version, row.version),
    )).returning({ version: studyStatesTable.version });
    if (updated[0]) return true;
  }
  return false;
}

function sourceChunks(state: JsonObject | null, courseId: string, topic: string, extraMaterials: unknown[] = []): {
  chunks: Array<{ label: string; text: string; score: number }>;
  status: SourceStatus;
} {
  const materials = [...(Array.isArray(state?.materials) ? state.materials : []), ...extraMaterials];
  const queryWords = `${topic} ${courseId}`.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
  const all: Array<{ label: string; text: string; score: number }> = [];
  for (const item of materials) {
    if (!jsonObject(item) || (item.courseId != null && item.courseId !== courseId) || typeof item.text !== "string") continue;
    const text = item.text;
    const label = typeof item.name === "string" ? item.name : typeof item.filename === "string" ? item.filename : "Course material";
    for (let offset = 0; offset < text.length; offset += SOURCE_CHUNK_LENGTH) {
      const chunk = text.slice(offset, offset + SOURCE_CHUNK_LENGTH);
      const lowered = chunk.toLowerCase();
      const score = queryWords.reduce((sum, word) => sum + (lowered.split(word).length - 1), 0);
      all.push({ label, text: chunk, score });
    }
  }
  const ranked = [...all].sort((a, b) => b.score - a.score);
  const selected: typeof all = [];
  let chars = 0;
  for (const chunk of ranked) {
    if (chars + chunk.text.length > SOURCE_CHAR_LIMIT) continue;
    selected.push(chunk);
    chars += chunk.text.length;
  }
  const truncated = selected.length < all.length;
  const labels = [...new Set(selected.map((chunk) => chunk.label))];
  return {
    chunks: selected,
    status: {
      usedSourceMaterial: selected.length > 0,
      selectedChunks: selected.length,
      availableChunks: all.length,
      truncated,
      coverage: selected.length === 0 ? "none" : truncated ? "selected" : "complete",
      sources: selected.length
        ? [
            ...labels.map((label) => ({ label, kind: "source" as const })),
            { label: "General explanatory context, when used", kind: "supplemental" as const },
            { label: "Reasoned interpretation, when used", kind: "inferred" as const },
          ]
        : [{ label: "Established general knowledge; no matching uploaded material", kind: "supplemental" }],
    },
  };
}

async function requireConsent(res: Response, ownerId: string): Promise<JsonObject | null> {
  const state = await accountState(ownerId);
  if (!state || state.aiConsent !== true) {
    res.status(403).json({ error: "Persist explicit AI consent in study state (aiConsent: true) before using AI coaching." });
    return null;
  }
  return state;
}

router.post("/study/sessions/:id/messages", async (req, res): Promise<void> => {
  if (!SendStudyMessageBody.safeParse(req.body).success ||
    !parseBody(req.body, { content: (v) => boundedText(v, 8000) })) {
    res.status(400).json({ error: "Message content must be 1-8000 characters." });
    return;
  }
  const session = await requireSession(req, res);
  if (!session) return;
  if (!session.checkIn) {
    res.status(409).json({ error: "Complete or skip the session check-in before sending a coaching message." });
    return;
  }
  const state = await requireConsent(res, owner(req));
  if (!state) return;
  const { chunks, status } = sourceChunks(state, session.courseId, session.topic, await reviewedLectureMaterials(owner(req), session.courseId));
  const userContent = (req.body as JsonObject).content as string;
  const history = session.messages.slice(-18).map((message) => ({
    role: message.role as "user" | "assistant",
    content: message.content as string,
  }));
  const sourceText = chunks.map((chunk) => `[SOURCE: ${chunk.label}]\n${chunk.text}`).join("\n\n");
  try {
    const response = await complete("tutor", {
      system: tutorPrompt.systemPrompt({
        topic: session.topic,
        quizInProgress: Boolean(session.quiz && !session.quiz.grade),
        status,
        sourceText,
      }),
      messages: [...history, { role: "user", content: userContent }],
    });
    const reply = response.text?.trim();
    if (!reply) throw new Error("Empty response");
    const timestamp = new Date().toISOString();
    session.messages.push({ role: "user", content: userContent, createdAt: timestamp });
    session.messages.push({ role: "assistant", content: reply, createdAt: new Date().toISOString(), sourceStatus: status });
    session.messages = session.messages.slice(-MAX_SESSION_MESSAGES);
    if (!await saveSession(session, owner(req))) {
      res.status(409).json({ error: "Session changed on another device. Please retry your message." });
      return;
    }
    res.json(safeSession(session));
  } catch (error) {
    req.log.error({ error: aiErrorMessage(error) }, "Tutoring AI request failed");
    res.status(502).json({ error: "The AI coach could not complete this message. Please try again." });
  }
});

router.post("/study/sessions/:id/quiz", async (req, res): Promise<void> => {
  if (!GenerateStudyQuizBody.safeParse(req.body).success ||
    !parseBody(req.body, { mode: (v) => v === "diagnostic" || v === "targeted" })) {
    res.status(400).json({ error: "Mode must be diagnostic or targeted." });
    return;
  }
  const session = await requireSession(req, res);
  if (!session) return;
  if (!session.checkIn) {
    res.status(409).json({ error: "Complete or skip the session check-in before generating a quiz." });
    return;
  }
  const state = await requireConsent(res, owner(req));
  if (!state) return;
  const mode = (req.body as JsonObject).mode as "diagnostic" | "targeted";
  const priorDiagnostic = session.scores.diagnostic;
  if (session.quiz && !session.quiz.grade) {
    res.status(409).json({ error: "Finish and grade the current quiz before creating another." });
    return;
  }
  if (mode === "targeted" && !priorDiagnostic) {
    res.status(400).json({ error: "Complete and grade a diagnostic quiz before requesting a targeted retest." });
    return;
  }
  if ((mode === "diagnostic" && session.scores.diagnostic) || (mode === "targeted" && session.scores.targeted)) {
    res.status(409).json({ error: "This session already has a graded score for that quiz mode." });
    return;
  }
  const weakConcepts = mode === "targeted"
    ? session.reviewSchedule.filter((item) => item.result === "missed").map((item) => item.concept).filter((value): value is string => typeof value === "string")
    : [];
  const expectedCount = mode === "diagnostic"
    ? Math.min(20, Math.max(3, Math.floor(session.minutes * 0.75)))
    : Math.min(10, Math.max(5, weakConcepts.length));
  const originalPrompts = mode === "targeted"
    ? [
        ...session.attempts.flatMap((attempt) => attempt.questions.map((question) => question.prompt)),
        ...(session.quiz?.mode === "diagnostic" ? session.quiz.questions.map((question) => question.prompt) : []),
      ]
    : [];
  const usedPrompts = new Set(originalPrompts.map((prompt) => prompt.trim().toLowerCase().replace(/\s+/g, " ")));
  const { chunks, status } = sourceChunks(state, session.courseId, session.topic, await reviewedLectureMaterials(owner(req), session.courseId));
  const sourceText = chunks.map((chunk) => `[SOURCE: ${chunk.label}]\n${chunk.text}`).join("\n\n");
  try {
    const response = await complete("session_quiz", {
      system: sessionQuizPrompt.systemPrompt({ expectedCount, originalPrompts, weakConcepts, status }),
      messages: [{ role: "user", content: JSON.stringify({ courseId: session.courseId, topic: session.topic, sourceMaterial: sourceText }) }],
    });
    const raw = response.text;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const proposed = jsonObject(parsed) && Array.isArray(parsed.questions) ? parsed.questions : [];
    const questions: StoredQuestion[] = [];
    let invalidItemCount = Math.max(0, expectedCount - proposed.length) + Math.max(0, proposed.length - expectedCount);
    for (const value of proposed.slice(0, expectedCount)) {
      if (!jsonObject(value) || typeof value.prompt !== "string" || !value.prompt.trim() ||
        typeof value.concept !== "string" || !value.concept.trim() || typeof value.explanation !== "string" ||
        !Array.isArray(value.options) || value.options.length !== 4 ||
        value.options.some((option) => typeof option !== "string" || !option.trim()) ||
        !Number.isInteger(value.answerIndex) || (value.answerIndex as number) < 0 || (value.answerIndex as number) > 3) {
        invalidItemCount += 1;
        continue;
      }
      const normalizedPrompt = value.prompt.trim().toLowerCase().replace(/\s+/g, " ");
      const normalizedOptions = (value.options as string[]).map((option) => option.trim().toLowerCase().replace(/\s+/g, " "));
      if (usedPrompts.has(normalizedPrompt) || new Set(normalizedOptions).size !== 4) {
        invalidItemCount += 1;
        continue;
      }
      usedPrompts.add(normalizedPrompt);
      const options = (value.options as string[]).map((text) => ({ id: randomUUID(), text }));
      questions.push({
        id: randomUUID(), prompt: value.prompt.slice(0, 2000), concept: value.concept.slice(0, 300), options,
        correctOptionId: options[value.answerIndex as number]!.id, explanation: value.explanation.slice(0, 2000), answers: [],
      });
    }
    if (!questions.length) {
      res.status(502).json({
        error: "The coach did not return any valid questions. Please retry generation.",
        expectedCount,
        invalidItemCount,
      });
      return;
    }
    const quiz: Quiz = { mode, expectedCount, questions, sourceStatus: status, invalidItemCount, grade: null };
    session.quiz = quiz;
    session.reportText = null;
    session.status = "active";
    if (!await saveSession(session, owner(req))) {
      res.status(409).json({ error: "Session changed on another device. Please retry quiz generation." });
      return;
    }
    res.json(safeSession(session));
  } catch (error) {
    req.log.error({ error: aiErrorMessage(error) }, "Session quiz AI request failed");
    res.status(502).json({ error: "Could not generate a complete quiz. Please try again." });
  }
});

router.put("/study/sessions/:id/answers", async (req, res): Promise<void> => {
  if (!SaveStudyAnswerBody.safeParse(req.body).success ||
    !parseBody(req.body, { questionId: (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v), optionId: (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v), assisted: (v) => typeof v === "boolean" })) {
    res.status(400).json({ error: "Provide questionId, optionId and assisted." });
    return;
  }
  const session = await requireSession(req, res);
  if (!session) return;
  if (!session.quiz || session.quiz.grade) {
    res.status(409).json({ error: "There is no ungraded quiz to answer." });
    return;
  }
  const body = req.body as JsonObject;
  const question = session.quiz.questions.find((candidate) => candidate.id === body.questionId);
  if (!question || !question.options.some((option) => option.id === body.optionId)) {
    res.status(400).json({ error: "Unknown question or option identifier." });
    return;
  }
  question.answers.push({ optionId: body.optionId as string, assisted: body.assisted as boolean });
  if (!await saveSession(session, owner(req))) {
    res.status(409).json({ error: "Session answers changed on another device. Reload the session and retry." });
    return;
  }
  res.json(safeSession(session));
});

router.put("/study/sessions/:id/questions/:questionId/flag", async (req, res): Promise<void> => {
  const parsed = FlagStudyQuestionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide a flag kind of invalid or ambiguous and an optional reason of at most 500 characters." });
    return;
  }
  const session = await requireSession(req, res);
  if (!session) return;
  if (!session.quiz) {
    res.status(409).json({ error: "Generate a quiz before reporting a question." });
    return;
  }
  if (session.quiz.grade) {
    res.status(409).json({
      error: "Question reports are only accepted before grading. Graded scores and review history cannot be safely recomputed.",
    });
    return;
  }
  const questionId = Array.isArray(req.params.questionId) ? req.params.questionId[0] : req.params.questionId;
  if (typeof questionId !== "string" || !/^[0-9a-f-]{36}$/i.test(questionId)) {
    res.status(400).json({ error: "Invalid question id." });
    return;
  }
  const question = session.quiz.questions.find((candidate) => candidate.id === questionId);
  if (!question) {
    res.status(404).json({ error: "Question not found in the current quiz." });
    return;
  }
  const kind = parsed.data.kind;
  const reason = parsed.data.reason?.trim() || undefined;
  const matchesFlag = (flag: StoredQuestionFlag | undefined): boolean =>
    flag?.kind === kind && (flag.reason ?? undefined) === reason;
  if (matchesFlag(question.flag)) {
    res.json(safeSession(session));
    return;
  }
  question.flag = {
    kind,
    ...(reason ? { reason } : {}),
    reportedAt: new Date().toISOString(),
  };
  if (!await saveSession(session, owner(req))) {
    const current = await getSession(session.id, owner(req));
    if (current?.quiz?.grade) {
      res.status(409).json({
        error: "Question reports are only accepted before grading. Graded scores and review history cannot be safely recomputed.",
      });
      return;
    }
    const currentQuestion = current?.quiz?.questions.find((candidate) => candidate.id === questionId);
    if (current && currentQuestion && matchesFlag(currentQuestion.flag)) {
      res.json(safeSession(current));
      return;
    }
    res.status(409).json({ error: "Session changed on another device. Reload the quiz and retry the question report." });
    return;
  }
  res.json(safeSession(session));
});

router.post("/study/sessions/:id/grade", async (req, res): Promise<void> => {
  const session = await requireSession(req, res);
  if (!session) return;
  if (!session.quiz) {
    res.status(409).json({ error: "Generate a quiz before grading." });
    return;
  }
  if (session.quiz.grade) {
    if (!await persistSessionReviews(owner(req), session)) {
      res.status(409).json({ error: "The grade is saved, but the account review schedule is busy. Retry to sync it." });
      return;
    }
    res.json(safeSession(session));
    return;
  }
  const now = new Date();
  const learnerReportedCount = session.quiz.questions.filter((question) => question.flag).length;
  const excludedQuestionCount = session.quiz.questions.filter((question) => question.invalid || question.flag).length;
  const invalidItems = session.quiz.invalidItemCount + excludedQuestionCount;
  const valid = session.quiz.questions.filter((question) =>
    !question.invalid && !question.flag && question.options.length === 4 &&
    question.options.some((option) => option.id === question.correctOptionId));
  const answered = valid.filter((question) => {
    const answer = question.answers.at(-1);
    return answer && question.options.some((option) => option.id === answer.optionId);
  });
  const correct = answered.filter((question) => question.answers.at(-1)?.optionId === question.correctOptionId);
  const score = {
    correct: correct.length,
    answered: answered.length,
    excluded: invalidItems + valid.length - answered.length,
    invalidItems,
    unanswered: valid.length - answered.length,
    total: valid.length + invalidItems,
    percent: answered.length ? Math.round((correct.length / answered.length) * 100) : 0,
    gradedAt: now.toISOString(),
  };
  for (const question of valid) {
    const answer = question.answers.at(-1);
    const selectedOption = answer ? question.options.find((option) => option.id === answer.optionId) : undefined;
    const correctOption = question.options.find((option) => option.id === question.correctOptionId)!;
    question.feedback = {
      selectedOptionId: selectedOption?.id ?? null,
      selectedOptionText: selectedOption?.text ?? null,
      correctOptionId: correctOption.id,
      correctOptionText: correctOption.text,
      explanation: question.explanation,
      concept: question.concept,
      assisted: answer?.assisted ?? false,
    };
  }
  session.quiz.grade = score;
  session.attempts = [...session.attempts, session.quiz];
  if (session.quiz.mode === "diagnostic") session.scores.diagnostic = score;
  else session.scores.targeted = score;
  const review = correct.map((question) => ({
    concept: question.concept, result: "correct", sessionId: session.id,
    quizMode: session.quiz!.mode,
    reviewKey: `${session.id}:${session.quiz!.mode}:${question.id}`,
    dueAt: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
    intervalDays: 3,
  }));
  for (const question of answered.filter((item) => !correct.includes(item))) {
    review.push({
      concept: question.concept, result: "missed", sessionId: session.id,
      quizMode: session.quiz!.mode,
      reviewKey: `${session.id}:${session.quiz!.mode}:${question.id}`,
      dueAt: new Date(now.getTime() + 86_400_000).toISOString(), intervalDays: 1,
    });
  }
  session.reviewSchedule = [...session.reviewSchedule, ...review];
  const skipped = valid.length - answered.length;
  const missedConcepts = [...new Set(answered
    .filter((question) => question.answers.at(-1)?.optionId !== question.correctOptionId)
    .map((question) => question.concept))];
  const formatScore = (value: Record<string, unknown> | null): string => {
    if (!value) return "not yet graded";
    return `${value.correct}/${value.answered} answered valid (${value.percent}%)`;
  };
  const remediationStatus = session.quiz.mode === "targeted"
    ? "targeted retest completed"
    : missedConcepts.length
      ? "not yet completed; missed concepts need focused review"
      : "no missed answered concepts identified";
  const nextStep = missedConcepts.length
    ? session.quiz.mode === "diagnostic"
      ? "review the missed concepts, then take the targeted retest"
      : "review the remaining missed concepts in a new focused session"
    : session.quiz.mode === "diagnostic" && score.invalidItems === 0 && skipped === 0
      ? "continue to the next topic or scheduled review"
      : "review any excluded or unanswered questions, then choose the next topic";
  session.reportText = `Course: ${session.courseId}. Topic: ${session.topic}. Diagnostic score: ${formatScore(session.scores.diagnostic)}. Targeted retest score: ${formatScore(session.scores.targeted)}. Latest ${session.quiz.mode === "diagnostic" ? "diagnostic" : "targeted retest"} score: ${formatScore(score)}. Score denominator includes answered valid questions only; ${skipped} unanswered and ${score.invalidItems} invalid or ambiguous item(s) excluded, including ${learnerReportedCount} learner report(s). Automated AI checks do not guarantee factual correctness. Question reports are accepted before grading; graded scores and review history are not safely recomputed afterward. Missed concepts: ${missedConcepts.join(", ") || "none among answered valid questions"}. Remediation status: ${remediationStatus}. Next step: ${nextStep}.`;
  session.status = "completed";
  if (!await saveSession(session, owner(req))) {
    const current = await getSession(session.id, owner(req));
    if (current?.quiz?.grade) {
      res.json(safeSession(current));
      return;
    }
    res.status(409).json({ error: "Session changed on another device. Reload and retry grading." });
    return;
  }

  if (!await persistSessionReviews(owner(req), session)) {
    res.status(409).json({ error: "The grade is saved, but the account review schedule is busy. Retry to sync it." });
    return;
  }
  res.json(safeSession(session));
});

export default router;