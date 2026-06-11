import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const threadSource = readFileSync(
  join(process.cwd(), "src", "components", "thread", "index.tsx"),
  "utf8",
);

test("visible user messages are mirrored to the detached composer", () => {
  assert.match(threadSource, /function notifyParentHumanMessage/);
  assert.match(threadSource, /type: "HUMAN_MESSAGE"/);
  assert.match(threadSource, /if \(!options\.hidden\) \{/);
  assert.match(threadSource, /notifyParentHumanMessage\(newHumanMessage\.id, trimmed\)/);
});

test("detached composer can stop the active agent run", () => {
  assert.match(threadSource, /event\.data\?\.type === "STOP_RUN"/);
  assert.match(threadSource, /stream\.stop\(\)/);
});

test("iframe voice capture matches detached recording behavior", () => {
  assert.match(threadSource, /const VOICE_AUDIO_CONSTRAINTS/);
  assert.match(threadSource, /channelCount: \{ ideal: 1 \}/);
  assert.match(threadSource, /echoCancellation: true/);
  assert.match(threadSource, /noiseSuppression: true/);
  assert.match(threadSource, /autoGainControl: false/);
  assert.match(threadSource, /sampleRate: \{ ideal: 48000 \}/);
  assert.match(threadSource, /sampleSize: \{ ideal: 16 \}/);
  assert.match(threadSource, /function buildVoiceAudioConstraints/);
  assert.match(threadSource, /enumerateDevices/);
  assert.match(threadSource, /setAudioInputDevices/);
  assert.match(threadSource, /startVoiceMeter\(stream\)/);
  assert.match(threadSource, /SpeechRecognition/);
  assert.match(threadSource, /webkitSpeechRecognition/);
  assert.match(threadSource, /recognition\.lang = "ur-PK"/);
  assert.match(threadSource, /normalizeUrduVoicePreview/);
  // The live transcript streams into the composer from the typed base text,
  // exactly like the detached composer in the AMS side panel.
  assert.match(threadSource, /recordingBaseTextRef/);
  assert.match(threadSource, /setInput\(`\$\{recordingBaseTextRef\.current\}\$\{preview\}`\)/);
  assert.match(
    threadSource,
    /navigator\.mediaDevices\.getUserMedia\(buildVoiceAudioConstraints\(selectedAudioDeviceId\)\)/,
  );
  // Pure browser SpeechRecognition — no audio recording and no Whisper
  // round-trip through the parent app.
  assert.doesNotMatch(threadSource, /MediaRecorder/);
  assert.doesNotMatch(threadSource, /copilotBridge\.transcribe/);
  // The translation pre-pass is disabled to match the detached composer:
  // the raw Urdu/English mix goes straight to the agent.
  assert.match(threadSource, /TEMP: translation disabled/);
  assert.match(threadSource, /await submitUserText\(trimmed\)/);
});

test("iframe voice replies are posted to the parent after the final AI message", () => {
  assert.match(threadSource, /function notifyParentSpeakText/);
  assert.match(threadSource, /type: "SPEAK_TEXT"/);
  assert.match(threadSource, /extractSpeakableText\(getContentString\(latest\.content \?\? \[\]\)\)/);
  assert.match(threadSource, /notifyParentSpeakText\(latest\.id, speakable\)/);
});
