import { NextRequest, NextResponse } from 'next/server'

const MALE_VOICES = ['austin', 'daniel', 'troy']
const FEMALE_VOICES = ['autumn', 'hannah', 'diana']

// 스타일 지시어 — 테스트 후 교체 가능
export const GROQ_STYLES = {
  natural:    '',
  confident:  '[confidently]',
  fast:       '[fast paced]',
  excited:    '[excited]',
} as const

export type GroqStyle = keyof typeof GROQ_STYLES

function getVoice(speakerIndex?: number): string {
  if (speakerIndex === undefined) return FEMALE_VOICES[0]
  const isMale = speakerIndex % 2 === 0
  const pool = isMale ? MALE_VOICES : FEMALE_VOICES
  return pool[Math.floor(speakerIndex / 2) % pool.length]
}

function buildInput(text: string, style: GroqStyle): string {
  const direction = GROQ_STYLES[style]
  return direction ? `${direction} ${text}` : text
}

export async function POST(req: NextRequest) {
  const { text, speakerIndex, style = 'natural' } = await req.json()
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const voice = getVoice(speakerIndex)
  const input = buildInput(text, style as GroqStyle)

  const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'canopylabs/orpheus-v1-english',
      input,
      voice,
      response_format: 'wav',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Groq TTS error:', err)
    return NextResponse.json({ error: 'Groq TTS 실패' }, { status: 500 })
  }

  const audioBuffer = await res.arrayBuffer()
  return new NextResponse(audioBuffer, {
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'no-store',
    },
  })
}
