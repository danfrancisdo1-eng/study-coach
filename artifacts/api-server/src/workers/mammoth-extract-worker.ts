import { parentPort, workerData } from "node:worker_threads";
import mammoth from "mammoth";

type WorkerInput = { bytes: Uint8Array };

if (parentPort) {
  const port = parentPort;
  const input = workerData as WorkerInput;
  void mammoth.extractRawText({ buffer: Buffer.from(input.bytes) })
    .then((result) => port.postMessage({ text: result.value }))
    .catch(() => port.postMessage({ error: "DOCX text extraction failed." }));
}