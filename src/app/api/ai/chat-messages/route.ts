import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
import { prisma } from '@/server/db';
import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabaseClient'; // Import Supabase admin client

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

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

async function getEmbedding(text: string, userIdForErrorLog: string): Promise<number[] | null> {
  if (!openai) {
    console.warn('[ChatMessagesAPI] OpenAI client not configured. Embedding generation skipped.');
    return null;
  }
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small", // Consistent with Supabase table dimension (e.g., 1536 for this model)
      input: text.replace(/\n/g, ' '), 
      encoding_format: "float",
    });
    return response.data[0]?.embedding || null;
  } catch (error) {
    console.error(`[ChatMessagesAPI] Error getting OpenAI embedding for user ${userIdForErrorLog}:`, error);
    return null;
  }
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
    if (supabaseAdmin && openai) { // Check if both Supabase admin and OpenAI clients are configured
      getEmbedding(content, userId)
        .then(async (embedding) => {
          if (embedding) {
            try {
              const { error: vectorError } = await supabaseAdmin
                .from('chat_embeddings') // Your Supabase table name
                .insert({
                  message_id: newMessage.id, // Link to the AiChatMessage
                  user_id: userId,
                  embedding: embedding,
                  // created_at is default in Supabase table
                });
              if (vectorError) {
                console.error("[ChatMessagesAPI] Supabase vector insert error for message:", newMessage.id, vectorError);
              } else {
                console.log(`[ChatMessagesAPI] Vector stored in Supabase for message: ${newMessage.id}`);
              }
            } catch (supaInsertError) {
                 console.error("[ChatMessagesAPI] Exception upserting vector to Supabase for message:", newMessage.id, supaInsertError);
            }
          }
        })
        .catch(embeddingError => {
            // This catch is for errors from getEmbedding promise itself, though getEmbedding already logs
            console.error("[ChatMessagesAPI] Outer catch for getEmbedding promise failed:", embeddingError);
        });
    } else {
      if (!supabaseAdmin) console.warn("[ChatMessagesAPI] Supabase admin client not configured. Vector not stored.");
      if (!openai) console.warn("[ChatMessagesAPI] OpenAI client not configured. Vector not generated.");
    }

    return NextResponse.json({ success: true, message: newMessage }, { status: 201 });

  } catch (error: unknown) {
    const e = error as Error;
    console.error('[API /ai/chat-messages POST] Error:', e.message);
    return NextResponse.json({ error: `Failed to save chat message: ${e.message}` }, { status: 500 });
  }
} 