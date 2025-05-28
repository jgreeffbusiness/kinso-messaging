import OpenAI from 'openai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const EMBEDDING_MODEL = 'text-embedding-3-small'; // Matches your chat-messages API

/**
 * Generates an embedding for the given text using OpenAI.
 * @param text The text to embed.
 * @param userIdForErrorLog Optional user ID for logging purposes.
 * @returns A promise that resolves to an array of numbers (embedding) or null if an error occurs or text is empty.
 */
export async function getEmbedding(text: string, userIdForErrorLog?: string): Promise<number[] | null> {
  if (!openai) {
    console.warn('[EmbeddingUtils] OpenAI client not configured. Embedding generation skipped.');
    if (userIdForErrorLog) console.warn('[EmbeddingUtils] Skipped for user:', userIdForErrorLog);
    return null;
  }
  
  const cleanText = text.replace(/\n/g, ' ').trim();
  if (!cleanText) {
    console.warn('[EmbeddingUtils] Empty text provided for embedding.');
    if (userIdForErrorLog) console.warn('[EmbeddingUtils] Skipped for user:', userIdForErrorLog);
    return null;
  }

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleanText,
      encoding_format: "float",
    });
    // Ensure response.data and response.data[0] exist before accessing embedding
    return response.data?.[0]?.embedding || null;
  } catch (error) {
    console.error('[EmbeddingUtils] Error getting OpenAI embedding:', error instanceof Error ? error.message : error);
    if (userIdForErrorLog) console.error('[EmbeddingUtils] Failed for user:', userIdForErrorLog);
    return null;
  }
}

/**
 * Simple text chunking utility.
 * This is a basic version. More sophisticated chunking might consider sentence boundaries, etc.
 * @param text The text to chunk.
 * @param maxTokensPerChunk Approximate maximum tokens per chunk (OpenAI's advice for embeddings is often around 8191 for this model, but smaller chunks can be better for RAG).
 *                          Let's aim for smaller, more focused chunks for better RAG. e.g. 500-1000 tokens.
 *                          A token is roughly 4 characters in English.
 * @param overlapTokens Number of tokens to overlap between chunks.
 * @returns An array of text chunks.
 */
export function chunkText({
  text,
  maxCharsPerChunk = 2000, // Approx 500 tokens, good for RAG
  overlapChars = 200     // Approx 50 tokens overlap
}: {
  text: string;
  maxCharsPerChunk?: number;
  overlapChars?: number;
}): string[] {
  if (!text) return [];
  if (text.length <= maxCharsPerChunk) return [text];

  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + maxCharsPerChunk, text.length);
    chunks.push(text.substring(i, end));
    i += maxCharsPerChunk - overlapChars;
    if (i + overlapChars >= text.length && end === text.length) break; // Avoid tiny last chunk if overlap makes it so
  }
  return chunks;
} 