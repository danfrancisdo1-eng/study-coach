/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#242c40',
    tint: '#dc6843',

    // Core surfaces
    background: '#f5f2e8',
    foreground: '#242c40',

    // Cards / elevated surfaces
    card: '#faf8f0',
    cardForeground: '#242c40',

    // Primary action color (buttons, links, active states)
    primary: '#dc6843',
    primaryForeground: '#fff9ef',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#dbe3ec',
    secondaryForeground: '#242c40',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#ebe8dc',
    mutedForeground: '#727580',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#d8e9df',
    accentForeground: '#31594d',

    // Destructive actions (delete, error states)
    destructive: '#b33b2d',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#d8d1c0',
    input: '#d8d1c0',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 16,
};

export default colors;
