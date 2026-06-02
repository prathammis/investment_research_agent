import { pool } from "@workspace/db";
import { logger } from "./logger";

export async function addChunks(
  documentId: string,
  chunks: string[],
  embeddings: number[][]
): Promise<void> {
  await pool.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);

  for (let i = 0; i < chunks.length; i++) {
    const id = `${documentId}_chunk_${i}`;
    const embStr = `[${embeddings[i].join(",")}]`;
    await pool.query(
      "INSERT INTO document_chunks (id, document_id, content, embedding, chunk_index) VALUES ($1, $2, $3, $4::vector, $5) ON CONFLICT (id) DO UPDATE SET content = $3, embedding = $4::vector",
      [id, documentId, chunks[i], embStr, i]
    );
  }
  logger.info({ documentId, count: chunks.length }, "Chunks stored in pgvector");
}

export async function queryChunks(
  documentId: string,
  queryEmbedding: number[],
  nResults = 5
): Promise<string[]> {
  const embStr = `[${queryEmbedding.join(",")}]`;
  const result = await pool.query<{ content: string }>(
    `SELECT content FROM document_chunks
     WHERE document_id = $1
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [documentId, embStr, nResults]
  );
  return result.rows.map((r) => r.content);
}

export async function deleteChunks(documentId: string): Promise<void> {
  await pool.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);
  logger.info({ documentId }, "Deleted chunks from pgvector");
}
