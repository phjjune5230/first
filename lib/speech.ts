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

// speaker 인덱스(0,1,2...) → 남/여 교대로 voice 반환
// 0,2,4... → 남성, 1,3,5... → 여성
function getVoiceForSpeakerIndex(index: number, lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  const isMale = index % 2 === 0

  // 해당 언어 voice만 필터 (앞 2자리 언어코드 기준)
  const langVoices = voices.filter(v => v.lang.startsWith(lang.split('-')[0]))
  if (langVoices.length === 0) return null

  // 이름 기반 성별 추측
  const maleKeywords = ['male', 'man', 'david', 'mark', 'james', 'daniel', 'thomas', 'george', 'ryan', 'fred']
  const femaleKeywords = ['female', 'woman', 'samantha', 'karen', 'victoria', 'kate', 'lisa', 'moira', 'fiona', 'tessa', 'zira']

  const targeted = langVoices.filter(v => {
    const name = v.name.toLowerCase()
    return isMale
      ? maleKeywords.some(k => name.includes(k))
      : femaleKeywords.some(k => name.includes(k))
  })

  // 매칭되면 사용, 없으면 인덱스로 교대 폴백
  if (targeted.length > 0) return targeted[0]
  return langVoices[index % langVoices.length] ?? null
}

export async function speakText(
  text: string,
  lang: TTSLanguage = 'en-US',
  rate: number = 1.1,
  speakerIndex?: number  // 0=첫번째 화자, 1=두번째... undefined=단일 TTS
): Promise<void> {
  return new Promise((resolve, reject) => {
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

    // speakerIndex 있으면 성별 voice 배정
    if (speakerIndex !== undefined) {
      const voice = getVoiceForSpeakerIndex(speakerIndex, actualLang)
      if (voice) utterance.voice = voice
    }

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
