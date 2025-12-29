import { searchKnowledgeBase } from "@/lib/sietk-knowledge-base"
import { searchSIETKWebsite } from "@/lib/exa-search"
import { createHash, randomUUID } from "crypto"

export const maxDuration = 60

// --- CONSTANTS ---
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent"
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

// --- CACHE SETUP ---
// Simple in-memory cache. In production, use Redis/Vercel KV.
const cache = new Map<string, { answer: string; timestamp: number }>()

// --- MAIN ROUTE HANDLER ---
export async function POST(req: Request) {
  const requestId = randomUUID()
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key missing" }), { status: 500 })
  }

  try {
    const { messages } = await req.json()
    const latestMessage = messages.slice(-1)[0]
    const userQuery = latestMessage?.content

    if (!userQuery) {
      return new Response(JSON.stringify({ error: "No query found" }), { status: 400 })
    }

    // 🛡️ 1. CACHE CHECK (Instant Response)
    const cachedResponse = await getCached(userQuery)
    if (cachedResponse) {
      console.log(`[${requestId}] CACHE HIT`)
      return createStreamResponse(cachedResponse)
    }

    // 🧠 2. INTENT CLASSIFICATION (The "Router")
    // We use a cheap heuristic or fast LLM check to see if we need to search.
    // For speed, let's use a keyword heuristic + fast pattern matching first.
    // If it looks like a "Hi/Hello/Thanks" -> General.
    // If it has "SIETK", "Fee", "Course", "Who", "What", "Principal" -> Query.
    const isGeneralChat = /^(hi|hello|hey|greetings|thanks|thank you|good morning|good evening|bye)$/i.test(userQuery.trim())

    let context = ""
    let confidence = 0.0

    if (isGeneralChat) {
      console.log(`[${requestId}] Intent: GENERAL CHAT (Skipping Search)`)
    } else {
      console.log(`[${requestId}] Intent: QUERY (Triggering Search Engine)`)

      // 🕵️ 3. PARALLEL "ALL-KNOWING" SEARCH
      // We run KB, Exa, and Tavily ALL at once.
      const searchResults = await runUnifiedSearch(userQuery)
      context = searchResults.context
      confidence = searchResults.confidence
    }

    // 🤖 4. AI SYNTHESIS (Final Conclusion)
    const prompt = buildProductionPrompt({ content: context, confidence }, userQuery, messages)
    const answer = await generateWithFallback(prompt, apiKey)

    // 💾 5. CACHE & STREAM
    if (!isGeneralChat) {
      await setCache(userQuery, answer)
    }
    return createStreamResponse(answer)

  } catch (error) {
    console.error(`[${requestId}] Critical Error:`, error)
    return createStreamResponse("I'm sorry, I encountered a system error. Please try again.")
  }
}

// Helper for the new "Unified Search"
async function runUnifiedSearch(query: string) {
  // Run KB + Exa + Tavily in PARALLEL
  const { searchTavily } = await import("@/lib/tavily-search")

  const [kbResult, webResults] = await Promise.all([
    // 1. KB Search (Fast local)
    Promise.resolve(searchKnowledgeBase(query)),

    // 2. Web Search (Parallel External)
    Promise.allSettled([
      searchSIETKWebsite(query),
      searchTavily(query)
    ])
  ])

  // Process Web Results
  const exa = (webResults[0].status === 'fulfilled') ? webResults[0].value : ""
  const tavily = (webResults[1].status === 'fulfilled') ? webResults[1].value : ""

  // COMBINE EVERYTHING
  let combinedContext = ""

  if (kbResult) {
    combinedContext += `--- INTERNAL KNOWLEDGE BASE ---\n${kbResult}\n\n`
  }

  if (exa || tavily) {
    combinedContext += `--- REAL-TIME WEB SEARCH RESULTS ---\n`
    if (exa) combinedContext += `[Source: SIETK.org]: ${exa}\n`
    if (tavily) combinedContext += `[Source: Google/Web]: ${tavily}\n`
  }

  // Determine Confidence
  // If we found KB info OR Web info, we are confident.
  const confidence = (kbResult || exa || tavily) ? 0.9 : 0.0

  return { context: combinedContext, confidence }
}

// --- SUPPORT FUNCTIONS ---

async function getCached(query: string): Promise<string | null> {
  const key = createHash('sha256').update(query.toLowerCase().trim()).digest('hex')
  const cached = cache.get(key)

  // Cache valid for 1 hour (3600000 ms)
  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.answer
  }
  return null
}

async function setCache(query: string, answer: string) {
  const key = createHash('sha256').update(query.toLowerCase().trim()).digest('hex')
  cache.set(key, { answer, timestamp: Date.now() })
}

async function tieredRetrieval(query: string) {
  // TIER 1: Knowledge Base (Zero Latency)
  const kbResult = searchKnowledgeBase(query)

  // If KB result is strong (heuristic check), we might skip web search to save time/cost.
  // For now, if we have a direct hit, we mark confidence high.
  if (kbResult) {
    console.log("-> Tier 1: KB Match Found")
    return {
      content: kbResult,
      confidence: 0.95,
      sources: ['Knowledge Base']
    }
  }

  // TIER 2: Parallel Web Search (Exa + Tavily) with Timeout
  console.log("-> Tier 2: Web Search (Exa + Tavily) Triggered")
  try {
    // Dynamic import to keep bundle small if not used
    const { searchTavily } = await import("@/lib/tavily-search")

    // The Race: Web Search vs 1.5s Timeout
    const webResults = await Promise.race([
      Promise.allSettled([
        searchSIETKWebsite(query),
        searchTavily(query)
      ]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
    ]) as PromiseSettledResult<string>[]

    // Process results safely
    const exa = webResults[0].status === 'fulfilled' ? webResults[0].value : ""
    const tavily = webResults[1].status === 'fulfilled' ? webResults[1].value : ""

    if (!exa && !tavily) {
      return { content: "No information found.", confidence: 0, sources: [] }
    }

    return {
      content: `EXA: ${exa}\n\nTAVILY: ${tavily}`,
      confidence: 0.85,
      sources: ['Web Search']
    }

  } catch (error) {
    console.log("-> Tier 2 Web Search Timed Out or Failed")
    // Fallback: Just return generic "Not found" so LLM can politely decline
    return { content: "Search timed out.", confidence: 0.1, sources: [] }
  }
}

async function generateWithFallback(prompt: string, googleKey: string): Promise<string> {
  // ATTEMPT 1: Gemini (Primary) - 3.5s Timeout
  try {
    console.log("-> Attempt 1: Gemini Flash")
    return await Promise.race([
      callGemini(prompt, googleKey),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500))
    ])
  } catch (error) {
    console.error("Gemini failed/timeout:", error)

    // ATTEMPT 2: Groq (Fallback) - 5s Timeout
    const groqKey = process.env.GROQ_API_KEY
    if (groqKey) {
      try {
        console.log("-> Attempt 2: Groq (Llama 3)")
        return await Promise.race([
          callGroq(prompt, groqKey),
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ])
      } catch (e) {
        console.error("Groq failed/timeout:", e)
      }
    }
  }

  return "I'm sorry, I'm having trouble connecting to my AI brain right now. Please try again in 10 seconds."
}

async function callGemini(prompt: string, key: string): Promise<string> {
  const res = await fetch(`${GEMINI_API_URL}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  })
  if (!res.ok) throw new Error(res.statusText)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ""
}

async function callGroq(prompt: string, key: string): Promise<string> {
  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    })
  })
  if (!res.ok) throw new Error(res.statusText)
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ""
}

function buildProductionPrompt(retrieval: any, query: string, history: any[]): string {
  // Exclude the last message (current query) from history to avoid duplication
  // Then take the last 4 messages of the unexpected history
  const recentHistory = history.slice(0, -1).slice(-4).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')

  return `You are SIETK Assistant. Answer based on the CONTEXT provided.
  
CONTEXT (Confidence: ${retrieval.confidence}):
${retrieval.content}

HISTORY:
${recentHistory}

USER QUESTION:
${query}

INSTRUCTIONS:
1. If the CONTEXT contains the answer, use it and cite it like this [1].
2. If the answer is NOT in context, politely say you don't know. Do NOT hallucinate.
3. Be concise and helpful.
4. Format nicely with markdown.`
}

function createStreamResponse(text: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Simulate streaming for better UX
      const chunkSize = 20
      let i = 0
      function push() {
        if (i >= text.length) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(text.slice(i, i + chunkSize)))
        i += chunkSize
        // Tiny delay to simulate "thinking" / typewriter effect
        setTimeout(push, 10)
      }
      push()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
