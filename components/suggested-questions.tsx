"use client"

import { Button } from "@/components/ui/button"
import { HelpCircle } from "lucide-react"

const SUGGESTED_QUESTIONS = [
  "What CSE courses are offered at SIETK?",
  "Tell me about the AI & ML program",
  "What are SIETK's achievements?",
  "What facilities does the CSE department have?",
]

export function SuggestedQuestions({
  onQuestionClick,
}: {
  onQuestionClick: (question: string) => void
}) {
  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <HelpCircle className="w-4 h-4" />
        <span className="font-medium">Suggested questions</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {SUGGESTED_QUESTIONS.map((question, index) => (
          <Button
            key={index}
            variant="outline"
            className="justify-start h-auto py-3 px-4 text-left text-sm font-normal hover:bg-accent hover:border-primary/20 bg-transparent"
            onClick={() => onQuestionClick(question)}
          >
            {question}
          </Button>
        ))}
      </div>
    </div>
  )
}
