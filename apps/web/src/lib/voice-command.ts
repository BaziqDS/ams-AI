export function buildVoiceCommandPrompt(text: string) {
  return [
    "VOICE_MODE_COMMAND",
    "This user request came from hands-free voice mode while the AMS chat panel may be closed.",
    "The transcript may be Urdu, Roman Urdu, or English. Understand the user's intent in that language; do not ask them to repeat in English.",
    "When filling AMS form fields with set_form_values, write user-provided values in English/Latin script unless the field clearly requires Urdu text. Translate descriptive Urdu values into concise English form values, normalize common entities, and preserve known proper names in their standard English spelling.",
    "Examples: جامع مسجد or jamai masjid -> Jamia Masjid; کور آئی فائیو or core i5 -> Core i5.",
    "Do not tell the user to open the chat panel, click a chat button, or use an OpenUI navigation button when a registered frontend action can do the job.",
    "For create/open/navigation requests, prefer run_frontend_action against the current registered actions, especially open_form with { form_id: \"inspection_create\" | \"category_create\" | \"item_create\" } when applicable.",
    "If the relevant frontend action is available and allowed, perform it directly and reply briefly for voice playback.",
    "If the action is unavailable or blocked, explain the exact blocker briefly instead of rendering a chat-only workaround.",
    "",
    `User voice command: ${text.trim()}`,
  ].join("\n");
}
