# Open Talk Desktop

This is the Windows desktop client for Open Talk.

## Development

1. Install Node.js 20+.
2. Open a terminal in the `desktop` folder.
3. Run `npm install`.
4. Run `npm start`.

The desktop client opens Open Talk in a native Electron window. It uses the same production backend and WebRTC matching system as the mobile client.

## Windows installer

Run:

`npm run build:win`

The generated Windows installer will be placed in `desktop/dist/`.

## Local/staging URL

You can launch against another deployed Open Talk environment with:

`set OPEN_TALK_URL=https://your-staging-url.example && npm start`

No browser tab is required for the user: Open Talk runs in its own Windows application window.
