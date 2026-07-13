# Deployment Record

This repository was deployed from Git commit `a734fa5`.

## What worked

- The API worked locally on the OpenClaw server.
- The laptop CLI reached the server through Tailscale.
- When the laptop ran `habitat status`, backend request logs appeared on the server, which confirmed that the CLI request reached the backend successfully.

## What failed after shutdown

After stopping `bun run server`, the laptop showed this error:

```text
Unable to connect. Is the computer able to access the url?
```

This confirmed that the CLI depended on the backend process being available and that the remote request path stopped working once the server was no longer running.

## Network binding note

The backend must listen on `0.0.0.0` so the server can accept remote connections. Binding only to `localhost` would allow requests from the same machine, but it would prevent the laptop from reaching the server over Tailscale.

## Local files kept out of Git

The checkout still contains `.env` and `.habitat/habitat.sqlite` for local runtime use, but those files are ignored by Git and are not meant to be committed.

This document intentionally omits IP addresses, tokens, database contents, and credentials.
