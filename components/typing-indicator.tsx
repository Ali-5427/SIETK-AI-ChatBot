import { Bot } from "lucide-react"

export function TypingIndicator() {
  return (
    <div className="flex gap-3 items-start">
      <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground">
        <Bot className="w-4 h-4" />
      </div>
      <div className="flex-1 max-w-[85%] md:max-w-[75%]">
        <div className="px-4 py-2.5 rounded-2xl bg-muted rounded-tl-sm">
          <div className="flex gap-1.5 items-center">
            <div className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <div className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <div className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" />
          </div>
        </div>
      </div>
    </div>
  )
}
