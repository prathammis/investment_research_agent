import { Router, type IRouter } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { db, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { extractTextFromPDF, chunkText } from "../lib/pdf";
import { embedBatch } from "../lib/embeddings";
import { addChunks, deleteChunks } from "../lib/vectorstore";
import { generateDocumentSummary } from "../lib/agent";
import { UploadDocumentBody, DeleteDocumentParams } from "@workspace/api-zod";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.get("/documents", async (_req, res): Promise<void> => {
  const docs = await db.select().from(documentsTable).orderBy(documentsTable.uploadedAt);
  res.json(
    docs.map((d) => ({
      id: d.id,
      companyName: d.companyName,
      fileName: d.fileName,
      uploadedAt: d.uploadedAt.toISOString(),
      chunkCount: d.chunkCount,
      status: d.status,
      summary: d.summary ?? null,
    }))
  );
});

router.post("/documents/upload", upload.single("file"), async (req, res): Promise<void> => {
  const parsed = UploadDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const id = uuidv4();
  const { companyName } = parsed.data;

  await db.insert(documentsTable).values({
    id,
    companyName,
    fileName: req.file.originalname,
    chunkCount: 0,
    status: "processing",
  });

  res.status(201).json({
    id,
    companyName,
    fileName: req.file.originalname,
    uploadedAt: new Date().toISOString(),
    chunkCount: 0,
    status: "processing",
    summary: null,
  });

  // Process asynchronously after response is sent
  const buffer = req.file.buffer;
  setImmediate(async () => {
    try {
      const text = await extractTextFromPDF(buffer);
      const chunks = chunkText(text);

      // Embed in batches of 20
      const batchSize = 20;
      const allEmbeddings: number[][] = [];
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const embs = await embedBatch(batch);
        allEmbeddings.push(...embs);
      }

      await addChunks(id, chunks, allEmbeddings);

      const { summary } = await generateDocumentSummary(id, companyName);

      await db
        .update(documentsTable)
        .set({ chunkCount: chunks.length, status: "ready", summary })
        .where(eq(documentsTable.id, id));
    } catch (err) {
      await db
        .update(documentsTable)
        .set({ status: "error" })
        .where(eq(documentsTable.id, id));
    }
  });
});

router.delete("/documents/:id", async (req, res): Promise<void> => {
  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, params.data.id));

  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  await deleteChunks(params.data.id);
  await db.delete(documentsTable).where(eq(documentsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
