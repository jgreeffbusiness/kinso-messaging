import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export interface CleanedEmail {
  cleanedContent: string // This replaces the raw email content
  summary: string
  keyPoints: string[]
  actionItems: string[]
  sender: {
    name?: string
    email?: string
    company?: string
  }
  urgency: 'low' | 'medium' | 'high'
  category: 'meeting' | 'administrative' | 'commercial' | 'personal' | 'notification' | 'other'
  originalContent: string // Keep the original for reference
}

export async function processEmailContent(rawEmailContent: string): Promise<CleanedEmail> {
  try {
    const prompt = `
You are an expert email processor specialized in creating concise, actionable summaries. Process this email with intelligence based on its type.

Raw email content:
${rawEmailContent}

SPECIAL HANDLING RULES:
- Meeting invites/confirmations: Focus on date, time, location, participants
- Newsletters/marketing: Extract key announcements, ignore promotional fluff
- System notifications: Highlight the action needed or status change
- Receipts/invoices: Focus on amount, date, what was purchased
- Support/customer service: Extract the issue and next steps
- Personal emails: Preserve the conversational tone but summarize key points

Please respond with a JSON object containing:
1. cleanedContent: A clean, readable version that serves as the PRIMARY content the user will see. Make this concise but complete - this replaces the original messy email entirely.
2. summary: A single sentence that captures the essence (for ultra-quick scanning)
3. keyPoints: Array of 2-4 most important points (be selective, not comprehensive)
4. actionItems: Only items that require action from the recipient
5. sender: Object with name, email, and company if identifiable
6. urgency: Assess urgency level (low/medium/high)
7. category: Categorize as 'meeting', 'administrative', 'commercial', 'personal', 'notification', or 'other'
8. originalContent: Copy of the original raw content

QUALITY GUIDELINES:
- cleanedContent should be what busy executives want to read - clear, concise, actionable
- Remove ALL: legal disclaimers, tracking pixels, unsubscribe links, excessive signatures, privacy notices
- Keep essential contact info only if relevant to the message
- For routine emails (confirmations, receipts), be extremely concise
- Preserve urgency and important deadlines
`

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Use the more cost-effective model for this task
      messages: [
        {
          role: "system",
          content: "You are an expert email content processor. Always respond with valid JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1, // Low temperature for consistent results
      response_format: { type: "json_object" }
    })

    const result = completion.choices[0]?.message?.content
    if (!result) {
      throw new Error('No response from OpenAI')
    }

    return JSON.parse(result) as CleanedEmail
  } catch (error) {
    console.error('Error processing email with OpenAI:', error)
    
    // Fallback: basic cleaning
    return {
      cleanedContent: rawEmailContent, // Use original content as fallback
      summary: "Unable to process email content automatically.",
      keyPoints: ["Raw email content available"],
      actionItems: [],
      sender: {
        name: "Unknown",
        email: "Unknown"
      },
      urgency: "low",
      category: "other",
      originalContent: rawEmailContent
    }
  }
}

// Helper function to extract basic info without AI (fallback)
export function basicEmailExtraction(rawContent: string): Partial<CleanedEmail> {
  const lines = rawContent.split('\n').filter(line => line.trim())
  
  // Try to find the main content (skip headers and footers)
  const startIndex = lines.findIndex(line => 
    line.includes('Hi ') || line.includes('Hello ') || line.includes('Dear ')
  )
  
  const endIndex = lines.findIndex((line, index) => 
    index > startIndex && (
      line.includes('Regards') || 
      line.includes('Best') || 
      line.includes('Thank you') ||
      line.includes('Liability limited') ||
      line.includes('LEGAL NOTICE')
    )
  )
  
  const mainContent = lines
    .slice(startIndex >= 0 ? startIndex : 0, endIndex >= 0 ? endIndex : lines.length)
    .join(' ')
    .trim()
  
  return {
    summary: mainContent.length > 200 ? mainContent.substring(0, 200) + '...' : mainContent,
    keyPoints: [mainContent],
    actionItems: [],
    urgency: 'low',
    category: 'other'
  }
}

// Ensure this helper is exported
export function extractEmailContent(message: any): string { // Kept message as any for broad compatibility from Gmail API
  // If plain text part exists, use that
  const plainPart = findBodyPart(message.data?.payload, 'text/plain'); // Added optional chaining
  if (plainPart?.body?.data) { // Added optional chaining
    return Buffer.from(plainPart.body.data, 'base64').toString();
  }
  
  const htmlPart = findBodyPart(message.data?.payload, 'text/html'); // Added optional chaining
  if (htmlPart?.body?.data) { // Added optional chaining
    const htmlContent = Buffer.from(htmlPart.body.data, 'base64').toString();
    return stripHtmlTags(htmlContent);
  }
  
  return message.snippet || 'No content available'; // Fallback to snippet or generic message
}

// Ensure this helper is exported if used by extractEmailContent
export function findBodyPart(part: any, mimeType: string): any | null {
  if (!part) return null;
  if (part.mimeType === mimeType) {
    return part;
  }
  if (part.parts) {
    for (const subPart of part.parts) {
      const found = findBodyPart(subPart, mimeType);
      if (found) return found;
    }
  }
  return null;
}

// Ensure this helper is exported if used by extractEmailContent
export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
} 