# Open Talk AI system

Users do not choose their speaking level. The system estimates A1/A2/B1/B2/C1/C2 from conversation evidence.

Evidence should include fluency, vocabulary range, grammar accuracy, intelligibility, response relevance, interaction skill and confidence. Aggregate evidence across multiple conversations so one unusual call does not cause a large level jump.

After every conversation, generate structured improvement items containing category, evidence, priority, actionable tip, confidence, first_seen, last_seen and status. Merge recurring issues, raise confidence when they recur, mark issues improving/resolved when later evidence supports it, and show the highest-value 3–5 items.

Only analyze conversations when the required consent is obtained. Do not infer protected traits and do not use gender as a quality or safety score.
