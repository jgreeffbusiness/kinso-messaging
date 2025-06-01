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
  action: 'FULFILL_INTENT' | 'REQUEST_INFO' | 'GENERAL_REPLY' | 'SEARCH_USER_DATA';
  intent?: 'ADD_CONTACT' | 'DRAFT_EMAIL' | 'GET_CONTACT_DETAILS' | 'SEARCH_USER_DATA' | null;
  data?: Record<string, unknown>; // Changed from any
  reply_to_user: string; // The text AI should say
  missing_entities?: string[];
  intent_context?: Record<string, unknown>; // Changed from any
}

const SYSTEM_PROMPT_INTENT_RECOGNITION = `
You are a highly intelligent AI assistant for Kinso. Your primary function is to understand user requests and respond in a specific JSON format. ALWAYS output a valid JSON object. Do NOT output plain text.

Available actions and their required JSON output structure:

1. ADD_CONTACT: 
   - Required information: contact name, and at least one of (email or phone number).
   - If only name is provided: { "action": "REQUEST_INFO", "intent_context": {"current_intent": "ADD_CONTACT", "name": "[extracted name]"}, "missing_entities": ["email", "phone"], "reply_to_user": "Sure, I can add [extracted name]. What is their email or phone number?" }
   - If name and details provided: { "action": "FULFILL_INTENT", "intent": "ADD_CONTACT", "data": { "name": "[name]", "email": "[email]", "phone": "[phone]" }, "reply_to_user": "Okay, I will add [name]..." } // Backend will confirm actual success.

2. DRAFT_EMAIL:
   - Required information: recipient, subject, body hint.
   - If info missing: { "action": "REQUEST_INFO", ... corresponding fields ..., "reply_to_user": "[Clarifying question for DRAFT_EMAIL]" }
   - If info present: { "action": "FULFILL_INTENT", "intent": "DRAFT_EMAIL", "data": { "recipient": "[recipient]", "subject": "[subject]", "bodyHint": "[bodyHint]" }, "reply_to_user": "I can help draft that email." }

3. GET_CONTACT_DETAILS:
   - Required information: contact name.
   - If name is clear and backend will fetch: { "action": "FULFILL_INTENT", "intent": "GET_CONTACT_DETAILS", "data": { "name": "[contact name]" }, "reply_to_user": "Looking up details for [contact name]..." }
   - If name is ambiguous (backend would find multiple): { "action": "REQUEST_INFO", "intent_context": {"current_intent": "GET_CONTACT_DETAILS", "original_name_query": "[ambiguous name]"}, "missing_entities": ["clarification_of_contact"], "reply_to_user": "I found multiple contacts named [ambiguous name]: [Option 1], [Option 2]. Which one?" }

4. SEARCH_USER_DATA:
   - Triggered for recall-based questions about past communications or stored information (emails, Slack, notes, chat history).
   - Examples:
     - "What did [person] say about [topic]?"
     - "Find the email regarding [subject]"
     - "what was that boat thing abby wanted to use for charter?"
     - "what was the yacht message about?"
   - Your job is to identify this intent and extract the essential \`search_query\` string.
   - THE ONLY VALID RESPONSE FORMAT FOR THIS INTENT IS:
     { "action": "FULFILL_INTENT", "intent": "SEARCH_USER_DATA", "data": { "search_query": "[extracted_search_query]" }, "reply_to_user": "Okay, I will search for information about '[extracted_search_query]'." } 
     // The 'reply_to_user' here is a confirmation that the search process is starting.

5. GENERAL_REPLY (Use as a last resort):
   - If the user's query is not one of the supported actions, is completely uninterpretable, or if you are explicitly asked for a conversational reply not fitting other intents.
   - JSON Format: { "action": "GENERAL_REPLY", "reply_to_user": "[Your helpful, conversational, non-JSON reply if no other action fits]" }

User Input: "what was that boat thing abby wanted to use for charter?"
Expected AI JSON Output:
{ "action": "FULFILL_INTENT", "intent": "SEARCH_USER_DATA", "data": { "search_query": "abby boat charter boat company" }, "reply_to_user": "Okay, I will search for information about 'abby boat charter boat company'." }

User Input: "what was the yacht message about?"
Expected AI JSON Output:
{ "action": "FULFILL_INTENT", "intent": "SEARCH_USER_DATA", "data": { "search_query": "yacht message" }, "reply_to_user": "Okay, I will search for information about 'yacht message'." }

Focus on the current user request. Use conversation history for context if provided. Output ONLY a single, valid JSON object based on these instructions. Do not add any explanatory text before or after the JSON object.
`;

const SYSTEM_PROMPT_QUERY_EXPANSION = `
Given the user's original request and an initial search topic, generate a JSON array of 2-3 alternative or expanded search queries that are semantically similar or explore related facets of the original request. These queries will be used to search a vector database of the user's personal messages (emails, chats) and notes. Focus on extracting key entities, concepts, and potential synonyms or related terms. Output ONLY the JSON array of strings, like ["query1", "query2", "query3"].
`;

const SYSTEM_PROMPT_ANSWER_SYNTHESIS = `You are a helpful AI assistant. Your task is to answer the user's question based *only* on the following excerpts from their data.

Instructions:
1. Carefully review the user's original question and all the provided "Relevant excerpts".
2. Identify the single MOST RELEVANT excerpt that directly answers the user's question. Pay close attention to source types (e.g., an "email" if the user asked about an email).
3. If a directly relevant excerpt is found:
    a. First, provide a concise, direct answer to the user's question based on that excerpt.
    b. Then, clearly state the source of your information. For an email, mention its subject and date (e.g., "This information is from the email titled '[Subject]' dated [Date]."). For other types, mention relevant metadata.
    c. Follow this with a slightly more detailed summary (1-3 sentences) of that *specific most relevant excerpt*, focusing on the aspects pertinent to the user's query.
4. If multiple excerpts seem equally and highly relevant, you can synthesize information but should still clearly indicate the primary sources used.
5. If no single excerpt directly and adequately answers the question, but some excerpts provide partial clues or related information, synthesize an answer if possible and explicitly state the limitations or that the information is indirect.
6. If the answer cannot be found in the provided excerpts, state clearly: "I couldn't find specific information about [topic of user's query] in the provided excerpts."
7. Do NOT make up information or answer from general knowledge. Stick to the provided excerpts.

Relevant excerpts:
{{CONTEXT_STRING}}

User's original question: {{USER_QUERY}}

Answer:`;

// Define SearchResultItem interface if not already available globally or imported
interface SearchResultItem { 
  id: string; 
  content: string; 
  source: string; 
  similarity: number; 
  metadata?: Record<string, unknown>; 
}

const MAX_SNIPPETS_FOR_FINAL_ANSWER = 5; // Consistent with semantic-search adjustment

// Constants for controlling snippet selection
// const MAX_PLATFORM_SNIPPETS_TO_CONSIDER = 4; // No longer directly used in this new logic
// const MAX_CHAT_HISTORY_SNIPPETS_TO_CONSIDER = 3; // No longer directly used
// MAX_SNIPPETS_FOR_FINAL_ANSWER is still 5 (defined earlier or imported)

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

    // --- 1. Initial Intent Recognition --- 
    const initialMessagesForLLM: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT_INTENT_RECOGNITION },
        ...conversationHistory,
        { role: "user", content: userInput }
    ];
    const intentCompletion = await openai!.chat.completions.create({
        model: "gpt-3.5-turbo-0125", 
        messages: initialMessagesForLLM,
        temperature: 0.1,
        response_format: { type: "json_object" }
    });
    const intentLlmResponseContent = intentCompletion.choices[0]?.message?.content?.trim();
    console.log("[AI Assistant Handler] Raw Intent LLM Response (should be JSON):", intentLlmResponseContent);

    let parsedIntentLlmResponse: Partial<LLMStructuredResponse>;
    try {
      parsedIntentLlmResponse = JSON.parse(intentLlmResponseContent || "{}");
      if (!parsedIntentLlmResponse.action || !parsedIntentLlmResponse.reply_to_user) {
          console.error("[AI Assistant Handler] LLM JSON missing required fields (action or reply_to_user). Response:", intentLlmResponseContent);
          // Fallback if JSON is technically valid but missing our required fields
          parsedIntentLlmResponse = { 
              action: 'GENERAL_REPLY', 
              reply_to_user: "Sorry, I had a bit of trouble understanding that. Could you try rephrasing?"
          };
      }
    } catch (jsonParseError: unknown) {
      // This catch block should ideally not be hit frequently if JSON mode works as expected.
      console.error("[AI Assistant Handler] LLM response was NOT valid JSON despite JSON mode. Error: ", (jsonParseError as Error).message, "Raw response:", intentLlmResponseContent);
      parsedIntentLlmResponse = { 
          action: 'GENERAL_REPLY', 
          reply_to_user: "I'm having trouble processing that request right now. Please try again in a moment."
      };
    }

    console.log("[AI Assistant Handler] Parsed Intent LLM Response:", parsedIntentLlmResponse);

    // --- Handle SEARCH_USER_DATA intent specifically with expansion and source-prioritized synthesis ---
    if (parsedIntentLlmResponse.action === 'FULFILL_INTENT' && parsedIntentLlmResponse.intent === 'SEARCH_USER_DATA') {
      const initialSearchQuery = parsedIntentLlmResponse.data?.search_query as string;
      if (!initialSearchQuery) {
        console.error("[AI Assistant Handler] SEARCH_USER_DATA intent recognized, but no search_query found.");
        return NextResponse.json({ message: "I was ready to search, but I couldn't figure out what for. Please try rephrasing." });
      }
      console.log(`[AI Assistant] Initial search query for SEARCH_USER_DATA: "${initialSearchQuery}"`);

      // --- 2. Query Expansion --- 
      let searchQueries: string[] = [initialSearchQuery || userInput]; // Fallback to userInput if initialSearchQuery is empty
      try {
        console.log(`[AI Assistant] Attempting query expansion for: "${initialSearchQuery}" (Original input: "${userInput}")`);
        const expansionPrompt = `${SYSTEM_PROMPT_QUERY_EXPANSION}\nUser's original request: "${userInput}"\nInitial search topic: "${initialSearchQuery}"\nExpanded search queries (JSON array of strings):`;
        const expansionCompletion = await openai!.chat.completions.create({
          model: "gpt-3.5-turbo-0125", 
          messages: [{role: "system", content: expansionPrompt}],
          temperature: 0.4,
          response_format: { type: "json_object" } 
        });
        const expansionResponseContent = expansionCompletion.choices[0]?.message?.content?.trim();
        console.log("[AI Assistant Handler] Raw Query Expansion LLM Response:", expansionResponseContent);
        if (expansionResponseContent) {
          const parsedExpansion = JSON.parse(expansionResponseContent);
          let expandedQueriesArray: string[] = [];
          if (Array.isArray(parsedExpansion)) {
              expandedQueriesArray = parsedExpansion.filter(q => typeof q === 'string');
          } else if (parsedExpansion && Array.isArray(parsedExpansion.queries)) {
              expandedQueriesArray = parsedExpansion.queries.filter((q: unknown) => typeof q === 'string');
          }
          if (expandedQueriesArray.length > 0) {
            searchQueries = [initialSearchQuery, ...expandedQueriesArray.slice(0, 2)]; 
            console.log("[AI Assistant] Expanded/Final search queries:", searchQueries);
          }
        }
      } catch (expansionError) {
        console.error("[AI Assistant Handler] Error during query expansion:", expansionError, "Falling back to initial query only.");
      }

      const platformSnippetsFound: SearchResultItem[] = [];
      const platformSnippetIds = new Set<string>();
      const searchApiUrlBase = new URL('/api/ai/semantic-search', request.url).origin;

      // --- 1. Fetch Platform Messages for all expanded queries ---
      console.log("[AI Assistant] Phase 1: Fetching Platform Messages.");
      for (const currentQuery of searchQueries) {
        console.log(`[AI Assistant] Semantic search (platform_messages) for query: "${currentQuery}"`);
        try {
          const searchServiceResponse = await fetch(`${searchApiUrlBase}/api/ai/semantic-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': request.headers.get('cookie') || '' },
            body: JSON.stringify({ query: currentQuery, sources: ['platform_messages'] })
          });
          if (searchServiceResponse.ok) {
            const searchResult = await searchServiceResponse.json();
            const snippets = searchResult.debug_retrieved_snippets as SearchResultItem[] || [];
            snippets.forEach(s => { if (s && s.id && !platformSnippetIds.has(s.id)) { platformSnippetsFound.push(s); platformSnippetIds.add(s.id); } });
          } else { console.error(`[AI Assistant] Semantic search (platform_messages) failed for "${currentQuery}" with status: ${searchServiceResponse.status}`); }
        } catch (e) { console.error(`[AI Assistant] Error fetching platform_messages for "${currentQuery}":`, e); }
      }
      platformSnippetsFound.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
      console.log(`[AI Assistant] Found ${platformSnippetsFound.length} unique platform_messages snippets.`);

      let finalSelectedSnippetsForContext: SearchResultItem[] = [];

      if (platformSnippetsFound.length > 0) {
        console.log("[AI Assistant] Prioritizing platform messages for context.");
        finalSelectedSnippetsForContext = platformSnippetsFound.slice(0, MAX_SNIPPETS_FOR_FINAL_ANSWER);
      } else {
        // --- 2. Fallback to AI Chat History if NO platform messages found ---
        console.log("[AI Assistant] No platform messages found. Phase 2: Fetching AI Chat History.");
        const aiChatSnippetsFound: SearchResultItem[] = [];
        const aiChatSnippetIds = new Set<string>();
        const chatHistoryQueriesToTry = searchQueries.slice(0, 1); // Use fewer queries for chat history
        for (const currentQuery of chatHistoryQueriesToTry) {
          console.log(`[AI Assistant] Semantic search (ai_chat_history) for query: "${currentQuery}"`);
          try {
            const searchServiceResponse = await fetch(`${searchApiUrlBase}/api/ai/semantic-search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Cookie': request.headers.get('cookie') || '' },
              body: JSON.stringify({ query: currentQuery, sources: ['ai_chat_history'] })
            });
            if (searchServiceResponse.ok) {
              const searchResult = await searchServiceResponse.json();
              const snippets = searchResult.debug_retrieved_snippets as SearchResultItem[] || [];
              snippets.forEach(s => { if (s && s.id && !aiChatSnippetIds.has(s.id)) { aiChatSnippetsFound.push(s); aiChatSnippetIds.add(s.id); } });
            }
          } catch (e) { console.error(`[AI Assistant] Error fetching ai_chat_history for "${currentQuery}":`, e); }
        }
        aiChatSnippetsFound.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        console.log(`[AI Assistant] Found ${aiChatSnippetsFound.length} unique ai_chat_history snippets.`);
        finalSelectedSnippetsForContext = aiChatSnippetsFound.slice(0, MAX_SNIPPETS_FOR_FINAL_ANSWER);
      }
      
      console.log(`[AI Assistant] Top ${finalSelectedSnippetsForContext.length} snippets selected for final answer synthesis:`, JSON.stringify(finalSelectedSnippetsForContext, null, 2));

      // --- 4. Synthesize Final Answer & Prepare Response --- 
      let synthesizedAnswer: string;
      if (finalSelectedSnippetsForContext.length === 0) {
        synthesizedAnswer = "I searched your data but couldn't find any specific information related to your query.";
      } else {
        let contextString = finalSelectedSnippetsForContext.map(snippet => {
          let snippetHeader = `Source: ${snippet.source} (Similarity: ${snippet.similarity?.toFixed(2) || 'N/A'})`;
          if (snippet.metadata?.role) snippetHeader += ` | Role: ${snippet.metadata.role}`;
          if (snippet.metadata?.platform) snippetHeader += ` | Platform: ${snippet.metadata.platform}`;
          if (snippet.metadata?.subject) snippetHeader += ` | Subject: ${snippet.metadata.subject}`;
          return `${snippetHeader}\nContent: ${snippet.content}`;
        }).join('\n---\n');
        
        if(finalSelectedSnippetsForContext.length === 0) contextString = "No specific relevant excerpts found after processing.";

        const finalSystemPrompt = SYSTEM_PROMPT_ANSWER_SYNTHESIS
                                    .replace("{{CONTEXT_STRING}}", contextString)
                                    .replace("{{USER_QUERY}}", userInput);
        
        console.log("[AI Assistant] System prompt for final answer synthesis:", finalSystemPrompt);

        const answerCompletion = await openai!.chat.completions.create({
          model: "gpt-3.5-turbo-0125", 
          messages: [{role: "system", content: finalSystemPrompt}],
          temperature: 0.5, 
        });
        synthesizedAnswer = answerCompletion.choices[0]?.message?.content?.trim() || "I found some information, but I'm having trouble summarizing it.";
      }
      parsedIntentLlmResponse.reply_to_user = synthesizedAnswer;

      // --- Prepare retrieved_sources for the client --- 
      const retrieved_sources_for_client = finalSelectedSnippetsForContext
        .filter(snippet => snippet.source === 'platform_messages')
        .slice(0, 2) // Take top 1 or 2 platform messages that contributed
        .map(snippet => ({
          id: snippet.id,
          source_type: snippet.source,
          platform: snippet.metadata?.platform as string || 'unknown',
          subject: snippet.metadata?.subject as string || 'No Subject',
          timestamp: snippet.metadata?.timestamp as string || 'N/A',
          preview: snippet.content // This is the content_chunk
        }));
      
      // Modify the final response structure to include the main message and retrieved_sources
      return NextResponse.json({
        message: parsedIntentLlmResponse.reply_to_user,
        details: parsedIntentLlmResponse.data, // Contains original search_query etc.
        retrieved_sources: retrieved_sources_for_client.length > 0 ? retrieved_sources_for_client : undefined
      });
    }

    // --- FULFILL OTHER INTENTS (ADD_CONTACT, DRAFT_EMAIL, GET_CONTACT_DETAILS) ---
    if (parsedIntentLlmResponse.action === 'FULFILL_INTENT' && parsedIntentLlmResponse.intent /* && parsedIntentLlmResponse.intent !== 'SEARCH_USER_DATA' is implicit here */) {
        // const intentData = parsedIntentLlmResponse.data; // Removed as it's likely unused if cases below use parsedIntentLlmResponse.data directly
        switch (parsedIntentLlmResponse.intent) {
            case 'ADD_CONTACT': 
              // Presuming existing logic uses parsedIntentLlmResponse.data.name, .email, .phone
              /* ... existing ADD_CONTACT fulfillment logic ... */ 
              break;
            case 'DRAFT_EMAIL': 
              /* ... existing DRAFT_EMAIL fulfillment logic ... */ 
              // This intent might primarily pass data to the client via the 'actionToFulfill' field in the main return.
              break;
            case 'GET_CONTACT_DETAILS': 
              /* ... existing GET_CONTACT_DETAILS fulfillment logic ... */ 
              break;
            default: 
              console.warn(`[AI Assistant Handler] Unknown FULFILL_INTENT type in final processing: ${parsedIntentLlmResponse.intent}`);
              // Ensure reply_to_user is appropriate for an unknown fulfillment
              if (!parsedIntentLlmResponse.reply_to_user) {
                  parsedIntentLlmResponse.reply_to_user = "I understood an action, but I'm not sure how to complete it.";
              }
        }
        // Construct response for these non-search FULFILL_INTENT actions
        return NextResponse.json({
          message: parsedIntentLlmResponse.reply_to_user,
          details: parsedIntentLlmResponse.data, 
          actionToFulfill: { type: parsedIntentLlmResponse.intent, data: parsedIntentLlmResponse.data || {} }
          // No retrieved_sources for these types of actions
        });
    }

    // --- Handle REQUEST_INFO or GENERAL_REPLY from initial intent LLM --- 
    // This is the fallback if not a FULFILL_INTENT action handled above
    return NextResponse.json({
        message: parsedIntentLlmResponse.reply_to_user || "I'm not sure how to respond to that.",
        details: parsedIntentLlmResponse.intent_context || parsedIntentLlmResponse.data, // Use intent_context if available for REQUEST_INFO
        followUpQuestion: parsedIntentLlmResponse.action === 'REQUEST_INFO' ? parsedIntentLlmResponse.reply_to_user : undefined
    });

  } catch (error: unknown) {
    const e = error as Error;
    console.error('[AI Assistant Handler] Critical error:', e.message, e.stack);
    return NextResponse.json({ message: "Sorry, I encountered a critical error.", error: e.message }, { status: 500 });
  }
} 