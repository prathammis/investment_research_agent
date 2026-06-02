import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { db, documentsTable, sessionsTable, messagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { runAgent, generateDocumentSummary } from "../lib/agent";
import {
  AskResearchBody,
  GetSessionMessagesParams,
  DeleteSessionParams,
  GetDocumentSummaryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/research/ask", async (req, res): Promise<void> => {
  const parsed = AskResearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { question, documentId, sessionId: existingSessionId } = parsed.data;

  // Fetch document
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, documentId));

  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (doc.status !== "ready") {
    res.status(400).json({ error: "Document is still processing" });
    return;
  }

  // Get or create session
  let sessionId = existingSessionId ?? null;
  if (!sessionId) {
    sessionId = uuidv4();
    await db.insert(sessionsTable).values({
      id: sessionId,
      documentId,
      companyName: doc.companyName,
      messageCount: 0,
      lastMessage: null,
    });
  }

  // Load message history
  const history = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, sessionId))
    .orderBy(messagesTable.createdAt);

  const chatHistory = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Save user message
  const userMsgId = uuidv4();
  await db.insert(messagesTable).values({
    id: userMsgId,
    sessionId,
    role: "user",
    content: question,
    toolCalls: null,
  });

  // Run agent
  const result = await runAgent(question, documentId, doc.companyName, chatHistory);

  // Save assistant message
  const assistantMsgId = uuidv4();
  await db.insert(messagesTable).values({
    id: assistantMsgId,
    sessionId,
    role: "assistant",
    content: result.answer,
    toolCalls: result.toolCalls.length > 0 ? result.toolCalls : null,
  });

  // Update session
  await db
    .update(sessionsTable)
    .set({
      messageCount: chatHistory.length + 2,
      lastMessage: result.answer.slice(0, 200),
    })
    .where(eq(sessionsTable.id, sessionId));

  res.json({
    answer: result.answer,
    toolCalls: result.toolCalls,
    sessionId,
    messageId: assistantMsgId,
    sources: result.sources,
  });
});

router.get("/research/sessions", async (_req, res): Promise<void> => {
  const sessions = await db
    .select()
    .from(sessionsTable)
    .orderBy(desc(sessionsTable.createdAt));

  res.json(
    sessions.map((s) => ({
      id: s.id,
      documentId: s.documentId,
      companyName: s.companyName,
      createdAt: s.createdAt.toISOString(),
      messageCount: s.messageCount,
      lastMessage: s.lastMessage ?? null,
    }))
  );
});

router.get("/research/sessions/:sessionId/messages", async (req, res): Promise<void> => {
  const params = GetSessionMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, params.data.sessionId))
    .orderBy(messagesTable.createdAt);

  res.json(
    msgs.map((m) => ({
      id: m.id,
      sessionId: m.sessionId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      toolCalls: (m.toolCalls as any[]) ?? [],
    }))
  );
});

router.delete("/research/sessions/:sessionId", async (req, res): Promise<void> => {
  const params = DeleteSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, params.data.sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await db.delete(messagesTable).where(eq(messagesTable.sessionId, params.data.sessionId));
  await db.delete(sessionsTable).where(eq(sessionsTable.id, params.data.sessionId));
  res.sendStatus(204);
});

router.get("/research/summary/:documentId", async (req, res): Promise<void> => {
  const params = GetDocumentSummaryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, params.data.documentId));

  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (doc.status !== "ready") {
    res.status(400).json({ error: "Document is not ready yet" });
    return;
  }

  // Use cached summary or generate fresh
  if (doc.summary) {
    res.json({
      documentId: doc.id,
      companyName: doc.companyName,
      summary: doc.summary,
      keyMetrics: [],
      generatedAt: doc.uploadedAt.toISOString(),
    });
    return;
  }

  const { summary, keyMetrics } = await generateDocumentSummary(doc.id, doc.companyName);

  await db
    .update(documentsTable)
    .set({ summary })
    .where(eq(documentsTable.id, doc.id));

  res.json({
    documentId: doc.id,
    companyName: doc.companyName,
    summary,
    keyMetrics,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
