// Exa Web Search Helper for real-time information
// Uses Exa API to search and retrieve content from SIETK website

import { searchKnowledgeBase } from "./sietk-knowledge-base"

interface ExaSearchResult {
    title: string
    url: string
    text: string
    publishedDate?: string
}

interface ExaSearchResponse {
    results: ExaSearchResult[]
}

export async function searchSIETKWebsite(query: string): Promise<string> {
    const apiKey = process.env.EXA_API_KEY?.trim()

    if (!apiKey) {
        console.log("[Exa] No API key configured, skipping web search")
        return ""
    }

    try {
        console.log("[Exa] Searching for:", query)

        // Enhance query for better results
        let searchString = `${query} site:sietk.org OR site:siddharthgroup.ac.in`

        // Add specific keywords to help Exa find the right page
        if (query.toLowerCase().includes('hod') || query.toLowerCase().includes('head')) {
            searchString = `${query} faculty department head site:sietk.org`
        } else if (query.toLowerCase().includes('event') || query.toLowerCase().includes('workshop')) {
            searchString = `${query} news latest circular site:sietk.org`
        } else if (query.toLowerCase().includes('syllabus') || query.toLowerCase().includes('curriculum')) {
            searchString = `${query} pdf download site:sietk.org`
        }

        // Search specifically on SIETK website using Domain Filtering
        // Neural search works best with natural queries, not keyword hacking.
        const response = await fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
            },
            body: JSON.stringify({
                query: query, // Send pure query
                numResults: 5,
                type: "neural",
                useAutoprompt: true,
                includeDomains: ["sietk.org", "siddharthgroup.ac.in"], // Proper domain filtering
                contents: {
                    text: {
                        maxCharacters: 2000,
                        includeHtmlTags: false,
                    },
                },
            }),
        })

        if (!response.ok) {
            const error = await response.text()
            console.error("[Exa] Search error:", response.status, error)
            return ""
        }

        const data: ExaSearchResponse = await response.json()

        if (!data.results || data.results.length === 0) {
            console.log("[Exa] No results found")
            return ""
        }

        console.log(`[Exa] Found ${data.results.length} results`)

        // Format results for the AI context
        let context = "\n\n--- REAL-TIME INFORMATION FROM SIETK WEBSITE ---\n"

        for (const result of data.results) {
            context += `\nSource: ${result.title}\nURL: ${result.url}\n`
            if (result.text) {
                context += `Content: ${result.text.substring(0, 800)}...\n`
            }
            context += "---\n"
        }

        return context
    } catch (error) {
        console.error("[Exa] Search failed:", error)
        return ""
    }
}

// Function to generate a response directly from Exa search results
export async function searchSIETKWebsiteForResponse(query: string): Promise<string> {
    const apiKey = process.env.EXA_API_KEY?.trim()

    // First, check if we have a good answer in the knowledge base
    const knowledgeBaseAnswer = searchKnowledgeBase(query)

    if (!apiKey) {
        console.log("[Exa] No API key configured, using knowledge base only")
        return knowledgeBaseAnswer || "I apologize, but I don't have information about that. Please contact SIETK at 08577-264999."
    }

    try {
        console.log("[Exa] Searching for response:", query)

        // Search specifically on SIETK website
        const response = await fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
            },
            body: JSON.stringify({
                query: `${query} site:sietk.org SIETK college information`,
                numResults: 3,
                type: "auto",
                useAutoprompt: true,
                contents: {
                    text: {
                        maxCharacters: 1500,
                        includeHtmlTags: false,
                    },
                },
            }),
        })

        if (!response.ok) {
            const error = await response.text()
            console.error("[Exa] Search error:", response.status, error)
            return knowledgeBaseAnswer || "I encountered an error while searching. Please try again later."
        }

        const data: ExaSearchResponse = await response.json()

        // If knowledge base has a good answer, use it primarily
        if (knowledgeBaseAnswer) {
            let finalResponse = knowledgeBaseAnswer

            // Add source links from Exa if available
            if (data.results && data.results.length > 0) {
                finalResponse += "\n\n📚 **Additional Resources:**\n"
                for (let i = 0; i < Math.min(data.results.length, 2); i++) {
                    const result = data.results[i]
                    if (result.url && !result.url.includes('.pdf')) {
                        finalResponse += `- [${result.title}](${result.url})\n`
                    }
                }
            }

            return finalResponse
        }

        // If no knowledge base answer, format Exa results nicely
        if (!data.results || data.results.length === 0) {
            console.log("[Exa] No results found")
            return `I couldn't find specific information about "${query}" on the SIETK website. You can visit https://sietk.org for more details or contact the college at 08577-264999.`
        }

        console.log(`[Exa] Found ${data.results.length} results`)

        // Clean and format Exa results
        let responseText = `Here's what I found:\n\n`

        for (let i = 0; i < Math.min(data.results.length, 2); i++) {
            const result = data.results[i]
            if (result.text) {
                // Clean up the text - remove HTML artifacts
                let cleanText = result.text
                    .replace(/!\[.*?\]\(.*?\)/g, '') // Remove markdown images
                    .replace(/\[.*?\]\(.*?\)/g, '') // Remove markdown links
                    .replace(/<[^>]*>/g, '') // Remove HTML tags
                    .replace(/\s+/g, ' ')
                    .trim()

                // Get meaningful content (first 400 chars)
                if (cleanText.length > 50) {
                    responseText += `${cleanText.substring(0, 400)}...\n\n`
                }
            }
            responseText += `🔗 More info: ${result.url}\n\n`
        }

        responseText += `---\nFor more details, visit: https://sietk.org or call: 08577-264999`

        return responseText
    } catch (error) {
        console.error("[Exa] Search failed:", error)
        return knowledgeBaseAnswer || "I'm having trouble connecting. Please try again in a moment."
    }
}

// Function to check if a query needs real-time search
export function needsRealTimeSearch(query: string): boolean {
    const realTimeKeywords = [
        "latest", "current", "recent", "new", "update", "today",
        "news", "announcement", "event", "notice", "circular",
        "placement", "result", "exam", "schedule", "timetable",
        "fee", "deadline", "registration", "application"
    ]

    const lowerQuery = query.toLowerCase()
    return realTimeKeywords.some(keyword => lowerQuery.includes(keyword))
}

