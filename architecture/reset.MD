Lees eerst README.md en volg de onboardingroute via architecture/AGENT_ONBOARDING.md en architecture/QUICKSTART.md. Run npm run context:agent, inspecteer de bestaande worktree zonder wijzigingen van anderen te overschrijven en lees daarna work/README.md.
Werk vervolgens zelfstandig alle task packages in work/todo/ af, in deterministische volgorde. Lees per task alle instructies en fixtures, traceer de relevante architectuur, code en tests, implementeer één complete verticale slice en verifieer proportioneel met unit-, boundary-, web- en desktopchecks.
Verplaats een task alleen naar work/done/ wanneer hij werkelijk compleet en bewezen is, update duurzame architectuur wanneer een contract verandert en maak per afgeronde milestone een gerichte lokale commit. Ga daarna automatisch door met de volgende task. Een statusvraag onderbreekt deze opdracht niet.
Stop alleen wanneer de queue leeg is, ik expliciet zeg te stoppen, of een echte productbeslissing/externe blokkade veilig verder werken onmogelijk maakt. Bewaak voortdurend de LightTable-principes: React voor UI, retained WebGPU/gizmo-routes voor canvasinteractie, minimale dirty invalidation, één canoniek documentmodel, stabiele command-ID’s en geen onbewezen commerciële of Photoshop-parityclaims.


npm run context:agent
