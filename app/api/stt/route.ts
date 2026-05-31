import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const audio = formData.get('audio') as Blob | null
  if (!audio) return NextResponse.json({ error: 'audio required' }, { status: 400 })

  const groqForm = new FormData()
  groqForm.append('file', audio, 'recording.webm')
  groqForm.append('model', 'whisper-large-v3')
  groqForm.append('language', 'en')
  groqForm.append('response_format', 'json')
  // temperature 0 = 보정 최소화, 들린 그대로 전사
  groqForm.append('temperature', '0')

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: groqForm,
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Whisper STT error:', err)
    return NextResponse.json({ error: 'STT 실패' }, { status: 500 })
  }

  const data = await res.json()
  return NextResponse.json({ text: data.text ?? '' })
}
