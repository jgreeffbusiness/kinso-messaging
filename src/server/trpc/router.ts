import { createTRPCRouter } from './trpc'
import { contactRouter } from './routers/contact'
import { messageRouter } from './routers/message'
import { emailRouter } from './routers/email'

export const appRouter = createTRPCRouter({
  contact: contactRouter,
  message: messageRouter,
  email: emailRouter,
})

export type AppRouter = typeof appRouter