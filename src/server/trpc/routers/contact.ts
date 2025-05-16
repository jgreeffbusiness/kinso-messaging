import { z } from 'zod'
import { protectedProcedure, createTRPCRouter } from '../trpc'

export const contactRouter = createTRPCRouter({
  getAll: protectedProcedure.query(({ ctx }) => {
    return ctx.prisma.contact.findMany({
      where: { userId: ctx.user.id },
      orderBy: { fullName: 'asc' }
    })
  }),

  bulkImport: protectedProcedure
    .input(z.array(z.object({
      fullName: z.string(),
      email: z.string().email().optional(),
      phoneNumber: z.string().optional(),
      googleContactId: z.string(),
      photoUrl: z.string().optional(),
    })))
    .mutation(async ({ input, ctx }) => {
      // Optional: Use a transaction for all-or-nothing imports
      const result = await ctx.prisma.$transaction(async (tx) => {
        const imported = []
        const errors = []
        
        for (const contact of input) {
          try {
            // Check if contact already exists
            const existing = await tx.contact.findUnique({
              where: { googleContactId: contact.googleContactId }
            })
            
            if (existing) {
              // Update existing contact
              const updated = await tx.contact.update({
                where: { googleContactId: contact.googleContactId },
                data: {
                  fullName: contact.fullName,
                  email: contact.email,
                  phoneNumber: contact.phoneNumber,
                  photoUrl: contact.photoUrl,
                }
              })
              imported.push(updated)
            } else {
              // Create new contact
              const created = await tx.contact.create({
                data: {
                  ...contact,
                  userId: ctx.user.id,
                }
              })
              imported.push(created)
            }
          } catch (error) {
            errors.push({ contact, error: error.message })
          }
        }
        
        return { imported, errors }
      })
      
      return {
        success: true,
        imported: result.imported.length,
        errors: result.errors.length,
        details: result
      }
    }),

  create: protectedProcedure
    .input(z.object({
      fullName: z.string(),
      email: z.string().email().optional(),
      phoneNumber: z.string().optional(),
      googleContactId: z.string().optional(),
      photoUrl: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => {
      return ctx.prisma.contact.create({
        data: {
          ...input,
          userId: ctx.user.id,
        },
      })
    }),
})