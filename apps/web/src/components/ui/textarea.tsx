import * as React from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps
 extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
 ({ className, ...props }, ref) => {
 return (
 <textarea
 className={cn(
 "flex min-h-[80px] w-full rounded-control border border-rule-strong bg-surface px-3 py-2 text-sm text-ink shadow-card transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3",
 className
 )}
 ref={ref}
 {...props}
 />
 )
 }
)
Textarea.displayName = "Textarea"

export { Textarea }

