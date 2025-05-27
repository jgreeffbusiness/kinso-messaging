import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { ThreadAnalysis } from '@/lib/thread-processor'; // For typing conversationContext
import { ActiveFocusItemType } from '@/providers/ActiveFocusProvider'; // For typing activeItem

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ChatHandlerRequestBody {
  userInput: string;
  conversationContext?: ThreadAnalysis | null; // Context of the currently viewed item
  activeItemType?: ActiveFocusItemType['type'];
  activeItemData?: any; // Could be EnhancedMessage or just { id: string }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ChatHandlerRequestBody;
    const { userInput, conversationContext, activeItemType, activeItemData } = body;

    if (!userInput) {
      return NextResponse.json({ error: 'User input is required' }, { status: 400 });
    }

    let systemMessage = "You are a helpful AI executive assistant. Be concise and actionable.";
    let prompt = userInput;

    // Enhance prompt if there's active context
    if (conversationContext) {
      systemMessage = `You are an AI executive assistant providing help related to a specific communication thread. Be concise, contextual, and actionable.`;
      
      const contactName = (activeItemData as any)?.contact?.fullName || (activeItemData as any)?.displayName || "the contact";
      const summary = conversationContext.summary || "this conversation";

      // Check if user input looks like a drafting command (could be more sophisticated)
      if (userInput.toLowerCase().startsWith('draft a reply') || 
          userInput.toLowerCase().startsWith('help me reply') || 
          userInput.toLowerCase().startsWith('respond to')) {
        
        prompt = 
`The user is viewing a conversation with ${contactName} summarized as: "${summary}".
They want help drafting a reply. Their instruction or key points for the reply are: "${userInput}".

Based on this, generate a suitable reply draft for the user to send to ${contactName}.
If their instruction is vague, ask for clarification on what they want to say.
Focus on being helpful and professional. The user can edit this draft before sending.

Drafted Reply:
`;
      } else {
        // General query about the selected context
        prompt = 
`Context: Conversation with ${contactName} (Summary: "${summary}").
User's question/task related to this context: "${userInput}".

Provide a concise and helpful answer or perform the task based on the user's input and the provided summary.`;
      }
    } else {
      // General query, no specific item selected
      systemMessage = "You are Kinso, a helpful AI executive assistant. Answer the user's general questions or perform general tasks.";
      prompt = userInput;
    }

    console.log(`[AI Chat Handler] System: ${systemMessage}`);
    console.log(`[AI Chat Handler] Prompt: ${prompt}`);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt }
      ],
      temperature: 0.7, // Allow for some creativity in chat
      max_tokens: 300,
    });

    const aiReply = completion.choices[0]?.message?.content?.trim() || "Sorry, I couldn't process that.";

    return NextResponse.json({ reply: aiReply });

  } catch (error) {
    console.error('[API /ai/chat-handler] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred.';
    return NextResponse.json({ error: `Failed to get AI chat response: ${errorMessage}` }, { status: 500 });
  }
} 