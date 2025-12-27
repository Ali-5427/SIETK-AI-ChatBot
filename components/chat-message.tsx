"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { Bot, User } from "lucide-react"
import { useState, useEffect } from "react"

// Define Message type locally
interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

// Simple markdown renderer function with better structure
function renderMarkdown(content: string) {
  const lines = content.split('\n')
  const elements: React.ReactElement[] = []
  let currentList: string[] = []
  let keyIndex = 0

  const getKey = () => `element-${keyIndex++}`

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={getKey()} className="list-disc ml-5 my-2 space-y-1">
          {currentList.map((item, i) => (
            <li key={i} className="text-sm text-gray-700 dark:text-gray-300">{processBoldText(item)}</li>
          ))}
        </ul>
      )
      currentList = []
    }
  }

  lines.forEach((line) => {
    const trimmed = line.trim()

    // Main Heading (# text) - Large, Bold, with border
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      flushList()
      const text = trimmed.slice(2)
      elements.push(
        <h1 key={getKey()} className="text-xl font-bold text-gray-900 dark:text-white mt-1 mb-3 pb-2 border-b border-gray-200 dark:border-gray-600">
          {text}
        </h1>
      )
      return
    }

    // Heading 2 (## text) - Medium, Bold
    if (trimmed.startsWith('## ')) {
      flushList()
      const text = trimmed.slice(3)
      elements.push(
        <h2 key={getKey()} className="text-lg font-bold text-gray-800 dark:text-gray-100 mt-4 mb-2">
          {text}
        </h2>
      )
      return
    }

    // Heading 3 (### text) - Small heading
    if (trimmed.startsWith('### ')) {
      flushList()
      const text = trimmed.slice(4)
      elements.push(
        <h3 key={getKey()} className="text-base font-semibold text-gray-700 dark:text-gray-200 mt-3 mb-1">
          {text}
        </h3>
      )
      return
    }

    // Bullet point
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      currentList.push(trimmed.slice(2))
      return
    }

    // Empty line - add spacing
    if (trimmed === '') {
      flushList()
      elements.push(<div key={getKey()} className="h-2" />)
      return
    }

    // Bold line (starts with **text**) - treat as sub-heading
    if (trimmed.startsWith('**') && trimmed.includes(':**')) {
      flushList()
      elements.push(
        <p key={getKey()} className="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-3 mb-1">
          {processBoldText(trimmed)}
        </p>
      )
      return
    }

    // Bold title line (just **text**)
    if (trimmed.startsWith('**') && trimmed.endsWith('**') && !trimmed.includes(':**')) {
      flushList()
      const text = trimmed.slice(2, -2)
      elements.push(
        <p key={getKey()} className="text-sm font-bold text-gray-800 dark:text-gray-200 mt-3 mb-0.5">
          {text}
        </p>
      )
      return
    }

    // Regular text with possible bold
    flushList()
    elements.push(
      <p key={getKey()} className="text-sm text-gray-600 dark:text-gray-400 my-0.5 leading-relaxed">
        {processBoldText(trimmed)}
      </p>
    )
  })

  flushList()
  return elements
}

// Process **bold** text
function processBoldText(text: string): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = []
  const regex = /\*\*([^*]+)\*\*/g
  let lastIndex = 0
  let match
  let keyIdx = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <strong key={`bold-${keyIdx++}`} className="font-bold text-gray-900 dark:text-white">
        {match[1]}
      </strong>
    )
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

export function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user"
  const [formattedTime, setFormattedTime] = useState<string>("")

  useEffect(() => {
    setFormattedTime(
      message.timestamp.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    )
  }, [message.timestamp])

  return (
    <div className={cn("flex gap-3 items-start", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Message Content */}
      <div className={cn("flex-1 max-w-[85%] md:max-w-[75%]", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "px-4 py-3 rounded-2xl",
            isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm",
          )}
        >
          {isUser ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <div className="space-y-1">
              {renderMarkdown(message.content)}
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground mt-1 px-1 block">
          {formattedTime}
        </span>
      </div>
    </div>
  )
}
