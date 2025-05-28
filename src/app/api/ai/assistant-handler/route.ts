import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
import { prisma } from '@/server/db';
import OpenAI from 'openai';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

interface AiAssistantContext {
  current_intent?: 'ADD_CONTACT' | 'DRAFT_EMAIL' | 'GET_CONTACT_DETAILS_CLARIFY' | string; 
  name?: string;
  original_name_query?: string;
  options?: Array<{id: string, name: string, email?: string | null, status?: string}>;
  [key: string]: unknown;
}

interface AssistantRequestBody {
  userInput: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentIntentContext?: AiAssistantContext | null;
}

// This will be the structure we expect the LLM to (mostly) return in a parsable way
interface LLMStructuredResponse {
  action: 'FULFILL_INTENT' | 'REQUEST_INFO' | 'GENERAL_REPLY';
  intent?: 'ADD_CONTACT' | 'DRAFT_EMAIL' | 'GET_CONTACT_DETAILS' | null;
  data?: Record<string, unknown>; // Changed from any
  reply_to_user: string; // The text AI should say
  missing_entities?: string[];
  intent_context?: Record<string, unknown>; // Changed from any
}

const SYSTEM_PROMPT = `
You are a highly intelligent AI assistant for Kinso, a productivity application. Your goal is to understand user requests and help them manage contacts and draft communications. Be concise and helpful.

Available actions you can fulfill or gather information for:
1. ADD_CONTACT: 
   - Required information: contact name, and at least one of (email or phone number).
   - If only name is provided, ask for email or phone.
   - If name and some details are provided, confirm and proceed.
2. DRAFT_EMAIL:
   - Required information: recipient (name or email), subject (can be inferred), body (can be a hint).
   - If critical info like recipient is missing, ask for it.
   - If some info is present, confirm and ask for the rest.
3. GET_CONTACT_DETAILS:
   - Required information: contact name.
   - User might say: "show me details for jane doe", "who is john smith?", "lookup sarah connor".
   - If the name is ambiguous and multiple contacts are found, ask the user to clarify which one.

Interaction Flow:
- User provides an initial request.
- You determine the intent and extract entities.
- If all information for an intent is gathered: Respond with a confirmation and signal the action to be fulfilled using a JSON object with "action": "FULFILL_INTENT", "intent": "[INTENT_NAME]", "data": {extracted_entities}, and a "reply_to_user": "[Your confirmation message]".
- If information is missing: Ask a clear, natural follow-up question. Respond with a JSON object like: { "action": "REQUEST_INFO", "intent_context": {"current_intent": "[INTENT_NAME]", ...any_gathered_data}, "missing_entities": ["field1", "field2"], "reply_to_user": "[Your follow-up question]" }.
- If the user's query is not one of the supported actions or is ambiguous: Provide a helpful, conversational response as plain text (or use JSON with "action": "GENERAL_REPLY", "reply_to_user": "[Your conversational reply]").

Example FULFILL_INTENT for ADD_CONTACT:
{ "action": "FULFILL_INTENT", "intent": "ADD_CONTACT", "data": { "name": "Jane Smith", "email": "jane@example.com", "phone": "5551234" }, "reply_to_user": "Okay, I've added Jane Smith with email jane@example.com and phone 5551234." }

Example REQUEST_INFO for ADD_CONTACT:
{ "action": "REQUEST_INFO", "intent_context": {"current_intent": "ADD_CONTACT", "name": "Jane Smith"}, "missing_entities": ["email", "phone"], "reply_to_user": "Sure, I can add Jane Smith. What is her email or phone number?" }

Example FULFILL_INTENT for GET_CONTACT_DETAILS (when contact is found by backend):
{ "action": "FULFILL_INTENT", "intent": "GET_CONTACT_DETAILS", "data": { "name": "Jane Smith" }, "reply_to_user": "Looking up Jane Smith for you..." }

Example REQUEST_INFO for GET_CONTACT_DETAILS (if name is ambiguous and backend finds multiple):
{ "action": "REQUEST_INFO", "intent_context": {"current_intent": "GET_CONTACT_DETAILS", "original_name_query": "Jane"}, "missing_entities": ["clarification_of_contact"], "reply_to_user": "I found multiple contacts named Jane: Jane Doe and Jane Roe. Which one did you mean?" }

Strive to return responses in the specified JSON format when an action or information request is identified.
If you are just having a general conversation or cannot identify a clear action, your response can be plain text or use {"action": "GENERAL_REPLY", "reply_to_user": "..."}.
Focus on the current user request. Use conversation history for context if provided.
`;

export async function POST(request: NextRequest) {
  if (!openai) {
    return NextResponse.json({ error: 'OpenAI API key not configured. AI Assistant is unavailable.' }, { status: 503 });
  }

  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string };
    const userId = decoded.userId;
    if (!userId) return NextResponse.json({ error: 'User ID not found' }, { status: 401 });

    const body = await request.json() as AssistantRequestBody;
    const { userInput, conversationHistory = [], currentIntentContext } = body;

    console.log(`[ASSISTANT_HANDLER] User: ${userId}, Input: "${userInput}"`);
    if (currentIntentContext) {
      console.log("[ASSISTANT_HANDLER] Received context:", JSON.stringify(currentIntentContext));
    } else {
      console.log("[ASSISTANT_HANDLER] No incoming context received.");
    }

    if (!userInput) {
      return NextResponse.json({ error: 'No user input provided.' }, { status: 400 });
    }

    // --- START: Handle direct follow-up for GET_CONTACT_DETAILS_CLARIFY ---
    if (currentIntentContext && currentIntentContext.current_intent === 'GET_CONTACT_DETAILS_CLARIFY') {
      console.log("\n>>> ENTERING GET_CONTACT_DETAILS_CLARIFY BLOCK <<<");
      console.log("[ASSISTANT_HANDLER] Context For Clarify:", JSON.stringify(currentIntentContext));
      console.log("[ASSISTANT_HANDLER] User Clarification Input:", userInput);

      const originalQuery = currentIntentContext.original_name_query as string;
      const options = currentIntentContext.options as Array<{id: string, name: string, email?: string | null, status?: string}>;
      const userChoice = userInput.trim().toLowerCase();

      let chosenContactData: {id: string, name: string, email?: string | null, status?: string} | undefined;
      const choiceIndex = parseInt(userChoice) - 1;

      if (!isNaN(choiceIndex) && options && options[choiceIndex]) {
        chosenContactData = options[choiceIndex];
      } else if (options) {
        chosenContactData = options.find(opt => opt.name.toLowerCase() === userChoice);
      }
      console.log("[ASSISTANT_HANDLER] Clarification - Resolved choice:", chosenContactData);

      let chosenContactId: string | undefined;
      if (chosenContactData) {
        chosenContactId = chosenContactData.id;
      }

      if (chosenContactId) {
        const contact = await prisma.contact.findUnique({
          where: { id: chosenContactId, userId: userId, status: 'ACTIVE' },
          select: { fullName: true, email: true, phoneNumber: true, source: true, status: true, platformData: true /* any other needed fields */ }
        });

        if (contact) {
          // We have the specific contact. Now use LLM to answer the original question based on this contact's data.
          // The original question might be stored in currentIntentContext.original_user_query or inferred.
          // For simplicity, let's assume the original query that led to disambiguation was about getting general details.
          // Or, better, the LLM can be prompted to answer about specific field if original query mentioned it.
          
          const contextForLLMResponse = `User previously asked about '${currentIntentContext.original_name_query}'. They clarified they meant ${contact.fullName}. Here are the details for ${contact.fullName}: ${JSON.stringify(contact)}. Now, answer the user's likely original request for details about this contact, or if they asked for a specific piece of information (like phone or email) from ${contact.fullName}, provide that.`;
          
          const messagesForFinalAnswer: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: "system", content: "You are an AI assistant. Based on the provided contact data, answer the user's request concisely." },
            // Optionally include some prior conversation history if it helps frame the original request
            ...conversationHistory.slice(-2), // Last couple of turns
            { role: "user", content: `Okay, I meant ${contact.fullName}. What are their details?` }, // Simulated user input for this LLM call
            { role: "assistant", content: contextForLLMResponse } // Provide structured data as assistant turn
          ];

          const finalCompletion = await openai!.chat.completions.create({
            model: "gpt-3.5-turbo-0125",
            messages: messagesForFinalAnswer,
            temperature: 0.2,
          });
          const finalAnswer = finalCompletion.choices[0]?.message?.content?.trim() || "I found the contact, but had trouble formulating the details.";
          return NextResponse.json({ message: finalAnswer, details: null, followUpQuestion: undefined });
        } else {
          return NextResponse.json({ message: `Sorry, I couldn't retrieve active details for the selected contact.` });
        }
      } else {
        const optionList = options ? options.map((opt,i) => `${i+1}. ${opt.name} (${opt.status})`).join('\n') : 'No options found in context.';
        console.log("[ASSISTANT_HANDLER] Clarification - Choice not understood from options:", options);
        return NextResponse.json({ 
          message: `Sorry, I didn't understand your selection for "${originalQuery}". Options were:\n${optionList}\nPlease try again (e.g., type '1' or the name).`,
          details: currentIntentContext, // Send context back to retry clarification
          followUpQuestion: `Which contact named "${originalQuery}" did you mean?` // Re-iterate question
        });
      }
    } 
    // --- END: Handle direct follow-up ---

    console.log("[ASSISTANT_HANDLER] No direct context handled or fell through. Proceeding to LLM for general processing.");

    const initialMessagesForLLM: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...conversationHistory,
        { role: "user", content: userInput }
    ];

    console.log("[AI Assistant Handler] Sending to OpenAI with messages:", JSON.stringify(initialMessagesForLLM, null, 2));

    const initialCompletion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo-0125", 
        messages: initialMessagesForLLM,
        temperature: 0.3,
    });

    const llmResponseContent = initialCompletion.choices[0]?.message?.content?.trim();
    console.log("[AI Assistant Handler] Raw LLM Response:", llmResponseContent);

    if (!llmResponseContent) {
      throw new Error('LLM returned an empty response.');
    }

    let parsedLlmResponse: Partial<LLMStructuredResponse>;
    try {
      parsedLlmResponse = JSON.parse(llmResponseContent);
      if (!parsedLlmResponse.reply_to_user) {
          parsedLlmResponse.reply_to_user = llmResponseContent;
          if(!parsedLlmResponse.action) parsedLlmResponse.action = 'GENERAL_REPLY';
      }
    } catch (jsonParseError: unknown) {
      console.warn("[AI Assistant Handler] LLM response was not valid JSON. Error: ", (jsonParseError as Error).message);
      parsedLlmResponse = { action: 'GENERAL_REPLY', reply_to_user: llmResponseContent };
    }

    console.log("[AI Assistant Handler] Parsed LLM Response:", parsedLlmResponse);

    // --- FULFILL INTENT if signaled by LLM ---
    if (parsedLlmResponse.action === 'FULFILL_INTENT' && parsedLlmResponse.intent && parsedLlmResponse.data) {
      const intentData = parsedLlmResponse.data;
      switch (parsedLlmResponse.intent) {
        case 'ADD_CONTACT':
          try {
            if (!intentData.name) throw new Error('Name is missing for ADD_CONTACT intent.');
            const newContact = await prisma.contact.create({
              data: {
                userId: userId,
                fullName: intentData.name as string,
                email: intentData.email as string || undefined,
                phoneNumber: intentData.phone as string || undefined,
                source: 'ai_assistant'
              }
            });
            // Override reply_to_user with a more definitive success message from backend
            parsedLlmResponse.reply_to_user = `Contact "${newContact.fullName}" added successfully!`;
            // We could add contactId to details if frontend needs it: parsedLlmResponse.data.contactId = newContact.id;
          } catch (dbError: unknown) {
            console.error("[AI Assistant Handler] DB error creating contact:", dbError);
            parsedLlmResponse.reply_to_user = `Sorry, I tried to add the contact but there was a database error: ${(dbError as Error).message}`;
            // parsedLlmResponse.error = `DB error: ${(dbError as Error).message}`; // Add error field to response
          }
          break;
        case 'DRAFT_EMAIL':
          // The LLM itself might draft the email body based on the prompt.
          // For now, we just pass the structured data to the client as before.
          // Client will use mailto or its own compose UI.
          // The parsedLlmResponse.reply_to_user can be a confirmation like "Okay, I can set up that draft for you."
          break;
        case 'GET_CONTACT_DETAILS':
          try {
            const contactNameQuery = intentData.name as string;
            if (!contactNameQuery) throw new Error('Contact name is missing for GET_CONTACT_DETAILS intent.');

            console.log(`[AI Assistant] GET_CONTACT_DETAILS: Searching for "${contactNameQuery}" for user ${userId}`);

            // Step 1: Try to find ACTIVE contacts
            let foundContacts = await prisma.contact.findMany({
              where: {
                userId: userId,
                fullName: { contains: contactNameQuery, mode: 'insensitive' },
                status: 'ACTIVE'
              },
              take: 5,
              select: { id: true, fullName: true, email: true, phoneNumber: true, source: true, status: true, platformData: true }
            });
            let searchScope = "active";

            // Step 2: If no ACTIVE contacts found, try PENDING_MERGE_REVIEW (or other non-active but relevant statuses)
            if (foundContacts.length === 0) {
              console.log(`[AI Assistant] No ACTIVE contacts found for "${contactNameQuery}". Searching PENDING_MERGE_REVIEW.`);
              foundContacts = await prisma.contact.findMany({
                where: {
                  userId: userId,
                  fullName: { contains: contactNameQuery, mode: 'insensitive' },
                  status: 'PENDING_MERGE_REVIEW' // Or an array: status: { in: ['PENDING_MERGE_REVIEW', 'INACTIVE'] }
                },
                take: 5,
                select: { id: true, fullName: true, email: true, phoneNumber: true, source: true, status: true, platformData: true }
              });
              if (foundContacts.length > 0) searchScope = "pending review";
            }

            if (foundContacts.length === 0) {
              parsedLlmResponse.reply_to_user = `Sorry, I couldn't find any contacts (active or pending review) named "${contactNameQuery}".`;
            } else if (foundContacts.length === 1) {
              const contact = foundContacts[0];
              let detailsString = `Details for ${contact.fullName} (Status: ${contact.status}):\n`;
              if (contact.email) detailsString += `- Email: ${contact.email}\n`;
              if (contact.phoneNumber) detailsString += `- Phone: ${contact.phoneNumber}\n`;
              if (contact.source) detailsString += `- Source: ${contact.source}\n`;
              parsedLlmResponse.reply_to_user = detailsString.trim();
              if (contact.status !== 'ACTIVE') {
                parsedLlmResponse.reply_to_user += `\nThis contact is currently ${contact.status.toLowerCase().replace('_',' ')}.`;
                // Potentially add follow-up context to ask if user wants to activate/review it.
              }
            } else { // Multiple contacts found (from either ACTIVE or PENDING_MERGE_REVIEW search)
              const names = foundContacts.map((c, i) => `${i + 1}. ${c.fullName} (${c.status}, ${c.email || 'No email'})`).join('\n');
              parsedLlmResponse.action = 'REQUEST_INFO'; 
              parsedLlmResponse.reply_to_user = `I found a few contacts matching "${contactNameQuery}" (${searchScope}):\n${names}\nWhich one did you mean?`;
              parsedLlmResponse.intent_context = { 
                current_intent: 'GET_CONTACT_DETAILS_CLARIFY', 
                original_name_query: contactNameQuery,
                // Pass options with their status, so clarification can also check status
                options: foundContacts.map(c => ({id: c.id, name: c.fullName, email: c.email, status: c.status}))
              };
            }
          } catch (dbError: unknown) {
            console.error("[AI Assistant Handler] DB error getting contact details:", dbError);
            parsedLlmResponse.reply_to_user = `Sorry, I encountered an error trying to look up contact details: ${(dbError as Error).message}`;
          }
          break;
        default:
          console.warn(`[AI Assistant Handler] Unknown intent to fulfill: ${parsedLlmResponse.intent}`);
          parsedLlmResponse.reply_to_user = "I understood an action, but I'm not sure how to do that yet.";
      }
    }

    return NextResponse.json({
        message: parsedLlmResponse.reply_to_user || "I'm not sure how to respond to that.",
        details: parsedLlmResponse.intent_context || parsedLlmResponse.data,
        followUpQuestion: parsedLlmResponse.action === 'REQUEST_INFO' ? parsedLlmResponse.reply_to_user : undefined,
        actionToFulfill: parsedLlmResponse.action === 'FULFILL_INTENT' && parsedLlmResponse.intent === 'DRAFT_EMAIL' ? 
            { type: 'DRAFT_EMAIL', data: parsedLlmResponse.data || {} } : undefined,
    });

  } catch (error: unknown) {
    const e = error as Error;
    console.error('[AI Assistant Handler] Critical error:', e.message, e.stack);
    return NextResponse.json({ message: "Sorry, I encountered a critical error.", error: e.message }, { status: 500 });
  }
} 