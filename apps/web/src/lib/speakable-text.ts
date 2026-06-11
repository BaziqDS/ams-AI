// Voice narration is agent-controlled: the orchestrator's output contract
// (see prompts.ts <voice_narration>) says that when a reply deserves to be
// spoken, the agent puts a single `<voice>…</voice>` line ABOVE the
// `root =` OpenUI line, containing one short plain-English sentence that
// the /api/copilot/voice/speak route translates to Urdu before TTS. No tag
// means the agent chose silence — we never fall back to narrating the UI
// markup, so the agent fully controls when audio plays and what it says.
//
// The tag never renders: OpenUI extraction (getOpenUiLang) slices the
// content from `root =` onward, so anything above that line is invisible
// in the chat UI.

const VOICE_TAG_PATTERN = /<voice>([\s\S]*?)<\/voice>/i;

export function extractSpeakableText(content: string): string {
  const match = content.match(VOICE_TAG_PATTERN);
  if (!match) return "";
  return match[1].replace(/\s+/g, " ").trim();
}
