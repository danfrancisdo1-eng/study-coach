# UX_PRINCIPLES.md
<!-- Master App Builder v1.1 module. Based on 7 psychology laws for UX (PeterStewieStartup's video), translated into iOS rules. Apple's Human Interface Guidelines win any conflict. -->

## Who we design for
Students 13+, often tired, on a phone, studying in short bursts. Every screen should help them start studying faster and keep going.

## The 7 laws as rules

### 1. Fitts's Law — big, close targets are easier to hit
- Tap targets at least 44x44 pt.
- The main action on each screen sits in the bottom half (thumb zone), full-width or close to it.
- Destructive actions (delete, reset progress) are small, separated, and confirmed.

### 2. Hick's Law — more choices, slower decisions
- One primary action per screen.
- Tab bar: 5 items maximum.
- Option lists over ~7: group, search, or use progressive disclosure ("More").
- Onboarding asks only what's needed to start the first study session.

### 3. Miller's Law — limited working memory
- Chunk content into groups of 3-5 (modern research puts working memory closer to ~4 items than 7).
- Long AI answers: short sections, headings, bullet steps; "show more" instead of walls of text.
- Flashcards and quizzes: one item at a time.

### 4. Jakob's Law — use patterns people already know
- Native iOS components and navigation (tab bar, navigation stack, sheets, swipe-back).
- SF Symbols-style icons; standard gestures only. No custom gesture without a visible alternative.
- Cross-platform code must still look and behave like an iOS app.

### 5. Zeigarnik Effect — unfinished tasks pull people back
- Show progress on study sets, courses, and sessions (progress bars, checklists, "3 of 10 left").
- "Resume where you left off" on the home screen.
- Encourage, never guilt. No shame messages or fake urgency about streaks.

### 6. Von Restorff Effect — the distinct item gets noticed
- One accent color, reserved for the primary action and key highlights.
- Never rely on color alone; pair it with text, an icon, or weight (color-blind users).
- If everything is highlighted, nothing is. One emphasized element per screen.

### 7. Aesthetic-Usability Effect — polished feels easier
- Consistent spacing, type scale, and corner radius from one theme file (constants/colors.ts and a shared theme).
- Support Dark Mode and Dynamic Type from day one.
- Polish can hide real usability problems: test flows with a real student, not just screenshots.

## Accessibility (required)
- Text contrast at least 4.5:1 (3:1 for large text).
- Every control has an accessibility label (VoiceOver).
- Layout survives the largest Dynamic Type size without clipping.
- Respect Reduce Motion.

## Paywall rules (free + premium)
- Show what's free vs. premium plainly before asking for money.
- Price, billing period, and renewal terms clearly visible; Restore Purchases and a visible close button.
- No trick UI: no hidden close buttons, pre-selected upsells, or confusing toggles.

## UI checklist (run on every UI change, report pass/fail)
1. Tap targets >= 44 pt; primary action in thumb zone
2. One primary action; <= 5 tabs; choices grouped
3. Content chunked; AI answers scannable
4. Native iOS patterns and icons
5. Progress / resume shown where a task spans sessions
6. Single accent color used only for emphasis; not color-only
7. Theme tokens used; Dark Mode and Dynamic Type checked
8. Contrast, accessibility labels, Reduce Motion checked
9. Paywall rules (if the screen touches premium)
