import { z } from 'zod'
import { protectedProcedure, createTRPCRouter } from '../trpc'
import { syncContactEmails, syncAllUserEmails } from '@server/services/gmail'

export const emailRouter = createTRPCRouter({
  syncContactEmails: protectedProcedure
    .input(z.object({ contactId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return syncContactEmails(ctx.user.id, input.contactId)
    }),
  
  syncAllEmails: protectedProcedure
    .mutation(async ({ ctx }) => {
      return syncAllUserEmails(ctx.user.id)
    }),
  
  getEmailThreads: protectedProcedure
    .input(z.object({ contactId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.message.findMany({
        where: { 
          userId: ctx.user.id,
          contactId: input.contactId,
          platform: 'email'
        },
        orderBy: { timestamp: 'desc' },
        select: {
          id: true,
          platformMessageId: true,
          content: true,
          timestamp: true,
          platformData: true
        }
      })
    })
}) 