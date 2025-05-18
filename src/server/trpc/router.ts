import { createTRPCRouter } from './trpc'
import { contactRouter } from './routers/contact'
import { messageRouter } from './routers/message'
export const appRouter = createTRPCRouter({
  contact: contactRouter,
  message: messageRouter,
})

export type AppRouter = typeof appRouter