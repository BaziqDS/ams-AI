import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVoiceCommandPrompt,
  getVoiceCommandDisplayText,
} from "./voice-command";

test("voice command prompt tells the agent to act without requiring the chat panel", () => {
  const prompt = buildVoiceCommandPrompt("create an inspection");

  assert.match(prompt, /VOICE_MODE_COMMAND/);
  assert.match(prompt, /Do not tell the user to open the chat panel/i);
  assert.match(prompt, /run_frontend_action/i);
  assert.match(prompt, /open_form/i);
  assert.match(prompt, /create an inspection/);
});

test("voice command prompt explains that input is pre-translated by Google Translate", () => {
  const prompt = buildVoiceCommandPrompt("create inspection for Jamia Masjid");

  assert.match(prompt, /translated to English by Google Translate/i);
  assert.match(prompt, /set_form_values/i);
  assert.match(prompt, /Jamia Masjid/i);
  assert.match(prompt, /create inspection for Jamia Masjid/);
});

test("voice command prompt lists all module form ids including location_create", () => {
  const prompt = buildVoiceCommandPrompt("create a location");

  assert.match(prompt, /location_create/);
  assert.match(prompt, /stock_entry_create/);
  assert.match(prompt, /stock_register_create/);
});

test("voice command display text extracts only the translated transcript", () => {
  const prompt = buildVoiceCommandPrompt("create inspection for CSIT");

  assert.equal(getVoiceCommandDisplayText(prompt), "Voice: create inspection for CSIT");
  assert.equal(getVoiceCommandDisplayText("regular chat text"), null);
});
