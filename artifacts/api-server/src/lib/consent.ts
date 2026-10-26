// D-210: what a student reads when an AI feature is used before they agreed to the AI notice. It used to
// be a developer's sentence ("Persist explicit AI consent in study state ...") that the phone showed as is
// (a beta tester saw it on an exam's course screen). The code lets the app tell this case apart.
export const AI_CONSENT_REQUIRED = {
  error: "Turn on the AI coach first: go to the Coach tab and tap “I understand and consent”.",
  code: "ai_consent_required",
} as const;
