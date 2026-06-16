# 03 — De-AI the copy (German voice)

**Size:** S · **Depends on:** — · **Status:** 🟢 ready

## Goal
Replace the competent-but-generic German copy with something that sounds like the podcast
community wrote it — less "AI marketing", more real voice.

## Where the copy lives
- `src/index.html` — hero, round banner, form labels, privacy note, footer.
- `src/ranking.html` — table intro, the "only confirmed/active teams" note, footer.
- `src/confirm.html` — confirm prompt, success/already/error states.
- `apps-script/Code.gs` — the confirmation **email** (subject + body) and the confirm/result
  HTML pages (`htmlPage_`, `confirmPromptPage_`, etc.), plus all the `{ok:false, error}` messages.

## What "less AI-like" means (decide the voice)
Current tone is neutral/explanatory ("Stelle aus den TTBL-Stars dein Fantasy-Team zusammen…").
Options to pick from (or mix):
- **Casual podcast-insider:** uses the community's in-jokes, informal du, a bit cheeky.
- **Dry/understated:** short, factual, no hype.
- **Hype/broadcast:** leans into the sports-broadcast aesthetic (matches the visual design).

## Open questions / decisions
- **Voice:** which of the above? Any phrases/in-jokes from the podcast to weave in? A name for
  the "organizer" persona?
- **Formality:** du throughout (current) — keep.
- **Scope:** just the user-facing site, or also the email + error messages (recommend all of it —
  the email is the most "official"-feeling touchpoint and most worth humanizing).

## Notes
- Lowest-risk item; no logic changes. Good first/warm-up task.
- Keep the GDPR/privacy note accurate even while making it friendlier (it's a legal-ish text).
- The `npm run smoke` test asserts some structural strings (`x-data=...`) but not copy, so
  rewrites won't break it.
