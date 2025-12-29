import { searchKnowledgeBase, getSystemPrompt, SIETK_KNOWLEDGE_BASE } from "@/lib/sietk-knowledge-base"
import { searchSIETKWebsite } from "@/lib/exa-search"

export const maxDuration = 60

// Gemini API Configuration - using v1beta API
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent"

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    // Get the latest user message
    const latestUserMessage = messages.filter((m: { role: string }) => m.role === "user").pop()

    if (!latestUserMessage) {
      return new Response(
        JSON.stringify({ error: "No user message found" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      )
    }

    const userQuery = latestUserMessage.content
    console.log("[AGENT] User query:", userQuery)

    // ============================================
    // STEP 1: Search Knowledge Base
    // ============================================
    console.log("[AGENT] Step 1: Searching Knowledge Base...")
    const knowledgeBaseResult = searchKnowledgeBase(userQuery)
    console.log("[AGENT] Knowledge Base result:", knowledgeBaseResult ? "Found" : "Not found")



    // ============================================
    // STEP 2: Parallel Web Search (Exa + Tavily)
    // ============================================
    console.log("[AGENT] Step 2: Running Parallel Search (Exa + Tavily)...")
    let exaResult = ""
    let tavilyResult = ""

    try {
      // Dynamic import for Tavily
      const { searchTavily } = await import("@/lib/tavily-search")

      // Run both searches at the same time
      const [exaPromise, tavilyPromise] = await Promise.allSettled([
        searchSIETKWebsite(userQuery),
        searchTavily(userQuery)
      ])

      // Process Exa Result
      if (exaPromise.status === "fulfilled") {
        exaResult = exaPromise.value
        console.log("[AGENT] Exa result: Found")
      } else {
        console.log("[AGENT] Exa search failed")
      }

      // Process Tavily Result
      if (tavilyPromise.status === "fulfilled") {
        tavilyResult = tavilyPromise.value
        console.log("[AGENT] Tavily result: Found")
      } else {
        console.log("[AGENT] Tavily search failed")
      }

    } catch (error) {
      console.error("[AGENT] Parallel search error:", error)
    }

    // Combine results for the AI
    const combinedSearchResults = `
    --- EXA SEARCH RESULTS ---
    ${exaResult || "No results from Exa."}

    --- TAVILY SEARCH RESULTS ---
    ${tavilyResult || "No results from Tavily."}
    `

    // ============================================
    // STEP 3: Use Gemini AI to Synthesize Response
    // ============================================
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim()

    if (!geminiApiKey) {
      console.log("[AGENT] No Gemini API key, using knowledge base only")
      // Fallback to knowledge base or Exa result
      const fallbackResponse = knowledgeBaseResult ||
        "I apologize, but I don't have specific information about that. Please contact SIETK at 08577-264999 or visit https://sietk.org"

      return createStreamResponse(fallbackResponse)
    }

    console.log("[AGENT] Step 3: Synthesizing with Gemini AI...")

    // Build the AI prompt with all gathered information
    const aiPrompt = buildAIPrompt(userQuery, knowledgeBaseResult, combinedSearchResults, messages)

    // Call Gemini API
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: aiPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        ],
      }),
    })

    if (!geminiResponse.ok) {
      const error = await geminiResponse.text()
      console.error("[AGENT] Gemini API error:", geminiResponse.status, error)

      // Try Groq API as fallback
      console.log("[AGENT] Trying Groq API as fallback...")
      const groqApiKey = process.env.GROQ_API_KEY?.trim()

      if (groqApiKey) {
        try {
          const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${groqApiKey}`,
            },
            body: JSON.stringify({
              model: "llama-3.1-8b-instant",
              messages: [
                { role: "system", content: aiPrompt },
                { role: "user", content: userQuery }
              ],
              max_tokens: 1024,
              temperature: 0.7,
            }),
          })

          if (groqResponse.ok) {
            const groqData = await groqResponse.json()
            const groqAnswer = groqData.choices?.[0]?.message?.content
            if (groqAnswer) {
              console.log("[AGENT] Groq response generated successfully")
              return createStreamResponse(groqAnswer)
            }
          } else {
            console.error("[AGENT] Groq API also failed:", await groqResponse.text())
          }
        } catch (groqError) {
          console.error("[AGENT] Groq fallback error:", groqError)
        }
      }

      // Final fallback to knowledge base
      const fallbackResponse = knowledgeBaseResult ||
        "I'm having trouble processing your request. Please try again or contact SIETK at 08577-264999."

      return createStreamResponse(fallbackResponse)
    }

    const geminiData = await geminiResponse.json()
    const aiResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I couldn't generate a response. Please try again."

    console.log("[AGENT] Gemini response generated successfully")

    return createStreamResponse(aiResponse)

  } catch (error) {
    console.error("[AGENT] Error:", error)
    return new Response(JSON.stringify({ error: "Error processing request" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}

// Build AI prompt with all gathered information
function buildAIPrompt(
  userQuery: string,
  knowledgeBase: string | null,
  exaResult: string,
  conversationHistory: Array<{ role: string; content: string }>
): string {

  const systemContext = `You are SIETK Assistant, an intelligent AI for Siddharth Institute of Engineering and Technology, Puttur, Andhra Pradesh.

YOUR ROLE:
- Give accurate, helpful, and detailed answers about SIETK
- Use ALL provided information (knowledge base + web search) to create comprehensive answers
- If the user asks about something specific, give specific details
- Be professional yet friendly

RESPONSE FORMAT (MUST FOLLOW):
1. Start with a main heading using ## (e.g., "## Topic Name 🎓")
2. Organize content into sections with **bold labels**
3. Use bullet points (-) for lists
4. Include specific details like numbers, dates, names
5. End with contact info: 📞 08577-264999 | 🌐 https://sietk.org

EXAMPLE RESPONSE:
## Curriculum & Syllabus at SIETK 📚

**Current Regulations:**
SIETK follows R23 and R20 autonomous regulations approved by JNTUA.

**B.Tech Subjects Include:**
- **Core Subjects:** Data Structures, DBMS, Operating Systems, Computer Networks
- **Specialization Subjects:** Machine Learning, AI, Cloud Computing, Cyber Security
- **Practical Labs:** Programming Labs, Project Work, Internships

**Syllabus Access:**
You can download complete syllabus from https://sietk.org/syllabus_ug.php

📞 Contact: 08577-264999 | 🌐 Website: https://sietk.org

SIETK FACTS (USE ONLY THESE):
- Established: 2001 by Dr. K. Ashok Raju (Founder & Chairman)
- Full Address: Siddharth Nagar, Narayanavanam Road, Puttur - 517583, Andhra Pradesh
- GPS Coordinates: 13.4478, 79.5512
- Google Maps Link: https://www.google.com/maps/search/?api=1&query=13.4478,79.5512
- Distance from Tirupati: 22 km
- Affiliation: JNTUA (Autonomous since 2013)
- Programs: B.Tech (CSE, ECE, EEE, MECH, CIVIL, AI&ML, Data Science, Cloud), MBA, MCA, M.Tech
- Accreditations: NAAC 'A' Grade, NBA (5 programs), ISO 9001:2008
- Fee: B.Tech Rs.65,400/year | MBA Rs.27,200/year | MCA Rs.44,700/year
- Phone: 08577-264999
- Email: principal.f6@jntua.ac.in
- Website: https://sietk.org

CRITICAL RULES (MUST FOLLOW):
1. NEVER make up information like coordinates, fake map links, or data not provided
2. ONLY use information from the knowledge base and web search results provided
3. If you don't have specific info, say "Please contact SIETK for details"
4. Do NOT create fake URLs or links
5. Answer based on PROVIDED information only
6. Keep responses accurate and factual`

  let prompt = systemContext + "\n\n"

  // Add knowledge base information if available
  if (knowledgeBase) {
    // Remove emojis from knowledge base before passing to Gemini
    const cleanedKB = knowledgeBase.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|📚|📞|🌐|🏆|🎓|💼|💰|📋|🏛️|👨‍💼|👨‍🏫|📝|💻|📊/gu, '')
    prompt += `KNOWLEDGE BASE INFORMATION:\n${cleanedKB}\n\n`
  }

  // Add Exa search results if available
  if (exaResult && exaResult.trim()) {
    prompt += `REAL-TIME WEB SEARCH RESULTS:\n${exaResult}\n\n`
  }

  // Add conversation history (last 3 exchanges)
  const recentHistory = conversationHistory.slice(-6)
  if (recentHistory.length > 0) {
    prompt += "CONVERSATION HISTORY:\n"
    for (const msg of recentHistory) {
      prompt += `${msg.role.toUpperCase()}: ${msg.content}\n`
    }
    prompt += "\n"
  }

  // Add current user query
  prompt += `USER'S CURRENT QUESTION:\n${userQuery}\n\n`

  prompt += `YOUR RESPONSE (use emojis for engagement, but NO # or * symbols):`

  return prompt
}

// Create a streaming response for frontend compatibility
function createStreamResponse(text: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
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
