import { NextRequest, NextResponse } from 'next/server'
import { validateProvider } from '@/lib/validation'
import { callSmallTalkLLM, ALL_PROVIDERS } from '@/lib/llm'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!
const GITHUB_OWNER = process.env.GITHUB_OWNER!
const GITHUB_REPO = process.env.GITHUB_REPO!
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

// 레포 파일 트리 가져오기
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

// 파일 커밋 (수정)
async function commitFile(path: string, content: string, sha: string, message: string) {
  const encoded = Buffer.from(content).toString('base64')
  return githubFetch(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: encoded,
      sha,
      branch: BRANCH,
    }),
  })
}

// 현재 브랜치 HEAD SHA 가져오기 (롤백용)
async function getHeadSha(): Promise<string> {
  const data = await githubFetch(`/git/ref/heads/${BRANCH}`)
  return data.object.sha
}

// revert commit (이전 SHA로 reset)
async function revertToSha(targetSha: string, currentSha: string) {
  // 타겟 SHA의 트리 가져오기
  const targetCommit = await githubFetch(`/git/commits/${targetSha}`)
  const treeSha = targetCommit.tree.sha

  // 새 커밋 생성 (이전 트리 참조)
  const newCommit = await githubFetch('/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: `revert: 이전 버전으로 롤백 (${targetSha.slice(0, 7)})`,
      tree: treeSha,
      parents: [currentSha],
    }),
  })

  // ref 업데이트
  await githubFetch(`/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  })

  return newCommit.sha
}

// ── LLM 프롬프트 ────────────────────────────────────

function buildPlanPrompt(request: string, fileTree: string[]): string {
  return `너는 코드 수정 전문가야. 사용자 요청을 보고 어떤 파일을 수정해야 할지 판단해.

레포 파일 목록:
${fileTree.join('\n')}

사용자 요청: ${request}

반드시 JSON만 반환 (다른 텍스트 없이):
{
  "files": ["수정할 파일 경로 배열"],
  "plan": "수정 방향 한국어 설명 (2~4문장)"
}

규칙:
- 실제로 수정이 필요한 파일만 포함
- 최대 5개 파일
- 확실하지 않으면 files를 비워서 반환`
}

function buildModifyPrompt(request: string, files: Record<string, string>): string {
  const fileContents = Object.entries(files)
    .map(([path, content]) => `\n\`\`\`\n// ${path}\n${content}\n\`\`\``)
    .join('\n')

  return `너는 코드 수정 전문가야. 아래 파일들을 사용자 요청에 맞게 수정해.

사용자 요청: ${request}

현재 파일 내용:
${fileContents}

반드시 JSON만 반환 (마크다운 코드블록 없이):
{
  "changes": [
    {
      "path": "파일 경로",
      "content": "수정된 전체 파일 내용",
      "description": "이 파일에서 무엇을 바꿨는지 한 줄 설명"
    }
  ],
  "summary": "전체 변경사항 요약 (한국어, 2~3문장)"
}

규칙:
- content는 수정된 파일 전체 내용 (일부가 아님)
- 요청한 것만 수정, 나머지는 그대로 유지
- 한국어로 설명`
}

// ── 간단 diff 생성 ───────────────────────────────────
function makeDiff(original: string, modified: string, path: string): string {
  const origLines = original.split('\n')
  const modLines = modified.split('\n')
  const lines: string[] = [`--- ${path}`, `+++ ${path}`]

  let i = 0, j = 0
  while (i < origLines.length || j < modLines.length) {
    if (origLines[i] === modLines[j]) {
      i++; j++
    } else {
      if (i < origLines.length) lines.push(`- ${origLines[i++]}`)
      if (j < modLines.length) lines.push(`+ ${modLines[j++]}`)
    }
  }
  return lines.join('\n')
}

// ── API 핸들러 ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, messages, request, provider, pendingChanges, rollbackSha } = body
  const validProvider = validateProvider(provider)

  // ── 1. 파일 트리 조회 ──────────────────────────────
  if (action === 'get_tree') {
    try {
      const files = await getFileTree()
      const headSha = await getHeadSha()
      return NextResponse.json({ ok: true, files, headSha })
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
  }

  // ── 2. 수정 계획 수립 ──────────────────────────────
  if (action === 'plan') {
    try {
      const files = await getFileTree()
      const prompt = buildPlanPrompt(request, files)
      const result = await callSmallTalkLLM(
        [{ role: 'user', content: prompt }],
        '너는 코드 수정 전문가야. JSON만 반환해.',
        validProvider
      )
      const parsed = JSON.parse(result.content.replace(/```json|```/g, '').trim())
      return NextResponse.json({ ok: true, ...parsed, provider: result.provider, availableProviders: ALL_PROVIDERS })
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
  }

  // ── 3. 수정 내용 생성 (diff 미리보기) ─────────────
  if (action === 'generate') {
    try {
      // 파일 내용 읽기
      const fileContents: Record<string, string> = {}
      const fileShas: Record<string, string> = {}
      for (const path of request.files as string[]) {
        const { content, sha } = await getFileContent(path)
        fileContents[path] = content
        fileShas[path] = sha
      }

      const prompt = buildModifyPrompt(request.userRequest, fileContents)
      const result = await callSmallTalkLLM(
        [{ role: 'user', content: prompt }],
        '너는 코드 수정 전문가야. JSON만 반환해.',
        validProvider
      )
      const parsed = JSON.parse(result.content.replace(/```json|```/g, '').trim())

      // diff 생성
      const diffs = parsed.changes.map((change: any) => ({
        ...change,
        sha: fileShas[change.path],
        diff: makeDiff(fileContents[change.path] ?? '', change.content, change.path),
      }))

      return NextResponse.json({
        ok: true,
        changes: diffs,
        summary: parsed.summary,
        provider: result.provider,
        availableProviders: ALL_PROVIDERS,
      })
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
  }

  // ── 4. 실제 커밋 & 푸시 ────────────────────────────
  if (action === 'commit') {
    try {
      const headSha = await getHeadSha()
      const commitMessage = `fix: ${pendingChanges.summary ?? '코드봇 자동 수정'}`

      for (const change of pendingChanges.changes) {
        await commitFile(change.path, change.content, change.sha, commitMessage)
      }

      return NextResponse.json({
        ok: true,
        headSha, // 롤백용으로 반환
        message: `✅ ${pendingChanges.changes.length}개 파일 커밋 완료`,
        availableProviders: ALL_PROVIDERS,
      })
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
  }

  // ── 5. 롤백 ────────────────────────────────────────
  if (action === 'rollback') {
    try {
      const currentSha = await getHeadSha()
      const newSha = await revertToSha(rollbackSha, currentSha)
      return NextResponse.json({
        ok: true,
        newSha,
        message: `✅ ${rollbackSha.slice(0, 7)}로 롤백 완료`,
        availableProviders: ALL_PROVIDERS,
      })
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
  }

  // ── 6. 일반 대화 (코드 관련 질문) ─────────────────
  try {
    const systemPrompt = `너는 코드 리뷰 및 수정 도우미야. 이 프로젝트는 Next.js + TypeScript + Supabase + Turso를 사용하는 개인 공부용 앱이야. 친절하고 간결하게 한국어로 답해.`
    const result = await callSmallTalkLLM(messages, systemPrompt, validProvider)
    return NextResponse.json({
      content: result.content,
      provider: result.provider,
      availableProviders: ALL_PROVIDERS,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
