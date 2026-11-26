import { Fragment } from "react";
import { parseText } from "@/lib/domains/records";
import { cn } from "@/lib/utils";

function Inline({ text }: { text: string }) {
  return text.split(/(\*\*[^*\n]+\*\*)/).map((part, index) => part.startsWith("**") && part.endsWith("**") && part.length > 4
    ? <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>);
}

// Stored text becomes React elements. Nothing in it is ever read as HTML.
export function RecordText({ source, level = 3, className }: { source: string; level?: 3 | 4; className?: string }) {
  return <div className={cn("grid gap-3 text-sm leading-relaxed wrap-anywhere", className)}>
    {parseText(source).map((block, index) => {
      if (block.kind === "heading") {
        const Heading = `h${Math.min(6, level + block.level - 1)}` as "h3" | "h4" | "h5" | "h6";
        return <Heading key={index} className={cn("font-semibold", block.level === 1 ? "text-lg leading-snug" : block.level === 2 ? "mt-1.5 text-[15px]" : "text-sm")}><Inline text={block.text} /></Heading>;
      }
      if (block.kind === "paragraph") return <p key={index} className="whitespace-pre-line"><Inline text={block.text} /></p>;
      const items = block.items.map((item, position) => <li key={position}><Inline text={item} /></li>);
      return block.ordered ? <ol key={index} start={block.start} className="grid list-decimal gap-1 pl-6">{items}</ol> : <ul key={index} className="grid list-disc gap-1 pl-5">{items}</ul>;
    })}
  </div>;
}
