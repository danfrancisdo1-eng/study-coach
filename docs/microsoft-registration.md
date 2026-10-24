# Microsoft app registration

Recorded October 3, 2026 from the owner's Azure registration screenshot.

- Display name: Study Coach
- Application (client) ID: `4c70bc67-bc44-4e37-8db0-7363dac3aa16`
- Object ID: `978ea315-dae2-49f7-9fc4-2c4a6b1935d0`
- Directory (tenant) ID: `27242beb-9b22-4d13-bf29-8053e10b9b32`
- Selected audience: Any Entra ID Tenant + Personal Microsoft accounts. Overview displays “All Microsoft account users.”
- State: Activated
- Redirect URI: not configured at registration
- Client credential: not created during registration (and never needed: the app is a public client)
- D-190 (2026-10-24): the app signs in with this registration. It needs, under Authentication → Add a platform → Mobile and desktop applications, the custom redirect URI `study-coach-mobile://onedrive`. Permissions asked at sign-in: Files.Read and offline_access (delegated; no admin consent for personal accounts).

Evidence: [Azure overview screenshot](../screenshots/microsoft-app-registration-2026-10-03.png).

This registers the application; direct OneDrive integration is not yet implemented or connected. Authentication flow, exact redirect URI, delegated read permissions, token handling, and personal-account testing remain to be completed. These identifiers are configuration, not passwords.

The portal displays a warning about end-user consent for newly registered multitenant apps without verified publishers. Review the applicable publisher/organization consent requirements before school/work-account rollout; this screenshot does not establish the outcome of personal-account consent testing.
