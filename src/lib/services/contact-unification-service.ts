import { prisma } from '@/server/db'
import { PlatformContact } from '@/lib/platforms/types'
import { shouldFilterContact, detectBot } from '@/lib/utils/bot-detection'
import { Prisma } from '@prisma/client'

// Export this interface
export interface ContactMatchScore {
  contactId: string
  score: number
  matchReasons: string[]
  // Add other fields that might be useful for the frontend, like fullName, email, avatar of the matched contact
  fullName?: string
  email?: string
  avatar?: string
  existingPlatformSources?: string[] // e.g., ['google', 'slack']
  isDefinitiveLink?: boolean
}

interface UnifiedContact {
  id: string
  fullName: string
  email?: string
  platformIdentities: {
    platform: string
    platformContactId: string
    handle?: string
    email?: string
    name?: string
    metadata?: Record<string, unknown>
  }[]
}

export class ContactUnificationService {
  
  /**
   * Main function: Takes a platform contact and finds or creates a unified contact
   * Filters out bots and automated accounts
   */
  async unifyContact(
    platformContact: PlatformContact, 
    platform: string, 
    userId: string
  ): Promise<string> {
    
    // First, check if this is a bot/automated account
    if (shouldFilterContact(platformContact)) {
      const detection = detectBot(platformContact)
      console.log(`Rejecting bot contact from ${platform}:`, platformContact.name, detection.reasons)
      throw new Error(`Contact rejected: ${detection.reasons.join(', ')}`)
    }
    
    // Step 1: Try to find existing matches
    const matches = await this.findContactMatches(platformContact, userId)
    
    if (matches.length > 0) {
      // Use the best match
      const bestMatch = matches[0]
      await this.addPlatformIdentity(bestMatch.contactId, platformContact, platform)
      return bestMatch.contactId
    }
    
    // Step 2: No matches found, create new unified contact
    return await this.createUnifiedContact(platformContact, platform, userId)
  }

  /**
   * Find potential contact matches using multiple strategies
   */
  public async findContactMatches(
    platformContact: PlatformContact, 
    userId: string
  ): Promise<ContactMatchScore[]> {
    console.log(`[ContactUnificationService] Finding matches for user ${userId}, contact: ${platformContact.name}, email: ${platformContact.email}, handle: ${platformContact.handle}, source platform ID: ${platformContact.id}`);
    const matches: ContactMatchScore[] = []
    const currentPlatformSource = formatPlatformName(String(platformContact.platformSpecific?.source || '')).toLowerCase(); // e.g., 'google', 'slack'

    // Strategy 0: Check for definitive existing link (same platform-specific ID for the same source platform)
    try {
        const existingContactsWithThisPlatformId = await prisma.contact.findMany({
            where: {
                userId,
                platformData: {
                    path: [currentPlatformSource, 'platformContactId'], // Check json path: platformData.google.platformContactId
                    equals: platformContact.id
                }
            }
        });
        if (existingContactsWithThisPlatformId.length > 0) {
            const definitiveMatch = existingContactsWithThisPlatformId[0];
            console.log(` -> Strategy 0: Definitive link found! New contact ID ${platformContact.id} (source: ${currentPlatformSource}) matches existing Unified Contact ${definitiveMatch.id}`);
            matches.push({
                contactId: definitiveMatch.id,
                score: 101, // Super high score for definitive link
                matchReasons: ['definitive_platform_id_match'],
                fullName: definitiveMatch.fullName,
                email: definitiveMatch.email || undefined,
                avatar: definitiveMatch.photoUrl || undefined,
                existingPlatformSources: this.getExistingPlatformSources(definitiveMatch.platformData),
                isDefinitiveLink: true
            });
            // If a definitive link is found, we can often stop here for this specific use case.
            // However, findContactMatches might be used by other UIs that want all possibilities.
            // For auto-sync, if this match is found, the decision is usually clear.
        }
    } catch (e: unknown) { console.error("Error in definitive link strategy:", (e as Error).message); }

    try {
      if (platformContact.email) {
        console.log(` -> Strategy 1: Email exact match for ${platformContact.email}`);
        const emailMatches = await prisma.contact.findMany({
          where: {
            userId,
            email: platformContact.email
          }
        })
        console.log(`    Found ${emailMatches.length} email exact matches.`);
        emailMatches.forEach(contact => {
          if (!matches.find(m => m.contactId === contact.id && m.isDefinitiveLink)) {
            matches.push({
              contactId: contact.id,
              score: 100,
              matchReasons: ['email_exact_match'],
              fullName: contact.fullName,
              email: contact.email || undefined,
              avatar: contact.photoUrl || undefined,
              existingPlatformSources: this.getExistingPlatformSources(contact.platformData)
            })
          }
        })
      }
    } catch (e: unknown) { console.error("Error in email exact match strategy:", (e as Error).message); }

    try {
      if (platformContact.email && platformContact.name) {
        const emailDomain = platformContact.email.split('@')[1]
        console.log(` -> Strategy 2: Name similarity + email domain match for ${platformContact.name} / ${emailDomain}`);
        const nameMatches = await this.findNameSimilarityMatches(
          platformContact.name, 
          emailDomain, 
          userId
        )
        console.log(`    Found ${nameMatches.length} name/domain matches.`);
        nameMatches.forEach(contact => {
          if (!matches.find(m => m.contactId === contact.id && m.isDefinitiveLink)) {
            matches.push({
              contactId: contact.id,
              score: 75,
              matchReasons: ['name_similarity', 'email_domain_match'],
              fullName: contact.fullName,
              email: contact.email || undefined,
              avatar: contact.photoUrl || undefined,
              existingPlatformSources: this.getExistingPlatformSources(contact.platformData)
            })
          }
        })
      }
    } catch (e: unknown) { console.error("Error in name/domain match strategy:", (e as Error).message); }

    try {
      if (platformContact.handle) {
        console.log(` -> Strategy 3: Handle match for ${platformContact.handle}`);
        const handleMatches = await this.findHandleMatches(platformContact.handle, userId)
        console.log(`    Found ${handleMatches.length} handle matches.`);
        handleMatches.forEach(match => {
          if (!matches.find(m => m.contactId === match.id && m.isDefinitiveLink)) {
            matches.push({
              contactId: match.id,
              score: 60,
              matchReasons: ['handle_match'],
              fullName: match.fullName,
              email: match.email || undefined,
              avatar: match.photoUrl || undefined,
              existingPlatformSources: this.getExistingPlatformSources(match.platformData)
            })
          }
        })
      }
    } catch (e: unknown) { console.error("Error in handle match strategy:", (e as Error).message); }

    try {
      if (platformContact.name) {
        console.log(` -> Strategy 4: Name-only fuzzy match for ${platformContact.name}`);
        const fuzzyMatches = await this.findFuzzyNameMatches(platformContact.name, userId)
        console.log(`    Found ${fuzzyMatches.length} fuzzy name matches.`);
        fuzzyMatches.forEach(match => {
          if (!matches.find(m => m.contactId === match.id && m.isDefinitiveLink)) {
            matches.push({
              contactId: match.id,
              score: 40,
              matchReasons: ['name_fuzzy_match'],
              fullName: match.fullName,
              email: match.email || undefined,
              avatar: match.photoUrl || undefined,
              existingPlatformSources: this.getExistingPlatformSources(match.platformData)
            })
          }
        })
      }
    } catch (e: unknown) { console.error("Error in fuzzy name match strategy:", (e as Error).message); }

    const sortedMatches = this.deduplicateAndSort(matches)
    console.log(`[ContactUnificationService] Total unique matches found and sorted: ${sortedMatches.length}`);
    return sortedMatches
  }

  /**
   * Find contacts with similar names and matching email domains
   */
  private async findNameSimilarityMatches(
    name: string, 
    emailDomain: string, 
    userId: string
  ) {
    console.log(`  [findNameSimilarityMatches] Name: ${name}, Domain: ${emailDomain}`);
    // Split name into parts for flexible matching
    const nameParts = name.toLowerCase().split(' ').filter(part => part.length > 1)
    
    const contacts = await prisma.contact.findMany({
      where: {
        userId,
        email: {
          contains: emailDomain
        }
      }
    })

    return contacts.filter(contact => {
      const contactNameParts = contact.fullName.toLowerCase().split(' ')
      
      // Check if at least 2 name parts match
      const matchingParts = nameParts.filter(part => 
        contactNameParts.some(contactPart => 
          contactPart.includes(part) || part.includes(contactPart)
        )
      )
      
      return matchingParts.length >= Math.min(2, nameParts.length)
    })
  }

  /**
   * Find contacts with matching handles across platforms
   */
  private async findHandleMatches(handle: string, userId: string) {
    console.log(`  [findHandleMatches] Handle: ${handle}`);
    const contacts = await prisma.contact.findMany({
      where: {
        userId,
        OR: [
          { email: { contains: handle } },
          { fullName: { contains: handle, mode: 'insensitive' } }
        ]
      }
    })
    
    return contacts
  }

  /**
   * Fuzzy name matching using simple similarity
   */
  private async findFuzzyNameMatches(name: string, userId: string) {
    console.log(`  [findFuzzyNameMatches] Name: ${name}`);
    const contacts = await prisma.contact.findMany({
      where: { userId }
    })

    return contacts.filter(contact => {
      const similarity = this.calculateNameSimilarity(name, contact.fullName)
      return similarity > 0.7 // 70% similarity threshold
    })
  }

  /**
   * Simple name similarity calculation
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    const s1 = name1.toLowerCase().trim()
    const s2 = name2.toLowerCase().trim()
    
    if (s1 === s2) return 1.0
    
    // Check if one name contains the other
    if (s1.includes(s2) || s2.includes(s1)) return 0.8
    
    // Simple word overlap calculation
    const words1 = s1.split(' ').filter(w => w.length > 1)
    const words2 = s2.split(' ').filter(w => w.length > 1)
    
    const commonWords = words1.filter(word => 
      words2.some(w => w.includes(word) || word.includes(w))
    )
    
    return commonWords.length / Math.max(words1.length, words2.length)
  }

  /**
   * Remove duplicates and sort by score
   */
  private deduplicateAndSort(matches: ContactMatchScore[]): ContactMatchScore[] {
    const uniqueMatches = new Map<string, ContactMatchScore>()
    
    matches.forEach(match => {
      const existing = uniqueMatches.get(match.contactId)
      if (!existing || match.score > existing.score) {
        uniqueMatches.set(match.contactId, match)
      }
    })
    
    return Array.from(uniqueMatches.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 5) // Top 5 matches only
  }

  /**
   * Create a new unified contact
   */
  public async createUnifiedContact(
    platformContact: PlatformContact,
    platform: string,
    userId: string,
    initialStatus: string = "ACTIVE"
  ): Promise<string> {
    const cleanedMetadata = platformContact.platformSpecific 
      ? Object.fromEntries(
          Object.entries(platformContact.platformSpecific).filter(([_key, value]) => value !== undefined)
        )
      : {};
    const platformData = {
      [platform]: {
        platformContactId: platformContact.id,
        handle: platformContact.handle || null,
        email: platformContact.email || null,
        name: platformContact.name,
        metadata: cleanedMetadata,
        addedAt: new Date().toISOString()
      }
    };
    const contact = await prisma.contact.create({
      data: {
        userId,
        fullName: platformContact.name,
        email: platformContact.email,
        photoUrl: platformContact.avatar,
        platformData: platformData as Prisma.InputJsonValue,
        status: initialStatus,
        source: platform
      }
    });
    console.log(`Created new unified contact ${contact.id} (Status: ${initialStatus}) for ${platform} contact ${platformContact.id}`);
    return contact.id;
  }

  /**
   * Add platform identity to existing unified contact
   */
  public async addPlatformIdentity(
    contactId: string,
    platformContact: PlatformContact,
    platform: string
  ): Promise<void> {
    const contact = await prisma.contact.findUnique({ where: { id: contactId }});
    if (!contact) return;
    
    const existingPlatformData = (contact.platformData as Record<string, unknown>) || {};
    const cleanedMetadata = platformContact.platformSpecific 
      ? Object.fromEntries(Object.entries(platformContact.platformSpecific).filter(([_key, value]) => value !== undefined))
      : {};
    existingPlatformData[platform] = {
      platformContactId: platformContact.id,
      handle: platformContact.handle || null,
      email: platformContact.email || null,
      name: platformContact.name,
      metadata: cleanedMetadata,
      addedAt: new Date().toISOString()
    };
    const updates: Prisma.ContactUpdateInput = { platformData: existingPlatformData as Prisma.InputJsonValue };
    if (!contact.email && platformContact.email) updates.email = platformContact.email;
    if (!contact.photoUrl && platformContact.avatar) updates.photoUrl = platformContact.avatar;
    if (contact.status !== 'ACTIVE') {
        updates.status = 'ACTIVE';
    }
    await prisma.contact.update({ where: { id: contactId }, data: updates });
    console.log(`Added ${platform} identity to unified contact ${contactId}. Status ensured ACTIVE.`);
  }

  /**
   * Get unified contact with all platform identities
   */
  async getUnifiedContact(contactId: string): Promise<UnifiedContact | null> {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId }
    })
    
    if (!contact) return null
    
    const platformData = (contact.platformData as Record<string, unknown>) || {}
    const platformIdentities = Object.entries(platformData).map(([platform, data]) => ({
      platform,
      ...(data as Record<string, unknown>)
    }))
    
    return {
      id: contact.id,
      fullName: contact.fullName,
      email: contact.email || undefined,
      platformIdentities: platformIdentities as UnifiedContact['platformIdentities']
    }
  }

  /**
   * Find platform-specific contact ID for a unified contact
   */
  async getPlatformContactId(
    unifiedContactId: string, 
    platform: string
  ): Promise<string | null> {
    
    const contact = await prisma.contact.findUnique({
      where: { id: unifiedContactId }
    })
    
    if (!contact) return null
    
    const platformData = (contact.platformData as Record<string, unknown>) || {}
    const platformInfo = platformData[platform] as { platformContactId?: string } | undefined
    
    return platformInfo?.platformContactId || null
  }

  // Alias for clarity if preferred by the API route, or API route can call findContactMatches directly
  public async findContactMatchesPublic(
    platformContact: PlatformContact, 
    userId: string
  ): Promise<ContactMatchScore[]> {
    return this.findContactMatches(platformContact, userId);
  }

  // Helper to extract platform IDs from existing contact's platformData
  private getExistingPlatformSources(platformData: Prisma.JsonValue | null | undefined): string[] {
    // Check if platformData is an object and not null/array before trying to get keys
    if (typeof platformData === 'object' && platformData !== null && !Array.isArray(platformData)) {
      return Object.keys(platformData);
    }
    return [];
  }

  public async autoProcessPlatformContact(
    platformContact: PlatformContact,
    platformKey: string, 
    userId: string,
    autoMergeThreshold: number = 90,
    autoCreateThreshold: number = 40
  ): Promise<{ action: string; unifiedContactId?: string; pendingApprovalId?: string; details?: string }> {
    
    const matches = await this.findContactMatches(platformContact, userId);
    let bestMatch: ContactMatchScore | null = null;
    if (matches.length > 0) {
      const definitiveLinks = matches.filter(m => m.isDefinitiveLink);
      if (definitiveLinks.length > 0) {
        bestMatch = definitiveLinks[0];
      } else {
        bestMatch = matches.reduce((best, current) => (current.score > best.score ? current : best), matches[0]);
      }
    }

    if (bestMatch && bestMatch.isDefinitiveLink) {
      console.log(`[AutoProcess] Contact ${platformContact.name} (${platformContact.id} from ${platformKey}) definitively linked to Unified Contact ${bestMatch.contactId}.`);
      return { action: 'definitive_link_exists', unifiedContactId: bestMatch.contactId, details: `Already linked to ${bestMatch.fullName}` };
    }

    if (bestMatch && bestMatch.score >= autoMergeThreshold) {
      console.log(`[AutoProcess] Auto-merging ${platformContact.name} from ${platformKey} with existing Unified Contact ${bestMatch.contactId} (Name: ${bestMatch.fullName}, Score: ${bestMatch.score})`);
      await this.addPlatformIdentity(bestMatch.contactId!, platformContact, platformKey);
      return { action: 'auto_merged', unifiedContactId: bestMatch.contactId, details: `Merged with ${bestMatch.fullName}` };
    }
    
    if (!bestMatch || bestMatch.score < autoCreateThreshold) {
      console.log(`[AutoProcess] No strong match for ${platformContact.name} from ${platformKey}. Creating new. (Best score: ${bestMatch?.score || 'N/A'})`);
      const newUnifiedContactId = await this.createUnifiedContact(platformContact, platformKey, userId, 'ACTIVE');
      return { action: 'auto_created_new', unifiedContactId: newUnifiedContactId, details: `Created new contact` };
    }
    
    // Ambiguous Match: Create new contact with PENDING_MERGE_REVIEW status, then flag for duplicate review
    console.log(`[AutoProcess] Ambiguous match for ${platformContact.name} from ${platformKey} (Match: ${bestMatch.fullName}, Score: ${bestMatch.score}). Creating new with PENDING_MERGE_REVIEW status.`);
    const newUnifiedContactIdForReview = await this.createUnifiedContact(platformContact, platformKey, userId, 'PENDING_MERGE_REVIEW');
    
    try {
      // Populate fields for PendingContactApproval based on an ambiguous merge scenario
      const approvalData = {
        userId,
        platform: platformKey, // Platform of the newly fetched contact
        senderName: platformContact.name, // Name of the newly fetched contact
        senderEmail: platformContact.email || null,
        senderHandle: platformContact.handle || null,
        messageCount: 0, // Not from a message directly, but represents a contact profile
        firstMessageDate: new Date(), // Or creation date of platformContact if available
        lastMessageDate: new Date(),
        previewContent: `Potential duplicate. New: '${platformContact.name}' from ${platformKey}. Existing: '${bestMatch.fullName}'. Score: ${bestMatch.score}.`,
        approvalType: "MERGE_REVIEW", // New type to distinguish from NEW_SENDER
        potentialMatchToContactId: bestMatch.contactId!, // ID of the existing contact it matched
        matchReason: bestMatch.matchReasons.join(','),
        matchScore: bestMatch.score
      };

      const pendingApproval = await prisma.pendingContactApproval.create({
        data: approvalData
      });
      return { 
        action: 'submitted_for_merge_review', 
        unifiedContactId: newUnifiedContactIdForReview, // ID of the *new* contact that is pending merge/approval
        pendingApprovalId: pendingApproval.id,
        details: `New contact created (ID: ${newUnifiedContactIdForReview}), pending merge review against ${bestMatch.fullName}` 
      };
    } catch (pendingError: unknown) {
        const e = pendingError as Error;
        console.error(`[AutoProcess] Failed to create PendingContactApproval record for new contact ${newUnifiedContactIdForReview} (potential duplicate of ${bestMatch.contactId}): ${e.message}`);
        return { 
            action: 'auto_created_new_pending_flag_failed', 
            unifiedContactId: newUnifiedContactIdForReview, 
            details: `Created new contact, but failed to submit for merge review. Error: ${e.message}` 
        };
    }
  }
}

// Helper to format platform name - ensure it's available or defined here if not imported globally
const formatPlatformName = (source?: string): string => {
  if (!source) return 'unknown';
  if (source.toLowerCase().includes('google')) return 'google';
  if (source.toLowerCase().includes('slack')) return 'slack';
  return source.replace(/_webhook_message|_contact_import|_contacts|_contact/gi, '').replace(/_/g, ' ').toLowerCase().trim() || 'unknown';
};

// Singleton instance
export const contactUnificationService = new ContactUnificationService() 