# Open Talk data model

## profiles
Identity and current AI level. locked_until is server enforced.

## conversations
Participant IDs, duration, consent state, transcript reference, AI assessment and timestamps.

## improvement_items
User ID, category, issue, evidence summary, priority, confidence, status, first_seen and last_seen.

## achievements
Stable achievement definitions and unlock criteria.

## user_achievements
User ID, achievement ID and unlocked timestamp.

## reports
Reporter, reported user, reason, evidence reference, moderation status and timestamps.

## moderation_actions
Case ID, action, reason, moderator/system actor, appeal state and timestamps.

## notifications
User ID, type, payload, read state and timestamps.

Keep sensitive data minimized and define deletion/retention rules before production launch.
