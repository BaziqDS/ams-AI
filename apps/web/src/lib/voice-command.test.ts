import assert from "node:assert/strict";
import test from "node:test";

import { buildVoiceCommandPrompt } from "./voice-command";

test("voice command prompt tells the agent to act without requiring the chat panel", () => {
  const prompt = buildVoiceCommandPrompt("create an inspection");

  assert.match(prompt, /VOICE_MODE_COMMAND/);
  assert.match(prompt, /Do not tell the user to open the chat panel/i);
  assert.match(prompt, /run_frontend_action/i);
  assert.match(prompt, /open_form/i);
  assert.match(prompt, /create an inspection/);
});

test("voice command prompt keeps Urdu input understandable but fills forms in English", () => {
  const prompt = buildVoiceCommandPrompt("جامع مسجد کے لیے inspection بناؤ");

  assert.match(prompt, /Urdu, Roman Urdu, or English/i);
  assert.match(prompt, /set_form_values/i);
  assert.match(prompt, /English\/Latin script/i);
  assert.match(prompt, /Jamia Masjid/i);
  assert.match(prompt, /جامع مسجد/);
});
