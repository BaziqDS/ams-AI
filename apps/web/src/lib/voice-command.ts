export function buildVoiceCommandPrompt(text: string) {
  return [
    "VOICE_MODE_COMMAND",
    "This user request came from hands-free voice mode while the AMS chat panel may be closed.",
    "The transcript has been translated to English by Google Translate before reaching you. It may still contain transliterated proper names, AMS domain terms, or minor translation artifacts. Interpret the intent generously and do not ask the user to repeat or clarify minor wording issues.",
    "When filling AMS form fields with set_form_values, normalize common entities and preserve known proper names in their standard English spelling.",
    "Examples: Jamia Masjid stays Jamia Masjid; core i5 -> Core i5.",
    "Do not tell the user to open the chat panel, click a chat button, or use an OpenUI navigation button when a registered frontend action can do the job.",
    "For create/open/navigation requests, prefer run_frontend_action against the current registered actions, especially open_form with { form_id: \"inspection_create\" | \"location_create\" | \"category_create\" | \"item_create\" | \"stock_entry_create\" | \"stock_register_create\" } when applicable.",
    "If the relevant frontend action is available and allowed, perform it directly and reply briefly for voice playback.",
    "If the action is unavailable or blocked, explain the exact blocker briefly instead of rendering a chat-only workaround.",
    "",
    `User voice command: ${text.trim()}`,
  ].join("\n");
}

export function getVoiceCommandDisplayText(text: string) {
  if (!text.includes("VOICE_MODE_COMMAND")) return null;
  const match = text.match(/(?:^|\n)User voice command:\s*([\s\S]+)$/);
  const transcript = match?.[1]?.trim();
  return transcript ? `Voice: ${transcript}` : null;
}
