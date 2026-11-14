# Moby seccomp profile

Source: https://raw.githubusercontent.com/moby/profiles/f862455628f78f84c937e967e4a03902fb1dee11/seccomp/default.json

Pinned upstream commit: f862455628f78f84c937e967e4a03902fb1dee11. The profile is Apache-2.0 licensed by the Moby contributors; see LICENSE beside this notice. Bastion removes outbound socket calls from the allow rules and adds a connect refusal. The inherited syscall restrictions remain.
