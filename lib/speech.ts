/** Turn an agent answer (light markdown) into text that reads well aloud. */
export function toSpeech(text: string): string {
  return text
    .replace(/\*\*Verdict:\*\*/i, "Verdict:")
    .replace(/[*_`#]/g, "")
    .replace(/(\d+)\/100/g, "$1 out of 100")
    .replace(/(\d)″/g, "$1 inches")
    .replace(/\n+/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
}
