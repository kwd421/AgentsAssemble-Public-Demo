# Public demo interface

The public demo keeps its server rail, channel list, message feed and member panel. Onboarding is a room-level dialog rather than a separate dashboard.

## Design references

- Discord Custom Profiles: https://support.discord.com/hc/en-us/articles/4403147417623-Custom-Profiles — individual banners, avatars and profile identities.
- Discord Appearance: https://support.discord.com/hc/en-us/articles/207260127-How-to-Change-Discord-Color-Themes-and-Customize-Appearance-Settings — charcoal surfaces, readable type and separated navigation.
- Linear and Raycast were reviewed for restrained hierarchy, but the room layout remains Discord-like.

## UI decisions

- Stable agent IDs carry amber, blue and rose identities through setup, member list, profile editor and messages. Status dots still communicate execution state, not identity.
- Short Korean headings use word-break: keep-all. Instructions and fields use 14–16px text instead of the old 10–12px form text.
- Setup fields are blank. Placeholders show current values. Blank fields retain the current server profile; they never submit placeholder strings.
- Current profiles remain visible in the right-hand editor. The existing WebSocket profile queue and backend validation are retained.
- Native dialog provides keyboard focus containment and an inert background. Escape, close and skip never submit edits. Saving waits for server acknowledgements.
- On narrow viewports the member panel is an explicit drawer, and the profile form becomes a single column. Help is available in the chat header, not just the hidden mobile sidebar.
- No new provider, secret, server permission or AI tool is introduced.

## Verification

The `UI verification` workflow runs the existing Node test suite and a production build using the same pinned original style source as the Dockerfile. `scripts/ui-smoke.mjs` then starts a local fixture server and checks onboarding, placeholders, individual and three-profile saves, unmentioned three-agent turns, focus containment and responsive layout. It records screenshots at desktop, 1063px, tablet and mobile widths.

These browser checks use fixture responses only and consume no live model quota. Results and screenshots are uploaded as `ui-evidence`; a successful build alone is not a browser test.
