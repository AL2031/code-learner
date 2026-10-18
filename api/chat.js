// Vercel serverless function: api/chat.js
// Rotates between 3-10 Groq API keys (env vars GROQ_KEY_1 ... GROQ_KEY_10).
// The browser never sees a key and never sends a prompt: it only names a task
// ("lesson", "explain", "hint") plus the data for it. All prompts live below.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const ALLOWED = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);

// ---------------------------------------------------------------- prompts

const HINT_SYSTEM = `You are PyQuest's Python tutor. A beginner is stuck on an exercise. Say what their code does now, what is missing or wrong, and one concrete next step. Do NOT give the full solution. Plain text, under 100 words.`;

const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

// The lesson is written in TWO calls (part 1 and part 2) so each one stays the same size
// as before but the finished lesson has about twice the room for examples and explanations.
// LESSON_BASE holds the rules shared by both parts; each part adds its own section list.
const LESSON_BASE = `You are PyQuest's Python 3.12 tutor. Your reader is an absolute beginner who has never programmed. You write complete, rigorous, friendly lessons that explain every idea in plain English and show plenty of examples.

VOICE
Warm, concrete, second person. Short sentences. Give an everyday analogy before any abstraction. Be thorough rather than brief, but never pad.

EXPLAIN EVERY WORD (the most important teaching rule)
Never assume the reader knows a term. The first time a type, word or concept appears, say what it means in everyday language. That includes the basics hiding inside your examples, for instance: **int** (a whole number like 7), **float** (a number with a decimal point like 2.5), **str** (text in quotes), **bool** (True or False), **None** (the value that means "nothing here"), **list**, **tuple**, **dict**, **set**, **variable**, **function**, **argument**, **return value**, **method**, **object**, **exception**. Do this even if an earlier unit covered it, because learners jump around the course. Once a term has its own entry, a short reminder clause is enough. Never use a word you have not explained.

EXAMPLES (the second most important rule)
Show many examples. Every new idea gets at least two: the simplest possible case first, then a realistic one. Vary the values and the types (int, float, str, bool, list) so the reader sees the idea work in different situations. Use real-life names and numbers (prices, ages, scores, names) instead of foo and bar. Say in one sentence what each example demonstrates, and afterwards explain in plain words what each line did.

FORMAT (strict, the app parses this)
- A heading is a line that starts with "## ". No other heading syntax.
- Use **bold** only for new terms and built-in names. No tables, no HTML, no other markdown. Bullet lines may start with "- ".
- All code goes in fenced blocks.

CODE AND OUTPUT RULES (very important)
1. A \`\`\`python block contains ONLY code that runs exactly as written when pasted into an empty file. Comments are fine.
2. NEVER write ">>>" or "..." prompts. NEVER put program output or results inside a python block, not as bare lines and not as "# prints:" comments.
3. Directly after each python block, show what it prints in a separate fenced block whose language tag is exactly \`output\`. One output block per code block. If the code prints nothing, omit the output block. If a snippet is meant to crash, put only the last line of the error message in a block tagged \`error\` and say in the prose that this one is expected to fail.
4. Every python block is self-contained: it defines everything it uses and imports what it needs. No input(), no files on disk, no network, no unseeded randomness, no timing, no memory addresses.
5. The output must be exactly what Python 3.12 prints, character for character. Work each one out carefully. With this many examples, accuracy matters more than quantity: prefer examples whose output you can verify by hand, and if you are not certain of an output, pick a different example. Avoid set ordering, id(), hash() of strings, and floats that do not print cleanly (one exception: 0.1 + 0.2 prints 0.30000000000000004 and may be used to teach float rounding).
6. Keep each python block under 12 lines. Use more blocks rather than longer ones.`;

const ENTRY_SPEC = `Give EVERY built-in name you are given its own mini-entry, in the order given. Each entry starts with the line "**name**" and covers: what it is in one sentence; its signature and what each argument means (including defaults); what it returns and the type of that value; TWO examples with their output (a basic one, then a variation with a different argument or type; they may share one block when short); one common mistake and how to fix it. If a name is a constant or a type rather than a function, adapt the entry sensibly. If you are given no names, leave this section out.`;

const LESSON_PART1 = `

THIS RESPONSE IS PART 1 OF 2. Write exactly these sections, in this order, and nothing else:

## The big idea
An everyday analogy, then what the unit is, why it exists and when you would use it. 4 to 6 sentences.

## Key terms in plain English
A mini-glossary of every type, term and concept a beginner needs to follow this unit, including the basics that appear in your examples (for example what an int, a float, a str or a bool is, if they show up). 6 to 10 entries, most important first. Each entry starts with the line "**term**" and then gives: what it is in everyday words (1 to 2 sentences); when you would use it or how to recognise it in code; a short python block with its output block; and, where beginners mix it up with something else, one "Don't confuse it with ..." sentence (for example int vs float, or the number 5 vs the text "5").

## How it works
The mental model in plain words, built up step by step. At least four small examples, from the simplest to a more realistic one. After each: code, then output, then 2 to 3 sentences on what each line did and why.

## Each built-in in depth
${ENTRY_SPEC}

LENGTH
About 1,300 words of prose plus the code blocks. If you are running out of room, shorten the prose, but never skip a required name and never leave a code block unfinished.`;

const LESSON_PART2 = `

THIS RESPONSE IS PART 2 OF 2. Part 1 already covered the big idea, the key terms, how it works and the first built-in names, so do not repeat them and do not write an introduction. Start straight with the first section. Write exactly these sections, in this order, and nothing else:

## Each built-in in depth, continued
${ENTRY_SPEC}

## Worked examples
Three small, realistic programs a beginner would actually write (for example a shopping total, a grade checker, a name formatter), each about a different situation. After each output, walk through the code line by line.

## Common mistakes
Five. For each: the wrong code, the exact error or wrong output, why it happened in plain words, and the corrected code.

## Edge cases and surprises
Four behaviours that surprise beginners, each shown with code and output, then explained.

## Remember
6 to 8 one-line takeaways, each starting with "- ".

LENGTH
About 1,300 words of prose plus the code blocks. If you are running out of room, shorten the prose, but never skip a required name and never leave a code block unfinished.`;

// Splits the unit's built-in names into the half for part 1 and the half for part 2.
function lessonNames(d) {
  const all = clip(d.builtins, 1500).split(/\s+/).filter(Boolean);
  const half = Math.ceil(all.length / 2);
  return { first: all.slice(0, half), second: all.slice(half) };
}

function lessonUser(d) {
  const two = d.part === 2;
  const { first, second } = lessonNames(d);
  const mine = two ? second : first, other = two ? first : second;
  const lines = [
    `Unit: ${clip(d.title, 120)}`,
    `Teacher's notes (a starting point, expand on them): ${clip(d.notes, 1500)}`,
    two ? "Write PART 2 of 2." : "Write PART 1 of 2.",
    mine.length
      ? `Built-in names that MUST each get their own entry, in this order: ${mine.join(" ")}`
      : "There are no built-in names for this part, so leave out the built-in entries section.",
  ];
  if (mine.length > 6) lines.push("That is a long list, so keep each entry compact (about 70 words plus a short code block) but still cover every required element.");
  if (other.length) lines.push(two
    ? `Part 1 already covered these built-ins, so do not cover them again: ${other.join(" ")}`
    : `Part 2 will cover these built-ins, so do not cover them here: ${other.join(" ")}`);
  return lines.join("\n");
}

const EXPLAIN_SYSTEM = `You are PyQuest's friendly Python 3.12 tutor for absolute beginners. Explain the code you are given line by line: what each line does, what it prints and why. Never assume the reader knows a word: the first time a line uses a type or term such as int (a whole number), float (a number with a decimal point), str (text), bool (True or False), None, a list, a dict, a function, an argument or a return value, say in everyday words what it is, and add a tiny extra example in a sentence if that helps. Plain text, short paragraphs, no markdown. Quote a line of code only when it helps, and never use fenced blocks.`;


const TASKS = {
  lesson: {
    system: d => LESSON_BASE + (d.part === 2 ? LESSON_PART2 : LESSON_PART1),
    max: 5500, temp: 0.4, effort: "low",
    user: lessonUser,
    valid: d => typeof d.title === "string" && d.title && typeof d.builtins === "string",
  },
  explain: {
    system: EXPLAIN_SYSTEM, max: 1500, temp: 0.3, effort: "low",
    user: d => clip(d.code, 6000),
    valid: d => typeof d.code === "string" && d.code.trim(),
  },
  hint: {
    system: HINT_SYSTEM, max: 600, temp: 0.3, effort: "low",
    user: d => `Task: ${clip(d.prompt, 1500)}\n\nTheir code:\n${clip(d.code, 6000)}`,
    valid: d => typeof d.prompt === "string" && typeof d.code === "string",
  },
};

// ------------------------------------------------------------- key rotation

const cooldown = new Map(); // key index -> timestamp until which we skip it (per warm instance)

function getKeys() {
  const out = [];
  for (let i = 1; i <= 10; i++) {
    const k = process.env["GROQ_KEY_" + i];
    if (k && k.trim()) out.push(k.trim());
  }
  return out;
}

async function callGroq(body) {
  const keys = getKeys();
  if (!keys.length) throw { status: 500, msg: "Server has no GROQ_KEY_1 ... GROQ_KEY_10 environment variables set." };

  const deadline = Date.now() + 55000;
  const start = Math.floor(Math.random() * keys.length); // spread load across keys
  let last = null;

  for (let n = 0; n < keys.length; n++) {
    const i = (start + n) % keys.length;
    if ((cooldown.get(i) || 0) > Date.now()) continue;
    const left = deadline - Date.now();
    if (left < 3000) break;

    let r;
    try {
      r = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + keys[i] },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(left),
      });
    } catch (e) {
      last = { status: 504, msg: "The AI service took too long to answer. Please try again." };
      continue;
    }

    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (text) return text;
      last = { status: 502, msg: "The AI service returned an empty answer. Please try again." };
      continue;
    }
    if (r.status === 429) { // this key is out of quota: park it and try the next one
      const wait = Math.min(parseFloat(r.headers.get("retry-after")) || 30, 120);
      cooldown.set(i, Date.now() + wait * 1000);
      last = { status: 429, msg: "The tutor is busy right now. Please try again in a minute." };
      continue;
    }
    if (r.status === 401 || r.status === 403) { // bad or revoked key: skip it for 10 minutes
      cooldown.set(i, Date.now() + 10 * 60 * 1000);
      console.error("GROQ_KEY_" + (i + 1) + " was rejected (HTTP " + r.status + ")");
      last = { status: 502, msg: "The tutor is temporarily unavailable." };
      continue;
    }
    if (r.status >= 500) { last = { status: 502, msg: "The AI service had a hiccup. Please try again." }; continue; }

    // 400/404/413...: the request itself is the problem, other keys would fail too
    console.error("Groq HTTP " + r.status + ": " + (await r.text().catch(() => "")).slice(0, 300));
    throw { status: 502, msg: "The AI service rejected the request (HTTP " + r.status + ")." };
  }
  throw last || { status: 429, msg: "The tutor is busy right now. Please try again in a minute." };
}

// ------------------------------------------------------------------ handler

function send(res, status, obj) {
  res.status(status).setHeader("Cache-Control", "no-store").json(obj);
}

module.exports = async function handler(req, res) {
  const origin = String(req.headers.origin || "").replace(/\/+$/, "");
  const okOrigin = ALLOWED.includes("*") || ALLOWED.includes(origin);

  if (okOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(okOrigin ? 204 : 403).end();
  if (!ALLOWED.length) return send(res, 500, { error: "Server is missing the ALLOWED_ORIGINS environment variable." });
  if (!okOrigin) return send(res, 403, { error: "This site is not allowed to use the tutor." });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });

  let d = req.body;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = null; } }
  const task = d && TASKS[d.task];
  if (!task || !task.valid(d)) return send(res, 400, { error: "Bad request." });

  try {
    const text = await callGroq({
      model: MODEL,
      temperature: task.temp,
      max_completion_tokens: task.max,
      reasoning_effort: task.effort,
      messages: [{ role: "system", content: typeof task.system === "function" ? task.system(d) : task.system }, { role: "user", content: task.user(d) }],
    });
    send(res, 200, { text });
  } catch (e) {
    send(res, e.status || 500, { error: e.msg || "Something went wrong." });
  }
};

module.exports._cooldown = cooldown; // exposed for tests
