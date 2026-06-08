import { NextRequest, NextResponse } from 'next/server'
import { validateProvider } from '@/lib/validation'
import { callSmallTalkLLM, ALL_PROVIDERS } from '@/lib/llm'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!
const GITHUB_OWNER = process.env.GITHUB_OWNER!
const GITHUB_REPO  = process.env.GITHUB_REPO!
const BRANCH = 'main'

// ── GitHub API 헬퍼 ─────────────────────────────────
async function githubFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${err}`)
  }
  return res.json()
}

// 파일 트리 가져오기
async function getFileTree(): Promise<string[]> {
  const data = await githubFetch(`/git/trees/${BRANCH}?recursive=1`)
  return (data.tree as any[])
    .filter(f => f.type === 'blob')
    .map(f => f.path)
    .filter(p =>
      (p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.py') || p.endsWith('.yml') || p.endsWith('.md')) &&
      !p.includes('node_modules') &&
      !p.includes('.next')
    )
}

// 파일 내용 읽기
async function getFileContent(path: string): Promise<{ content: string; sha: string }> {
  const data = await githubFetch(`/contents/${path}?ref=${BRANCH}`)
  const content = Buffer.from(data.content, 'base64').toString('utf-8')
  return { content, sha: data.sha }
}

// 파일 커밋
async function commitFile(path: string, content: string, sha: string, message: string) {
  const encoded = Buffer.from(content).toString('base64')
  return githubFetch(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: encoded, sha, branch: BRANCH }),
  })
}

// HEAD SHA 가져오기
async function getHeadSha(): Promise<string> {
  const data = await githubFetch(`/git/ref/heads/${BRANCH}`)
  return data.object.sha
}

// 커밋 히스토리 가져오기
async function getCommitHistory(limit = 10): Promise<{ sha: string; message: string; date: string }[]> {
  const data = await githubFetch(`/commits?sha=${BRANCH}&per_page=${limit}`)
  return (data as any[]).map(c => ({
    sha: c.sha,
    message: c.commit.message,
    date: c.commit.author.date,
  }))
}

// 롤백: 특정 SHA의 트리로 revert 커밋 생성
async function revertToSha(targetSha: string, currentSha: string) {
  const targetCommit = await githubFetch(`/git/commits/${targetSha}`)
  const treeSha = targetCommit.tree.sha
  const newCommit = await githubFetch('/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: `revert: ${targetSha.slice(0, 7)} 시점으로 롤백`,
      tree: treeSha,
      parents: [currentSha],
    }),
  })
  await githubFetch(`/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  })
  return newCommit.sha
}

// ── intent 판단 프롬프트 ────────────────────────────
function buildIntentPrompt(fileTree: string[]): string {
  return `너는 코드봇 의도 분석기야. 대화 맥락을 보고 사용자 의도를 JSON으로 반환해. 다른 텍스트 없이 JSON만.

## intent 종류

"review"  - 코드 검토/분석 요청
  예: "english봇 검토해줘", "이 파일 어때?", "코드 파이프라인 검토해줘"

"modify"  - 코드 수정 요청 (구체적 지시 포함)
  예: "이 부분 수정해줘", "버그 고쳐줘", "이렇게 바꿔줘"

"approve" - 수정/방향에 동의 (커밋 제안 트리거)
  예: "좋아", "ㅇㅇ", "그렇게 해줘", "오케이", "진행해", "맞아"
  주의: 수정이 이미 완료된 상황에서만 approve. 아직 수정 안 됐으면 chat.

"commit"  - 명시적 커밋 요청
  예: "커밋해줘", "푸시해줘", "올려줘"

"rollback" - 롤백 요청
  예: "롤백해줘", "되돌려줘", "이전 버전으로"

"chat"    - 일반 대화, 질문, 추가 검토 요청
  예: "이 부분은 왜 이렇게 했어?", "다른 파일도 봐줘", "아니 좀더 검토 필요해"

## 반환 형식

{
  "intent": "review" | "modify" | "approve" | "commit" | "rollback" | "chat",
  "files": ["관련 파일 경로 배열, 없으면 []"],
  "summary": "의도 한 줄 요약"
}

files 규칙:
- 사용자가 언급한 파일/기능명에 해당하는 경로를 fileTree에서 찾아서 포함
- "english봇" → app/api/english/route.ts, app/english/page.tsx
- "stock" → app/api/stock/route.ts, app/stock/page.tsx
- 언급 없으면 []

레포 파일 목록:
${fileTree.join('\n')}`
}

// ── 검토 프롬프트 ───────────────────────────────────
function buildReviewPrompt(files: Record<string, string>): string {
  const fileContents = Object.entries(files)
    .map(([path, content]) => `\n\`\`\`\n// ${path}\n${content}\n\`\`\``)
    .join('\n')
  return `너는 코드 리뷰 전문가야. 아래 파일들을 검토하고 한국어로 친절하게 설명해줘.

검토 관점:
- 버그나 잠재적 오류
- 개선할 수 있는 부분
- 잘 된 부분도 언급
- 전체적인 구조/흐름

파일 내용:${fileContents}

간결하게, 핵심만 짚어줘.`
}

// ── 수정 프롬프트 ───────────────────────────────────
function buildModifyPrompt(userRequest: string, files: Record<string, string>): string {
  const fileContents = Object.entries(files)
    .map(([path, content]) => `\n\`\`\`\n// ${path}\n${content}\n\`\`\``)
    .join('\n')
  return `너는 코드 수정 전문가야. 사용자 요청에 맞게 파일을 수정하고 JSON만 반환해.

사용자 요청: ${userRequest}

현재 파일:${fileContents}

반환 형식 (마크다운 없이 JSON만):
{
  "changes": [
    {
      "path": "파일 경로",
      "content": "수정된 전체 파일 내용",
      "description": "변경사항 한 줄 설명"
    }
  ],
  "summary": "전체 변경사항 요약 (2~3문장, 한국어)"
}

규칙:
- content는 수정된 파일 전체 (일부 아님)
- 요청한 것만 수정, 나머지 유지`
}

// ── 일반 대화 프롬프트 ──────────────────────────────
const CHAT_SYSTEM = `너는 코드 리뷰 및 수정 도우미야. 이 프로젝트는 Next.js + TypeScript + Supabase + Turso를 사용하는 개인 공부용 앱이야. 친절하고 간결하게 한국어로 답해.`

// ── API 핸들러 ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, messages, provider, rollbackSha, pendingChanges } = body
  const validProvider = validateProvider(provider)

  // ── 커밋 히스토리 조회 ──────────────────────────
  if (action === 'get_history') {
    try {
      const history = await getCommitHistory(10)
      return NextResponse.json({ ok: true, history })
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
  }

  // ── 롤백 실행 ───────────────────────────────────
  if (action === 'rollback') {
    try {
      const currentSha = await getHeadSha()
      const newSha = await revertToSha(rollbackSha, currentSha)
      return NextResponse.json({
        ok: true,
        newSha,
        message: `✅ ${rollbackSha.slice(0, 7)} 시점으로 롤백 완료`,
      })
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
  }

  // ── 커밋 실행 ───────────────────────────────────
  if (action === 'commit') {
    try {
      // 커밋 전 HEAD SHA 저장 (롤백용)
      const beforeSha = await getHeadSha()
      const commitMessage = `fix: ${pendingChanges.summary ?? '코드봇 자동 수정'}`

      for (const change of pendingChanges.changes) {
        await commitFile(change.path, change.content, change.sha, commitMessage)
      }

      // 커밋 후 HEAD SHA (실제 롤백 기준점)
      const afterSha = await getHeadSha()

      return NextResponse.json({
        ok: true,
        beforeSha,   // 이 SHA로 롤백하면 커밋 전으로 돌아감
        afterSha,
        message: `✅ ${pendingChanges.changes.length}개 파일 커밋 완료`,
        availableProviders: ALL_PROVIDERS,
      })
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
  }

  // ── 대화 처리 (메인) ─────────────────────────────
  try {
    // 1단계: 파일 트리 가져오기
    const fileTree = await getFileTree()

    // 2단계: intent 판단
    const recentMessages = messages.slice(-8).map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    const intentResult = await callSmallTalkLLM(
      recentMessages,
      buildIntentPrompt(fileTree),
      'groq' // intent 판단은 빠른 모델로 고정
    )

    let intent: { intent: string; files: string[]; summary: string }
    try {
      intent = JSON.parse(intentResult.content.replace(/```json|```/g, '').trim())
    } catch {
      intent = { intent: 'chat', files: [], summary: '' }
    }

    console.log('[Codebot] intent:', intent)

    // ── review: 파일 읽고 검토 ──────────────────────
    if (intent.intent === 'review' && intent.files.length > 0) {
      const fileContents: Record<string, string> = {}
      for (const path of intent.files.slice(0, 5)) {
        try {
          const { content } = await getFileContent(path)
          fileContents[path] = content
        } catch { /* 파일 없으면 스킵 */ }
      }

      const reviewPrompt = buildReviewPrompt(fileContents)
      const result = await callSmallTalkLLM(
        [{ role: 'user', content: reviewPrompt }],
        CHAT_SYSTEM,
        validProvider
      )

      return NextResponse.json({
        ok: true,
        intent: 'review',
        content: result.content,
        provider: result.provider,
        availableProviders: ALL_PROVIDERS,
      })
    }

    // ── modify: 수정 내용 생성 ───────────────────────
    if (intent.intent === 'modify' && intent.files.length > 0) {
      const fileContents: Record<string, string> = {}
      const fileShas: Record<string, string> = {}
      for (const path of intent.files.slice(0, 5)) {
        try {
          const { content, sha } = await getFileContent(path)
          fileContents[path] = content
          fileShas[path] = sha
        } catch { /* 파일 없으면 스킵 */ }
      }

      const userRequest = messages[messages.length - 1]?.content ?? ''
      const modifyPrompt = buildModifyPrompt(userRequest, fileContents)
      const result = await callSmallTalkLLM(
        [{ role: 'user', content: modifyPrompt }],
        CHAT_SYSTEM,
        validProvider
      )

      let changes: any[] = []
      let summary = ''
      try {
        const parsed = JSON.parse(result.content.replace(/```json|```/g, '').trim())
        changes = parsed.changes.map((c: any) => ({ ...c, sha: fileShas[c.path] }))
        summary = parsed.summary
      } catch {
        // 파싱 실패 시 일반 대화로 fallback
        return NextResponse.json({
          ok: true,
          intent: 'chat',
          content: result.content,
          provider: result.provider,
          availableProviders: ALL_PROVIDERS,
        })
      }

      return NextResponse.json({
        ok: true,
        intent: 'modify',
        content: summary,
        pendingChanges: { changes, summary },
        provider: result.provider,
        availableProviders: ALL_PROVIDERS,
      })
    }

    // ── approve: 커밋 제안 ───────────────────────────
    if (intent.intent === 'approve') {
      return NextResponse.json({
        ok: true,
        intent: 'approve',
        content: '그럼 커밋할까요?',
        availableProviders: ALL_PROVIDERS,
      })
    }

    // ── commit: 명시적 커밋 요청 → 버튼 출력 유도 ───
    if (intent.intent === 'commit') {
      return NextResponse.json({
        ok: true,
        intent: 'commit',
        content: '커밋 준비됐어요. 아래 버튼으로 확인해주세요.',
        availableProviders: ALL_PROVIDERS,
      })
    }

    // ── rollback: 롤백 요청 → 히스토리 로드 유도 ───
    if (intent.intent === 'rollback') {
      return NextResponse.json({
        ok: true,
        intent: 'rollback',
        content: '어느 시점으로 롤백할까요? 커밋 히스토리를 불러올게요.',
        availableProviders: ALL_PROVIDERS,
      })
    }

    // ── chat: 일반 대화 ─────────────────────────────
    const result = await callSmallTalkLLM(recentMessages, CHAT_SYSTEM, validProvider)
    return NextResponse.json({
      ok: true,
      intent: 'chat',
      content: result.content,
      provider: result.provider,
      availableProviders: ALL_PROVIDERS,
    })

  } catch (err) {
    console.error('Codebot error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}