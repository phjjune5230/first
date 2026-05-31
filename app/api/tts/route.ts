import { NextRequest, NextResponse } from 'next/server'

// speaker 인덱스 기반으로 남/여 교대 voice 배정
const MALE_VOICES = ['austin', 'daniel', 'troy']
const FEMALE_VOICES = ['autumn', 'hannah', 'diana']

function getVoice(speakerIndex?: number): string {
  if (speakerIndex === undefined) return FEMALE_VOICES[0]
  const isMale = speakerIndex % 2 === 0
  const pool = isMale ? MALE_VOICES : FEMALE_VOICES
  return pool[Math.floor(speakerIndex / 2) % pool.length]
}

export async function POST(req: NextRequest) {
  const { text, speakerIndex } = await req.json()
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const voice = getVoice(speakerIndex)

  const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'canopylabs/orpheus-v1-english',
      input: text,
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
