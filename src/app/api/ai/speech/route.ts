import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null

export async function POST(request: NextRequest) {
  if (!openai) {
    return NextResponse.json({ error: 'OpenAI API key not configured.' }, { status: 500 })
  }
  try {
    const { text, voice = 'alloy' } = await request.json()
    if (!text) return NextResponse.json({ error: 'No text provided' }, { status: 400 })

    const speech = await openai.audio.speech.create({
      model: 'tts-1',
      voice,
      input: text,
    })
    const buffer = Buffer.from(await speech.arrayBuffer())
    return new NextResponse(buffer, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    })
  } catch (e) {
    console.error('[Speech API] error', e)
    return NextResponse.json({ error: 'Failed to generate speech' }, { status: 500 })
  }
}
