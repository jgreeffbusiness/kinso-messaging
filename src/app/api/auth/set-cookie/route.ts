import { cookies } from 'next/headers'

export async function POST(req: Request) {
  try {
    const { token } = await req.json()

    if (!token) {
      return new Response('Missing token', { status: 400 })
    }

    const cookieStore = await cookies()
    cookieStore.set({
      name: 'token',
      value: token,
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })

    return new Response('Token stored', { status: 200 })
  } catch (err) {
    console.error('Cookie set error:', err)
    return new Response('Failed to store token', { status: 500 })
  }
} 