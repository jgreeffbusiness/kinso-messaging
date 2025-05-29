import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabaseClient';
import { getEmbedding } from '@/lib/ai/embeddingUtils';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const DEFAULT_TOP_K = 8;
const DEFAULT_MATCH_THRESHOLD = 0.6;
const SECONDARY_MATCH_THRESHOLD = 0.4;
const MIN_SNIPPETS_FROM_SOURCE_BEFORE_RETRY = 2;
const MAX_TOTAL_SNIPPETS = 5;

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
    console.log('[SemanticSearchAPI] Authenticated userId:', userId);
    if (!userId) {
      return NextResponse.json({ error: 'User ID not found in session' }, { status: 401 });
    }

    const body = (await request.json()) as SemanticSearchRequestBody;
    let { 
        query,
        sources = ['ai_chat_history', 'platform_messages'],
        topK = DEFAULT_TOP_K,
        matchThreshold = DEFAULT_MATCH_THRESHOLD
    } = body;
    console.log(`[SemanticSearchAPI] Received query: "${query}", sources: ${sources.join(', ')}, topK: ${topK}, primaryMatchThreshold: ${matchThreshold}`);

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
      console.error('[SemanticSearchAPI] Failed to generate embedding for query:', query);
      return NextResponse.json({ error: 'Failed to generate embedding for the query' }, { status: 500 });
    }
    console.log('[SemanticSearchAPI] Query embedding generated successfully.');

    let allSnippets: SearchResultItem[] = [];
    const retrievedSnippetIds = new Set<string>();

    if (sources.includes('ai_chat_history')) {
      console.log(`[SemanticSearchAPI] Fetching from match_ai_chat_messages with threshold: ${matchThreshold}`);
      const { data: chatData, error: chatError } = await supabaseAdmin.rpc('match_ai_chat_messages', {
        query_embedding: queryEmbedding,
        user_id_filter: userId,
        match_threshold: matchThreshold,
        match_count: topK,
      }) as { data: MatchAiChatMessageResult[] | null; error: any };

      if (chatError) {
        console.error('[SemanticSearchAPI] Error fetching from match_ai_chat_messages (initial):', chatError);
      } else if (chatData && chatData.length > 0) {
        console.log('[SemanticSearchAPI] Raw chatData received (initial):', JSON.stringify(chatData, null, 2));
        const formattedChatData: SearchResultItem[] = chatData.map(item => ({
          id: item.id,
          content: item.content,
          source: 'ai_chat_history',
          similarity: item.similarity,
          metadata: { role: item.role, created_at: item.created_at }
        }));
        formattedChatData.forEach(s => { if (!retrievedSnippetIds.has(s.id)) { allSnippets.push(s); retrievedSnippetIds.add(s.id); } });
        console.log(`[SemanticSearchAPI] Added ${formattedChatData.length} snippets from AI chat history (initial).`);
      } else {
        console.log('[SemanticSearchAPI] No data from match_ai_chat_messages (initial).');
      }
    }

    if (sources.includes('platform_messages')) {
      let platformSnippetsCount = 0;
      console.log(`[SemanticSearchAPI] Fetching from match_platform_messages with primary threshold: ${matchThreshold}`);
      const { data: platformMsgData, error: platformMsgError } = await supabaseAdmin.rpc('match_platform_messages', {
        query_embedding: queryEmbedding,
        user_id_filter: userId,
        match_threshold: matchThreshold,
        match_count: topK,
      }) as { data: MatchPlatformMessageResult[] | null; error: any };

      if (platformMsgError) {
        console.error('[SemanticSearchAPI] Error fetching from match_platform_messages (initial):', platformMsgError);
      } else if (platformMsgData && platformMsgData.length > 0) {
        console.log('[SemanticSearchAPI] Raw platformMsgData received (initial):', JSON.stringify(platformMsgData, null, 2));
        const formattedPlatformData: SearchResultItem[] = platformMsgData.map(item => ({
          id: item.id, content: item.content_chunk, source: 'platform_messages', similarity: item.similarity,
          metadata: { platform: item.platform, subject: item.original_subject, timestamp: item.message_timestamp, full_content_preview: item.original_full_content?.substring(0, 200) + '...' }
        }));
        formattedPlatformData.forEach(s => { if (!retrievedSnippetIds.has(s.id)) { allSnippets.push(s); retrievedSnippetIds.add(s.id); } });
        platformSnippetsCount = formattedPlatformData.length;
        console.log(`[SemanticSearchAPI] Added ${platformSnippetsCount} snippets from platform messages (initial).`);
      } else {
        console.log('[SemanticSearchAPI] No data from match_platform_messages (initial).');
      }

      if (platformSnippetsCount < MIN_SNIPPETS_FROM_SOURCE_BEFORE_RETRY && platformSnippetsCount < topK) {
        console.log(`[SemanticSearchAPI] Platform messages count (${platformSnippetsCount}) is low. Retrying with secondary threshold: ${SECONDARY_MATCH_THRESHOLD}`);
        const { data: platformMsgDataRetry, error: platformMsgErrorRetry } = await supabaseAdmin.rpc('match_platform_messages', {
          query_embedding: queryEmbedding,
          user_id_filter: userId,
          match_threshold: SECONDARY_MATCH_THRESHOLD,
          match_count: topK - platformSnippetsCount,
        }) as { data: MatchPlatformMessageResult[] | null; error: any };

        if (platformMsgErrorRetry) {
          console.error('[SemanticSearchAPI] Error fetching from match_platform_messages (retry):', platformMsgErrorRetry);
        } else if (platformMsgDataRetry && platformMsgDataRetry.length > 0) {
          console.log('[SemanticSearchAPI] Raw platformMsgData received (retry):', JSON.stringify(platformMsgDataRetry, null, 2));
          const formattedPlatformDataRetry: SearchResultItem[] = platformMsgDataRetry.map(item => ({
            id: item.id, content: item.content_chunk, source: 'platform_messages', similarity: item.similarity,
            metadata: { platform: item.platform, subject: item.original_subject, timestamp: item.message_timestamp, full_content_preview: item.original_full_content?.substring(0, 200) + '...' }
          }));
          formattedPlatformDataRetry.forEach(s => { if (!retrievedSnippetIds.has(s.id)) { allSnippets.push(s); retrievedSnippetIds.add(s.id); } });
          console.log(`[SemanticSearchAPI] Added ${formattedPlatformDataRetry.length} snippets from platform messages (retry).`);
        } else {
          console.log('[SemanticSearchAPI] No additional data from match_platform_messages (retry).');
        }
      }
    }
    
    const finalUniqueSnippets: SearchResultItem[] = [];
    const uniqueIds = new Map<string, SearchResultItem>();
    for (const snippet of allSnippets) {
        if (!uniqueIds.has(snippet.id) || (uniqueIds.get(snippet.id)!.similarity || 0) < (snippet.similarity || 0)) {
            uniqueIds.set(snippet.id, snippet);
        }
    }
    finalUniqueSnippets.push(...uniqueIds.values());
    allSnippets = finalUniqueSnippets;

    console.log('[SemanticSearchAPI] Total snippets BEFORE sorting/slicing (after potential retry & de-dupe):', allSnippets.length);
    allSnippets.forEach(snippet => {
      console.log(`[SemanticSearchAPI] Snippet pre-sort: Source: ${snippet.source}, Similarity: ${snippet.similarity?.toFixed(4) || 'N/A'}, Content: "${snippet.content?.substring(0, 100) || 'N/A'}..."`);
    });

    allSnippets.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    const topSnippets = allSnippets.slice(0, MAX_TOTAL_SNIPPETS);

    console.log('[SemanticSearchAPI] MAX_TOTAL_SNIPPETS set to:', MAX_TOTAL_SNIPPETS);
    console.log('[SemanticSearchAPI] Top snippets count after sort and slice:', topSnippets.length);
    topSnippets.forEach(snippet => {
      console.log(`[SemanticSearchAPI] Top Snippet: Source: ${snippet.source}, Similarity: ${snippet.similarity?.toFixed(4) || 'N/A'}, Content: "${snippet.content?.substring(0, 150) || 'N/A'}..."`);
      console.log('[SemanticSearchAPI] Top Snippet Metadata:', snippet.metadata);
    });

    if (topSnippets.length === 0) {
      console.warn('[SemanticSearchAPI] No relevant snippets found after filtering, thresholding, and sorting!');
    }

    let contextString = topSnippets
      .map(snippet => {
        let snippetHeader = `Source: ${snippet.source === 'ai_chat_history' ? 'AI Chat History' : 'Platform Message'} (Similarity: ${snippet.similarity?.toFixed(2) || 'N/A'})`;
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
    console.log('[SemanticSearchAPI] Context string for LLM:', contextString);

    const systemPromptForAnswer = `You are a helpful AI assistant. Based ONLY on the following relevant excerpts from the user\'s data, answer their current question. 
If the answer is not found in the provided excerpts, clearly state that you couldn\'t find the information in the provided context or that the context is insufficient. 
Do not make up information. Be concise. Reference the source of information if it seems relevant (e.g., \"In a previous chat...\", \"In an email with subject X...\").

Relevant excerpts:
${contextString}`;
    console.log('[SemanticSearchAPI] System prompt for final LLM:', systemPromptForAnswer);
    console.log('[SemanticSearchAPI] User query for final LLM:', query);

    // 5. Call OpenAI LLM
    const llmResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // Or your preferred model, e.g., gpt-4
      messages: [
        { role: 'system', content: systemPromptForAnswer },
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