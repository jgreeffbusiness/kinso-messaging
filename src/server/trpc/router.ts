import { createTRPCRouter } from './trpc'
import { contactRouter } from './routers/contact'

export const appRouter = createTRPCRouter({
  contact: contactRouter,
})

export type AppRouter = typeof appRouter