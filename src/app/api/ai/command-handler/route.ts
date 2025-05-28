import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify } from 'jsonwebtoken';
import { prisma } from '@/server/db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

interface CommandResponse {
  message: string;
  details?: Record<string, unknown>;
  error?: string;
  followUpQuestion?: string; // For dialog management later
  actionToFulfill?: { // For actions like drafting an email
    type: string; 
    data: Record<string, unknown>;
  }
}

interface ParsedContactDetails {
  name?: string;
  email?: string;
  phone?: string;
  hasMinimalInfo?: boolean; // True if at least email or phone is present with name
}

interface AiContextFromClient {
  intentContext?: string;
  contactName?: string;
  [key: string]: unknown;
}

interface CommandRequestBodyWithContext {
  command: string;
  context?: AiContextFromClient | null;
}

function parseAddContactCommand(command: string): ParsedContactDetails | null {
  const commandLower = command.toLowerCase();
  // More flexible regex to capture intent and name primarily
  const addIntentMatch = commandLower.match(/(?:add|create)\s+contact\s+(.+?)(?:\s+with email|\s+with phone|\s+email|\s+phone|\s+whose email|\s+whose phone|$)/i);
  
  if (!addIntentMatch || !addIntentMatch[1]) {
    // Try a simpler match if the user just says "add/create contact" then provides details later
    if (commandLower.startsWith('add contact') || commandLower.startsWith('create contact')){
        // Could be an initial command just stating intent without a name yet.
        // For now, we require a name in the first go for this parser.
        // A more advanced dialog manager would handle "Add contact" -> "Okay, what's their name?"
    }
    return null;
  }

  let name = addIntentMatch[1].trim();
  let email: string | undefined;
  let phone: string | undefined;

  // Attempt to extract email and phone from the rest of the command or the original command
  const emailRegex = /email\s+([\w\.-]+@[\w\.-]+\.\w+)/i;
  const phoneRegex = /phone(?:\s+number)?\s+([\d\s\-\(\)]+)/i;

  const emailMatch = command.match(emailRegex);
  if (emailMatch && emailMatch[1]) {
    email = emailMatch[1].trim();
    // Remove email part from name if it was captured by the broader name regex
    name = name.replace(emailRegex, '').replace(/email/i, '').trim();
  }

  const phoneMatch = command.match(phoneRegex);
  if (phoneMatch && phoneMatch[1]) {
    phone = phoneMatch[1].replace(/\D/g, '');
    name = name.replace(phoneRegex, '').replace(/phone(?: number)?/i, '').trim();
  }
  
  // Clean up name further if it ended with linking words like 'and' or 'with'
  name = name.replace(/\s+(and|with)$/i, '').trim();

  if (!name && (email || phone)) { // If name got stripped entirely but we have details, try to find name another way or mark as incomplete
    // This case needs more thought: if name is empty after stripping, what to do?
    // For now, if initial addIntentMatch had a name, we assume it's valid even after stripping parts.
    // If name becomes empty here, it implies the *entire* initial name capture was part of email/phone phrase.
  }
  if (!name && !(email || phone)) return null; // Truly nothing captured
  if (!name && (email || phone)) name = "Unknown Contact"; // Fallback if only details are there, but usually name is primary from addIntentMatch

  const hasMinimalInfo = !!(email || phone);
  // If name is still empty here something is wrong with initial name capture or stripping logic
  // It should have been caught by !addIntentMatch or if name became empty and no details.
  // For robust parsing, if addIntentMatch[1] was valid, name should remain valid unless it *only* contained email/phone phrases.
  return { name: name || undefined, email, phone, hasMinimalInfo }; // Ensure name is not empty string if it was truthy before
}

function parseContactDetailsFromReply(command: string): { email?: string; phone?: string } {
  let email: string | undefined;
  let phone: string | undefined;

  const emailMatch = command.match(/email\s+([\w\.-]+@[\w\.-]+\.\w+)/i) || command.match(/([\w\.-]+@[\w\.-]+\.\w+)/i); // More general email match
  if (emailMatch && emailMatch[1]) {
    email = emailMatch[1].trim();
  }

  const phoneMatch = command.match(/phone(?:\s+number)?\s+([\d\s\-\(\)]+)/i) || command.match(/([\d\s\-\(\)]+)/i); // More general phone match
  if (phoneMatch && phoneMatch[1]) {
    phone = phoneMatch[1].replace(/\D/g, '');
  }
  return { email, phone };
}

export async function POST(request: NextRequest): Promise<NextResponse<CommandResponse>> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Unauthorized' } as CommandResponse, { status: 401 });
    
    const decoded = verify(sessionCookie, JWT_SECRET) as { userId: string };
    const userId = decoded.userId;
    if (!userId) return NextResponse.json({ error: 'User ID not found' } as CommandResponse, { status: 401 });

    const body = await request.json() as CommandRequestBodyWithContext;
    const { command, context: incomingContext } = body;
    if (!command || typeof command !== 'string') {
      return NextResponse.json({ error: 'Invalid command provided' } as CommandResponse, { status: 400 });
    }

    console.log(`[AI Command Handler] Cmd: "${command}", Context:`, incomingContext);

    // --- Handle Follow-up for ADD_CONTACT --- 
    if (incomingContext && incomingContext.intentContext === 'ADD_CONTACT' && incomingContext.contactName) {
      const nameFromContext = incomingContext.contactName as string;
      console.log(`[AI Command Handler] Follow-up for ADD_CONTACT, name: ${nameFromContext}`);
      const additionalDetails = parseContactDetailsFromReply(command);
      
      if (!additionalDetails.email && !additionalDetails.phone) {
        return NextResponse.json({
          message: `Okay, I have the name ${nameFromContext}. I still need an email or phone number. Can you provide one?`,
          followUpQuestion: 'ASK_CONTACT_DETAILS', // Still asking
          details: incomingContext // Pass context back again
        });
      }

      try {
        const newContact = await prisma.contact.create({
          data: {
            userId: userId,
            fullName: nameFromContext,
            email: additionalDetails.email,
            phoneNumber: additionalDetails.phone,
            source: 'voice_assistant'
          }
        });
        return NextResponse.json({
          message: `Got it! Contact "${newContact.fullName}" added with the details provided.`, 
          details: { contactId: newContact.id }
        });
      } catch (dbError: unknown) {
        console.error("[AI Command Handler] DB error creating contact:", dbError);
        return NextResponse.json({ error: `Failed to add contact: ${(dbError as Error).message}` } as CommandResponse, { status: 500 });
      }
    }

    // --- Initial Intent: Add Contact ---
    const initialContactDetails = parseAddContactCommand(command);
    if (initialContactDetails && initialContactDetails.name) {
      if (!initialContactDetails.hasMinimalInfo && !initialContactDetails.email && !initialContactDetails.phone) {
        return NextResponse.json({
          message: `Okay, I can add ${initialContactDetails.name}. What is their email or phone number?`,
          followUpQuestion: 'ASK_CONTACT_DETAILS', 
          details: { intentContext: 'ADD_CONTACT', contactName: initialContactDetails.name }
        });
      } else {
        try {
          const newContact = await prisma.contact.create({
            data: {
              userId: userId,
              fullName: initialContactDetails.name,
              email: initialContactDetails.email,
              phoneNumber: initialContactDetails.phone,
              source: 'voice_assistant' 
            }
          });
          return NextResponse.json({
            message: `Contact "${newContact.fullName}" added successfully.`, 
            details: { contactId: newContact.id, ...initialContactDetails }
          });
        } catch (dbError: unknown) {
          console.error("[AI Command Handler] DB error creating contact:", dbError);
          return NextResponse.json({ error: `Failed to add contact: ${(dbError as Error).message}` } as CommandResponse, { status: 500 });
        }
      }
    }

    // --- Intent: Send Email (Draft) ---
    const sendEmailMatch = command.toLowerCase().match(/send (?:an )?email to ([\w\s\.-]+@?[\w\.-]*)(?: asking| saying| regarding| about| that)?\s*(.*)/i);
    if (sendEmailMatch) {
        const recipientNameOrEmail = sendEmailMatch[1].trim();
        const emailPrompt = sendEmailMatch[2]?.trim() || 'Regarding our discussion.';
        console.log(`[AI Command Handler] Intent: Send Email. To: ${recipientNameOrEmail}, Prompt: ${emailPrompt}`);
        // In a real scenario, you might look up recipientNameOrEmail in contacts to get their actual email.
        return NextResponse.json({
            message: "Okay, I can help draft that.",
            actionToFulfill: {
                type: "DRAFT_EMAIL",
                data: {
                    recipient: recipientNameOrEmail, // Frontend would resolve this to an email
                    subject: emailPrompt.substring(0,50) + (emailPrompt.length > 50 ? "..." : ""), // Simple subject from prompt
                    bodyHint: emailPrompt
                }
            }
        });
    }

    // Default: Command not understood
    return NextResponse.json({
      message: "Sorry, I didn't understand that. You can say things like 'add contact John Doe phone 5551234' or 'send email to Jane about dinner'",
    });

  } catch (error: unknown) {
    const e = error as Error;
    console.error('[AI Command Handler] Critical error:', e.message);
    return NextResponse.json({ error: `Command processing failed: ${e.message}` } as CommandResponse, { status: 500 });
  }
  // Fallback return to satisfy all paths, though critical error should have returned
  return NextResponse.json({ error: 'Unexpected error in command handler' } as CommandResponse, { status: 500 });
} 