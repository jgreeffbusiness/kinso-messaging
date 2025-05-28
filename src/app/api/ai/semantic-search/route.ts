import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabaseClient';
import { getEmbedding } from '@/lib/ai/embeddingUtils';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const DEFAULT_TOP_K = 3;
const DEFAULT_MATCH_THRESHOLD = 0.7;
const MAX_TOTAL_SNIPPETS = 7; // Max combined snippets to send to LLM

interface SemanticSearchRequestBody {
  query: string;
  sources?: ('ai_chat_history' | 'platform_messages')[];
  topK?: number;
  matchThreshold?: number;
}

// Define a common structure for search results from different sources
interface SearchResultItem {
  id: string; // Original ID of the item (AiChatMessage ID or Message ID)
  content: string; // The text content/chunk that was matched or relevant text
  source: 'ai_chat_history' | 'platform_messages';
  similarity: number;
  metadata?: Record<string, unknown>; // For things like message role, timestamp, subject etc.
}

// Interfaces for Supabase RPC results
interface MatchAiChatMessageResult {
  id: string;
  user_id: string;
  role: string;
  content: string;
  created_at: string; 
  similarity: number;
  source_type: 'ai_chat_history';
}

interface MatchPlatformMessageResult {
  id: string;
  user_id: string;
  contact_id: string | null;
  platform: string;
  platform_message_id: string;
  content_chunk: string;
  chunk_index: number;
  original_subject: string | null;
  original_full_content: string;
  message_timestamp: string; 
  similarity: number;
  source_type: 'platform_messages'; // Corrected to match literal type
}


export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string };
    const userId = decoded.userId;
    if (!userId) {
      return NextResponse.json({ error: 'User ID not found in session' }, { status: 401 });
    }

    const body = (await request.json()) as SemanticSearchRequestBody;
    const { 
        query,
        sources = ['ai_chat_history', 'platform_messages'], // Default to all sources
        topK = DEFAULT_TOP_K,
        matchThreshold = DEFAULT_MATCH_THRESHOLD
    } = body;

    if (!query) {
      return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
    }
    if (!openai) {
      return NextResponse.json({ error: 'OpenAI client not configured on server' }, { status: 500 });
    }
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Supabase admin client not configured on server' }, { status: 500 });
    }

    const queryEmbedding = await getEmbedding(query, userId);
    if (!queryEmbedding) {
      return NextResponse.json({ error: 'Failed to generate embedding for the query' }, { status: 500 });
    }

    let allSnippets: SearchResultItem[] = [];

    // 1. Search AI Chat History
    if (sources.includes('ai_chat_history')) {
      const { data: chatData, error: chatError } = await supabaseAdmin.rpc('match_ai_chat_messages', {
        query_embedding: queryEmbedding,
        user_id_filter: userId,
        match_threshold: matchThreshold,
        match_count: topK,
      }) as { data: MatchAiChatMessageResult[] | null; error: any };

      if (chatError) {
        console.error('[SemanticSearchAPI] Error fetching from match_ai_chat_messages:', chatError);
        // Decide if this should be a hard error or just a warning
      } else if (chatData) {
        const formattedChatData: SearchResultItem[] = chatData.map((item: MatchAiChatMessageResult) => ({
          id: item.id,
          content: item.content, // SQL function returns the full original content
          source: 'ai_chat_history',
          similarity: item.similarity,
          metadata: { role: item.role, created_at: item.created_at }
        }));
        allSnippets = allSnippets.concat(formattedChatData);
      }
    }

    // 2. Search Platform Messages
    if (sources.includes('platform_messages')) {
      const { data: platformMsgData, error: platformMsgError } = await supabaseAdmin.rpc('match_platform_messages', {
        query_embedding: queryEmbedding,
        user_id_filter: userId,
        match_threshold: matchThreshold,
        match_count: topK,
      }) as { data: MatchPlatformMessageResult[] | null; error: any };

      if (platformMsgError) {
        console.error('[SemanticSearchAPI] Error fetching from match_platform_messages:', platformMsgError);
      } else if (platformMsgData) {
        const formattedPlatformData: SearchResultItem[] = platformMsgData.map((item: MatchPlatformMessageResult) => ({
          id: item.id,
          content: item.content_chunk, // SQL function returns the matched chunk
          source: 'platform_messages',
          similarity: item.similarity,
          metadata: { 
            platform: item.platform, 
            subject: item.original_subject, 
            timestamp: item.message_timestamp, 
            full_content_preview: item.original_full_content?.substring(0, 200) + '...' // Optional: preview of full content
          }
        }));
        allSnippets = allSnippets.concat(formattedPlatformData);
      }
    }

    // 3. Sort all collected snippets by similarity and take the top N
    allSnippets.sort((a, b) => b.similarity - a.similarity);
    const topSnippets = allSnippets.slice(0, MAX_TOTAL_SNIPPETS);

    if (topSnippets.length === 0) {
      // Option 1: Return a message saying nothing relevant was found
      // return NextResponse.json({ answer: \"I couldn't find any relevant information in your data to answer that question.\" });
      // Option 2: Call the LLM without context, or with a specific prompt indicating no context was found.
      // For now, let's proceed to LLM, which might say it can't answer based on context.
    }

    // 4. Construct the prompt for the LLM
    let contextString = topSnippets
      .map(snippet => {
        let snippetHeader = `Source: ${snippet.source === 'ai_chat_history' ? 'AI Chat History' : 'Platform Message'} (Similarity: ${snippet.similarity.toFixed(2)})`;
        if (snippet.source === 'ai_chat_history' && snippet.metadata?.role) {
          snippetHeader += ` | Role: ${snippet.metadata.role}`;
        }
        if (snippet.source === 'platform_messages' && snippet.metadata?.platform) {
          snippetHeader += ` | Platform: ${snippet.metadata.platform}`;
          if (snippet.metadata.subject) snippetHeader += ` | Subject: ${snippet.metadata.subject}`;
        }
        return `${snippetHeader}\nContent: ${snippet.content}`;
      })
      .join('\n---\n');
    
    if (topSnippets.length === 0) {
        contextString = "No specific relevant excerpts found in your data.";
    }

    const systemPrompt = `You are a helpful AI assistant. Based ONLY on the following relevant excerpts from the user\'s data, answer their current question. 
If the answer is not found in the provided excerpts, clearly state that you couldn\'t find the information in the provided context or that the context is insufficient. 
Do not make up information. Be concise. Reference the source of information if it seems relevant (e.g., \"In a previous chat...\", \"In an email with subject X...\").

Relevant excerpts:
${contextString}`;

    // 5. Call OpenAI LLM
    const llmResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // Or your preferred model, e.g., gpt-4
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      temperature: 0.3, // Lower temperature for more factual, less creative answers
    });

    const answer = llmResponse.choices[0]?.message?.content?.trim() || "Sorry, I couldn't formulate a response.";

    return NextResponse.json({ 
        answer,
        debug_retrieved_snippets: topSnippets // Optional: for debugging what was retrieved
    });

  } catch (error: unknown) {
    const e = error as Error;
    console.error('[API /ai/semantic-search POST] Error:', e.message, e.stack);
    return NextResponse.json({ error: `Failed to process semantic search: ${e.message}` }, { status: 500 });
  }
} 