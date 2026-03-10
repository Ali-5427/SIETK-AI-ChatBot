import { searchKnowledgeBase } from "@/lib/knowledge_service";
import { searchSIETKWebsite } from "@/lib/exa-search";

export const maxDuration = 60;

// Main function to handle the POST request
export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    const latestUserMessage = messages.filter((m: { role: string }) => m.role === "user").pop();

    if (!latestUserMessage) {
      return new Response(JSON.stringify({ error: "No user message found" }), { status: 400 });
    }

    const userQuery = latestUserMessage.content;
    console.log("[AGENT] User query:", userQuery);

    const groqApiKey = process.env.GROQ_API_KEY?.trim();
    if (!groqApiKey) {
      console.log("[AGENT] No Groq API key, using original flow");
      return await processOriginalFlow(userQuery, messages);
    }

    // Step 0: Analyze Query to determine its type
    const queryAnalysis = await analyzeQueryWithGroq(userQuery, groqApiKey);
    console.log("[AGENT] Query analysis:", queryAnalysis);

    // Step 1: Route based on query type
    if (queryAnalysis.queryType === 'conversational') {
      console.log("[AGENT] Handling as a conversational/general query.");
      return await generateConversationalResponse(userQuery, messages, groqApiKey);
    } else {
      console.log("[AGENT] Handling as a factual college-related query.");
      return await generateFactualResponse(userQuery, messages, queryAnalysis);
    }

  } catch (error) {
    console.error("[AGENT] Error in POST function:", error);
    return new Response(JSON.stringify({ error: "Error processing request" }), { status: 500 });
  }
}

// Generates responses for CONVERSATIONAL or GENERAL KNOWLEDGE queries
async function generateConversationalResponse(
    userQuery: string, messages: Array<{ role: string; content: string }>,
    groqApiKey: string
): Promise<Response> {
    const conversationalPrompt = `You are a friendly and helpful AI assistant.
- Your user is interacting with a college chatbot, but their current query is conversational or general knowledge.
- Answer their question naturally and concisely.
- Do NOT mention that you are a different AI or that you are switching modes. Just answer the question.`;

    try {
        const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqApiKey}` },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: conversationalPrompt },
                    ...messages.slice(-6) // include recent conversation history
                ],
                max_tokens: 250,
                temperature: 0.9,
            }),
        });

        if (groqResponse.ok) {
            const groqData = await groqResponse.json();
            const groqAnswer = groqData.choices?.[0]?.message?.content;
            if (groqAnswer) return createStreamResponse(groqAnswer);
        }
    } catch (error) {
        console.error("[AGENT] Conversational call failed:", error);
    }
    return createStreamResponse("I'm not sure how to answer that, but I can help with any questions about SIETK college!");
}

// Generates responses for FACTUAL, college-related queries
async function generateFactualResponse(
  userQuery: string,
  messages: Array<{ role: string; content: string }>,
  queryAnalysis: { needsKnowledgeBase: boolean; needsRealTimeSearch: boolean; department?: string; category?: string; intent: string; queryType: string; }
): Promise<Response> {
    // 1. Gather Information
    let knowledgeBaseResult: string | null = null;
    if (queryAnalysis.needsKnowledgeBase) {
      console.log("[AGENT] Searching knowledge base...");
      knowledgeBaseResult = searchKnowledgeBase(userQuery, queryAnalysis.department, queryAnalysis.category);
      console.log("[AGENT] Knowledge base result:", knowledgeBaseResult ? "Found" : "Not found");
    }

    let exaResult = "";
    if (queryAnalysis.needsRealTimeSearch) {
      console.log("[AGENT] Searching Exa API for real-time info...");
      try {
        exaResult = await searchSIETKWebsite(userQuery);
      } catch (error) {
        console.log("[AGENT] Exa real-time search failed.");
      }
    }

    // 2. Synthesize Final Response
    const groqApiKey = process.env.GROQ_API_KEY?.trim();
    const aiPrompt = buildFactualPrompt(userQuery, knowledgeBaseResult, exaResult, queryAnalysis);

    if (groqApiKey) {
        try {
            const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqApiKey}` },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [{ role: "system", content: aiPrompt }, { role: "user", content: userQuery }],
                    max_tokens: 1024,
                    temperature: 0.7,
                }),
            });
            if (groqResponse.ok) {
                const groqData = await groqResponse.json();
                const groqAnswer = groqData.choices?.[0]?.message?.content;
                if (groqAnswer) return createStreamResponse(groqAnswer);
            }
        } catch (error) {
            console.error("[AGENT] Factual response generation call failed:", error);
        }
    }
    // Fallback response if everything fails
    return createStreamResponse("I'm having trouble processing your request. Please try again or contact SIETK at 08577-264999.");
}

// Analyzes the user's query to determine if it is factual or conversational
async function analyzeQueryWithGroq(userQuery: string, groqApiKey: string): Promise<{
  needsKnowledgeBase: boolean;
  needsRealTimeSearch: boolean;
  queryType: string;
  intent: string;
  department?: string;
  category?: string;
}> {
  const analysisPrompt = `Your task is to classify a user query for a college AI assistant. You must determine if it's a factual question ABOUT THE COLLEGE or if it's a general/conversational query.

**CRITICAL RULES:**
1.  **First, check for conversational/general queries.** A query is conversational if it's a greeting ('hi', 'hello'), a farewell ('bye', 'thanks'), small talk ('how are you'), or a general knowledge question ('what is the capital of France?').
2.  If the query IS conversational or general, you MUST respond with this exact JSON:
    \'\'\'json
    {
      "needsKnowledgeBase": false,
      "needsRealTimeSearch": false,
      "queryType": "conversational",
      "intent": "The user is making conversation or asking a general question."
    }
    \'\'\'
3.  **If the query is NOT conversational/general, then** it must be a factual question about the college. Analyze it as a factual question.
    Example factual query: "what are the fees for the cse department"
    Example JSON for factual query:
    \'\'\'json
    {
        "needsKnowledgeBase": true,
        "needsRealTimeSearch": false,
        "queryType": "factual",
        "intent": "User is asking about CSE department fees.",
        "department": "Computer Science",
        "category": "Admissions"
    }
    \'\'\'

**User Query:** "${userQuery}"

**Respond with JSON only.** Provide your analysis below.
`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqApiKey}` },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "system", content: analysisPrompt }],
        max_tokens: 400,
        temperature: 0.0,
        response_format: { type: "json_object" },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const analysisText = data.choices?.[0]?.message?.content;
      if (analysisText) {
          try {
            return JSON.parse(analysisText);
          } catch (e) {
              console.error("[AGENT] Failed to parse JSON from analysis endpoint.", analysisText, e);
          }
      }
    } else {
        console.error("[AGENT] Query analysis API call failed with status:", response.status, await response.text());
    }
  } catch (e) {
      console.error("[AGENT] Query analysis call failed:", e);
  }

  // Default fallback if analysis fails completely
  return { needsKnowledgeBase: true, needsRealTimeSearch: userQuery.toLowerCase().includes('news'), queryType: "factual", intent: "general inquiry" };
}

// Builds the main prompt for FACTUAL queries
function buildFactualPrompt(
  userQuery: string, knowledgeBase: string | null, exaResult: string,
  queryAnalysis: { intent: string; queryType: string; }
): string {
    const systemContext = `You are SIETK Assistant, an expert AI for Siddharth Institute of Engineering and Technology, Puttur.
Your Role: Provide accurate, detailed answers about SIETK based ONLY on the provided information.

RESPONSE FORMAT:
1. Main heading: ## Topic Name 🎓
2. Sections: **Bold labels**
3. Lists: Use bullet points (-)
4. End every response with: 📞 08577-264999 | 🌐 https://sietk.org

CRITICAL RULES:
1.  Source of Truth: Use ONLY the data in "KNOWLEDGE BASE INFORMATION".
2.  No Outside Knowledge: Do not use any information you were trained on. If it's not in the context, you don't know it.
3.  Handle Missing Info: If the knowledge base is empty or doesn't have the answer, you MUST state: "I do not have specific information on that. For the most accurate details, please contact the college."
4.  Stick to the Query: Answer only the user's current question.`;

  let prompt = systemContext + "\\n\\n";
  prompt += `QUERY ANALYSIS:\\n- Type: ${queryAnalysis.queryType}\\n- Intent: ${queryAnalysis.intent}\\n\\n`;

  if (knowledgeBase) {
    prompt += `KNOWLEDGE BASE INFORMATION (Source of Truth):\\n\`\`\`json\\n${knowledgeBase}\\n\`\`\`\\n\\n`;
  }
  if (exaResult) {
    prompt += `REAL-TIME WEB SEARCH RESULTS (Additional Context):\\n${exaResult}\\n\\n`;
  }

  prompt += `USER'S CURRENT QUESTION:\\n${userQuery}\\n\\n`;
  prompt += `YOUR RESPONSE (Follow all rules and formatting guidelines):`;

  return prompt;
}

// Legacy flow for when Groq analysis is not available
async function processOriginalFlow(userQuery: string, messages: Array<{ role: string; content: string }>): Promise<Response> {
  const knowledgeBaseResult = searchKnowledgeBase(userQuery);
  let exaResult = "";
   try {
        exaResult = await searchSIETKWebsite(userQuery);
      } catch (error) {
        console.log("[AGENT] Exa search failed.");
      }
  const dummyAnalysis = { queryType: 'factual', intent: 'general inquiry', needsKnowledgeBase: true, needsRealTimeSearch: true };
  return await generateFactualResponse(userQuery, messages, dummyAnalysis);
}


// Utility to create a streaming response
function createStreamResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
