# Realtime voice architecture

1. Client requests a match.
2. Match service reserves two compatible users and creates a session.
3. Clients obtain microphone permission.
4. WebRTC carries live audio; Supabase Realtime or a signaling service handles signaling.
5. Recording is off by default. Transcription/AI analysis requires clear consent.
6. Permitted transcript/audio data goes to a server-side analysis pipeline.
7. AI returns level evidence and the updated Need to Improve list.
8. Results are stored against the conversation and progress.
9. Users can report, block or leave immediately.

Use TURN for difficult networks, authenticated signaling, short-lived session credentials and rate limits.
