import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
import { prisma } from '@/server/db';
import { supabaseAdmin } from '@/lib/supabaseClient'; // Import Supabase admin client
import { getEmbedding } from '@/lib/ai/embeddingUtils'; // Import from shared utils

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
// const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // No longer needed here
// const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null; // No longer needed here
// const EMBEDDING_MODEL = 'text-embedding-3-small'; // No longer needed here

interface SaveMessageRequestBody {
  role: 'user' | 'assistant';
  content: string;
  sessionId?: string; // Optional
  // createdAt will be set by the server
}

export interface ChatMessageForClient {
    id: string; // Prisma IDs are usually strings (cuid, uuid)
    content: string;
    role: 'user' | 'assistant'; // Role matches AiChatMessage model
    createdAt: string; // ISO string date
}

// Placeholder type for Prisma AiChatMessage - replace with actual generated type after prisma generate
interface PrismaAiChatMessage {
    id: string;
    userId: string;
    role: string; // In DB it's string, cast to 'user' | 'assistant' for client
    content: string;
    createdAt: Date;
    sessionId?: string | null;
}

export async function GET(request: NextRequest) {
    try {
        const cookieStore = await cookies();
        const sessionCookie = cookieStore.get('session')?.value;
        if (!sessionCookie) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string };
        const userId = decoded.userId;
        if (!userId) {
            return NextResponse.json({ error: 'User ID not found' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const limitParam = searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 50; // Default to 50 messages

        // Fetch recent messages for the user
        const recentMessagesFromDb = await prisma.aiChatMessage.findMany({
            where: { userId },
            orderBy: { createdAt: 'asc' }, // Fetch oldest first within the limit to show in correct order
            take: limit,
        });

        // Map to the structure expected by the client (e.g., ChatProvider's Message type)
        const messagesForClient: ChatMessageForClient[] = recentMessagesFromDb.map((msg: PrismaAiChatMessage) => ({
            id: msg.id,
            content: msg.content,
            role: msg.role as 'user' | 'assistant', // Cast if role in DB is just string
            createdAt: msg.createdAt.toISOString(),
        }));

        return NextResponse.json({ messages: messagesForClient });

    } catch (error: unknown) {
        const e = error as Error;
        console.error('[API /ai/chat-messages GET] Error:', e.message);
        return NextResponse.json({ error: `Failed to fetch chat messages: ${e.message}` }, { status: 500 });
    }
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
      return NextResponse.json({ error: 'User ID not found' }, { status: 401 });
    }

    const body = await request.json() as SaveMessageRequestBody;
    const { role, content, sessionId } = body;

    if (!role || !content || (role !== 'user' && role !== 'assistant')) {
      return NextResponse.json({ error: 'Invalid message data: role and content are required.' }, { status: 400 });
    }

    const newMessage = await prisma.aiChatMessage.create({
      data: {
        userId,
        role,
        content,
        sessionId: sessionId || null, // Ensure null if undefined
      }
    });

    // Asynchronously generate embedding and save to Supabase vector table
    if (supabaseAdmin) {
      getEmbedding(content, userId)
        .then(async (embedding) => {
          if (embedding) {
            try {
              const { error: vectorError } = await supabaseAdmin
                .from('ai_chat_message_embeddings') // Table name for AI chat message embeddings
                .insert({
                  message_id: newMessage.id, 
                  user_id: userId,
                  embedding: embedding,
                  content_chunk: content, // Store the full content as the "chunk" for now
                  chunk_index: 0 // Default to 0 as we are not chunking yet
                });
              if (vectorError) {
                console.error("[ChatMessagesAPI] Supabase vector insert error for AiChatMessage:", newMessage.id, vectorError.message);
              } else {
                console.log(`[ChatMessagesAPI] Vector stored in Supabase for AiChatMessage: ${newMessage.id}`);
              }
            } catch (supaInsertError: unknown) {
                 console.error("[ChatMessagesAPI] Exception upserting vector for AiChatMessage:", newMessage.id, (supaInsertError as Error).message);
            }
          } else {
             console.warn(`[ChatMessagesAPI] Embedding not generated for AiChatMessage ${newMessage.id}, not storing in vector DB.`);
          }
        })
        .catch(embeddingError => {
            console.error("[ChatMessagesAPI] Error in getEmbedding promise chain for AiChatMessage:", (embeddingError as Error).message);
        });
    } else {
      console.warn("[ChatMessagesAPI] Supabase admin client not configured. AiChatMessage vector not stored.");
    }

    return NextResponse.json({ success: true, message: newMessage }, { status: 201 });

  } catch (error: unknown) {
    const e = error as Error;
    console.error('[API /ai/chat-messages POST] Error:', e.message);
    return NextResponse.json({ error: `Failed to save chat message: ${e.message}` }, { status: 500 });
  }
} 