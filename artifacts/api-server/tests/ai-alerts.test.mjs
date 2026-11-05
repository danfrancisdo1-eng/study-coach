// D-223: which AI failures email an alert, the email itself, and that each problem emails once per window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_WINDOW_MS, alertEmail, alertKind, firstInWindow, notifyAiFailure } from '../src/lib/ai-alerts.ts';

const apiError = (status, message) => Object.assign(new Error(message), { status });

test('alertKind: the failures a person must fix, from the real Render log lines', () => {
  assert.equal(alertKind(apiError(401, '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')), 'key_rejected');
  assert.equal(alertKind(new Error('Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')), 'key_rejected');
  assert.equal(alertKind(apiError(400, "400 The model 'gpt-image-1' does not exist.")), 'model_missing');
  assert.equal(alertKind(apiError(404, '404 model: claude-x not found')), 'model_missing');
  assert.equal(alertKind(apiError(400, '400 Your credit balance is too low to access the Anthropic API.')), 'billing');
  assert.equal(alertKind(apiError(429, '429 You exceeded your current quota, please check your plan and billing details.')), 'billing');
  assert.equal(alertKind(apiError(403, '403 Your organization must be verified to use the model `gpt-image-2`.')), 'no_access');
  assert.equal(alertKind(new Error('ANTHROPIC_API_KEY must be set to use the anthropic AI provider.')), 'key_missing');
});

test('alertKind: passing trouble never emails', () => {
  assert.equal(alertKind(apiError(429, '429 Rate limit reached for requests')), null);
  assert.equal(alertKind(apiError(529, '529 {"type":"overloaded_error"}')), null);
  assert.equal(alertKind(apiError(500, '500 Internal server error')), null);
  assert.equal(alertKind(new Error('Request timed out.')), null);
  assert.equal(alertKind(new Error('The audio contained no recognizable speech.')), null);
  assert.equal(alertKind(apiError(400, '400 messages: text content blocks must be non-empty')), null);
});

test('firstInWindow: once per key every 6 hours', () => {
  const sent = new Map();
  assert.equal(firstInWindow(sent, 'openai:model_missing', 0), true);
  assert.equal(firstInWindow(sent, 'openai:model_missing', ALERT_WINDOW_MS - 1), false);
  assert.equal(firstInWindow(sent, 'anthropic:model_missing', 1), true, 'another provider is its own problem');
  assert.equal(firstInWindow(sent, 'openai:model_missing', ALERT_WINDOW_MS), true);
});

test('alertEmail: says which service, what broke, what to do and the provider\'s words', () => {
  const { subject, text } = alertEmail({ provider: 'anthropic', feature: 'coach', kind: 'key_rejected', detail: 'invalid x-api-key', at: new Date('2026-11-05T01:00:00Z') });
  assert.equal(subject, 'RapidRecall AI alert: Claude (Anthropic) is failing (the API key was rejected)');
  assert.match(text, /while doing: coach/);
  assert.match(text, /Create a new key/);
  assert.match(text, /The provider said: invalid x-api-key/);
});

const quietLog = () => { const lines = []; const at = (level) => (obj, msg) => lines.push({ level, msg, ...obj }); return { lines, warn: at('warn'), info: at('info'), error: at('error') }; };

test('notifyAiFailure: emails through Resend once per problem, never throws', async () => {
  const calls = [];
  const send = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '' }; };
  const env = { RESEND_API_KEY: 're_test', ALERT_EMAIL: 'dan@example.com' };
  const memory = new Map();
  const log = quietLog();
  const failure = { provider: 'openai', feature: 'memory picture (gpt-image-1)', error: apiError(400, "400 The model 'gpt-image-1' does not exist.") };
  await notifyAiFailure(failure, log, env, send, () => new Date(0), memory);
  await notifyAiFailure(failure, log, env, send, () => new Date(1000), memory);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to, ['dan@example.com']);
  assert.equal(body.from, 'RapidRecall alerts <onboarding@resend.dev>');
  assert.match(body.subject, /OpenAI is failing \(the model does not exist any more\)/);
  assert.equal(log.lines.filter((l) => l.msg === 'AI alert').length, 2, 'every failure is logged');

  // Passing trouble: nothing sent, nothing logged as an alert.
  await notifyAiFailure({ provider: 'anthropic', feature: 'coach', error: apiError(529, 'overloaded') }, log, env, send, () => new Date(2000), memory);
  assert.equal(calls.length, 1);

  // A failed send is tried again on the next failure; a throwing sender never escapes.
  const failing = async () => ({ ok: false, status: 422, text: async () => 'bad from' });
  const m2 = new Map();
  const keyFailure = { provider: 'anthropic', feature: 'coach', error: apiError(401, 'invalid x-api-key') };
  await notifyAiFailure(keyFailure, log, env, failing, () => new Date(0), m2);
  await notifyAiFailure(keyFailure, log, env, send, () => new Date(1), m2);
  assert.equal(calls.length, 2);
  await notifyAiFailure(keyFailure, log, env, async () => { throw new Error('network down'); }, () => new Date(ALERT_WINDOW_MS * 2), m2);
});

test('notifyAiFailure: without RESEND_API_KEY or ALERT_EMAIL it only logs', async () => {
  const calls = [];
  const log = quietLog();
  await notifyAiFailure({ provider: 'anthropic', feature: 'coach', error: apiError(401, 'invalid x-api-key') }, log, {}, async () => { calls.push(1); return { ok: true, status: 200, text: async () => '' }; }, () => new Date(0), new Map());
  assert.equal(calls.length, 0);
  assert.ok(log.lines.some((l) => l.msg === 'AI alert'));
});
