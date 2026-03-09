
import { searchKnowledgeBase } from "@/lib/knowledge_service";
import { searchSIETKWebsite } from "@/lib/exa-search";

export const maxDuration = 60;

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent";

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

    // Step 0: Analyze Query
    const queryAnalysis = await analyzeQueryWithGroq(userQuery, groqApiKey);
    console.log("[AGENT] Query analysis:", queryAnalysis);

    // NEW: Handle conversational queries directly
    if (queryAnalysis.queryType === 'conversational') {
      console.log("[AGENT] Handling as a conversational query.");
      return await generateConversationalResponse(userQuery, messages, groqApiKey);
    }

    // Step 1: Gather Information
    let knowledgeBaseResult: string | null = null;
    if (queryAnalysis.needsKnowledgeBase) {
      console.log("[AGENT] Searching knowledge base...");
      knowledgeBaseResult = searchKnowledgeBase(userQuery, queryAnalysis.department, queryAnalysis.category);
      console.log("[AGENT] Knowledge base result:", knowledgeBaseResult ? "Found" : "Not found");
    }

    let exaResult = "";
    if (queryAnalysis.needsRealTimeSearch) {
      console.log("[AGENT] Searching Exa API...");
      try {
        exaResult = await searchSIETKWebsite(userQuery);
      } catch (error) {
        console.log("[AGENT] Exa search failed.");
      }
    }

    // Step 2: Synthesize Final Response for Factual Queries
    return await generateFinalResponse(userQuery, knowledgeBaseResult, exaResult, messages, queryAnalysis);

  } catch (error) {
    console.error("[AGENT] Error:", error);
    return new Response(JSON.stringify({ error: "Error processing request" }), { status: 500 });
  }
}

// Function for generating responses to factual/complex queries
async function generateFinalResponse(
  userQuery: string,
  knowledgeBaseResult: string | null,
  exaResult: string,
  messages: Array<{ role: string; content: string }>,
  queryAnalysis: { queryType: string; intent: string }
): Promise<Response> {
    const groqApiKey = process.env.GROQ_API_KEY?.trim();
    const aiPrompt = buildGroqPrompt(userQuery, knowledgeBaseResult, exaResult, messages, queryAnalysis);

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
            console.error("[AGENT] Groq call failed:", error);
        }
    }

    // Fallback if Groq fails or is not available
    return createStreamResponse("I\'m having trouble processing your request. Please try again or contact SIETK at 08577-264999.");
}

// NEW: Function specifically for handling conversational queries
async function generateConversationalResponse(
    userQuery: string, 
    messages: Array<{ role: string; content: string }>,
    groqApiKey: string
): Promise<Response> {
    const conversationalPrompt = `You are a friendly and helpful AI assistant for Siddharth Institute of Engineering and Technology (SIETK).
    Your role is to be a welcoming and natural conversational partner.
    - If the user says hello or greets you, respond warmly.
    - If the user says goodbye, respond politely.
    - For any other general chat, be friendly and brief.
    - Do not answer factual questions about the college. Your only job is to handle simple conversation.
    - Keep your responses short and natural.`;

    try {
        const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqApiKey}` },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: conversationalPrompt },
                    ...messages.slice(-6) // Include recent conversation history
                ],
                max_tokens: 150,
                temperature: 0.9, // Higher temperature for more natural conversation
            }),
        });

        if (groqResponse.ok) {
            const groqData = await groqResponse.json();
            const groqAnswer = groqData.choices?.[0]?.message?.content;
            if (groqAnswer) {
                return createStreamResponse(groqAnswer);
            }
        }
    } catch (error) {
        console.error("[AGENT] Conversational call failed:", error);
    }

    // Fallback for conversational response
    return createStreamResponse("Hello! How can I help you with information about SIETK college today?");
}


// Updated to better classify conversational queries
async function analyzeQueryWithGroq(userQuery: string, groqApiKey: string): Promise<{
  needsKnowledgeBase: boolean;
  needsRealTimeSearch: boolean;
  queryType: string; // Added 'conversational'
  intent: string;
  department?: string;
  category?: string;
}> {
  try {
    const analysisPrompt = `Analyze this user query for an AI assistant at SIETK engineering college. Classify it and extract entities.

Query: "${userQuery}"

Respond with JSON only. Choose queryType from: "factual", "conversational", "complex".
- Use "conversational" for greetings, farewells, or general chat ('hi', 'how are you', 'thanks', 'bye').
- For "conversational" queries, needsKnowledgeBase should be false.
- For factual queries, identify a specific category and department if possible.

{
  "needsKnowledgeBase": boolean,
  "needsRealTimeSearch": boolean,
  "queryType": "factual | conversational | complex",
  "intent": "brief description of user intent",
  "department": "e.g., computer_science_and_engineering",
  "category": "e.g., faculty, curriculum, fees, admissions"
}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqApiKey}` },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: analysisPrompt }],
        max_tokens: 350,
        temperature: 0.0, // Zero temperature for deterministic classification
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const analysisText = data.choices?.[0]?.message?.content;
      try {
        const parsedAnalysis = JSON.parse(analysisText);
        // Ensure needsKnowledgeBase is false if query is conversational
        if (parsedAnalysis.queryType === 'conversational') {
            parsedAnalysis.needsKnowledgeBase = false;
        }
        return parsedAnalysis;
      } catch (e) { /* Fallback below */ }
    }
  } catch (e) { /* Fallback below */ }

  // Default fallback if analysis fails
  return { needsKnowledgeBase: true, needsRealTimeSearch: false, queryType: "factual", intent: "general inquiry" };
}

// Legacy flow for when Groq analysis is not available
async function processOriginalFlow(userQuery: string, messages: Array<{ role: string; content: string }>): Promise<Response> {
  console.log("[AGENT] Using original flow...");
  const knowledgeBaseResult = searchKnowledgeBase(userQuery);
  let exaResult = "";
   try {
        exaResult = await searchSIETKWebsite(userQuery);
      } catch (error) {
        console.log("[AGENT] Exa search failed.");
      }
  const dummyAnalysis = { queryType: 'factual', intent: 'general inquiry' };
  return await generateFinalResponse(userQuery, knowledgeBaseResult, exaResult, messages, dummyAnalysis);
}

// Builds the main prompt for factual queries
function buildGroqPrompt(
  userQuery: string, knowledgeBase: string | null, exaResult: string,
  conversationHistory: Array<{ role: string; content: string }>,
  queryAnalysis: { queryType: string; intent: string }
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

  let prompt = systemContext + "\n\n";
  prompt += `QUERY ANALYSIS:\n- Type: ${queryAnalysis.queryType}\n- Intent: ${queryAnalysis.intent}\n\n`;

  if (knowledgeBase) {
    prompt += `KNOWLEDGE BASE INFORMATION (Source of Truth):\n\`\`\`json\n${knowledgeBase}\n\`\`\`\n\n`;
  }
  if (exaResult) {
    prompt += `REAL-TIME WEB SEARCH RESULTS (Additional Context):\n${exaResult}\n\n`;
  }

  prompt += `USER'S CURRENT QUESTION:\n${userQuery}\n\n`;
  prompt += `YOUR RESPONSE (Follow all rules and formatting guidelines):`;

  return prompt;
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
