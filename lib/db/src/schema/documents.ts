import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentsTable = pgTable("documents", {
  id: text("id").primaryKey(),
  companyName: text("company_name").notNull(),
  fileName: text("file_name").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  chunkCount: integer("chunk_count").notNull().default(0),
  status: text("status").notNull().default("processing"),
  summary: text("summary"),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  uploadedAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
