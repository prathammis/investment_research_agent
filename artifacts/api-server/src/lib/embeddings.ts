import OpenAI from "openai";
import { logger } from "./logger";

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

export async function embed(text: string): Promise<number[]> {
  const client = getOpenAI();
  try {
    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  } catch (err) {
    logger.error({ err }, "Embedding failed");
    throw err;
  }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const client = getOpenAI();
  try {
    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: texts,
    });
    return response.data.map((d) => d.embedding);
  } catch (err) {
    logger.error({ err }, "Batch embedding failed");
    throw err;
  }
}
