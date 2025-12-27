"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, GraduationCap } from "lucide-react"
import { ChatMessage } from "@/components/chat-message"
import { TypingIndicator } from "@/components/typing-indicator"
import { SuggestedQuestions } from "@/components/suggested-questions"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I'm the SIETK AI Assistant. I can help you with information about courses, admissions, departments, facilities, and more. How can I assist you today?",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [messages])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to get response")
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          assistantMessage.content += chunk

          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { ...assistantMessage }
            return updated
          })
        }
      }
    } catch (err) {
      console.error("[AGENT] Chat error:", err)
      setError("Failed to get response. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleQuestionClick = (question: string) => {
    setInput(question)
    setTimeout(() => {
      const form = document.querySelector("form")
      if (form) {
        form.requestSubmit()
      }
    }, 10)
  }

  return (
    <div className="flex flex-col w-full h-screen max-w-4xl mx-auto p-4 md:p-6">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b">
        <div className="p-2.5 rounded-xl bg-primary text-primary-foreground">
          <GraduationCap className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">SIETK AI Chatbot</h1>
          <p className="text-sm text-muted-foreground">Siddharth Institute of Engineering and Technology, Puttur</p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden shadow-lg min-h-0">
        <div className="flex-1 overflow-hidden relative">
          <div ref={viewportRef} className="h-full overflow-y-auto p-4 md:p-6">
            <div className="space-y-4">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {isLoading && <TypingIndicator />}
              {error && (
                <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
                  <p className="text-sm font-medium">{error}</p>
                </div>
              )}
              <div ref={scrollRef} />
            </div>

            {messages.length === 1 && !isLoading && <SuggestedQuestions onQuestionClick={handleQuestionClick} />}
          </div>
        </div>

        <div className="p-4 border-t bg-card shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about SIETK..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button type="submit" disabled={!input.trim() || isLoading} size="icon" className="shrink-0">
              <Send className="w-4 h-4" />
              <span className="sr-only">Send message</span>
            </Button>
          </form>

          <p className="mt-3 text-xs text-center text-muted-foreground">
            AI-powered chatbot trained on official SIETK information. Responses are generated in real-time.
          </p>
        </div>
      </Card>
    </div>
  )
}
