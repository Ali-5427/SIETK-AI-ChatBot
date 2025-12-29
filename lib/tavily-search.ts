show me export async function searchTavily(query: string): Promise<string> {
    const apiKey = process.env.TAVILY_API_KEY

    if (!apiKey) {
        console.warn("TAVILY_API_KEY is not set")
        return ""
    }

    try {
        const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                api_key: apiKey,
                query: `${query} site:sietk.org OR "Siddharth Institute of Engineering and Technology"`,
                search_depth: "basic",
                include_answer: true,
                max_results: 5,
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error(`Tavily API error: ${response.status} ${errorText}`)
            return ""
        }

        const data = await response.json()

        // Format the results
        let formattedResults = ""

        if (data.answer) {
            formattedResults += `Direct Answer: ${data.answer}\n\n`
        }

        if (data.results && Array.isArray(data.results)) {
            formattedResults += "Web Results:\n"
            data.results.forEach((result: any) => {
                formattedResults += `- Title: ${result.title}\n`
                formattedResults += `  URL: ${result.url}\n`
                formattedResults += `  Content: ${result.content}\n\n`
            })
        }

        return formattedResults
    } catch (error) {
        console.error("Error searching with Tavily:", error)
        return ""
    }
}
