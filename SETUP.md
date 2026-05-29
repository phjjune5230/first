# Study Assistant 설치 및 실행 가이드

## 1. Supabase 설정

1. https://supabase.com 에서 새 프로젝트 생성
2. SQL Editor에서 `supabase_schema.sql` 전체 내용 실행
3. Settings > API에서 아래 두 값 복사:
   - `Project URL`
   - `anon public key`

## 2. Gemini API 키 발급

1. https://aistudio.google.com/app/apikey 접속
2. "Create API Key" 클릭
3. 키 복사

## 3. 환경변수 설정

`.env.local` 파일 열어서 채우기:

```
GEMINI_API_KEY=여기에_Gemini_키
NEXT_PUBLIC_SUPABASE_URL=여기에_Supabase_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=여기에_Supabase_anon_key
```

## 4. 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:3000 접속

## 5. Vercel 배포 (폰에서 접속하려면)

```bash
npm install -g vercel
vercel
```

배포 후 Vercel 대시보드 > Settings > Environment Variables에
`.env.local`의 세 값을 똑같이 추가해야 해요.

## 사용 방법

1. 첫 실행 시 AI가 커리큘럼 만들기 도와줌
2. 매일 접속해서 공부 (대화)
3. 끝나면 **세션 종료 & 저장** 버튼 필수!
4. 다음 날 접속하면 이전 기록 기반으로 이어서 진행

## 파일 구조

```
app/
  page.tsx          # 메인 채팅 UI
  api/chat/
    route.ts        # Gemini API 연동 + 세션 저장 로직
lib/
  supabase.ts       # DB 연동 유틸
supabase_schema.sql # DB 테이블 생성 SQL
.env.local          # API 키 (절대 git에 올리지 말 것)
```
