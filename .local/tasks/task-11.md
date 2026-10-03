# Task #11: Confirm Apple and Google sign-in finish on a real iPhone before release

# Confirm real iPhone social sign-in before release

The Expo preview shows both buttons and typechecks pass, but neither Apple nor Google OAuth completion was tested with a real identity on a physical iPhone. Before submission, use a consenting owner-controlled test account in both configured Clerk environments, sign in with each provider, confirm the return to the study desk and access to existing courses, then sign out and sign in again. Do not publish as part of the test without approval. See artifacts/study-coach-mobile/components/SocialSignIn.tsx, artifacts/study-coach-mobile/app/(auth)/sign-in.tsx, and replit.md. This is distinct from the existing cross-device session-recovery task.
