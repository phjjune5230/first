import ChatWindow from '@/components/ChatWindow'

export default function SmalltalkPage() {
  return (
    <ChatWindow
      title="잡담"
      subtitle="가볍게 수다 떨기"
      apiPath="/api/smalltalk"
      greeting={`안녕! 가볍게 잡담할래요? 오늘 기분은 어때요?`}
    />
  )
}
