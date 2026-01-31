import { searchKnowledgeBase, getSystemPrompt, SIETK_KNOWLEDGE_BASE } from "@/lib/sietk-knowledge-base"
import { searchAllInfoKnowledgeBase, ALL_INFO_KNOWLEDGE_BASE } from "@/lib/all-info-knowledge-base"
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
    // STEP 0: Groq Query Analysis
    // ============================================
    console.log("[AGENT] Step 0: Analyzing query with Groq...")
    const groqApiKey = process.env.GROQ_API_KEY?.trim()

    if (!groqApiKey) {
      console.log("[AGENT] No Groq API key, falling back to original flow")
      return await processOriginalFlow(userQuery, messages)
    }

    const queryAnalysis = await analyzeQueryWithGroq(userQuery, groqApiKey)
    console.log("[AGENT] Query analysis:", queryAnalysis)

    // ============================================
    // STEP 1: Conditional Information Gathering
    // ============================================
    let knowledgeBaseResult = null
    let exaResult = ""

    // Search Knowledge Base if needed
    if (queryAnalysis.needsKnowledgeBase) {
      console.log("[AGENT] Step 1a: Hybrid Knowledge Base Search...")
      knowledgeBaseResult = await hybridKnowledgeSearch(userQuery, groqApiKey)
      console.log("[AGENT] Hybrid Knowledge Base result:", knowledgeBaseResult ? "Found" : "Not found")
    }

    // Search Exa for Real-Time Info if needed
    if (queryAnalysis.needsRealTimeSearch) {
      console.log("[AGENT] Step 1b: Searching Exa API...")
      try {
        exaResult = await searchSIETKWebsite(userQuery)
        console.log("[AGENT] Exa result:", exaResult ? "Found" : "Not found")
      } catch (error) {
        console.log("[AGENT] Exa search failed, continuing without it")
      }
    }

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
    const aiPrompt = buildAIPrompt(userQuery, knowledgeBaseResult, exaResult, messages)

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

// Analyze query with Groq to determine processing needs
async function analyzeQueryWithGroq(userQuery: string, groqApiKey: string): Promise<{
  needsKnowledgeBase: boolean
  needsRealTimeSearch: boolean
  queryType: string
  intent: string
}> {
  try {
    const analysisPrompt = `Analyze this user query about SIETK college and determine what information sources are needed.

Query: "${userQuery}"

Respond with JSON only:
{
  "needsKnowledgeBase": true/false (for static info like fees, courses, contact, basic facts),
  "needsRealTimeSearch": true/false (for current events, latest news, recent updates, dynamic content),
  "queryType": "factual"/"real-time"/"complex"/"general",
  "intent": "brief description of what user wants"
}`

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: analysisPrompt }],
        max_tokens: 200,
        temperature: 0.1, // Low temperature for consistent analysis
      }),
    })

    if (response.ok) {
      const data = await response.json()
      const analysisText = data.choices?.[0]?.message?.content

      try {
        const analysis = JSON.parse(analysisText)
        return {
          needsKnowledgeBase: analysis.needsKnowledgeBase ?? true,
          needsRealTimeSearch: analysis.needsRealTimeSearch ?? false,
          queryType: analysis.queryType ?? "factual",
          intent: analysis.intent ?? "general inquiry"
        }
      } catch (parseError) {
        console.log("[AGENT] Failed to parse Groq analysis, using defaults")
      }
    }
  } catch (error) {
    console.error("[AGENT] Groq analysis failed:", error)
  }

  // Default fallback
  return {
    needsKnowledgeBase: true,
    needsRealTimeSearch: false,
    queryType: "factual",
    intent: "general inquiry"
  }
}

// Fallback to original flow when Groq is not available
async function processOriginalFlow(userQuery: string, messages: Array<{ role: string; content: string }>): Promise<Response> {
  console.log("[AGENT] Using original flow (no Groq API key)")

  // ============================================
  // STEP 1: Search Knowledge Base
  // ============================================
  console.log("[AGENT] Step 1: Searching Knowledge Base...")
  const knowledgeBaseResult = searchAllInfoKnowledgeBase(userQuery)
  console.log("[AGENT] Knowledge Base result:", knowledgeBaseResult ? "Found" : "Not found")

  // ============================================
  // STEP 2: Search Exa for Real-Time Info
  // ============================================
  console.log("[AGENT] Step 2: Searching Exa API...")
  let exaResult = ""
  try {
    exaResult = await searchSIETKWebsite(userQuery)
    console.log("[AGENT] Exa result:", exaResult ? "Found" : "Not found")
  } catch (error) {
    console.log("[AGENT] Exa search failed, continuing without it")
  }

  // ============================================
  // STEP 3: Use Gemini AI to Synthesize Response
  // ============================================
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim()

  if (!geminiApiKey) {
    console.log("[AGENT] No Gemini API key, using knowledge base only")
    const fallbackResponse = knowledgeBaseResult ||
      "I apologize, but I don't have specific information about that. Please contact SIETK at 08577-264999 or visit https://sietk.org"
    return createStreamResponse(fallbackResponse)
  }

  console.log("[AGENT] Step 3: Synthesizing with Gemini AI...")
  const aiPrompt = buildAIPrompt(userQuery, knowledgeBaseResult, exaResult, messages)

  const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: aiPrompt }] }],
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
    const groqApiKey = process.env.GROQ_API_KEY?.trim()
    if (groqApiKey) {
      try {
        const groqFallbackResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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

        if (groqFallbackResponse.ok) {
          const groqData = await groqFallbackResponse.json()
          const groqAnswer = groqData.choices?.[0]?.message?.content
          if (groqAnswer) {
            console.log("[AGENT] Groq fallback response generated successfully")
            return createStreamResponse(groqAnswer)
          }
        }
      } catch (groqError) {
        console.error("[AGENT] Groq fallback error:", groqError)
      }
    }

    const fallbackResponse = knowledgeBaseResult ||
      "I'm having trouble processing your request. Please try again or contact SIETK at 08577-264999."
    return createStreamResponse(fallbackResponse)
  }

  const geminiData = await geminiResponse.json()
  const aiResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ||
    "I couldn't generate a response. Please try again."

  console.log("[AGENT] Gemini response generated successfully")
  return createStreamResponse(aiResponse)
}

// Build Groq prompt with all gathered information
function buildGroqPrompt(
  userQuery: string,
  knowledgeBase: string | null,
  exaResult: string,
  conversationHistory: Array<{ role: string; content: string }>,
  queryAnalysis: { queryType: string; intent: string }
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

  // Add query analysis context
  prompt += `QUERY ANALYSIS:\n- Type: ${queryAnalysis.queryType}\n- Intent: ${queryAnalysis.intent}\n\n`

  // Add knowledge base information if available
  if (knowledgeBase) {
    // Remove emojis from knowledge base before passing to Groq
    const cleanedKB = knowledgeBase.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|📚|📞|🌐|🏆|🎓|💼|💰|📋|🏛️|👨‍💼|👨‍🏫|📝|💻|📊/gu, '')
    prompt += `KNOWLEDGE BASE INFORMATION:\n${cleanedKB}\n\n`
  }

  // Add all-info knowledge base context
  prompt += `ADDITIONAL COLLEGE INFORMATION:\n`
  prompt += `- College Website: ${ALL_INFO_KNOWLEDGE_BASE.college.website}\n`
  prompt += `- Established: ${ALL_INFO_KNOWLEDGE_BASE.college.established}\n`
  prompt += `- Principal: ${ALL_INFO_KNOWLEDGE_BASE.management.principal.name}\n`
  prompt += `- Contact: ${ALL_INFO_KNOWLEDGE_BASE.college.location.phone}\n`
  prompt += `- Location: ${ALL_INFO_KNOWLEDGE_BASE.college.location.address}\n\n`

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

// Build AI prompt with all gathered information (legacy function for fallback)
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

  // Add all-info knowledge base context
  prompt += `ADDITIONAL COLLEGE INFORMATION:\n`
  prompt += `- College Website: ${ALL_INFO_KNOWLEDGE_BASE.college.website}\n`
  prompt += `- Established: ${ALL_INFO_KNOWLEDGE_BASE.college.established}\n`
  prompt += `- Principal: ${ALL_INFO_KNOWLEDGE_BASE.management.principal.name}\n`
  prompt += `- Contact: ${ALL_INFO_KNOWLEDGE_BASE.college.location.phone}\n`
  prompt += `- Location: ${ALL_INFO_KNOWLEDGE_BASE.college.location.address}\n\n`

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

// Hybrid Knowledge Search - Combines AI intelligence with structured search
async function hybridKnowledgeSearch(userQuery: string, groqApiKey: string): Promise<string | null> {
  try {
    console.log("[HYBRID] Step 1: AI Query Analysis...")
    
    // Step 1: AI analyzes query and suggests search strategy
    const analysisPrompt = `Analyze this user query about SIETK college and suggest the best search approach.

Query: "${userQuery}"

Respond with JSON only:
{
  "searchType": "faculty/laboratory/board/general",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "department": "specific department if applicable",
  "confidence": "high/medium/low"
}`

    const analysisResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: analysisPrompt }],
        max_tokens: 200,
        temperature: 0.1,
      }),
    })

    if (!analysisResponse.ok) {
      console.log("[HYBRID] AI analysis failed, falling back to traditional search")
      return searchAllInfoKnowledgeBase(userQuery)
    }

    const analysisData = await analysisResponse.json()
    const analysisText = analysisData.choices?.[0]?.message?.content
    
    let searchStrategy
    try {
      searchStrategy = JSON.parse(analysisText)
    } catch (parseError) {
      console.log("[HYBRID] Failed to parse AI analysis, using traditional search")
      return searchAllInfoKnowledgeBase(userQuery)
    }

    console.log("[HYBRID] Step 2: Structured Search with AI guidance...")
    
    // Step 2: Use AI-guided keywords for structured search
    let searchResult = searchAllInfoKnowledgeBase(userQuery)
    
    // If no result, try with AI-suggested keywords
    if (!searchResult && searchStrategy.keywords.length > 0) {
      for (const keyword of searchStrategy.keywords) {
        searchResult = searchAllInfoKnowledgeBase(keyword)
        if (searchResult) break
      }
    }

    if (!searchResult) {
      console.log("[HYBRID] No structured search results found")
      return null
    }

    console.log("[HYBRID] Step 3: AI Response Enhancement...")
    
    // Step 3: AI enhances and formats the response
    const enhancementPrompt = `You are SIETK Assistant, an intelligent AI for Siddharth Institute of Engineering and Technology.

USER QUERY: "${userQuery}"

KNOWLEDGE BASE INFORMATION:
${searchResult}

TASK: 
1. Use ONLY the provided knowledge base information
2. Create a comprehensive, well-structured response
3. Add relevant details from the knowledge base
4. Format with proper headings and bullet points
5. Include specific numbers, names, and details when available
6. End with: 📞 08577-264999 | 🌐 https://sietk.org

RESPONSE FORMAT:
## Topic Name 🎓

**Key Information:**
- Specific details with numbers and names
- Well-organized bullet points
- Complete information from knowledge base

**Additional Details:**
- More specific information if available
- Relevant context and explanations

📞 Contact: 08577-264999 | 🌐 Website: https://sietk.org

IMPORTANT: Use only information from the provided knowledge base. Do not make up information.`

    const enhancementResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqApiKey}`,
      },
  body: JSON.stringify({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: enhancementPrompt }],
    max_tokens: 1024,
    temperature: 0.7,
  }),
    })

    if (!enhancementResponse.ok) {
      console.log("[HYBRID] AI enhancement failed, returning raw search result")
      return searchResult
    }

    const enhancementData = await enhancementResponse.json()
    const enhancedResponse = enhancementData.choices?.[0]?.message?.content

    console.log("[HYBRID] AI enhancement successful")
    return enhancedResponse || searchResult

  } catch (error) {
    console.error("[HYBRID] Hybrid search failed:", error)
    // Fallback to traditional search
    return searchAllInfoKnowledgeBase(userQuery)
  }
}
  
