export type TTSLanguage = 'en-US' | 'en-GB' | 'en-IN' | 'en-AU' | 'en-CA' | 'en-IE' | 'en-NZ' | 'en-ZA' | 'de-DE' | 'random'
export type TTSMode = 'groq' | number  // 'groq' or speech rate (0.8~1.7)

const LANGUAGES: Record<TTSLanguage, string> = {
  'en-US': '🇺🇸 미국',
  'en-GB': '🇬🇧 영국',
  'en-IN': '🇮🇳 인도',
  'en-AU': '🇦🇺 호주',
  'en-CA': '🇨🇦 캐나다',
  'en-IE': '🇮🇪 아일랜드',
  'en-NZ': '🇳🇿 뉴질랜드',
  'en-ZA': '🇿🇦 남아공',
  'de-DE': '🇩🇪 독일 영어',
  'random': '🎲 랜덤',
}

const LANG_CODES = Object.keys(LANGUAGES).filter(l => l !== 'random') as TTSLanguage[]

export function getLanguageLabel(lang: TTSLanguage): string {
  return LANGUAGES[lang]
}

export function getAllLanguages(): TTSLanguage[] {
  return Object.keys(LANGUAGES) as TTSLanguage[]
}

function getActualLang(lang: TTSLanguage): string {
  if (lang === 'random') {
    return LANG_CODES[Math.floor(Math.random() * LANG_CODES.length)]
  }
  return lang
}

// voices 로드 대기 (voiceschanged 이벤트 활용)
function getVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    const voices = window.speechSynthesis.getVoices()
    if (voices.length > 0) return resolve(voices)
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      resolve(window.speechSynthesis.getVoices())
    }, { once: true })
  })
}

// speaker 인덱스(0,1,2...) → 남/여 교대로 voice 반환
async function getVoiceForSpeakerIndex(index: number, lang: string): Promise<SpeechSynthesisVoice | null> {
  const voices = await getVoices()
  const isMale = index % 2 === 0

  const langVoices = voices.filter(v => v.lang.startsWith(lang.split('-')[0]))
  if (langVoices.length === 0) return null

  const maleKeywords = ['male', 'man', 'david', 'mark', 'james', 'daniel', 'thomas', 'george', 'ryan', 'fred']
  const femaleKeywords = ['female', 'woman', 'samantha', 'karen', 'victoria', 'kate', 'lisa', 'moira', 'fiona', 'tessa', 'zira']

  const targeted = langVoices.filter(v => {
    const name = v.name.toLowerCase()
    return isMale
      ? maleKeywords.some(k => name.includes(k))
      : femaleKeywords.some(k => name.includes(k))
  })

  if (targeted.length > 0) return targeted[0]
  return langVoices[index % langVoices.length] ?? null
}

export async function speakText(
  text: string,
  lang: TTSLanguage = 'en-US',
  rate: number = 1.1,
  speakerIndex?: number,
  cancelPrevious: boolean = true
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(new Error('Speech Synthesis not supported'))
      return
    }

    const actualLang = getActualLang(lang)
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = actualLang
    utterance.rate = rate
    utterance.pitch = 1
    utterance.volume = 1

    if (speakerIndex !== undefined) {
      const voice = await getVoiceForSpeakerIndex(speakerIndex, actualLang)
      if (voice) utterance.voice = voice
    }

    utterance.onend = () => resolve()
    utterance.onerror = () => reject(new Error('Speech synthesis failed'))

    if (cancelPrevious) window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  })
}

export type GroqStyle = 'natural' | 'confident' | 'fast' | 'excited'

// Groq TTS - 서버 API 호출 후 audio blob 재생
export async function speakWithGroq(text: string, speakerIndex?: number, style: GroqStyle = 'natural'): Promise<void> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, speakerIndex, style }),
  })
  if (!res.ok) throw new Error('Groq TTS 호출 실패')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const audio = new Audio(url)
    audio.onended = () => { URL.revokeObjectURL(url); resolve() }
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Audio 재생 실패')) }
    audio.play()
  })
}

// 모듈 레벨에서 recognition 인스턴스 관리 (stopListening 버그 수정)
let activeRecognition: any = null
let activeMediaRecorder: MediaRecorder | null = null

export async function startListening(useWhisper: boolean = false): Promise<string> {
  if (useWhisper) {
    return startListeningWhisper()
  }
  return startListeningWebSpeech()
}

// Whisper STT — 녹음 후 서버로 전송, 들린 그대로 전사
async function startListeningWhisper(): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const chunks: BlobPart[] = []

  return new Promise((resolve, reject) => {
    const recorder = new MediaRecorder(stream)
    activeMediaRecorder = recorder

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      activeMediaRecorder = null
      try {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const form = new FormData()
        form.append('audio', blob)
        const res = await fetch('/api/stt', { method: 'POST', body: form })
        const data = await res.json()
        resolve(data.text ?? '')
      } catch (e) {
        reject(e)
      }
    }
    recorder.onerror = () => {
      stream.getTracks().forEach(t => t.stop())
      activeMediaRecorder = null
      reject(new Error('Recording failed'))
    }

    recorder.start()
  })
}

async function startListeningWebSpeech(): Promise<string> {
  return new Promise((resolve, reject) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      reject(new Error('Speech Recognition not supported'))
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = false

    activeRecognition = recognition

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      activeRecognition = null
      resolve(transcript.trim())
    }

    recognition.onerror = () => {
      activeRecognition = null
      reject(new Error('Speech recognition failed'))
    }

    recognition.onend = () => {
      activeRecognition = null
    }

    recognition.start()
  })
}

export function stopListening(): void {
  if (activeRecognition) {
    activeRecognition.stop()
    activeRecognition = null
  }
  if (activeMediaRecorder && activeMediaRecorder.state !== 'inactive') {
    activeMediaRecorder.stop()
    // activeMediaRecorder는 onstop에서 null 처리
  }
}
