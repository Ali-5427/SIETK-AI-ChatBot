
import { searchKnowledgeBase } from "@/lib/knowledge_service";
import { searchSIETKWebsite } from "@/lib/exa-search";

export const maxDuration = 60;

// Gemini API Configuration - using v1beta API
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent";

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    // Get the latest user message
    const latestUserMessage = messages.filter((m: { role: string }) => m.role === "user").pop();

    if (!latestUserMessage) {
      return new Response(
        JSON.stringify({ error: "No user message found" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const userQuery = latestUserMessage.content;
    console.log("[AGENT] User query:", userQuery);

    // ===========================================
    // STEP 0: Groq Query Analysis
    // ===========================================
    console.log("[AGENT] Step 0: Analyzing query with Groq...");
    const groqApiKey = process.env.GROQ_API_KEY?.trim();

    if (!groqApiKey) {
      console.log("[AGENT] No Groq API key for analysis, falling back to original flow");
      return await processOriginalFlow(userQuery, messages);
    }

    const queryAnalysis = await analyzeQueryWithGroq(userQuery, groqApiKey);
    console.log("[AGENT] Query analysis:", queryAnalysis);

    // ===========================================
    // STEP 1: Conditional Information Gathering
    // ===========================================
    let knowledgeBaseResult: string | null = null;
    let exaResult = "";

    // Search Knowledge Base if needed
    if (queryAnalysis.needsKnowledgeBase) {
      console.log("[AGENT] Step 1a: Hybrid Knowledge Base Search...");
      // Use the new hybrid search which calls our new knowledge service
      knowledgeBaseResult = await hybridKnowledgeSearch(userQuery, groqApiKey, queryAnalysis);
      console.log("[AGENT] Hybrid Knowledge Base result:", knowledgeBaseResult ? "Found" : "Not found");
    }

    // Search Exa for Real-Time Info if needed
    if (queryAnalysis.needsRealTimeSearch) {
      console.log("[AGENT] Step 1b: Searching Exa API...");
      try {
        exaResult = await searchSIETKWebsite(userQuery);
        console.log("[AGENT] Exa result:", exaResult ? "Found" : "Not found");
      } catch (error) {
        console.log("[AGENT] Exa search failed, continuing without it");
      }
    }

    // ===========================================
    // STEP 2: Synthesize Final Response
    // ===========================================
    return await generateFinalResponse(userQuery, knowledgeBaseResult, exaResult, messages, queryAnalysis);

  } catch (error) {
    console.error("[AGENT] Error:", error);
    return new Response(JSON.stringify({ error: "Error processing request" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function generateFinalResponse(
  userQuery: string,
  knowledgeBaseResult: string | null,
  exaResult: string,
  messages: Array<{ role: string; content: string }>,
  queryAnalysis: { queryType: string; intent: string }
): Promise<Response> {
  const groqApiKey = process.env.GROQ_API_KEY?.trim();
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  const aiPrompt = buildGroqPrompt(userQuery, knowledgeBaseResult, exaResult, messages, queryAnalysis);

  // Primary: Groq
  if (groqApiKey) {
    console.log("[AGENT] Step 3: Synthesizing with Groq AI (Primary)...");
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
      });

      if (groqResponse.ok) {
        const groqData = await groqResponse.json();
        const groqAnswer = groqData.choices?.[0]?.message?.content;
        if (groqAnswer) {
          console.log("[AGENT] Groq response generated successfully");
          return createStreamResponse(groqAnswer);
        }
      }
      console.error("[AGENT] Groq API failed or returned empty response:", groqResponse.status, await groqResponse.text());
    } catch (groqError) {
      console.error("[AGENT] Groq primary call error:", groqError);
    }
  }

  // Fallback: Gemini (using a simplified prompt)
  if (geminiApiKey) {
    console.log("[AGENT] Falling back to Gemini AI...");
    const geminiPrompt = buildAIPrompt(userQuery, knowledgeBaseResult, exaResult, messages);
    try {
      const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: geminiPrompt }] }],
          generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 1024 },
        }),
      });

      if (geminiResponse.ok) {
        const geminiData = await geminiResponse.json();
        const aiResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (aiResponse) {
          console.log("[AGENT] Gemini fallback response generated successfully");
          return createStreamResponse(aiResponse);
        }
      }
      console.error("[AGENT] Gemini fallback API error:", geminiResponse.status, await geminiResponse.text());
    } catch (geminiError) {
      console.error("[AGENT] Gemini fallback call error:", geminiError);
    }
  }

  // Final fallback
  const finalFallbackResponse = knowledgeBaseResult || "I\'m having trouble processing your request. Please try again or contact SIETK at 08577-264999.";
  return createStreamResponse(finalFallbackResponse);
}

// Analyze query with Groq 
async function analyzeQueryWithGroq(userQuery: string, groqApiKey: string): Promise<{
  needsKnowledgeBase: boolean;
  needsRealTimeSearch: boolean;
  queryType: string;
  intent: string;
  department?: string;
  category?: string;
}> {
  try {
    const analysisPrompt = `Analyze this user query for an AI assistant at an engineering college (SIETK). Identify the user\'s intent, the type of query, and any specific entities.
    
Query: "${userQuery}"

Respond with JSON only, following this structure:
{
  "needsKnowledgeBase": true,
  "needsRealTimeSearch": false, // Only true for very recent news, events, or dynamic content
  "queryType": "factual", // factual, complex, general
  "intent": "e.g., asking for the head of the CSE department",
  "department": "e.g., computer_science_and_engineering", // Use snake_case if applicable
  "category": "e.g., faculty, curriculum, fees, admissions" // Lowercase category
}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: analysisPrompt }],
        max_tokens: 300,
        temperature: 0.1,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const analysisText = data.choices?.[0]?.message?.content;
      try {
        return JSON.parse(analysisText);
      } catch (parseError) {
        console.log("[AGENT] Failed to parse Groq analysis, using defaults");
      }
    }
  } catch (error) {
    console.error("[AGENT] Groq analysis failed:", error);
  }

  // Default fallback
  return {
    needsKnowledgeBase: true,
    needsRealTimeSearch: false,
    queryType: "factual",
    intent: "general inquiry"
  };
}

// Fallback to original flow when Groq is not available for analysis
async function processOriginalFlow(userQuery: string, messages: Array<{ role: string; content: string }>): Promise<Response> {
  console.log("[AGENT] Using original flow (no Groq analysis)");
  
  // Step 1: Search Knowledge Base using the new service
  console.log("[AGENT] Step 1: Searching Knowledge Base...");
  const knowledgeBaseResult = searchKnowledgeBase(userQuery); // UPDATED
  console.log("[AGENT] Knowledge Base result:", knowledgeBaseResult ? "Found" : "Not found");

  // Step 2: Search Exa API (unchanged)
  console.log("[AGENT] Step 2: Searching Exa API...");
  let exaResult = "";
  try {
    exaResult = await searchSIETKWebsite(userQuery);
  } catch (error) {
    console.log("[AGENT] Exa search failed, continuing without it");
  }

  // Step 3: Synthesize Final Response
  const dummyAnalysis = { queryType: \'factual\', intent: \'general inquiry\' };
  return await generateFinalResponse(userQuery, knowledgeBaseResult, exaResult, messages, dummyAnalysis);
}

// Build Groq prompt with the new dynamic knowledge
function buildGroqPrompt(
  userQuery: string,
  knowledgeBase: string | null,
  exaResult: string,
  conversationHistory: Array<{ role: string; content: string }>,
  queryAnalysis: { queryType: string; intent: string }
): string {

  // REMOVED the large hardcoded SIETK_FACTS block. All data is now dynamic.
  const systemContext = `You are SIETK Assistant, an intelligent AI for Siddharth Institute of Engineering and Technology, Puttur, Andhra Pradesh.

YOUR ROLE:
- Give accurate, helpful, and detailed answers about SIETK.
- Use the provided "KNOWLEDGE BASE INFORMATION" and "REAL-TIME WEB SEARCH RESULTS" as the single source of truth.
- Synthesize information from both sources to create comprehensive answers.
- Be professional yet friendly.

RESPONSE FORMAT (MUST FOLLOW):
1. Start with a main heading using ## (e.g., "## Topic Name 🎓").
2. Organize content into sections with **bold labels**.
3. Use bullet points (-) for lists.
4. Include specific details like numbers, dates, names, course codes, etc., found in the provided information.
5. If the information is not in the provided context, state "I do not have specific information on that. Please contact the college for details."
6. End every response with the official contact info: 📞 08577-264999 | 🌐 https://sietk.org

CRITICAL RULES:
1. NEVER make up information. Do not invent names, numbers, links, or data.
2. ONLY use the information provided in the context below. Do not use any prior knowledge.
3. If the provided context is empty or doesn\'t contain the answer, say you don\'t have the information and provide the contact details.
4. Answer ONLY the user\'s current question.
`;

  let prompt = systemContext + "\\n\\n";
  prompt += `QUERY ANALYSIS:\\n- Type: ${queryAnalysis.queryType}\\n- Intent: ${queryAnalysis.intent}\\n\\n`;

  if (knowledgeBase) {
    prompt += `KNOWLEDGE BASE INFORMATION (Source of Truth):\\n\`\`\`json\\n${knowledgeBase}\\n\`\`\`\\n\\n`;
  }

  if (exaResult && exaResult.trim()) {
    prompt += `REAL-TIME WEB SEARCH RESULTS (Additional Context):\\n${exaResult}\\n\\n`;
  }

  const recentHistory = conversationHistory.slice(-6);
  if (recentHistory.length > 0) {
    prompt += "CONVERSATION HISTORY:\\n";
    for (const msg of recentHistory) {
      prompt += `${msg.role.toUpperCase()}: ${msg.content}\\n`;
    }
    prompt += "\\n";
  }

  prompt += `USER'S CURRENT QUESTION:\\n${userQuery}\\n\\n`;
  prompt += `YOUR RESPONSE (Follow all rules and formatting guidelines):`;

  return prompt;
}

// Simplified prompt for Gemini fallback
function buildAIPrompt(
  userQuery: string,
  knowledgeBase: string | null,
  exaResult: string,
  conversationHistory: Array<{ role: string; content: string }>
): string {
  // This function is now a simplified version of buildGroqPrompt
  let prompt = `You are SIETK Assistant. Answer the user\'s question based ONLY on the provided Knowledge Base and Web Search results. Be concise and helpful. If the information is not available, say so and provide the college contact number 08577-264999.\n\n`;

  if (knowledgeBase) {
    prompt += `KNOWLEDGE BASE:\\n${knowledgeBase}\\n\n`;
  }
  if (exaResult && exaResult.trim()) {
    prompt += `WEB SEARCH RESULTS:\\n${exaResult}\\n\n`;
  }
  prompt += `USER QUESTION: "${userQuery}"\n\nANSWER:`;
  return prompt;
}

// Create a streaming response
function createStreamResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Hybrid Knowledge Search - Uses AI analysis to call the new knowledge service
async function hybridKnowledgeSearch(
    userQuery: string, 
    groqApiKey: string, 
    analysis: { department?: string, category?: string }
): Promise<string | null> {
  try {
    console.log("[HYBRID] Using AI-guided search...");
    
    // Use the analysis from the previous step to perform a targeted search
    const searchResult = searchKnowledgeBase(
      userQuery,
      analysis.department,
      analysis.category
    );

    if (!searchResult) {
      console.log("[HYBRID] No structured search results found.");
      return null;
    }
    
    // For now, we return the raw JSON result. 
    // The main LLM prompt is now smart enough to interpret it.
    console.log("[HYBRID] Search successful. Returning structured JSON.");
    return searchResult;

  } catch (error) {
    console.error("[HYBRID] Hybrid search failed:", error);
    // Fallback to a general search if the guided one fails
    return searchKnowledgeBase(userQuery);
  }
}
