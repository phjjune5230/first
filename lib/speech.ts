export type TTSLanguage = 'en-US' | 'en-GB' | 'en-IN' | 'en-AU' | 'en-CA' | 'en-IE' | 'en-NZ' | 'en-ZA' | 'de-DE' | 'random'

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

export async function speakText(text: string, lang: TTSLanguage = 'en-US'): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(new Error('Speech Synthesis not supported'))
      return
    }

    const actualLang = getActualLang(lang)
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = actualLang
    utterance.rate = 0.9
    utterance.pitch = 1
    utterance.volume = 1

    utterance.onend = () => resolve()
    utterance.onerror = () => reject(new Error('Speech synthesis failed'))

    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  })
}

export async function startListening(): Promise<string> {
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

    recognition.onstart = () => {
      console.log('Listening started')
    }

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      resolve(transcript.trim())
    }

    recognition.onerror = () => {
      reject(new Error('Speech recognition failed'))
    }

    recognition.start()
  })
}

export function stopListening(): void {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (SpeechRecognition) {
    const recognition = new SpeechRecognition()
    recognition.stop()
  }
}
