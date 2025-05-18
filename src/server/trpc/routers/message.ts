import { z } from 'zod'
import { protectedProcedure, createTRPCRouter } from '../trpc'

export const messageRouter = createTRPCRouter({
  getAll: protectedProcedure.query(({ ctx }) => {
    return ctx.prisma.message.findMany({
      where: { userId: ctx.user.id },
      orderBy: { timestamp: 'desc' },
      include: {
        contact: true,
        summary: true
      }
    })
  }),
}) 